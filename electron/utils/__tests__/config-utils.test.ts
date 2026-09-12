import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const temporaryDirectories: string[] = []

function createTemporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-config-utils-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('config-utils', () => {
  it('uses an explicit NOVELFORGE_HOME_OVERRIDE only when a controlled environment provides one', async () => {
    vi.stubEnv('NOVELFORGE_HOME_OVERRIDE', 'C:/temp/isolated-novelforge-home')
    const configUtils = await import('../config-utils')

    expect(configUtils.NOVELFORGE_HOME).toBe('C:/temp/isolated-novelforge-home')
  })

  it('atomically replaces a JSON file with a complete parseable document', async () => {
    const directory = createTemporaryDirectory()
    const configPath = path.join(directory, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({ version: 'old' }), 'utf-8')
    const configUtils = await import('../config-utils')

    configUtils.writeJsonFile(configPath, {
      version: 'new',
      nested: { enabled: true },
    })

    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8'))).toEqual({
      version: 'new',
      nested: { enabled: true },
    })
    expect(fs.readdirSync(directory)).toEqual(['config.json'])
  })

  it('keeps the old JSON intact and removes the temporary file when writing fails', async () => {
    const directory = createTemporaryDirectory()
    const configPath = path.join(directory, 'config.json')
    const oldConfig = { version: 'old', locale: 'zh-CN' }
    fs.writeFileSync(configPath, JSON.stringify(oldConfig), 'utf-8')
    const configUtils = await import('../config-utils')
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('simulated write failure')
    })

    expect(() => configUtils.writeJsonFile(configPath, { version: 'new' })).toThrow(
      'simulated write failure',
    )

    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8'))).toEqual(oldConfig)
    expect(fs.readdirSync(directory)).toEqual(['config.json'])
  })

  it('keeps the old JSON intact and removes the temporary file when replace fails', async () => {
    const directory = createTemporaryDirectory()
    const configPath = path.join(directory, 'config.json')
    const oldConfig = { version: 'old', locale: 'zh-CN' }
    fs.writeFileSync(configPath, JSON.stringify(oldConfig), 'utf-8')
    const configUtils = await import('../config-utils')
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('simulated replace failure')
    })

    expect(() => configUtils.writeJsonFile(configPath, { version: 'new' })).toThrow(
      'simulated replace failure',
    )

    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8'))).toEqual(oldConfig)
    expect(fs.readdirSync(directory)).toEqual(['config.json'])
  })

  it('retries a transient Windows file lock while replacing JSON', async () => {
    if (process.platform !== 'win32') return
    const directory = createTemporaryDirectory()
    const configPath = path.join(directory, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({ version: 'old' }), 'utf-8')
    const configUtils = await import('../config-utils')
    const actualRenameSync = fs.renameSync
    const transientError = Object.assign(new Error('simulated transient lock'), {
      code: 'EPERM',
    })
    const rename = vi.spyOn(fs, 'renameSync')
      .mockImplementationOnce(() => {
        throw transientError
      })
      .mockImplementation(actualRenameSync)

    configUtils.writeJsonFile(configPath, { version: 'new' })

    expect(rename).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8'))).toEqual({ version: 'new' })
    expect(fs.readdirSync(directory)).toEqual(['config.json'])
  })

  it('preserves the full global config when the update preferences store writes through it', async () => {
    const novelforgeHome = createTemporaryDirectory()
    vi.stubEnv('NOVELFORGE_HOME_OVERRIDE', novelforgeHome)
    const configUtils = await import('../config-utils')
    const { GlobalConfigUpdatePreferencesStore } = await import(
      '../../services/update-preferences-store'
    )
    const existingConfig = {
      ...configUtils.DEFAULT_GLOBAL_CONFIG,
      locale: 'zh-CN' as const,
      customSetting: 'preserve-me',
    }
    fs.writeFileSync(configUtils.GLOBAL_CONFIG_PATH, JSON.stringify(existingConfig), 'utf-8')

    const store = new GlobalConfigUpdatePreferencesStore()
    const preferences = { lastAutomaticCheckDate: '2026-07-25' }

    expect(store.write(preferences)).toBe(true)
    expect(JSON.parse(fs.readFileSync(configUtils.GLOBAL_CONFIG_PATH, 'utf-8'))).toEqual({
      ...existingConfig,
      updatePreferences: preferences,
    })
    expect(fs.readdirSync(novelforgeHome)).toEqual(['config.json'])
  })
})
