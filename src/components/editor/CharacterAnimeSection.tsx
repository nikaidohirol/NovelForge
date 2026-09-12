import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Label } from '../ui/Label'
import {
  ANIME_AVATAR_COLORS,
  normalizeCharacterAnimeCard,
  type CharacterAnimeCard,
} from '../../shared/character-anime'
import { useLocaleStore } from '../../stores/locale-store'

/** 萌属性快捷标签（可自由输入扩展） */
const TRAIT_PRESETS = [
  '傲娇', '天然呆', '腹黑', '无口', '元气', '病娇', '三无', '大小姐', '中二', '猫系',
] as const

function linesToText(lines: readonly string[]): string {
  return lines.join('\n')
}

function textToLines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

/**
 * 二次元角色卡扩展编辑区 — 色板/萌属性/口头禅/属性面板/目标/秘密。
 * 所有字段为作者手动维护；秘密是模拟与生成中的知识边界来源。
 */
export default function CharacterAnimeSection({
  anime,
  onChange,
}: {
  anime: CharacterAnimeCard | undefined
  onChange: (anime: CharacterAnimeCard) => void
}) {
  const text = useLocaleStore(s => s.text)
  const [traitInput, setTraitInput] = useState('')
  const current = normalizeCharacterAnimeCard(anime)

  const patch = (partial: Partial<CharacterAnimeCard>) => {
    onChange(normalizeCharacterAnimeCard({ ...current, ...partial }))
  }

  const toggleTrait = (trait: string) => {
    patch({
      traits: current.traits.includes(trait)
        ? current.traits.filter(item => item !== trait)
        : [...current.traits, trait],
    })
  }

  const addTrait = () => {
    const trait = traitInput.trim()
    if (!trait || current.traits.includes(trait)) return
    patch({ traits: [...current.traits, trait] })
    setTraitInput('')
  }

  return (
    <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text)]">
        <Sparkles size={14} />
        {text('二次元档案', 'Anime profile')}
      </div>

      {/* 头像色板 */}
      <div>
        <Label>{text('头像色板', 'Avatar color')}</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {ANIME_AVATAR_COLORS.map(color => (
            <button
              key={color}
              type="button"
              aria-label={color}
              onClick={() => patch({ avatarColor: color })}
              className="h-6 w-6 rounded-full transition"
              style={{
                backgroundColor: color,
                outline: current.avatarColor === color ? '2px solid var(--color-text)' : 'none',
                outlineOffset: 1,
              }}
            />
          ))}
          <input
            type="color"
            aria-label={text('自定义颜色', 'Custom color')}
            value={current.avatarColor || '#E0568F'}
            onChange={e => patch({ avatarColor: e.target.value })}
            className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
          />
        </div>
      </div>

      {/* 萌属性标签 */}
      <div>
        <Label>{text('萌属性标签', 'Moe traits')}</Label>
        <div className="flex flex-wrap gap-1.5">
          {current.traits.map(trait => (
            <span
              key={trait}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text)' }}
            >
              {trait}
              <button
                type="button"
                aria-label={text(`移除 ${trait}`, `Remove ${trait}`)}
                onClick={() => toggleTrait(trait)}
                className="opacity-60 transition hover:opacity-100"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Input
            value={traitInput}
            onChange={(e) => setTraitInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addTrait()
              }
            }}
            placeholder={text('输入标签后回车添加...', 'Type a trait and press Enter...')}
            className="h-7 w-44 text-xs"
          />
          {TRAIT_PRESETS.filter(preset => !current.traits.includes(preset)).map(preset => (
            <button
              key={preset}
              type="button"
              onClick={() => toggleTrait(preset)}
              className="rounded-full px-2 py-0.5 text-xs transition"
              style={{
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-secondary)',
              }}
            >
              + {preset}
            </button>
          ))}
        </div>
      </div>

      {/* 属性面板 + 口头禅 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{text('发色', 'Hair color')}</Label>
          <Input
            value={current.panel.hair}
            onChange={(e) => patch({ panel: { ...current.panel, hair: e.target.value } })}
            placeholder={text('如：樱粉色长发', 'e.g. sakura-pink long hair')}
          />
        </div>
        <div>
          <Label>{text('瞳色', 'Eye color')}</Label>
          <Input
            value={current.panel.eyes}
            onChange={(e) => patch({ panel: { ...current.panel, eyes: e.target.value } })}
            placeholder={text('如：琥珀色', 'e.g. amber')}
          />
        </div>
        <div>
          <Label>{text('声线', 'Voice')}</Label>
          <Input
            value={current.panel.voice}
            onChange={(e) => patch({ panel: { ...current.panel, voice: e.target.value } })}
            placeholder={text('如：软糯少女音', 'e.g. soft girlish voice')}
          />
        </div>
        <div>
          <Label>{text('口头禅', 'Catchphrase')}</Label>
          <Input
            value={current.catchphrase}
            onChange={(e) => patch({ catchphrase: e.target.value })}
            placeholder={text('如：才、才不是为了你！', 'e.g. "I-It is not like I did it for you!"')}
          />
        </div>
      </div>

      {/* 目标 */}
      <div>
        <Label>{text('目标（每行一条）', 'Goals (one per line)')}</Label>
        <Textarea
          value={linesToText(current.goals)}
          onChange={(e) => patch({ goals: textToLines(e.target.value) })}
          rows={2}
          placeholder={text('驱动角色在模拟中行动的目标...', 'Goals that drive the character in simulation...')}
        />
      </div>

      {/* 秘密 */}
      <div>
        <Label>{text('秘密（每行一条）', 'Secrets (one per line)')}</Label>
        <Textarea
          value={linesToText(current.secrets)}
          onChange={(e) => patch({ secrets: textToLines(e.target.value) })}
          rows={2}
          placeholder={text('其他角色不可知的信息...', 'Facts other characters must not know...')}
        />
        <p className="mt-1 text-[0.65rem] text-[var(--color-text-secondary)]">
          {text(
            '秘密仅作者可见；互动模拟与章节生成中构成知识边界，角色不得泄露。',
            'Secrets are author-only; they form knowledge boundaries in simulation and generation.',
          )}
        </p>
      </div>
    </div>
  )
}
