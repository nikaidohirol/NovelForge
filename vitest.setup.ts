/**
 * 测试环境统一 UI 语言。
 *
 * locale-store 初始值取自 globalThis.navigator.language（跟随宿主系统语言）：
 * 本机中文系统解析为 zh-CN，而 CI runner（英文系统）解析为 en-US，
 * 会让所有断言中文文案的组件测试在 CI 上翻车。
 * 这里把 navigator.language 钉死为 zh-CN，使测试结果与运行机器无关。
 */

const nav = globalThis.navigator as { language?: string; languages?: string[] } | undefined

if (nav) {
  Object.defineProperty(nav, 'language', { value: 'zh-CN', configurable: true })
  Object.defineProperty(nav, 'languages', { value: ['zh-CN'], configurable: true })
}
