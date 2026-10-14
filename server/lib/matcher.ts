import type { Facet, InterestSignal, MatchedInterest, MatchedTerm, Pick, Product, RefineState, ScoreBreakdown, TasteProfile } from '../../shared/types'
import type { VocabIndex } from './vocab'
import { PARENT_ONLY_CAP, type InterestIndex } from './interests'

export const WEIGHTS = { interest: 0.55, property: 0.25, styleRef: 0.1, price: 0.1 }
export const INTEREST_FLOOR = 0.35
export const RELEVANCE_MIN = 0.45
export const TIE_EPSILON = 0.02
export const BASELINE_EPSILON = 0.05
export const CONTRAST_EXPONENT = 0.75

export function propertyFit(profile: TasteProfile, product: Product, vocab: VocabIndex) {
  const weights = facetWeights(profile, vocab, emptyRefine())
  const sum = product.terms.reduce((a, key) => a + (weights.get(key)?.weight ?? 0), 0)
  return sum / Math.sqrt(Math.max(1, product.terms.length))
}

export interface MatchOptions {
  baseline?: Record<string, number>
  budget?: number
  refine?: RefineState
  take?: number
  alternates?: number
  interestIndex?: InterestIndex
}

export interface MatchResult {
  picks: Omit<Pick, 'explanation' | 'explanationSource'>[]
  alternates: Omit<Pick, 'explanation' | 'explanationSource'>[]
  considered: number
  excludedByBudget: number
  strongMatches: number
  noInterestMatch: number
}

interface Scored {
  product: Product
  propertyRaw: number
  contrast: number | null
  contributions: { facet: Facet; value: number }[]
  interestHits: InterestHit[]
  score: ScoreBreakdown
  styleRefHits: { name: string; affinity: number }[]
}

interface InterestHit {
  signal: InterestSignal
  strength: number
  value: number
  level: 'specific' | 'broad'
  via?: string
}

export function interestHit(id: string, strength: number, interests: Map<string, InterestSignal>, index?: InterestIndex): InterestHit | null {
  const def = index?.defs.get(id)
  const own = interests.get(id)
  const hasChildren = !!index?.children.get(id)?.length
  if (def?.parent) {
    const parent = interests.get(def.parent)
    const specific = own?.weight ?? 0
    const broad = Math.min(PARENT_ONLY_CAP, parent?.weight ?? 0)
    if (own && specific >= broad && specific > 0) return { signal: own, strength, value: strength * specific, level: 'specific' }
    if (parent && broad > 0) return { signal: parent, strength, value: strength * broad, level: 'broad', via: def.label }
    return null
  }
  if (!own || own.weight <= 0) return null
  if (hasChildren) return { signal: own, strength, value: strength * Math.min(PARENT_ONLY_CAP, own.weight), level: 'broad' }
  return { signal: own, strength, value: strength * own.weight, level: 'specific' }
}

export function emptyRefine(): RefineState {
  return { boosts: {}, suppress: {}, excludedHandles: [], categoryPenalty: {} }
}

export function jaccard(a: string[], b: string[]) {
  const A = new Set(a)
  const B = new Set(b)
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  const union = A.size + B.size - inter
  return union ? inter / union : 0
}

export function interestKey(id: string) {
  return `interest:${id}`
}

function similarity(a: Product, b: Product) {
  const sameCategory = a.category === b.category ? 1 : 0
  return 0.5 * sameCategory + 0.5 * jaccard(a.interests.map(i => i.id), b.interests.map(i => i.id))
}

function noisyOr(values: number[]) {
  return 1 - values.reduce((acc, v) => acc * (1 - Math.max(0, Math.min(1, v))), 1)
}

export function targetPrice(profile: TasteProfile, products: Product[]) {
  const prices = products.map(p => p.price).filter(p => p > 0)
  if (!prices.length || !profile.priceComfort) return null
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  return min * Math.pow(max / min, profile.priceComfort.tier)
}

function priceFit(price: number, target: number | null) {
  if (!target) return 0.5
  const ratio = Math.log(price / target)
  return Math.exp(-(ratio * ratio) / (2 * 0.6 * 0.6))
}

export function facetWeights(profile: TasteProfile, vocab: VocabIndex, refine: RefineState) {
  const map = new Map<string, { facet: Facet; weight: number }>()
  for (const facet of profile.facets) {
    const mult = (refine.boosts[facet.key] ?? 1) * (refine.suppress[facet.key] ?? 1)
    if (vocab.terms.has(facet.key)) map.set(facet.key, { facet, weight: facet.weight * mult })
  }
  return map
}

export function interestWeights(profile: TasteProfile, refine: RefineState) {
  const map = new Map<string, InterestSignal>()
  for (const signal of profile.interests) {
    const key = interestKey(signal.id)
    const mult = (refine.boosts[key] ?? 1) * (refine.suppress[key] ?? 1)
    map.set(signal.id, { ...signal, weight: Math.min(1, signal.weight * mult) })
  }
  return map
}

function mixShares(parts: { share: Record<string, number>; weight: number }[]) {
  const out: Record<string, number> = {}
  for (const { share, weight } of parts) {
    const total = Object.values(share).reduce((a, b) => a + b, 0)
    if (total <= 0 || weight <= 0) continue
    for (const [k, v] of Object.entries(share)) out[k] = (out[k] ?? 0) + (weight * v) / total
  }
  const sum = Object.values(out).reduce((a, b) => a + b, 0) || 1
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, round(v / sum)]))
}

export function matchProducts(profile: TasteProfile, products: Product[], vocab: VocabIndex, opts: MatchOptions = {}): MatchResult {
  const refine = opts.refine ?? emptyRefine()
  const take = opts.take ?? 5
  const weights = facetWeights(profile, vocab, refine)
  const interests = interestWeights(profile, refine)
  const cap = Math.min(opts.budget ?? Infinity, refine.priceCap ?? Infinity)
  const excluded = new Set(refine.excludedHandles)

  const eligible = products.filter(p => !excluded.has(p.handle))
  const affordable = eligible.filter(p => p.price <= cap)

  const scored: Scored[] = affordable.map(product => {
    const contributions = product.terms
      .map(key => weights.get(key))
      .filter((x): x is { facet: Facet; weight: number } => !!x)
      .map(x => ({ facet: x.facet, value: x.weight }))
    const fit = contributions.reduce((a, c) => a + c.value, 0) / Math.sqrt(Math.max(1, product.terms.length))
    const base = opts.baseline?.[product.handle]
    const propertyRaw = base ? fit / Math.pow(base + BASELINE_EPSILON, CONTRAST_EXPONENT) : fit
    const contrast = base ? fit / (base + BASELINE_EPSILON) : null
    const interestHits = product.interests
      .map(pi => interestHit(pi.id, pi.strength, interests, opts.interestIndex))
      .filter((x): x is InterestHit => !!x && x.value > 0)
      .filter((h, i, all) => h.level === 'specific' || !all.some((o, j) => o.level === 'broad' && o.signal.id === h.signal.id && (o.value > h.value || (o.value === h.value && j < i))))
      .sort((a, b) => b.value - a.value)
    const styleRefHits = product.styleRefs
      .map(s => ({ name: s.name, affinity: profile.styleAffinity[s.entityId] ?? 0 }))
      .filter(s => s.affinity > 0)
      .sort((a, b) => b.affinity - a.affinity)
    return {
      product,
      propertyRaw,
      contrast,
      contributions,
      interestHits,
      styleRefHits,
      score: { interest: 0, property: 0, styleRef: 0, price: 0, total: 0 }
    }
  })

  const target = targetPrice(profile, products)
  const maxProperty = Math.max(1e-9, ...scored.map(s => s.propertyRaw))
  for (const s of scored) {
    const interest = noisyOr(s.interestHits.map(h => h.value))
    const property = s.propertyRaw / maxProperty
    const styleRef = property > 0 ? (s.styleRefHits[0]?.affinity ?? 0) : 0
    const price = priceFit(s.product.price, target)
    const penalty = Math.min(1, refine.categoryPenalty[s.product.category] ?? 0)
    const total = (WEIGHTS.interest * interest + WEIGHTS.property * property + WEIGHTS.styleRef * styleRef + WEIGHTS.price * price) * (1 - penalty)
    s.score = { interest: round(interest), property: round(property), styleRef: round(styleRef), price: round(price), total: round(total) }
  }

  const specificBest = (s: Scored) => Math.max(0, ...s.interestHits.filter(h => h.level === 'specific').map(h => h.value))
  const relevant = (s: Scored) => specificBest(s) >= INTEREST_FLOOR && s.score.total >= RELEVANCE_MIN
  const ranked = scored.filter(s => s.score.interest > 0).sort((a, b) => b.score.total - a.score.total)
  const strongPool = ranked.filter(relevant)
  const nearPool = ranked.filter(s => !relevant(s))

  const order = (pool: Scored[], selected: Scored[], limit: number) => {
    const rest = [...pool]
    const out: Scored[] = []
    while (out.length < limit && rest.length) {
      const best = rest[0]!.score.total
      const tied = rest.filter(c => c.score.total >= best - TIE_EPSILON)
      const chosen = tied.reduce((winner, cand) => {
        const sim = (x: Scored) => Math.max(0, ...[...selected, ...out].map(s => similarity(x.product, s.product)))
        const diff = sim(cand) - sim(winner)
        if (diff < 0) return cand
        if (diff === 0 && cand.score.total > winner.score.total) return cand
        return winner
      }, tied[0]!)
      out.push(chosen)
      rest.splice(rest.indexOf(chosen), 1)
    }
    return out
  }

  const picks = order(strongPool, [], take)
  const extra = opts.alternates ?? 5
  const alternates = order([...strongPool.filter(s => !picks.includes(s)), ...nearPool], picks, extra)

  const toPick = (s: Scored) => {
    const total = s.contributions.reduce((a, c) => a + c.value, 0) || 1
    const matched: MatchedTerm[] = [...s.contributions]
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map(c => ({ key: c.facet.key, label: c.facet.label, dimension: c.facet.dimension, weight: round(c.value / total) }))
    const facetShare: Record<string, number> = {}
    for (const c of s.contributions) {
      for (const [seedId, share] of Object.entries(c.facet.seedShare)) facetShare[seedId] = (facetShare[seedId] ?? 0) + c.value * share
    }
    const interestShare: Record<string, number> = {}
    for (const h of s.interestHits) {
      for (const [seedId, share] of Object.entries(h.signal.seedShare)) interestShare[seedId] = (interestShare[seedId] ?? 0) + h.value * share
    }
    const seedShare = mixShares([
      { share: interestShare, weight: WEIGHTS.interest * s.score.interest },
      { share: facetShare, weight: WEIGHTS.property * s.score.property }
    ])
    const matchedInterests: MatchedInterest[] = s.interestHits.map(h => ({
      id: h.signal.id,
      label: h.signal.label,
      level: h.level,
      via: h.via,
      weight: round(h.signal.weight),
      strength: h.strength,
      evidence: h.signal.evidence
    }))
    return {
      product: s.product,
      score: s.score,
      contrast: s.contrast === null ? null : round(s.contrast),
      matched,
      interests: matchedInterests,
      seedShare,
      styleRefHits: s.styleRefHits.slice(0, 2).map(h => ({ ...h, affinity: round(h.affinity) }))
    }
  }

  return {
    picks: picks.map(toPick),
    alternates: alternates.map(toPick),
    considered: affordable.length,
    excludedByBudget: eligible.length - affordable.length,
    strongMatches: strongPool.length,
    noInterestMatch: scored.length - ranked.length
  }
}

function round(x: number) {
  return Math.round(x * 1000) / 1000
}
