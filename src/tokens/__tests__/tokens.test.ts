import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Declaration, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const cssPath = resolve(process.cwd(), 'src/index.css')
const css = readFileSync(cssPath, 'utf8')
const root = postcss.parse(css, { from: cssPath })

const approvedPaperPalette = {
  '--color-bg': '#F7F3E8',
  '--color-raised': '#FCFAF3',
  '--color-sidebar': '#F0EADA',
  '--color-panel': '#F0EADA',
  '--color-titlebar': '#FCFAF3',
  '--color-activity-bar': '#F0EADA',
  '--color-hover': '#EAE3D2',
  '--color-active': '#E3DCC9',
  '--color-text': '#2B2A26',
  '--color-text-secondary': '#6E6A5F',
  '--color-text-muted': '#655F55',
  '--color-border': '#E3DCC9',
  '--color-accent': '#B5402C',
  '--color-accent-hover': '#9A3524',
  '--color-editor-bg': '#FCFAF3',
  '--color-statusbar': '#FCFAF3',
  '--color-titlebar-text': '#2B2A26',
}

function declarationsFor(selector: string) {
  const declarations: Record<string, string> = {}
  root.walkRules((rule: Rule) => {
    if (!rule.selectors.includes(selector)) return
    rule.walkDecls((declaration: Declaration) => {
      if (declaration.prop.startsWith('--')) declarations[declaration.prop] = declaration.value
    })
  })
  return declarations
}

describe('runtime CSS token authority', () => {
  it('does not expose a second hand-copied TypeScript color-token source', () => {
    expect(existsSync(resolve(process.cwd(), 'src/tokens/index.ts'))).toBe(false)
  })

  it('defines the paper palette once for the default, paper, and light theme selectors', () => {
    const paperPaletteRules: Array<{ selectors: string[]; declarations: Record<string, string> }> = []
    root.walkRules((rule: Rule) => {
      if (!rule.selectors.some(selector => selector === ':root' || selector === '.paper' || selector === '.light')) return

      const declarations = Object.fromEntries(
        rule.nodes
          .filter((node): node is Declaration => node.type === 'decl' && node.prop in approvedPaperPalette)
          .map(declaration => [declaration.prop, declaration.value]),
      )
      if (Object.keys(declarations).length > 0) paperPaletteRules.push({ selectors: rule.selectors, declarations })
    })

    expect(paperPaletteRules).toEqual([
      {
        selectors: [':root', '.paper', '.light'],
        declarations: approvedPaperPalette,
      },
    ])
  })

  it.each([
    [':root', approvedPaperPalette],
    ['.paper', approvedPaperPalette],
    ['.light', approvedPaperPalette],
    ['.galaxy', {
      '--color-bg': '#0A1628',
      '--color-raised': '#0E1B30',
      '--color-sidebar': '#0E1B30',
      '--color-panel': '#0E1B30',
      '--color-titlebar': '#0A1628',
      '--color-activity-bar': '#071220',
      '--color-hover': '#142640',
      '--color-active': '#1C3050',
      '--color-text': '#E0ECF4',
      '--color-text-secondary': '#8BA4BE',
      '--color-text-muted': '#5A7A96',
      '--color-border': '#172B42',
      '--color-accent': '#7EC8E3',
      '--color-accent-hover': '#6AB8D8',
      '--color-editor-bg': '#091525',
      '--color-statusbar': '#071220',
      '--color-titlebar-text': '#8BA4BE',
    }],
    ['.dark', {
      '--color-bg': '#1E1E1E',
      '--color-raised': '#252526',
      '--color-sidebar': '#252526',
      '--color-panel': '#252526',
      '--color-titlebar': '#181818',
      '--color-activity-bar': '#333333',
      '--color-hover': '#2A2D2E',
      '--color-active': '#37373D',
      '--color-text': '#D4D4D4',
      '--color-text-secondary': '#A0A0A0',
      '--color-text-muted': '#888888',
      '--color-border': '#3C3C3C',
      '--color-accent': '#0E639C',
      '--color-accent-hover': '#1177BB',
      '--color-editor-bg': '#1E1E1E',
      '--color-statusbar': '#181818',
      '--color-titlebar-text': '#CCCCCC',
    }],
  ])('locks the approved %s runtime palette', (selector, expected) => {
    expect(declarationsFor(selector)).toMatchObject(expected)
  })
})

describe('writer chrome aliases', () => {
  it('declares the shared semantic aliases once and limits theme overrides to text contrast', () => {
    const aliasRules: Array<{ selectors: string[]; declarations: Record<string, string> }> = []
    root.walkRules((rule: Rule) => {
      const declarations = Object.fromEntries(
        rule.nodes
          .filter((node): node is Declaration => node.type === 'decl' && node.prop.startsWith('--writer-'))
          .map(declaration => [declaration.prop, declaration.value]),
      )
      if (Object.keys(declarations).length > 0) aliasRules.push({ selectors: rule.selectors, declarations })
    })

    expect(aliasRules).toEqual([
      expect.objectContaining({ selectors: [':root', '.paper', '.light', '.dark', '.galaxy'] }),
      {
        selectors: [".app-skin-root[data-skin='classic'][data-theme='galaxy']"],
        declarations: {
          '--writer-primary-text': '#0A1628',
          '--writer-brand-mark-text': '#0A1628',
        },
      },
      {
        selectors: [".app-skin-root[data-skin='classic'][data-theme='dark']"],
        declarations: { '--writer-primary-text': '#FFFFFF' },
      },
    ])
  })
})

describe('relationship role semantics', () => {
  it('defines the approved role identity colors once for every runtime theme and image skin', () => {
    const roleRules: Array<{ selectors: string[]; declarations: Record<string, string> }> = []
    root.walkRules((rule: Rule) => {
      const declarations = Object.fromEntries(
        rule.nodes
          .filter((node): node is Declaration => node.type === 'decl' && node.prop.startsWith('--color-role-'))
          .map(declaration => [declaration.prop, declaration.value]),
      )
      if (Object.keys(declarations).length > 0) roleRules.push({ selectors: rule.selectors, declarations })
    })

    expect(roleRules).toEqual([
      {
        selectors: [':root', '.paper', '.light', '.galaxy', '.dark'],
        declarations: {
          '--color-role-protagonist': '#B5402C',
          '--color-role-antagonist': '#54666E',
          '--color-role-supporting': '#527A5B',
          '--color-role-minor': '#A39D8D',
        },
      },
      {
        selectors: ['.anime'],
        declarations: {
          '--color-role-protagonist': '#E0568F',
          '--color-role-antagonist': '#7C4DBF',
          '--color-role-supporting': '#0E9F6E',
          '--color-role-minor': '#C9A8C4',
        },
      },
    ])
  })
})

// 注：Storybook 文档测试已随 src/stories 目录移除——本项目不包含 Storybook 基础设施。

