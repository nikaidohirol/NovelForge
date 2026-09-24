/**
 * Agent 评测 — 真实模型层环境配置
 *
 * 配置来源（优先级从高到低）：
 * 1. 环境变量：NOVELFORGE_EVAL_BASE_URL / NOVELFORGE_EVAL_API_KEY / NOVELFORGE_EVAL_MODEL
 * 2. 项目根目录的 .env.eval.local（KEY=VALUE 行式格式，已被 .gitignore 的 .env.*.local 规则忽略）
 *
 * 门禁：只有 NOVELFORGE_EVAL_LIVE=1 且三项配置齐全时才会执行真实模型评测，
 * 否则整套 live 用例被跳过——`npm test` 永远不会发起计费调用。
 *
 * PowerShell 运行方式：
 *   $env:NOVELFORGE_EVAL_LIVE="1"
 *   $env:NOVELFORGE_EVAL_BASE_URL="https://<端点>/v1"
 *   $env:NOVELFORGE_EVAL_API_KEY="sk-..."
 *   $env:NOVELFORGE_EVAL_MODEL="<模型名>"
 *   npm run eval:live
 * 或创建 .env.eval.local 后直接 `npm run eval:live`。
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { EvalLiveConfig } from './eval-types'

/** live 配置的环境变量键名 */
type EvalEnvKey = 'NOVELFORGE_EVAL_BASE_URL' | 'NOVELFORGE_EVAL_API_KEY' | 'NOVELFORGE_EVAL_MODEL'

/** 读取 .env.eval.local（行式 KEY=VALUE，忽略注释与空行） */
function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {}
  const result: Record<string, string> = {}
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key) result[key] = value
  }
  return result
}

/** 是否显式开启真实模型层 */
export function isLiveGateEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NOVELFORGE_EVAL_LIVE === '1'
}

/**
 * 读取 live 配置；任一项缺失返回 null（评测层据此整体跳过）
 * @param env 环境变量（默认 process.env，测试可注入）
 * @param envFile .env.eval.local 路径（默认项目根目录，测试可注入临时文件）
 */
export function readEvalLiveConfig(
  env: Record<string, string | undefined> = process.env,
  envFile: string = resolve(process.cwd(), '.env.eval.local'),
): EvalLiveConfig | null {
  const fileVars = parseEnvFile(envFile)
  const pick = (key: EvalEnvKey): string | undefined =>
    env[key]?.trim() || fileVars[key]?.trim()
  const baseUrl = pick('NOVELFORGE_EVAL_BASE_URL')
  const apiKey = pick('NOVELFORGE_EVAL_API_KEY')
  const model = pick('NOVELFORGE_EVAL_MODEL')
  if (!baseUrl || !apiKey || !model) return null
  return { baseUrl, apiKey, model }
}
