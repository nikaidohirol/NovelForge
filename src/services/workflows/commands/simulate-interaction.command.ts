/**
 * SimulateInteractionCommand — 互动模拟生成模式（模式B）
 *
 * 流程：角色 Agent 逐轮互动（可带导演干预与秘密拦截）→ 互动日志 →
 * 叙事重写为章节草稿 → 保存草稿并归档互动记录。
 * 与蓝图式生成（GenerateDraftCommand）并列，共享同一 GenerationRuntime
 * 预算与取消语义。
 */
import { BaseWorkflowCommand, type CommandExecuteParams } from './base-command'
import { ipc } from '../../ipc-client'
import {
  requireWorkflowProjectSession,
  workflowUiText,
  workflowWritingLanguage,
} from '../workflow-project-session'
import { promptLanguageText } from '../../prompt-language'
import { countDraftUnits } from '../../../shared/draft-units'
import { normalizeCharacterRole } from '../../../shared/character-role'
import type { CharacterRosterEntry } from '../../../shared/character-roster'
import {
  normalizeDirectorInsight,
  normalizeSimulationAction,
  scanSecretViolations,
  type DirectorInsight,
  type SimulationRunResult,
  type SimulationTurn,
} from '../../../shared/simulation-protocol'

export interface SimulationParams {
  readonly projectPath: string
  readonly chapterNumber: number
  readonly chapterTitle: string
  readonly characterNames: readonly string[]
  readonly scenario: string
  readonly maxTurns: number
}

export interface SimulationResult {
  readonly draftId: number
  readonly draftVersion: number
  readonly transcriptPath: string
}

interface Participant {
  name: string
  role: string
  gender: string
  age: string
  appearance: string
  personality: string
  background: string
  abilities: string
  motivation: string
  relationships: Array<{ target: string; relation: string }>
  goals: string[]
  catchphrase: string
  secrets: string[]
  panel: { hair: string; eyes: string; voice: string }
}

const DIRECTOR_INTERVAL = 2
const RECENT_TURNS_IN_PROMPT = 6

function participantFromEntry(entry: CharacterRosterEntry): Participant {
  return {
    name: entry.name,
    role: normalizeCharacterRole(entry.role),
    gender: entry.gender,
    age: entry.age,
    appearance: entry.appearance,
    personality: entry.personality,
    background: entry.background,
    abilities: entry.abilities,
    motivation: entry.motivation,
    relationships: entry.relationships ?? [],
    goals: entry.anime?.goals ?? [],
    catchphrase: entry.anime?.catchphrase ?? '',
    secrets: entry.anime?.secrets ?? [],
    panel: entry.anime?.panel ?? { hair: '', eyes: '', voice: '' },
  }
}

function publicLine(participant: Participant): string {
  const parts = [
    `${participant.name}（${participant.role}）`,
    participant.gender && `性别：${participant.gender}`,
    participant.age && `年龄：${participant.age}`,
    participant.appearance && `外貌：${participant.appearance}`,
    participant.panel.hair && `发色：${participant.panel.hair}`,
    participant.panel.eyes && `瞳色：${participant.panel.eyes}`,
    participant.panel.voice && `声线：${participant.panel.voice}`,
    participant.personality && `性格：${participant.personality}`,
    participant.motivation && `动机：${participant.motivation}`,
  ].filter(Boolean)
  return parts.join('｜')
}

function transcriptLine(turn: SimulationTurn): string {
  const target = turn.action.target ? ` → ${turn.action.target}` : ''
  const actionTag = turn.action.actionType === 'speak' ? '' : `（${turn.action.actionType}）`
  return `${turn.index}. ${turn.character}${target}${actionTag}：${turn.action.content}`
}

export class SimulateInteractionCommand extends BaseWorkflowCommand<SimulationResult> {
  constructor(private readonly params: SimulationParams) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<SimulationResult> {
    const projectSession = requireWorkflowProjectSession(context)
    const expectedProjectPath = context.projectPath
    const writingLanguage = workflowWritingLanguage(context)
    const text = (zhCN: string, enUS: string) => promptLanguageText(writingLanguage, zhCN, enUS)
    const uiText = (zhCN: string, enUS: string) => workflowUiText(context, zhCN, enUS)

    // 读取角色名单（含二次元扩展与秘密）
    const roster = await ipc.invokeWithProjectSession(
      projectSession,
      'db:character-roster-read',
      expectedProjectPath,
    )
    const selected = new Set(this.params.characterNames)
    const participants = (roster.entries as CharacterRosterEntry[])
      .filter(entry => selected.has(entry.name))
      .map(participantFromEntry)
    if (participants.length < 2) {
      throw new Error(uiText('互动模拟至少需要 2 名已存在的角色。', 'Simulation needs at least 2 existing characters.'))
    }

    callbacks.log(uiText(
      `互动模拟开始：${participants.map(p => p.name).join('、')} × 场景「${this.params.scenario}」`,
      `Simulation started: ${participants.map(p => p.name).join(', ')} in "${this.params.scenario}"`,
    ))

    const turns: SimulationTurn[] = []
    const insights: DirectorInsight[] = []
    const tensionCurve: number[] = []
    const interventions: SimulationRunResult['interventions'] = []
    let pendingEvent = ''

    return this.executeWithGenerationRuntime('text', { step: null, context, callbacks }, async () => {
      for (let turnIndex = 1; turnIndex <= this.params.maxTurns; turnIndex++) {
        this.assertNotCancelled(context)
        // 轮转起始顺序，避免固定发言次序
        const order = participants.map((_, offset) => participants[(offset + turnIndex) % participants.length])

        for (const actor of order) {
          this.assertNotCancelled(context)
          const action = await this.requestAction({
            context,
            callbacks,
            participants,
            actor,
            scenario: this.params.scenario,
            recentTurns: turns.slice(-RECENT_TURNS_IN_PROMPT),
            pendingEvent,
          })

          // 知识边界：发言不得泄露他人的秘密 → 拦截重生成一次
          const others = participants
            .filter(p => p.name !== actor.name)
          let violations = scanSecretViolations(action.content, others.map(p => ({ name: p.name, secrets: p.secrets })))
          let finalAction = action
          let regenerated = false
          if (violations.length > 0) {
            callbacks.log(uiText(
              `  ⚠ ${actor.name} 的发言命中秘密边界（${violations.length} 处），拦截重生成`,
              `  ⚠ ${actor.name}'s line hit secret boundaries (${violations.length}); regenerating`,
            ))
            const retry = await this.requestAction({
              context,
              callbacks,
              participants,
              actor,
              scenario: this.params.scenario,
              recentTurns: turns.slice(-RECENT_TURNS_IN_PROMPT),
              pendingEvent,
              boundaryWarning: violations,
            })
            regenerated = true
            finalAction = retry
            violations = scanSecretViolations(retry.content, others.map(p => ({ name: p.name, secrets: p.secrets })))
            if (violations.length > 0) {
              finalAction = { actionType: 'silence', content: text('（欲言又止，把话咽了回去）', '(hesitates and swallows the words)') }
            }
          }

          const turn: SimulationTurn = {
            index: turns.length + 1,
            character: actor.name,
            action: finalAction,
            secretViolations: violations,
            regenerated,
          }
          turns.push(turn)
          callbacks.log(uiText(
            transcriptLine(turn),
            transcriptLine(turn),
          ))
        }

        // 导演评估：每 2 轮一次，四维加权张力 + 干预决策
        if (turnIndex % DIRECTOR_INTERVAL === 0 || turnIndex === this.params.maxTurns) {
          this.assertNotCancelled(context)
          const insight = await this.requestDirectorInsight({
            context,
            callbacks,
            participants,
            scenario: this.params.scenario,
            recentTurns: turns.slice(-DIRECTOR_INTERVAL * 2),
          })
          insights.push(insight)
          tensionCurve.push(insight.tension)
          callbacks.log(uiText(
            `  🎬 张力 ${insight.tension.toFixed(1)}/10（关系 ${insight.relationShift}｜冲突 ${insight.goalConflict}｜秘密 ${insight.secretPressure}｜新颖 ${insight.novelty}）`,
            `  🎬 Tension ${insight.tension.toFixed(1)}/10 (relation ${insight.relationShift} | conflict ${insight.goalConflict} | secret ${insight.secretPressure} | novelty ${insight.novelty})`,
          ))
          if (insight.needIntervention && insight.eventDescription) {
            interventions.push({ turn: turnIndex, type: insight.eventType ?? 'external_event', description: insight.eventDescription })
            pendingEvent = insight.eventDescription
            callbacks.log(uiText(
              `  ⚡ 导演注入：${insight.eventDescription}`,
              `  ⚡ Director injection: ${insight.eventDescription}`,
            ))
          } else {
            pendingEvent = ''
          }
        }
      }

      // 叙事重写：互动日志 → 章节草稿
      callbacks.log(uiText('互动完成，开始按文风重写为章节草稿…', 'Interaction complete. Rewriting the transcript into a chapter draft…'))
      const prose = await this.rewriteAsChapter({ context, callbacks, participants, turns })

      this.assertNotCancelled(context)
      const nextVersion: number = await ipc.invokeWithProjectSession(
        projectSession,
        'db:draft-next-version',
        this.params.chapterNumber,
        expectedProjectPath,
      )
      const createResult = await ipc.invokeWithProjectSession(projectSession, 'db:draft-create', {
        chapterNumber: this.params.chapterNumber,
        version: nextVersion,
        source: 'write',
        content: prose,
        wordCount: countDraftUnits(prose),
      }, expectedProjectPath)
      if (!createResult.success || !createResult.id) {
        throw new Error(createResult.error || uiText('章节草稿保存失败', 'Failed to save the chapter draft.'))
      }

      // 归档互动记录（含张力曲线与违规记录），供复盘与实验分析
      const runResult: SimulationRunResult = {
        characterNames: participants.map(p => p.name),
        scenario: this.params.scenario,
        maxTurns: this.params.maxTurns,
        tensionCurve,
        insights,
        turns,
        interventions,
      }
      const transcriptPath = `${expectedProjectPath}/.novelforge/simulations/sim-ch${this.params.chapterNumber}-${Date.now()}.json`
      try {
        await ipc.invokeWithProjectSession(
          projectSession,
          'fs:write-file',
          transcriptPath,
          JSON.stringify(runResult, null, 2),
          expectedProjectPath,
        )
      } catch { /* 归档失败不阻塞草稿产出 */ }

      context.data.draft = prose
      context.data.draftContent = prose
      context.data.draftId = createResult.id
      context.data.draftVersion = nextVersion
      context.data.draftPath = `novelforge://draft/${createResult.id}`
      context.data.chapterNumber = this.params.chapterNumber
      callbacks.log(uiText(
        `第 ${this.params.chapterNumber} 章草稿已生成（互动模拟），互动记录已归档。`,
        `Chapter ${this.params.chapterNumber} draft generated via simulation; the transcript was archived.`,
      ))
      return { draftId: createResult.id, draftVersion: nextVersion, transcriptPath }
    })
  }

  private async requestAction(options: {
    context: CommandExecuteParams['context']
    callbacks: CommandExecuteParams['callbacks']
    participants: Participant[]
    actor: Participant
    scenario: string
    recentTurns: SimulationTurn[]
    pendingEvent: string
    boundaryWarning?: string[]
  }): Promise<ReturnType<typeof normalizeSimulationAction>> {
    const writingLanguage = workflowWritingLanguage(options.context)
    const text = (zhCN: string, enUS: string) => promptLanguageText(writingLanguage, zhCN, enUS)
    const { actor } = options

    const persona = [
      `你是「${actor.name}」，正在与故事中的其他角色互动。`,
      actor.gender && `性别：${actor.gender}`,
      actor.age && `年龄：${actor.age}`,
      actor.appearance && `外貌：${actor.appearance}`,
      actor.personality && `性格：${actor.personality}`,
      actor.background && `背景：${actor.background}`,
      actor.abilities && `能力：${actor.abilities}`,
      actor.motivation && `核心动机：${actor.motivation}`,
      actor.goals.length > 0 && `本场景目标：${actor.goals.join('；')}`,
      actor.catchphrase && `口头禅（可自然使用，不要每句都用）：${actor.catchphrase}`,
      actor.secrets.length > 0 && `你自己的秘密（绝不可主动说出口）：${actor.secrets.join('；')}`,
    ].filter(Boolean).join('\n')

    const others = options.participants
      .filter(p => p.name !== actor.name)
      .map(p => publicLine(p))
      .join('\n')
    const relations = actor.relationships
      .map(r => r.target && r.relation ? `- ${r.target}：${r.relation}` : '')
      .filter(Boolean)
      .join('\n')
    const recent = options.recentTurns.length > 0
      ? options.recentTurns.map(transcriptLine).join('\n')
      : text('（还没有互动，你来开场）', '(No interaction yet; you open the scene.)')
    const event = options.pendingEvent
      ? text(`【导演事件】${options.pendingEvent}\n请让该事件自然影响你的行动。`, `[Director event] ${options.pendingEvent}\nLet it naturally affect your action.`)
      : ''
    const warning = options.boundaryWarning?.length
      ? text(
        `【警告】你上一条发言泄露了不该知道的秘密：\n${options.boundaryWarning.join('\n')}\n重新发言时必须完全回避这些信息——你的角色并不知道它们。`,
        `[Warning] Your previous line leaked secrets you must not know:\n${options.boundaryWarning.join('\n')}\nRewrite while avoiding them entirely.`,
      )
      : ''

    const system = text(
      '你是一个多角色互动小说模拟中的角色扮演引擎。只输出一个 JSON 对象，不要输出任何其他内容。',
      'You are a roleplay engine in a multi-character fiction simulation. Output exactly one JSON object and nothing else.',
    )
    const prompt = [
      persona,
      text('【其他角色（公开信息）】', '[Other characters (public info)]'), others,
      relations && text('【你与他们的关系】', '[Your relationships]') + `\n${relations}`,
      text('【场景】', '[Scenario]'), options.scenario,
      text('【最近互动】', '[Recent transcript]'), recent,
      event,
      warning,
      text(
        '请以该角色的身份决定下一步行动。行动类型 action_type ∈ speak/move/use/observe/silence；content 为发言原文（可直接引用）或动作描述；target 为互动对象（可选）。保持人设与说话方式，推动你的目标。',
        'Decide the character\'s next move. action_type ∈ speak/move/use/observe/silence; content is the spoken line or action description; target is optional. Stay in character and pursue your goals.',
      ),
      text(
        '输出格式：{"action_type":"speak","content":"…","target":"…"}',
        'Output format: {"action_type":"speak","content":"…","target":"…"}',
      ),
    ].filter(Boolean).join('\n\n')

    const raw = await this.callLLM(prompt, system, options.callbacks, { purpose: 'simulation-actor' }, options.context)
    return normalizeSimulationAction(this.parseJSON(raw))
  }

  private async requestDirectorInsight(options: {
    context: CommandExecuteParams['context']
    callbacks: CommandExecuteParams['callbacks']
    participants: Participant[]
    scenario: string
    recentTurns: SimulationTurn[]
  }): Promise<DirectorInsight> {
    const writingLanguage = workflowWritingLanguage(options.context)
    const text = (zhCN: string, enUS: string) => promptLanguageText(writingLanguage, zhCN, enUS)
    const roster = options.participants.map(p => publicLine(p)).join('\n')
    const goalsBlock = options.participants
      .map(p => p.goals.length > 0 ? `${p.name}：${p.goals.join('；')}` : `${p.name}：（无明确目标）`)
      .join('\n')
    const secretsBlock = options.participants
      .map(p => p.secrets.length > 0 ? `${p.name}：${p.secrets.join('；')}` : `${p.name}：（无）`)
      .join('\n')
    const transcript = options.recentTurns.map(transcriptLine).join('\n')

    const system = text(
      '你是互动模拟的导演 Agent，负责评估戏剧张力并决定是否注入干预事件。只输出一个 JSON 对象。',
      'You are the director agent of an interactive fiction simulation. Output exactly one JSON object.',
    )
    const prompt = [
      text('【场景】', '[Scenario]'), options.scenario,
      text('【角色档案】', '[Characters]'), roster,
      text('【各角色目标】', '[Goals]'), goalsBlock,
      text('【各角色秘密（仅你可见）】', '[Secrets (director-only)]'), secretsBlock,
      text('【最近互动】', '[Recent transcript]'), transcript,
      text(
        '请评估：relation_shift（关系变化强度）、goal_conflict（目标冲突）、secret_pressure（秘密悬而未决带来的压力）、novelty（互动新颖度，避免寒暄与重复），均为 0-10；并决定 need_intervention 是否注入干预（互动平淡/固化时注入，eventType ∈ external_event/secret_reveal/deadline/new_character）。',
        'Rate relation_shift, goal_conflict, secret_pressure and novelty (0-10 each) and decide need_intervention (inject when the scene turns flat or repetitive; event_type ∈ external_event/secret_reveal/deadline/new_character).',
      ),
      text(
        '输出格式：{"relation_shift":0,"goal_conflict":0,"secret_pressure":0,"novelty":0,"need_intervention":false,"event_type":"external_event","event_description":"…"}',
        'Output format: {"relation_shift":0,"goal_conflict":0,"secret_pressure":0,"novelty":0,"need_intervention":false,"event_type":"external_event","event_description":"…"}',
      ),
    ].filter(Boolean).join('\n\n')

    const raw = await this.callLLM(prompt, system, options.callbacks, { purpose: 'simulation-director' }, options.context)
    return normalizeDirectorInsight(this.parseJSON(raw))
  }

  private async rewriteAsChapter(options: {
    context: CommandExecuteParams['context']
    callbacks: CommandExecuteParams['callbacks']
    participants: Participant[]
    turns: SimulationTurn[]
  }): Promise<string> {
    const writingLanguage = workflowWritingLanguage(options.context)
    const text = (zhCN: string, enUS: string) => promptLanguageText(writingLanguage, zhCN, enUS)
    const transcript = options.turns.map(transcriptLine).join('\n')
    const roster = options.participants.map(p => publicLine(p)).join('\n')

    const system = text(
      '你是一位资深轻小说作者。把给定的角色互动记录改写为小说章节正文：以具体角色 POV 或旁观视角叙述，保留关键台词（可用引号直录）、动作与心理描写，按场景自然分段，不得出现 JSON 或「第X轮」等记录痕迹。',
      'You are an expert light-novel author. Rewrite the given interaction transcript into chapter prose: narrate from a character POV or observer view, keep key dialogue quoted, add action and inner-monologue beats, break into natural paragraphs, and leave no JSON or turn-number artifacts.',
    )
    const prompt = [
      text(`【章节】第 ${this.params.chapterNumber} 章 · ${this.params.chapterTitle}`, `[Chapter] Chapter ${this.params.chapterNumber} · ${this.params.chapterTitle}`),
      text('【角色档案】', '[Characters]'), roster,
      text('【互动记录（事实来源，不得编造关键事件）】', '[Transcript (source of truth; do not invent key events)]'), transcript,
      text(
        '请输出章节正文（Markdown，一级标题写章节名）。篇幅 1500-3000 字，节奏轻快、对话鲜活。',
        'Output the chapter prose (Markdown, first heading = chapter title). 1500-3000 words, lively pacing and vivid dialogue.',
      ),
    ].filter(Boolean).join('\n\n')

    return this.callLLM(prompt, system, options.callbacks, { purpose: 'simulation-rewrite', writingSkillStage: 'drafting' }, options.context)
  }
}
