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
    description: 'Set the 2 to 5 seeds (ids from earlier searches), build the cross-domain Qloo taste profile and run a first match. Returns interests, vibe facets, warnings, the first picks and a quality report.',
    parameters: {
      type: 'object',
      properties: { seed_ids: { type: 'array', items: { type: 'string' } }, budget: { type: 'number', description: 'Maximum price in USD, if the shopper gave one.' }, reason },
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
1. In your first turn, call search_entities or search_tags for every thing the recipient loves, all at once as parallel calls. For drinks, foods, genres and vibes use search_tags.
2. Pick the candidate that is clearly the intended one for each, then call build_profile with those ids and the budget if one was given. It returns the first picks and a quality report.
3. If the quality report is ok, stop and reply. If not and you still have calls left, fix the cause: replace a seed that barely shaped the results, try a different domain for the same love, or add a missing seed, then build_profile again. Use recommend only to change the budget.
You have at most ${MAX_TOOL_CALLS} tool calls in total. Every call needs a short reason.
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

const FILLER = /^(?:and|also|plus|but|my|our|his|her|their|the|a|an|he|she|they|is|are|really|totally|big|huge|fan|fans|of|into|loves?|likes?|enjoys?|adores?|obsessed|with|about|watching|listening|to|reading|playing|drinking|eating|anything|everything|all|things|stuff|sister|brother|mum|mom|dad|father|mother|wife|husband|partner|friend|boss|colleague|son|daughter|grandma|grandpa|aunt|uncle|cousin|nephew|niece|kid|kids|teen|teenager|girlfriend|boyfriend|fianc[eé]e?|bestie|roommate|neighbou?r|who|that|watches|listens|reads|plays|drinks|eats|collects|follows|supports|goes|crazy|mad|passionate|keen|on|for|she|he|they|always|since|forever|lot|lots)\s+/i

export function parseBudget(text: string): number | undefined {
  const m = text.match(/(?:budget|under|around|about|max(?:imum)?|up to|less than|below)[^0-9$]{0,12}\$?\s?(\d{2,4})|\$\s?(\d{2,4})|(\d{2,4})\s?(?:dollars|usd|\$)/i)
  const n = Number(m?.[1] ?? m?.[2] ?? m?.[3])
  return n > 0 ? n : undefined
}

export function splitLoves(text: string): string[] {
  return text
    .replace(/(?:budget|under|around|max(?:imum)?|up to|less than|below)?[^.,;]{0,12}\$?\s?\d{2,4}\s?(?:dollars|usd|\$)?/gi, ' ')
    .split(/[.,;:!?\n]|\band\b|&|\bplus\b|\balso\b/i)
    .map(part => {
      let s = part.trim()
      for (let i = 0; i < 8 && FILLER.test(s); i++) s = s.replace(FILLER, '').trim()
      const core = s.replace(/\s+(?:films?|movies?|series|shows?|books?|novels?|music|songs?|albums?)$/i, '').trim()
      return core.split(/\s+/).length > 1 || /^[A-Z0-9]/.test(core) ? core : s
    })
    .filter(s => s.length >= 3 && !/^(?:budget|gift|present|birthday|something)\b/i.test(s))
    .slice(0, 5)
}

function words(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff\s-]/g, ' ').split(/[\s-]+/).map(w => w.replace(/s$/, '')).filter(w => w.length > 1 && !['the', 'of', 'and', 'a'].includes(w))
}

function nameFit(phrase: string, name: string) {
  const p = words(phrase)
  const n = words(name.split(/[:(]/)[0]!)
  if (!p.length || !n.length) return 0
  const hits = p.filter(w => n.includes(w)).length
  return (hits / p.length) * Math.min(1, p.length / n.length)
}

async function bestSeed(ctx: PipelineContext, safety: Safety, phrase: string): Promise<Seed | undefined> {
  const [entities, tags] = await Promise.all([searchEntities(ctx, safety, phrase, undefined, 5), searchTags(ctx, phrase, 5)])
  const ranked = [...entities.map((s, i) => ({ s, fit: nameFit(phrase, s.name) - i * 0.02 })), ...tags.map((s, i) => ({ s, fit: nameFit(phrase, s.name) - i * 0.02 - 0.01 }))].sort((a, b) => b.fit - a.fit)
  const top = ranked[0]
  if (top && top.fit >= 0.3) return top.s
  return entities[0] && nameFit(phrase, entities[0].name) > 0 ? entities[0] : tags[0]
}

async function directSeeds(ctx: PipelineContext, safety: Safety, text: string, trace: ReturnType<typeof tracer>, state: AgentState) {
  const why = 'The language model is unavailable, so this phrase is matched in Qloo directly'
  const phrases = splitLoves(text)
  const found = await Promise.all(phrases.map(async phrase => {
    const hit = await trace.run(`Search “${phrase}”`, why, () => bestSeed(ctx, safety, phrase), s => s?.name ?? 'no match')
    return hit
  }))
  const seeds = [...new Map(found.filter((s): s is Seed => !!s).map(s => [s.id, s])).values()].slice(0, 5)
  if (!seeds.length) return
  state.seeds = seeds
  state.budget ??= parseBudget(text)
  state.last = await trace.run(`Build profile from ${seeds.map(s => s.name).join(', ')}`, why, () => recommend(ctx, { seeds, budget: state.budget, explain: false }, silentTracer()), r => `${r.strongMatches} strong matches`)
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
      if (typeof args.budget === 'number' && args.budget > 0) state.budget = args.budget
      const out = await trace.run(`Build profile from ${seeds.map(s => s.name).join(', ')}`, why, () => recommend(ctx, { seeds, explain: false, budget: state.budget }, silentTracer()), r => `${r.profile.interests.slice(0, 4).map(i => `${i.label} ${Math.round(i.weight * 100)}%`).join(', ')} · ${r.strongMatches} strong matches · quality ${r.quality.ok ? 'ok' : r.quality.issues.join('; ')}`)
      state.last = out
      return {
        seeds: seeds.map(s => s.name),
        interests: out.profile.interests.slice(0, 8).map(i => ({ label: i.label, weight: i.weight })),
        vibe: out.profile.facets.slice(0, 8).map(f => f.label),
        warnings: out.profile.warnings,
        ...summarizeRecommend(out)
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

  let llmDown = false
  while (calls < MAX_TOOL_CALLS) {
    let res: Awaited<ReturnType<typeof chat>>
    try {
      res = await chat(ctx.llm, { system: SYSTEM, messages, tools: TOOLS, maxTokens: 800, temperature: 0.2 })
    } catch {
      llmDown = true
      break
    }
    provider = `${res.provider}:${res.model}`
    if (!res.toolCalls.length) {
      finalText = res.text.trim()
      break
    }
    const allowed = res.toolCalls.slice(0, MAX_TOOL_CALLS - calls)
    messages.push({ role: 'assistant', content: res.text || undefined, toolCalls: allowed })
    calls += allowed.length
    const searches = allowed.every(c => c.name === 'search_entities' || c.name === 'search_tags')
    const run = async (call: (typeof allowed)[number]) => {
      try {
        return await exec(call.name, call.args ?? {})
      } catch (err) {
        return { error: (err as Error).message.slice(0, 200) }
      }
    }
    const outputs: unknown[] = []
    if (searches) outputs.push(...(await Promise.all(allowed.map(run))))
    else for (const call of allowed) outputs.push(await run(call))
    allowed.forEach((call, i) => messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify({ ...(outputs[i] as object), callsLeft: MAX_TOOL_CALLS - calls }) }))
  }

  if (llmDown && !state.last) await directSeeds(ctx, safety, userMessage, trace, state)
  if (llmDown && state.last) finalText = `The language model is busy right now, so I matched your words to Qloo directly: ${state.seeds.map(s => s.name).join(', ')}. Adjust the seeds if one is off.`
  if (!llmDown && calls >= MAX_TOOL_CALLS && !finalText) {
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
    const explained = await trace.run('Explain picks', 'Write one grounded line per pick from the matched interests and Qloo evidence', () => explainPicks(result!.picks, result!.profile.seeds, llmDown ? { provider: '', keys: {} } : ctx.llm), e => (e.source === 'llm' ? 'written by the LLM from Qloo facts' : 'template'))
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
