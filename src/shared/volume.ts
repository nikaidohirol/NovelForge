/**
 * 轻小说分卷规则 — 卷（Volume）> 章（Chapter）的组织单位。
 *
 * 分卷采用确定规则：第 N 章属于第 ceil(N / chaptersPerVolume) 卷。
 * chaptersPerVolume 无效（0/负数/非整数）时视为不分卷（volumeOfChapter 返回 0）。
 */

/** 未配置或无效时的规范化结果：0 = 不分卷。 */
export const MAX_CHAPTERS_PER_VOLUME = 99

export function resolveChaptersPerVolume(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 0) return 0
    if (parsed > MAX_CHAPTERS_PER_VOLUME) return MAX_CHAPTERS_PER_VOLUME
    return parsed
}

/** 是否启用分卷 */
export function volumeEnabled(chaptersPerVolume: unknown): boolean {
    return resolveChaptersPerVolume(chaptersPerVolume) >= 1
}

/** 第 chapterNumber 章所属卷号；未分卷返回 0。 */
export function volumeOfChapter(chapterNumber: number, chaptersPerVolume: unknown): number {
    const perVolume = resolveChaptersPerVolume(chaptersPerVolume)
    if (perVolume < 1 || !Number.isSafeInteger(chapterNumber) || chapterNumber < 1) return 0
    return Math.ceil(chapterNumber / perVolume)
}

/** 卷标题（第 1 卷）；输入 0 或负数返回空串。 */
export function volumeLabel(volume: number): string {
    return Number.isSafeInteger(volume) && volume >= 1 ? `第${volume}卷` : ''
}

/**
 * 侧边栏分组标签：仅卷号（如「第2卷」）。
 * 章节范围由分组内的条目自解释，避免配置变更后标签与实际内容不一致。
 */
export function volumeGroupLabel(volume: number): string {
    return volumeLabel(volume)
}
