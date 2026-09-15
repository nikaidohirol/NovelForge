import { describe, expect, it } from 'vitest'
import {
  MAX_CHAPTERS_PER_VOLUME,
  resolveChaptersPerVolume,
  volumeEnabled,
  volumeGroupLabel,
  volumeLabel,
  volumeOfChapter,
} from '../volume'

describe('resolveChaptersPerVolume', () => {
  it('有效整数原样返回', () => {
    expect(resolveChaptersPerVolume(6)).toBe(6)
    expect(resolveChaptersPerVolume(12)).toBe(12)
  })

  it('无效输入规范化为 0（不分卷）', () => {
    expect(resolveChaptersPerVolume(0)).toBe(0)
    expect(resolveChaptersPerVolume(-3)).toBe(0)
    expect(resolveChaptersPerVolume(2.5)).toBe(0)
    expect(resolveChaptersPerVolume(NaN)).toBe(0)
    expect(resolveChaptersPerVolume(undefined)).toBe(0)
    expect(resolveChaptersPerVolume('abc')).toBe(0)
  })

  it('数字字符串可解析', () => {
    expect(resolveChaptersPerVolume('8')).toBe(8)
  })

  it('超过上限时钳制到 MAX_CHAPTERS_PER_VOLUME', () => {
    expect(resolveChaptersPerVolume(MAX_CHAPTERS_PER_VOLUME + 1)).toBe(MAX_CHAPTERS_PER_VOLUME)
  })
})

describe('volumeEnabled', () => {
  it('每卷章数 >= 1 时启用', () => {
    expect(volumeEnabled(1)).toBe(true)
    expect(volumeEnabled(10)).toBe(true)
  })

  it('0 或无效值不启用', () => {
    expect(volumeEnabled(0)).toBe(false)
    expect(volumeEnabled(undefined)).toBe(false)
  })
})

describe('volumeOfChapter', () => {
  it('按 ceil(章号/每卷章数) 归卷', () => {
    expect(volumeOfChapter(1, 6)).toBe(1)
    expect(volumeOfChapter(6, 6)).toBe(1)
    expect(volumeOfChapter(7, 6)).toBe(2)
    expect(volumeOfChapter(12, 6)).toBe(2)
    expect(volumeOfChapter(13, 6)).toBe(3)
  })

  it('未分卷或非法章号返回 0', () => {
    expect(volumeOfChapter(1, 0)).toBe(0)
    expect(volumeOfChapter(0, 6)).toBe(0)
    expect(volumeOfChapter(-1, 6)).toBe(0)
    expect(volumeOfChapter(1.5, 6)).toBe(0)
  })
})

describe('volumeLabel / volumeGroupLabel', () => {
  it('正整数卷号输出「第N卷」', () => {
    expect(volumeLabel(1)).toBe('第1卷')
    expect(volumeGroupLabel(2)).toBe('第2卷')
  })

  it('非法卷号返回空串', () => {
    expect(volumeLabel(0)).toBe('')
    expect(volumeLabel(-1)).toBe('')
    expect(volumeGroupLabel(1.5)).toBe('')
  })
})
