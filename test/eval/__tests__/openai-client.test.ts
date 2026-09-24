import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOpenAICompatClient } from '../live/openai-client'

const CONFIG = {
  baseUrl: 'https://api.example.com/v1/',
  apiKey: 'sk-eval-test',
  model: 'eval-model',
}

function mockFetchOnce(payload: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createOpenAICompatClient', () => {
  it('拼接 chat/completions 端点并携带鉴权与消息体', async () => {
    const fetchMock = mockFetchOnce({
      choices: [{ message: { content: '回答' } }],
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    })
    const client = createOpenAICompatClient(CONFIG)
    const content = await client.generateFn(
      [
        { role: 'system', content: '系统提示' },
        { role: 'user', content: '问题' },
      ],
      'ignored-model',
    )

    expect(content).toBe('回答')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-eval-test')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.model).toBe('eval-model')
    expect(body.temperature).toBe(0.2)
    expect(body.stream).toBe(false)
    expect(body.messages).toEqual([
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '问题' },
    ])
    expect(client.usageSink).toEqual([{ model: 'eval-model', promptTokens: 12, completionTokens: 34 }])
    expect(client.requestCount()).toBe(1)
  })

  it('缺省字段按空串与 0 处理', async () => {
    mockFetchOnce({ choices: [{}] })
    const client = createOpenAICompatClient(CONFIG)
    const content = await client.generateFn([{ role: 'user', content: 'q' }], 'm')
    expect(content).toBe('')
    expect(client.usageSink).toEqual([{ model: 'eval-model', promptTokens: 0, completionTokens: 0 }])
  })

  it('非 2xx 响应抛出含状态码的安全错误', async () => {
    mockFetchOnce({ error: 'rate limited' }, 429)
    const client = createOpenAICompatClient(CONFIG)
    await expect(client.generateFn([{ role: 'user', content: 'q' }], 'm'))
      .rejects.toThrow(/HTTP 429/)
  })

  it('网络异常转换为不含 key 的错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const client = createOpenAICompatClient(CONFIG)
    await expect(client.generateFn([{ role: 'user', content: 'q' }], 'm'))
      .rejects.toThrow(/评测请求网络失败.*ECONNREFUSED/)
  })
})
