/**
 * SimulationDialog — 互动模拟启动对话框（模式B 特色入口）
 * 选择 2-4 名角色 + 场景 + 轮数，运行「互动 → 叙事重写」工作流生成章节草稿。
 */
import { useMemo, useState } from 'react'
import { MessagesSquare, Play } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useCharacterStore } from '../../stores/character-store'
import { useLLMStore } from '../../stores/llm-store'
import { useWorkflowStore, workflowResourceConflictMessage } from '../../stores/workflow-store'
import { useLocaleStore } from '../../stores/locale-store'
import { createSimulationWorkflow } from '../../services/workflows/simulation-workflow'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Label } from '../ui/Label'
import {
  captureProjectSession,
  isProjectSessionCurrent,
} from '../project-session-gate'
import type { ModelProfile } from '../../shared/ipc-channels'

const MAX_PARTICIPANTS = 4
const MIN_TURNS = 2
const MAX_TURNS = 20

interface Props {
  isOpen: boolean
  onClose: () => void
}

function isGenerationModel(model: ModelProfile): boolean {
  return model.purposes.includes('generation')
}

function preferredGenerationModelId(models: ModelProfile[], defaultModelId: string | null): string | null {
  return defaultModelId && models.some(model => model.id === defaultModelId && isGenerationModel(model))
    ? defaultModelId
    : models.find(isGenerationModel)?.id
    ?? null
}

export default function SimulationDialog({ isOpen, onClose }: Props) {
  const text = useLocaleStore(s => s.text)
  const characters = useCharacterStore(s => s.characters)
  const models = useLLMStore(s => s.models)
  const defaultModelId = useLLMStore(s => s.defaultModelId)

  const [selected, setSelected] = useState<string[]>([])
  const [scenario, setScenario] = useState('')
  const [maxTurns, setMaxTurns] = useState(6)
  const [chapterNumber, setChapterNumber] = useState(1)
  const [chapterTitle, setChapterTitle] = useState('')
  const [error, setError] = useState<string | null>(null)

  const modelId = useMemo(() => preferredGenerationModelId(models, defaultModelId), [models, defaultModelId])

  const toggle = (name: string) => {
    setSelected((prev) => {
      if (prev.includes(name)) return prev.filter(item => item !== name)
      if (prev.length >= MAX_PARTICIPANTS) return prev
      return [...prev, name]
    })
  }

  const handleStart = () => {
    const project = useProjectStore.getState().currentProject
    if (!project) return
    const projectSession = captureProjectSession(project)
    if (!projectSession) return

    if (selected.length < 2) {
      setError(text('至少选择 2 名角色', 'Select at least 2 characters'))
      return
    }
    if (!scenario.trim()) {
      setError(text('请填写场景描述', 'Describe the scenario'))
      return
    }
    if (!isProjectSessionCurrent(projectSession)) return

    const workflow = createSimulationWorkflow({
      projectPath: project.path,
      chapterNumber: Math.max(1, Math.floor(chapterNumber) || 1),
      chapterTitle: chapterTitle.trim() || text('互动模拟', 'Simulation'),
      characterNames: selected,
      scenario: scenario.trim(),
      maxTurns: Math.min(MAX_TURNS, Math.max(MIN_TURNS, Math.floor(maxTurns) || MIN_TURNS)),
    }, projectSession, {
      ...(modelId ? { generationModelId: modelId } : {}),
      uiLocale: useLocaleStore.getState().locale,
    })

    const resourceConflict = useWorkflowStore.getState().getResourceConflict(workflow)
    if (resourceConflict) {
      setError(workflowResourceConflictMessage(useLocaleStore.getState().locale, resourceConflict.title))
      return
    }
    void useWorkflowStore.getState().startWorkflow(workflow, false)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessagesSquare size={16} className="text-[var(--color-accent)]" />
            {text('互动模拟生成', 'Interactive simulation')}
          </DialogTitle>
          <DialogDescription>
            {text(
              '角色在场景中自主互动（导演控场、秘密不越界），互动日志自动重写为章节草稿。',
              'Characters improvise in a scene under a director with secret boundaries; the transcript is rewritten into a chapter draft.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>
              {text('参与角色', 'Participants')}
              <span className="ml-2 text-[0.65rem] font-normal text-[var(--color-text-secondary)]">
                {text(`已选 ${selected.length}/${MAX_PARTICIPANTS}（至少 2）`, `${selected.length}/${MAX_PARTICIPANTS} selected (min 2)`)}
              </span>
            </Label>
            {characters.length === 0 ? (
              <p className="text-xs text-[var(--color-text-secondary)]">
                {text('暂无角色，请先创建角色卡', 'No characters yet; create character cards first')}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {characters.map((character) => {
                  const active = selected.includes(character.name)
                  return (
                    <button
                      key={character.name}
                      type="button"
                      onClick={() => toggle(character.name)}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
                      style={{
                        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        backgroundColor: active ? 'var(--color-active)' : 'transparent',
                      }}
                    >
                      <span
                        className="h-4 w-4 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: character.anime?.avatarColor || 'var(--color-role-supporting, #0E9F6E)' }}
                      />
                      <span className="truncate">{character.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <Label>{text('场景描述', 'Scenario')}</Label>
            <Textarea
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              rows={3}
              placeholder={text(
                '如：学园祭前夜，社团教室里只剩两个人，预算表却对不上账……',
                'e.g. On the eve of the school festival, two club members alone in the room find the budget sheet does not add up...',
              )}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>{text('互动轮数', 'Turns')}</Label>
              <Input
                type="number"
                min={MIN_TURNS}
                max={MAX_TURNS}
                value={maxTurns}
                onChange={(e) => setMaxTurns(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>{text('目标章节', 'Chapter')}</Label>
              <Input
                type="number"
                min={1}
                value={chapterNumber}
                onChange={(e) => setChapterNumber(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>{text('章节标题', 'Title')}</Label>
              <Input
                value={chapterTitle}
                onChange={(e) => setChapterTitle(e.target.value)}
                placeholder={text('可留空', 'Optional')}
              />
            </div>
          </div>

          {error && (
            <p className="text-xs" style={{ color: 'var(--color-danger-text, #DC2626)' }}>{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{text('取消', 'Cancel')}</Button>
          <Button onClick={handleStart} disabled={characters.length < 2}>
            <Play size={12} /> {text('开始模拟', 'Start simulation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
