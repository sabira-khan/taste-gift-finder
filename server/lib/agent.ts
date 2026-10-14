import type { RefineState, Seed, TraceStep } from '../../shared/types'
import type { QlooEntity } from './qloo'
import type { Safety } from './safety'
import { chat, resolveLlm, type ChatMessage, type ToolSpec } from './llm'
import { applyRefine, recommend, silentTracer, tracer, type PipelineContext, type RecommendOutput } from './pipeline'
import { emptyRefine } from './matcher'
import { explainPicks } from './explain'

export const MAX_TOOL_CALLS = 6

export const SEARCH_TYPES: Record<string, string> = {
  movie: 'urn:entity:movie',
  tv_show: 'urn:entity:tv_show',
  artist: 'urn:entity:artist',
  book: 'urn:entity:book',
  author: 'urn:entity:author',
  brand: 'urn:entity:brand',
  videogame: 'urn:entity:videogame',
  person: 'urn:entity:person',
  podcast: 'urn:entity:podcast',
  place: 'urn:entity:place'
}

const reason = { type: 'string', description: 'One short sentence: why this step, shown to the shopper in the trace.' }

const TOOLS: ToolSpec[] = [
  {
    name: 'search_entities',
    description: 'Find Qloo entities (films, shows, artists, books, brands, games, people, podcasts) matching something the recipient loves. Returns candidates with ids.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, type: { type: 'string', enum: Object.keys(SEARCH_TYPES) }, reason },
      required: ['query', 'reason']
    }
  },
  {
    name: 'search_tags',
    description: 'Find Qloo tags for tastes that are not a single entity, such as a music genre, a cuisine or a drink culture (e.g. lo-fi, matcha, Arabic coffee).',
    parameters: { type: 'object', properties: { query: { type: 'string' }, reason }, required: ['query', 'reason'] }
  },
  {
    name: 'build_profile',
    description: 'Set the 2 to 5 seeds (ids from earlier searches) and build the cross-domain Qloo taste profile. Returns concrete interests, vibe facets and warnings.',
    parameters: {
      type: 'object',
      properties: { seed_ids: { type: 'array', items: { type: 'string' } }, reason },
      required: ['seed_ids', 'reason']
    }
  },
  {
    name: 'recommend',
    description: 'Match the current profile against the store catalog. Returns the top picks with matched interests and a quality report. Call build_profile first.',
    parameters: { type: 'object', properties: { budget: { type: 'number', description: 'Maximum price in USD, if the shopper gave one.' }, reason }, required: ['reason'] }
  },
  {
    name: 'refine',
    description: 'Re-rank after feedback: more_like or not_style need a product handle; too_expensive lowers the price cap.',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['more_like', 'not_style', 'too_expensive'] }, handle: { type: 'string' }, reason },
      required: ['action', 'reason']
    }
  }
]

const SYSTEM = `You are the gift-finding agent of a store powered by Qloo's cultural taste graph.
The shopper describes a recipient in free text. Your job: turn it into 2 to 5 Qloo seeds, build a taste profile, and get recommendations from the store's matcher. You never pick products yourself.
Workflow:
1. search_entities or search_tags for each thing the recipient loves. Pick the candidate that is clearly the intended one. For drinks, foods, genres and vibes use search_tags.
2. build_profile with the chosen ids.
3. recommend, passing the budget if one was given.
4. Read the quality report. If it is not ok and you still have calls left, fix the cause: replace a seed that barely shaped the results, try a different domain for the same love, or add a missing seed. Then build_profile and recommend again.
You have at most ${MAX_TOOL_CALLS} tool calls in total, so search several things before building. Every call needs a short reason.
When done, reply with one or two sentences to the shopper describing what you understood about the recipient. Do not list products.`

interface AgentState {
  candidates: Map<string, Seed>
  seeds: Seed[]
  budget?: number
  refine: RefineState
  last?: RecommendOutput
}

function toSeed(e: QlooEntity, type: string): Seed {
  return {
    id: e.entity_id,
    kind: 'entity',
    name: e.name,
    type: e.types?.[0] ?? type,
    image: e.properties?.image?.url,
    description: e.properties?.short_description ?? e.disambiguation,
    tags: (e.tags ?? []).slice(0, 80).map(t => ({ id: t.id, name: t.name, type: t.type }))
  }
}

export async function searchEntities(ctx: PipelineContext, safety: Safety, query: string, type?: string, take = 6): Promise<Seed[]> {
  const types = type && SEARCH_TYPES[type] ? SEARCH_TYPES[type] : Object.values(SEARCH_TYPES).filter(t => t !== 'urn:entity:place').join(',')
  const results = await ctx.qloo.search(query, { types, take })
  return results.filter(e => !safety.check(e).blocked).map(e => toSeed(e, types.split(',')[0]!))
}

export async function searchTags(ctx: PipelineContext, query: string, take = 6): Promise<Seed[]> {
  const tags = await ctx.qloo.searchTags(query, { take })
  return tags.map(t => ({ id: t.id, kind: 'tag' as const, name: t.name, type: t.type, tags: [{ id: t.id, name: t.name, type: t.type }] }))
}

function summarizeRecommend(out: RecommendOutput) {
  return {
    strongMatches: out.strongMatches,
    picks: out.picks.map(p => ({ handle: p.product.handle, title: p.product.title, price: p.product.price, score: p.score.total, interests: p.interests.map(i => `${i.label}${i.level === 'broad' ? ' (broad)' : ''}`) })),
    quality: out.quality
  }
}

export interface AgentResult {
  message: string
  seeds: Seed[]
  budget?: number
  result: RecommendOutput | null
  trace: TraceStep[]
  toolCalls: number
  provider?: string
}

export async function runAgent(ctx: PipelineContext, safety: Safety, userMessage: string): Promise<AgentResult> {
  if (!resolveLlm(ctx.llm)) throw new Error('Agent mode needs an LLM key')
  const trace = tracer(ctx.qloo)
  const state: AgentState = { candidates: new Map(), seeds: [], refine: emptyRefine() }
  const messages: ChatMessage[] = [{ role: 'user', content: userMessage }]
  let calls = 0
  let finalText = ''
  let provider: string | undefined

  const exec = async (name: string, args: Record<string, any>): Promise<unknown> => {
    const why = String(args.reason ?? '')
    if (name === 'search_entities') {
      const found = await trace.run(`Search “${args.query}”${args.type ? ` (${args.type})` : ''}`, why, () => searchEntities(ctx, safety, String(args.query), args.type), r => r.slice(0, 3).map(s => s.name).join(', ') || 'no match')
      found.forEach(s => state.candidates.set(s.id, s))
      return found.map(s => ({ id: s.id, name: s.name, type: s.type, about: s.description?.slice(0, 120) }))
    }
    if (name === 'search_tags') {
      const found = await trace.run(`Search tag “${args.query}”`, why, () => searchTags(ctx, String(args.query)), r => r.slice(0, 3).map(s => s.name).join(', ') || 'no match')
      found.forEach(s => state.candidates.set(s.id, s))
      return found.map(s => ({ id: s.id, name: s.name, type: s.type }))
    }
    if (name === 'build_profile') {
      const ids: string[] = Array.isArray(args.seed_ids) ? args.seed_ids.map(String) : []
      const seeds = ids.map(id => state.candidates.get(id)).filter((s): s is Seed => !!s).slice(0, 5)
      if (!seeds.length) return { error: 'none of these ids came from a search; search first' }
      state.seeds = seeds
      state.refine = emptyRefine()
      const out = await recommend(ctx, { seeds, explain: false, budget: state.budget }, silentTracer())
      state.last = out
      trace.steps.push({ step: `Build profile from ${seeds.map(s => s.name).join(', ')}`, reason: why, detail: out.profile.interests.slice(0, 4).map(i => `${i.label} ${Math.round(i.weight * 100)}%`).join(', '), qlooCalls: 0, cacheHits: 0, ms: 0 })
      return {
        seeds: seeds.map(s => s.name),
        interests: out.profile.interests.slice(0, 8).map(i => ({ label: i.label, weight: i.weight })),
        vibe: out.profile.facets.slice(0, 8).map(f => f.label),
        warnings: out.profile.warnings
      }
    }
    if (name === 'recommend') {
      if (!state.seeds.length) return { error: 'call build_profile first' }
      if (typeof args.budget === 'number' && args.budget > 0) state.budget = args.budget
      const out = await trace.run('Recommend', why, () => recommend(ctx, { seeds: state.seeds, budget: state.budget, refine: state.refine, explain: false }, silentTracer()), r => `${r.strongMatches} strong matches · quality ${r.quality.ok ? 'ok' : r.quality.issues.join('; ')}`)
      state.last = out
      return summarizeRecommend(out)
    }
    if (name === 'refine') {
      if (!state.last) return { error: 'call recommend first' }
      state.refine = applyRefine(state.refine, { type: args.action, handle: args.handle } as any, ctx.products, state.last.picks.map(p => ({ handle: p.product.handle, price: p.product.price })))
      const out = await trace.run(`Refine: ${args.action}`, why, () => recommend(ctx, { seeds: state.seeds, budget: state.budget, refine: state.refine, explain: false }, silentTracer()), r => `${r.strongMatches} strong matches`)
      state.last = out
      return summarizeRecommend(out)
    }
    return { error: `unknown tool ${name}` }
  }

  while (calls < MAX_TOOL_CALLS) {
    const res = await chat(ctx.llm, { system: SYSTEM, messages, tools: TOOLS, maxTokens: 800, temperature: 0.2 })
    provider = `${res.provider}:${res.model}`
    if (!res.toolCalls.length) {
      finalText = res.text.trim()
      break
    }
    const allowed = res.toolCalls.slice(0, MAX_TOOL_CALLS - calls)
    messages.push({ role: 'assistant', content: res.text || undefined, toolCalls: allowed })
    for (const call of allowed) {
      calls++
      let output: unknown
      try {
        output = await exec(call.name, call.args ?? {})
      } catch (err) {
        output = { error: (err as Error).message.slice(0, 200) }
      }
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify({ ...(output as object), callsLeft: MAX_TOOL_CALLS - calls }) })
    }
  }

  if (calls >= MAX_TOOL_CALLS && !finalText) {
    if (state.seeds.length && !state.last) state.last = await recommend(ctx, { seeds: state.seeds, budget: state.budget, explain: false })
    try {
      const wrap = await chat(ctx.llm, { system: SYSTEM, messages: [...messages, { role: 'user', content: 'Tool budget used. Reply to the shopper in one or two sentences now.' }], maxTokens: 200 })
      finalText = wrap.text.trim()
    } catch {
      finalText = ''
    }
  }

  let result = state.last ?? null
  if (result) {
    const explained = await trace.run('Explain picks', 'Write one grounded line per pick from the matched interests and Qloo evidence', () => explainPicks(result!.picks, result!.profile.seeds, ctx.llm), e => (e.source === 'llm' ? 'written by the LLM from Qloo facts' : 'template'))
    result = { ...result, picks: explained.picks, explanationSource: explained.source, trace: trace.steps, refine: state.refine }
  }
  return {
    message: finalText || (result ? 'Here is what I found from their tastes.' : 'I could not find enough of their tastes in Qloo. Try naming a film, artist, book or brand they love.'),
    seeds: state.seeds,
    budget: state.budget,
    result,
    trace: trace.steps,
    toolCalls: calls,
    provider
  }
}
