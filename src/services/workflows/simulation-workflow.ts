/**
 * 互动模拟工作流工厂 — 模式B 入口。
 * 与 createChapterWorkflow（蓝图式，模式A）并列，产出同一形态的章节草稿。
 */
import { workflowResourceKey, type WorkflowDefinition } from '../../stores/workflow-store'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import { sameProjectPathKey } from '../../shared/project-session-context'
import type { Locale } from '../../i18n/types'
import { localize } from '../../i18n/core'

export interface SimulationWorkflowParams {
  projectPath: string
  chapterNumber: number
  chapterTitle: string
  characterNames: string[]
  scenario: string
  maxTurns: number
}

export interface SimulationWorkflowOptions {
  generationModelId?: string
  uiLocale?: Locale
}

function workflowProjectSession(
  projectPath: string,
  sourceProjectSession: ProjectSessionContext,
): ProjectSessionContext {
  if (!sameProjectPathKey(sourceProjectSession.projectPath, projectPath)) {
    throw new Error(localize(
      'zh-CN',
      '工作流项目会话与目标路径不匹配',
      'Workflow project session does not match the target path',
    ))
  }
  return Object.freeze({ ...sourceProjectSession })
}

export function createSimulationWorkflow(
  params: SimulationWorkflowParams,
  sourceProjectSession: ProjectSessionContext,
  options: SimulationWorkflowOptions = {},
): WorkflowDefinition {
  const uiLocale = options.uiLocale ?? 'zh-CN'
  const generationModelId = options.generationModelId?.trim() || undefined
  const frozenParams = Object.freeze({ ...params, characterNames: Object.freeze([...params.characterNames]) })
  return {
    type: 'chapter_creation',
    projectPath: params.projectPath,
    projectSession: workflowProjectSession(params.projectPath, sourceProjectSession),
    uiLocale,
    ...(generationModelId ? { generationModelId } : {}),
    resourceKeys: [workflowResourceKey('chapter', params.chapterNumber)],
    readResourceKeys: [],
    title: localize(uiLocale,
      `互动模拟 — 第 ${params.chapterNumber} 章 · ${params.chapterTitle}`,
      `Simulation — Chapter ${params.chapterNumber} · ${params.chapterTitle}`,
    ),
    steps: [
      {
        name: localize(uiLocale, '互动模拟', 'Interactive simulation'),
        description: localize(
          uiLocale,
          '角色在场景中自主互动（导演控场 + 秘密边界），互动日志再重写为草稿',
          'Characters interact under a director with secret boundaries; the transcript is rewritten into a draft',
        ),
        executor: async (step, context, callbacks) => {
          const { SimulateInteractionCommand } = await import('./commands/simulate-interaction.command')
          const cmd = new SimulateInteractionCommand(frozenParams)
          await cmd.execute({ step, context, callbacks })
        },
      },
    ],
    onComplete: {
      mode: 'open',
      message: localize(
        uiLocale,
        `第${params.chapterNumber}章草稿已由互动模拟生成`,
        `Chapter ${params.chapterNumber} draft generated via simulation`,
      ),
    },
  }
}
