import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..')
const packageJsonPath = path.join(repositoryRoot, 'package.json')
const browserConfigPath = path.join(repositoryRoot, 'vitest.browser.config.ts')
const browserTestPath = path.join(
  repositoryRoot,
  'src',
  'components',
  'panels',
  'sidebar',
  '__tests__',
  'sidebar-legacy-character-render.browser.tsx',
)

describe('renderer browser qualification contract', () => {
  it('keeps real-browser tests out of the default node runner behind a dedicated command', () => {
    const packageMetadata = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>
    }
    const browserConfig = readFileSync(browserConfigPath, 'utf8')

    expect(existsSync(browserTestPath)).toBe(true)
    expect(packageMetadata.scripts?.test).toBe('vitest run')
    expect(packageMetadata.scripts?.['test:browser']).toBe(
      'vitest run --config vitest.browser.config.ts',
    )
    expect(browserConfig).toContain("include: ['src/**/*.browser.tsx']")
    expect(browserConfig).not.toContain('.browser.test.tsx')
    expect(browserConfig).toContain(
      'const browserApiPort = Number(process.env.NOVELFORGE_VITEST_BROWSER_API_PORT || 63450)',
    )
    expect(browserConfig).toMatch(/api:\s*\{\s*host:\s*'127\.0\.0\.1',\s*port:\s*browserApiPort\s*\}/)
    expect(browserConfig).not.toMatch(/api:\s*\{[^}]*host:\s*['"](?:0\.0\.0\.0|::)['"]/s)
    expect(browserConfig).toContain('provider: playwright(')
    expect(browserConfig).toContain('headless: true')
  })

  // 注：CI workflow 契约已随 .github/workflows 目录移除——本项目暂不携带云端构建流水线。
})
