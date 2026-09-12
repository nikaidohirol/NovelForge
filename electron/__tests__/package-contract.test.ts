import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

describe('release dependency contract', () => {
  it('exposes the matching LanceDB native binding for every shipped desktop architecture', () => {
    expect(pkg.dependencies?.['@lancedb/lancedb']).toBe('0.22.3')
    expect(pkg.optionalDependencies).toMatchObject({
      '@lancedb/lancedb-darwin-arm64': '0.22.3',
      '@lancedb/lancedb-darwin-x64': '0.22.3',
      '@lancedb/lancedb-win32-x64-msvc': '0.22.3',
    })
    // npm 安装路线：lockfile 由 npm 生成并入库。
    expect(existsSync('package-lock.json')).toBe(true)
  })

  it('keeps the desktop packaging config wiring LanceDB bindings and the safe file-system helper', () => {
    const builder = readFileSync('electron-builder.json5', 'utf8')
    const macConfig = builder.slice(builder.indexOf('"mac":'), builder.indexOf('"win":'))
    expect(macConfig).toContain('"identity": "-"')
    expect(macConfig).toContain('"hardenedRuntime": false')
    const macArtifactTemplate = 'novelforge-mac-${arch}-${version}-installer.${ext}'
    expect(builder).toContain(macArtifactTemplate)
    const resolveMacArtifactName = (architecture: 'arm64' | 'x64') => macArtifactTemplate
      .replace('${arch}', architecture)
      .replace('${version}', '0.0.0')
      .replace('${ext}', 'dmg')
    expect(resolveMacArtifactName('arm64')).toBe('novelforge-mac-arm64-0.0.0-installer.dmg')
    expect(resolveMacArtifactName('x64')).toBe('novelforge-mac-x64-0.0.0-installer.dmg')
    expect(builder).toContain('node_modules/@lancedb/lancedb/**/*')
    expect(builder).toContain('node_modules/@lancedb/lancedb-darwin-*/**/*')
    expect(builder).toContain('node_modules/@lancedb/lancedb-win32-x64-msvc/**/*')
    expect(builder).toContain('electron/security/windows-safe-file-system.ps1')
    expect(builder).toContain('security/windows-safe-file-system.ps1')

    const safeFileSystem = readFileSync('electron/security/windows-safe-file-system.ts', 'utf8')
    const safeFileSystemHelper = readFileSync('electron/security/windows-safe-file-system.ps1', 'utf8')
    expect(safeFileSystem).toContain('electron.app.isPackaged === true')
    expect(safeFileSystemHelper).toContain('public void Commit(bool mustAlreadyExist)')
    expect(safeFileSystemHelper).toContain('private const int FileRenameInformationEx = 65;')
    expect(safeFileSystemHelper).toContain('FILE_RENAME_REPLACE_IF_EXISTS | FILE_RENAME_POSIX_SEMANTICS')
    expect(safeFileSystemHelper).toContain('FILE_SHARE_READ | FILE_SHARE_WRITE);')
    expect(safeFileSystemHelper).toContain('RenameExistingIntoDirectory(temporaryFile.DangerousGetHandle()')
    expect(safeFileSystemHelper).toContain('$session.Commit($mustAlreadyExist)')
  })
})
