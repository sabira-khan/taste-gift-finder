import type { Pick, Product, RefineAction, RefineState, Seed, TasteProfile, TraceStep } from '../../shared/types'
import type { QlooClient } from './qloo'
import type { VocabIndex } from './vocab'
import type { InterestIndex } from './interests'
import type { LlmConfig } from './llm'
import { buildProfile, type ProfileContext } from './profile'
import { emptyRefine, interestKey, matchProducts, type MatchResult } from './matcher'
import { explainPicks, templateExplanation, type Draft } from './explain'

export interface PipelineContext {
  qloo: QlooClient
  vocab: VocabIndex
  interests: InterestIndex
  profileCtx: ProfileContext
  productBaseline: Record<string, number>
  products: Product[]
  llm: LlmConfig
}

export interface RecommendInput {
  seeds: Seed[]
  budget?: number
  refine?: RefineState
  take?: number
  explain?: boolean
}

export interface QualityReport {
  ok: boolean
  issues: string[]
  suggestions: string[]
  seedInfluence: Record<string, number>
}

export interface RecommendOutput {
  profile: TasteProfile
  picks: Pick[]
  alternates: Pick[]
  strongMatches: number
  considered: number
  excludedByBudget: number
  quality: QualityReport
  explanationSource: 'llm' | 'template'
  trace: TraceStep[]
  refine: RefineState
}

export function tracer(qloo: QlooClient) {
  const steps: TraceStep[] = []
  return {
    steps,
    async run<T>(step: string, reason: string, fn: () => Promise<T>, detail?: (r: T) => string): Promise<T> {
      const start = Date.now()
      const before = qloo.calls.length
      const result = await fn()
      const calls = qloo.calls.slice(before)
      steps.push({ step, reason, detail: detail?.(result), qlooCalls: calls.length, cacheHits: calls.filter(c => c.cached).length, ms: Date.now() - start })
      return result
    }
  }
}

export type Tracer = ReturnType<typeof tracer>

export function silentTracer(): Tracer {
  return {
    steps: [],
    async run<T>(_step: string, _reason: string, fn: () => Promise<T>) {
      return fn()
    }
  }
}

export function assessQuality(profile: TasteProfile, match: MatchResult): QualityReport {
  const issues: string[] = []
  const suggestions: string[] = []
  const influence: Record<string, number> = {}
  for (const p of match.picks) for (const [id, v] of Object.entries(p.seedShare)) influence[id] = (influence[id] ?? 0) + v
  const total = Object.values(influence).reduce((a, b) => a + b, 0) || 1
  const seedInfluence = Object.fromEntries(profile.seeds.map(s => [s.name, Math.round(((influence[s.id] ?? 0) / total) * 100) / 100]))
  if (match.strongMatches < 3) {
    issues.push(`only ${match.strongMatches} products passed the relevance threshold`)
    suggestions.push('try a more specific seed in a different domain (an artist, film, book or brand they love)')
  }
  const top = Object.entries(seedInfluence).sort((a, b) => b[1] - a[1])[0]
  if (top && profile.seeds.length > 1 && top[1] > 0.7) {
    issues.push(`one seed dominates the picks (${top[0]} ${Math.round(top[1] * 100)}%)`)
    suggestions.push(`replace or complement ${top[0]} with a seed from another domain`)
  }
  for (const w of profile.warnings) {
    if (w.includes('barely shaped')) {
      issues.push(w)
      suggestions.push('swap that seed for a better-known entity or an alternative spelling')
    }
    if (w.includes('no proxy')) issues.push(w)
  }
  const topInterest = profile.interests[0]
  if (!topInterest || topInterest.weight < 0.5) {
    issues.push('no strong concrete interest was found')
    suggestions.push('add a seed that names a hobby or fandom directly')
  }
  return { ok: issues.length === 0, issues, suggestions: [...new Set(suggestions)], seedInfluence }
}

export async function recommend(ctx: PipelineContext, input: RecommendInput, trace: Tracer = tracer(ctx.qloo)): Promise<RecommendOutput> {
  const refine = input.refine ?? emptyRefine()
  const profile = await trace.run(
    'Build taste profile',
    'Qloo brand insights in 6 gift lanes, cross-domain insights, tag insights for concrete interests, and style affinity for catalog reference brands',
    () => buildProfile(ctx.profileCtx, input.seeds),
    p => `${p.interests.slice(0, 3).map(i => i.label).join(', ')} · ${p.brandsUsed} brands read, ${p.brandsFiltered} filtered by safety`
  )
  const match = await trace.run(
    'Match catalog',
    'Score every product: interest 55%, vibe 25%, style references 10%, price 10%. Only specific interest matches qualify',
    async () => matchProducts(profile, ctx.products, ctx.vocab, { take: input.take ?? 5, alternates: 6, budget: input.budget, refine, baseline: ctx.productBaseline, interestIndex: ctx.interests }),
    m => `${m.strongMatches} strong matches out of ${m.considered} products${m.excludedByBudget ? `, ${m.excludedByBudget} over budget` : ''}`
  )
  const quality = assessQuality(profile, match)
  const explained = input.explain === false
    ? { picks: match.picks.map(d => withTemplate(d, profile.seeds)), source: 'template' as const }
    : await trace.run(
        'Explain picks',
        'One line per pick, grounded in the matched interest, its Qloo evidence and the seeds behind it',
        () => explainPicks(match.picks, profile.seeds, ctx.llm),
        e => (e.source === 'llm' ? 'written by the LLM from Qloo facts' : `template${'error' in e && e.error ? ' (LLM unavailable)' : ''}`)
      )
  return {
    profile,
    picks: explained.picks,
    alternates: match.alternates.map(d => withTemplate(d, profile.seeds)),
    strongMatches: match.strongMatches,
    considered: match.considered,
    excludedByBudget: match.excludedByBudget,
    quality,
    explanationSource: explained.source,
    trace: trace.steps,
    refine
  }
}

function withTemplate(d: Draft, seeds: Seed[]): Pick {
  return { ...d, explanation: templateExplanation(d, seeds), explanationSource: 'template' }
}

export function applyRefine(state: RefineState, action: RefineAction, products: Product[], shown: { handle: string; price: number }[]): RefineState {
  const next: RefineState = {
    boosts: { ...state.boosts },
    suppress: { ...state.suppress },
    excludedHandles: [...state.excludedHandles],
    categoryPenalty: { ...state.categoryPenalty },
    priceCap: state.priceCap
  }
  if (action.type === 'too_expensive') {
    const ref = action.handle ? products.find(p => p.handle === action.handle)?.price : Math.max(0, ...shown.map(s => s.price))
    if (ref) next.priceCap = Math.round(Math.min(next.priceCap ?? Infinity, ref * 0.8))
    return next
  }
  const product = products.find(p => p.handle === action.handle)
  if (!product) return next
  if (action.type === 'more_like') {
    for (const key of product.terms) next.boosts[key] = Math.min(4, (next.boosts[key] ?? 1) * 1.6)
    for (const i of product.interests) next.boosts[interestKey(i.id)] = Math.min(2, (next.boosts[interestKey(i.id)] ?? 1) * 1.3)
    next.categoryPenalty[product.category] = Math.max(0, (next.categoryPenalty[product.category] ?? 0) - 0.25)
  }
  if (action.type === 'not_style') {
    if (!next.excludedHandles.includes(product.handle)) next.excludedHandles.push(product.handle)
    for (const key of product.terms) next.suppress[key] = Math.max(0.1, (next.suppress[key] ?? 1) * 0.5)
    next.categoryPenalty[product.category] = Math.min(0.6, (next.categoryPenalty[product.category] ?? 0) + 0.25)
  }
  return next
}
