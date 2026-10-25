import type { SpendMeter, Usage } from './spend'

export type Provider = 'anthropic' | 'openai' | 'gemini'

export interface LlmConfig {
  provider: Provider | ''
  model?: string
  keys: Partial<Record<Provider, string>>
  meter?: SpendMeter
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, any>
  signature?: string
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export interface ChatRequest {
  system: string
  messages: ChatMessage[]
  tools?: ToolSpec[]
  maxTokens?: number
  temperature?: number
}

export interface ChatResponse {
  text: string
  toolCalls: ToolCall[]
  provider: Provider
  model: string
  usage: Usage
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-3.8-flash'
}

const ORDER: Provider[] = ['anthropic', 'openai', 'gemini']

export function resolveLlm(config: LlmConfig): { provider: Provider; key: string; model: string } | null {
  const wanted = config.provider && config.keys[config.provider] ? [config.provider] : ORDER
  for (const provider of wanted) {
    const key = config.keys[provider]
    if (key) return { provider, key, model: config.model && config.provider === provider ? config.model : DEFAULT_MODELS[provider] }
  }
  return null
}

async function post(url: string, headers: Record<string, string>, body: unknown, label: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal })
    const text = await res.text()
    if (!res.ok) throw new Error(`${label} ${res.status}: ${text.slice(0, 200)}`)
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

async function anthropic(key: string, model: string, req: ChatRequest): Promise<ChatResponse> {
  const messages: any[] = []
  for (const m of req.messages) {
    if (m.role === 'user') messages.push({ role: 'user', content: m.content })
    else if (m.role === 'assistant') {
      const content: any[] = []
      if (m.content) content.push({ type: 'text', text: m.content })
      for (const c of m.toolCalls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args })
      messages.push({ role: 'assistant', content })
    } else {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }
      const last = messages[messages.length - 1]
      if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') last.content.push(block)
      else messages.push({ role: 'user', content: [block] })
    }
  }
  const data = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
    model,
    system: req.system,
    max_tokens: req.maxTokens ?? 1200,
    thinking: { type: 'disabled' },
    messages,
    tools: req.tools?.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  }, 'Anthropic')
  const text = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
  const toolCalls = (data.content ?? []).filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, name: b.name, args: b.input ?? {} }))
  return { text, toolCalls, provider: 'anthropic', model, usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 } }
}

async function openai(key: string, model: string, req: ChatRequest): Promise<ChatResponse> {
  const messages: any[] = [{ role: 'system', content: req.system }]
  for (const m of req.messages) {
    if (m.role === 'user') messages.push({ role: 'user', content: m.content })
    else if (m.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: m.content ?? null,
        tool_calls: m.toolCalls?.length ? m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) : undefined
      })
    } else messages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
  }
  const data = await post('https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${key}` }, {
    model,
    messages,
    max_tokens: req.maxTokens ?? 1200,
    temperature: req.temperature ?? 0.3,
    tools: req.tools?.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
  }, 'OpenAI')
  const msg = data.choices?.[0]?.message ?? {}
  const toolCalls = (msg.tool_calls ?? []).map((c: any) => {
    let args = {}
    try {
      args = JSON.parse(c.function.arguments || '{}')
    } catch {
      args = {}
    }
    return { id: c.id, name: c.function.name, args }
  })
  return { text: msg.content ?? '', toolCalls, provider: 'openai', model, usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 } }
}

async function gemini(key: string, model: string, req: ChatRequest): Promise<ChatResponse> {
  const contents: any[] = []
  for (const m of req.messages) {
    if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: m.content }] })
    else if (m.role === 'assistant') {
      const parts: any[] = []
      if (m.content) parts.push({ text: m.content })
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.args }, ...(c.signature ? { thoughtSignature: c.signature } : {}) })
      contents.push({ role: 'model', parts })
    } else {
      const part = { functionResponse: { name: m.name, response: { result: m.content } } }
      const last = contents[contents.length - 1]
      if (last?.role === 'user' && last.parts[0]?.functionResponse) last.parts.push(part)
      else contents.push({ role: 'user', parts: [part] })
    }
  }
  const body = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents,
    generationConfig: { maxOutputTokens: (req.maxTokens ?? 1200) + 2048, temperature: req.temperature ?? 0.3, thinkingConfig: { thinkingLevel: 'low' } },
    tools: req.tools?.length ? [{ functionDeclarations: req.tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }] : undefined
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  let data: any
  for (let attempt = 0; ; attempt++) {
    try {
      data = await post(url, { 'x-goog-api-key': key }, body, 'Gemini')
      break
    } catch (err) {
      if (attempt >= 2 || !/Gemini (404|429|5\d\d)/.test((err as Error).message)) throw err
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
    }
  }
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const text = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('')
  const toolCalls = parts.filter((p: any) => p.functionCall).map((p: any, i: number) => ({ id: `call_${Date.now()}_${i}`, name: p.functionCall.name, args: p.functionCall.args ?? {}, ...(p.thoughtSignature ? { signature: p.thoughtSignature } : {}) }))
  const meta = data.usageMetadata ?? {}
  return { text, toolCalls, provider: 'gemini', model, usage: { inputTokens: meta.promptTokenCount ?? 0, outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0) } }
}

export async function chat(config: LlmConfig, req: ChatRequest): Promise<ChatResponse> {
  const llm = resolveLlm(config)
  if (!llm) throw new Error('No LLM key configured')
  await config.meter?.check()
  const call = llm.provider === 'anthropic' ? anthropic : llm.provider === 'openai' ? openai : gemini
  const res = await call(llm.key, llm.model, req)
  await config.meter?.record(res.usage)
  return res
}

export function parseJsonBlock<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as T
  } catch {
    return null
  }
}
