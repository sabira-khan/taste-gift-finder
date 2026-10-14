import { runAgent } from '../lib/agent'
import { resolveLlm } from '../lib/llm'

export default defineEventHandler(async event => {
  const body = await readBody(event)
  const message = String(body?.message ?? '').trim().slice(0, 600)
  if (message.length < 4) throw createError({ statusCode: 400, statusMessage: 'tell us a little about them' })
  const ctx = await pipelineContext()
  if (!resolveLlm(ctx.llm)) throw createError({ statusCode: 409, statusMessage: 'agent_unavailable', data: { reason: 'No LLM key is configured, so use the seed picker instead.' } })
  const out = await runAgent(ctx, ctx.safety, message)
  return { ...out, catalogSource: ctx.catalogSource }
})
