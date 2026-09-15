import os from 'node:os'
import { configDefaults, defineConfig } from 'vitest/config'

// 高核数 Windows 机器上的默认并发会令重负载测试相互干扰（并行 flaky）。
// windows-safe-file-system 依赖真实 junction/外部进程句柄，必须独占串行执行。
const heavyFsTest = 'electron/security/__tests__/windows-safe-file-system.test.ts'
const mainMaxWorkers = Math.min(8, Math.max(2, Math.floor(os.cpus().length / 4)))

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'windows-fs-security',
          include: [heavyFsTest],
          fileParallelism: false,
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      {
        test: {
          name: 'main',
          exclude: [...configDefaults.exclude, heavyFsTest],
          maxWorkers: mainMaxWorkers,
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
})
