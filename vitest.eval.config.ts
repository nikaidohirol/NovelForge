import { defineConfig } from 'vitest/config'

// 真实模型评测层：显式 opt-in（NOVELFORGE_EVAL_LIVE=1 + 端点配置），不进 CI。
// 串行执行避免供应商限流与 toolRegistry 全局单例竞争；单用例放宽到 5 分钟。
export default defineConfig({
  test: {
    include: ['test/eval/live/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 300_000,
    setupFiles: ['./vitest.setup.ts'],
  },
})
