/**
 * 二次元角色卡扩展 — 叠加在基础角色卡之上的特化字段。
 *
 * 设计约束：
 * - 该扩展由作者手动维护，LLM 候选角色不会生成这些字段；
 * - `secrets` 是模拟/生成中的知识边界来源，不得进入常规 Markdown 渲染；
 * - 空扩展序列化为空串落库，旧角色读出后表现为无扩展。
 */

/** 属性面板：外貌的结构化字段（与自由文本 appearance 互补） */
export interface CharacterAnimePanel {
  /** 发色 */
  hair: string
  /** 瞳色 */
  eyes: string
  /** 声线 */
  voice: string
}

/** 二次元角色卡扩展 */
export interface CharacterAnimeCard {
  /** 头像色板（UI 头像底色，#RRGGBB） */
  avatarColor: string
  /** 萌属性标签（傲娇/天然呆/腹黑…） */
  traits: string[]
  /** 口头禅 */
  catchphrase: string
  /** 目标（驱动模拟决策） */
  goals: string[]
  /** 秘密：其他角色不可知（知识边界） */
  secrets: string[]
  /** 属性面板 */
  panel: CharacterAnimePanel
}

/** 角色头像色板预设（樱粉×浅紫主题友好） */
export const ANIME_AVATAR_COLORS = [
  '#E0568F', '#7C4DBF', '#0E9F6E', '#D97706',
  '#2563EB', '#DC2626', '#0891B2', '#C9A8C4',
] as const

export const EMPTY_CHARACTER_ANIME_PANEL: CharacterAnimePanel = {
  hair: '',
  eyes: '',
  voice: '',
}

export const EMPTY_CHARACTER_ANIME_CARD: CharacterAnimeCard = {
  avatarColor: '',
  traits: [],
  catchphrase: '',
  goals: [],
  secrets: [],
  panel: { ...EMPTY_CHARACTER_ANIME_PANEL },
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => asText(item))
    .filter(item => item.length > 0)
}

function asPanel(value: unknown): CharacterAnimePanel {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    hair: asText(source.hair),
    eyes: asText(source.eyes),
    voice: asText(source.voice),
  }
}

/** 判断扩展是否为空（空扩展不落库、不进投影哈希） */
export function isEmptyCharacterAnimeCard(card: CharacterAnimeCard | undefined | null): boolean {
  if (!card) return true
  return (
    !card.avatarColor
    && card.traits.length === 0
    && !card.catchphrase
    && card.goals.length === 0
    && card.secrets.length === 0
    && !card.panel.hair
    && !card.panel.eyes
    && !card.panel.voice
  )
}

/** 归一化未知来源的二次元扩展数据（防御式，永远返回合法对象） */
export function normalizeCharacterAnimeCard(value: unknown): CharacterAnimeCard {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const normalized: CharacterAnimeCard = {
    avatarColor: asText(source.avatarColor),
    traits: asTextArray(source.traits),
    catchphrase: asText(source.catchphrase),
    goals: asTextArray(source.goals),
    secrets: asTextArray(source.secrets),
    panel: asPanel(source.panel),
  }
  return normalized
}

/**
 * 解析数据库 anime_json 列；空/损坏数据返回 undefined（视为无扩展）。
 */
export function parseCharacterAnimeCard(value: unknown): CharacterAnimeCard | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  const card = normalizeCharacterAnimeCard(parsed)
  return isEmptyCharacterAnimeCard(card) ? undefined : card
}

/** 序列化落库；空扩展返回空串，保持旧行为兼容 */
export function serializeCharacterAnimeCard(card: CharacterAnimeCard | undefined): string {
  if (!card || isEmptyCharacterAnimeCard(card)) return ''
  return JSON.stringify(card)
}
