/**
 * novelforge-protocol — 统一管理 novelforge:// 伪协议路径解析
 *
 * 所有 novelforge:// 路径的常量映射和解析逻辑集中在此，
 * 新增架构字段或路径协议时只需修改此文件。
 */

import type { ProjectSessionContext } from '../shared/ipc-channels'
import { ipc } from './ipc-client'

// ===== novelforge://core/ 架构字段映射 =====

/** 路径 key → ProjectCoreData 中的驼峰字段名 */
export const CORE_FIELD_MAP: Record<string, string> = {
    premise: 'premise',
    worldbuilding: 'worldbuilding',
    characters: 'charactersArch',
    synopsis: 'synopsis',
}

/** 从 novelforge://core/ 路径中解析出 DB 字段名 */
export function parseCoreField(novelforgePath: string): string | null {
    if (!novelforgePath.startsWith('novelforge://core/')) return null
    const key = novelforgePath.replace('novelforge://core/', '')
    return CORE_FIELD_MAP[key] ?? null
}

/** 从 DB 读取 novelforge://core/ 路径对应的内容 */
export async function readCoreContent(
    novelforgePath: string,
    projectSession: ProjectSessionContext,
): Promise<string> {
    const key = novelforgePath.replace('novelforge://core/', '')
    if (key === 'characters') {
        const roster = await ipc.invokeWithProjectSession(
            projectSession,
            'db:character-roster-read',
            projectSession.projectPath,
        )
        // 角色图谱是 roster 的只读投影；未 ready 时仅展示已存档的旧文本证据，
        // 绝不从 project_core.charactersArch 把不一致投影伪装成事实。
        return roster.status === 'ready'
            ? roster.renderedMarkdown
            : roster.legacyMarkdown ?? ''
    }
    const core = await ipc.invokeWithProjectSession(
        projectSession,
        'db:project-core-get',
        projectSession.projectPath,
    )
    if (!core) throw new Error('无法读取故事架构内容')
    const fieldMap: Record<string, string> = {
        premise: core.premise || '',
        worldbuilding: core.worldbuilding || '',
        synopsis: core.synopsis || '',
    }
    return fieldMap[key] || ''
}

/** 将内容写入 novelforge://core/ 对应的 DB 字段 */
export async function writeCoreContent(
    novelforgePath: string,
    content: string,
    projectSession: ProjectSessionContext,
): Promise<boolean> {
    if (novelforgePath === 'novelforge://core/characters') return false
    const dbField = parseCoreField(novelforgePath)
    if (!dbField) return false
    const res = await ipc.invokeWithProjectSession(
        projectSession,
        'db:project-core-update',
        { [dbField]: content },
        projectSession.projectPath,
    )
    return res.success === true
}

// ===== novelforge://draft/ | novelforge://revision/ | novelforge://review/ 内容读取 =====

/** 读取 novelforge:// 伪协议路径的内容（统一入口） */
export async function readNovelForgeContent(
    filePath: string,
    projectSession: ProjectSessionContext,
): Promise<string> {
    if (filePath.startsWith('novelforge://draft/') || filePath.startsWith('novelforge://manuscript/')) {
        const prefix = filePath.startsWith('novelforge://draft/') ? 'novelforge://draft/' : 'novelforge://manuscript/'
        const draftId = parseInt(filePath.replace(prefix, ''))
        const full = await ipc.invokeWithProjectSession(
            projectSession,
            'db:draft-get-full',
            draftId,
            projectSession.projectPath,
        )
        if (!full) throw new Error('虚拟草稿不存在或无法读取')
        return full.content
    }

    if (filePath.startsWith('novelforge://revision/')) {
        const revId = parseInt(filePath.replace('novelforge://revision/', ''))
        const full = await ipc.invokeWithProjectSession(
            projectSession,
            'db:revision-get-full',
            revId,
            projectSession.projectPath,
        )
        if (!full) throw new Error('虚拟修稿不存在或无法读取')
        return full.content
    }

    if (filePath.startsWith('novelforge://review/')) {
        const revId = parseInt(filePath.replace('novelforge://review/', ''))
        const full = await ipc.invokeWithProjectSession(
            projectSession,
            'db:review-get-full',
            revId,
            projectSession.projectPath,
        )
        if (!full) throw new Error('虚拟审稿不存在或无法读取')
        return full.content
    }

    if (filePath.startsWith('novelforge://core/')) {
        return readCoreContent(filePath, projectSession)
    }

    console.warn('[readNovelForgeContent] 不支持的路径协议:', filePath)
    return ''
}

/** 判断路径是否为 novelforge:// 伪协议 */
export function isNovelForgeProtocol(path: string): boolean {
    return path.startsWith('novelforge://')
}
