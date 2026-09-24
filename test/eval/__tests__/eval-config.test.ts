import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { isLiveGateEnabled, readEvalLiveConfig, readPriceUsdPerMTok } from '../eval-config'

describe('isLiveGateEnabled', () => {
  it('仅当 NOVELFORGE_EVAL_LIVE=1 时开启', () => {
    expect(isLiveGateEnabled({ NOVELFORGE_EVAL_LIVE: '1' })).toBe(true)
    expect(isLiveGateEnabled({ NOVELFORGE_EVAL_LIVE: '0' })).toBe(false)
    expect(isLiveGateEnabled({})).toBe(false)
  })
})

describe('readEvalLiveConfig', () => {
  const base = { NOVELFORGE_EVAL_BASE_URL: 'https://api.example.com/v1' }
  const fullEnv = {
    ...base,
    NOVELFORGE_EVAL_API_KEY: 'sk-test',
    NOVELFORGE_EVAL_MODEL: 'eval-model',
  }

  it('三项齐全时返回配置', () => {
    expect(readEvalLiveConfig(fullEnv, 'nonexistent.env')).toEqual({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'eval-model',
    })
  })

  it('任一项缺失时返回 null', () => {
    expect(readEvalLiveConfig(base, 'nonexistent.env')).toBeNull()
    expect(readEvalLiveConfig(
      { ...fullEnv, NOVELFORGE_EVAL_API_KEY: '  ' },
      'nonexistent.env',
    )).toBeNull()
  })

  it('环境变量缺失时回退 .env.eval.local', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nf-eval-'))
    const envFile = join(dir, '.env.eval.local')
    writeFileSync(envFile, [
      '# 注释行',
      '',
      'NOVELFORGE_EVAL_BASE_URL=https://file.example.com/v1',
      'NOVELFORGE_EVAL_API_KEY="sk-from-file"',
      'NOVELFORGE_EVAL_MODEL=file-model',
    ].join('\n'))
    expect(readEvalLiveConfig({}, envFile)).toEqual({
      baseUrl: 'https://file.example.com/v1',
      apiKey: 'sk-from-file',
      model: 'file-model',
    })
  })

  it('环境变量优先于文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nf-eval-'))
    const envFile = join(dir, '.env.eval.local')
    writeFileSync(envFile, [
      'NOVELFORGE_EVAL_BASE_URL=https://file.example.com/v1',
      'NOVELFORGE_EVAL_API_KEY=sk-from-file',
      'NOVELFORGE_EVAL_MODEL=file-model',
    ].join('\n'))
    expect(readEvalLiveConfig({ ...fullEnv }, envFile)?.baseUrl).toBe('https://api.example.com/v1')
  })
})

describe('readPriceUsdPerMTok', () => {
  const INPUT = 'NOVELFORGE_EVAL_PRICE_INPUT_USD_PER_MTOK'
  const OUTPUT = 'NOVELFORGE_EVAL_PRICE_OUTPUT_USD_PER_MTOK'

  it('未配置时两个单价均为 undefined', () => {
    expect(readPriceUsdPerMTok({}, 'nonexistent.env')).toEqual({ input: undefined, output: undefined })
  })

  it('环境变量缺失时回退 .env.eval.local，非法值忽略', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nf-eval-'))
    const envFile = join(dir, '.env.eval.local')
    writeFileSync(envFile, [`${INPUT}=0.15`, `${OUTPUT}=abc`].join('\n'))
    expect(readPriceUsdPerMTok({}, envFile)).toEqual({ input: 0.15, output: undefined })
  })

  it('环境变量优先于文件，负数视为非法', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nf-eval-'))
    const envFile = join(dir, '.env.eval.local')
    writeFileSync(envFile, [`${INPUT}=-1`].join('\n'))
    expect(readPriceUsdPerMTok({ [INPUT]: '0.3' }, envFile).input).toBe(0.3)
    expect(readPriceUsdPerMTok({}, envFile).input).toBeUndefined()
  })
})
