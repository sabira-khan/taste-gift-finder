import { createHash } from 'node:crypto'
import type { CrossDomainNode, Facet, Lane, PriceComfort, Seed, TasteProfile } from '../../shared/types'
import type { QlooClient, QlooEntity } from './qloo'
import type { Safety } from './safety'
import { attachTagProxies, proxyOwners, seedSignalParams } from './seeds'
import { dimensionOf, type VocabIndex } from './vocab'
import { buildInterests, type InterestBaseline, type InterestIndex } from './interests'

export interface ProfileContext {
  qloo: QlooClient
  lanes: Lane[]
  safety: Safety
  vocab: VocabIndex | null
  styleBrandIds?: string[]
  interests?: InterestIndex
  interestBaseline?: InterestBaseline | null
}

export interface LaneResult {
  lane: Lane
  brands: QlooEntity[]
  filtered: { name: string; category?: string; matched?: string }[]
}

async function attempt<T>(warnings: string[] | undefined, label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (!warnings) throw err
    warnings.push(`${label}: ${(err as Error).message.slice(0, 120)}`)
    return fallback
  }
}

export const CROSS_DOMAIN_TYPES = ['urn:entity:movie', 'urn:entity:artist', 'urn:entity:book', 'urn:entity:tv_show'] as const

export const DOMAIN_CATEGORIES: Record<string, string[]> = {
  'urn:entity:movie': ['prints-art', 'home-decor'],
  'urn:entity:tv_show': ['prints-art', 'games-puzzles'],
  'urn:entity:artist': ['audio', 'prints-art'],
  'urn:entity:book': ['books-reading', 'stationery']
}

function seedEntityIds(seeds: Seed[]) {
  const ids = seeds.filter(s => s.kind === 'entity').map(s => s.id)
  return ids.length ? ids.join(',') : undefined
}

export async function fetchLaneBrands(ctx: ProfileContext, seeds: Seed[], take = 25, warnings?: string[]): Promise<LaneResult[]> {
  return Promise.all(
    ctx.lanes.map(async lane => {
      const res = await attempt(warnings, `lane ${lane.id}`, () => ctx.qloo.insights({
        'filter.type': 'urn:entity:brand',
        ...seedSignalParams(seeds),
        'filter.tags': lane.tags.join(','),
        'filter.exclude.tags': ctx.safety.excludeParam,
        'filter.exclude.entities': seedEntityIds(seeds),
        'feature.explainability': true,
        take
      }), {})
      const brands: QlooEntity[] = []
      const filtered: LaneResult['filtered'] = []
      for (const entity of res.results?.entities ?? []) {
        const verdict = ctx.safety.check(entity)
        if (verdict.blocked) filtered.push({ name: entity.name, category: verdict.category, matched: verdict.matched })
        else brands.push(entity)
      }
      return { lane, brands, filtered }
    })
  )
}

export async function fetchCrossDomain(ctx: ProfileContext, seeds: Seed[], take = 6, warnings?: string[]) {
  const results = await Promise.all(
    CROSS_DOMAIN_TYPES.map(async type => {
      const res = await attempt(warnings, `domain ${type}`, () => ctx.qloo.insights({
        'filter.type': type,
        ...seedSignalParams(seeds),
        'filter.exclude.entities': seedEntityIds(seeds),
        'feature.explainability': true,
        take
      }), {})
      return { type, entities: (res.results?.entities ?? []).filter(e => !ctx.safety.check(e).blocked) }
    })
  )
  return results
}

export async function fetchStyleAffinity(ctx: ProfileContext, seeds: Seed[], warnings?: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(ctx.styleBrandIds ?? [])]
  if (!ids.length) return {}
  const res = await attempt(warnings, 'style affinity', () => ctx.qloo.insights({
    'filter.type': 'urn:entity:brand',
    ...seedSignalParams(seeds),
    'filter.results.entities': ids.join(','),
    take: Math.min(50, ids.length)
  }), {})
  const raw: Record<string, number> = {}
  for (const e of res.results?.entities ?? []) raw[e.entity_id] = e.query?.affinity ?? 0
  return normalizeRange(raw, 0)
}

export function seedScoresOf(entity: QlooEntity, seeds: Seed[]): Record<string, number> {
  const scores: Record<string, number> = {}
  const owners = proxyOwners(seeds)
  for (const list of Object.values(entity.query?.explainability ?? {})) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const id = item.entity_id ?? item.tag_id ?? item.id
      const ref = id ? owners.get(id) : undefined
      if (ref) scores[ref.owner] = (scores[ref.owner] ?? 0) + Math.max(0, item.score ?? 0) * ref.share
    }
  }
  const total = Object.values(scores).reduce((a, b) => a + b, 0)
  if (total <= 0) return Object.fromEntries(seeds.map(s => [s.id, 1 / seeds.length]))
  return Object.fromEntries(seeds.map(s => [s.id, (scores[s.id] ?? 0) / total]))
}

function normalizeRange(values: Record<string, number>, floor = 0.3): Record<string, number> {
  const list = Object.values(values)
  if (!list.length) return {}
  const min = Math.min(...list)
  const max = Math.max(...list)
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, max === min ? 1 : floor + (1 - floor) * ((v - min) / (max - min))])
  )
}

function meanTop(values: number[], n: number) {
  const top = [...values].sort((a, b) => b - a).slice(0, n)
  return top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0
}

function weightedPercentile(samples: { value: number; weight: number }[], q: number) {
  const sorted = [...samples].sort((a, b) => a.value - b.value)
  const total = sorted.reduce((a, s) => a + s.weight, 0)
  let acc = 0
  for (const s of sorted) {
    acc += s.weight
    if (acc / total >= q) return s.value
  }
  return sorted[sorted.length - 1]!.value
}

export function profileId(seeds: Seed[]) {
  return createHash('sha1').update(seeds.map(s => s.id).sort().join('|')).digest('hex').slice(0, 12)
}

export const LIFT_SMOOTHING = 3

export function priceTier(value: number, reference: number[]) {
  if (!reference.length) return 0.5
  let i = 0
  while (i < reference.length && reference[i]! < value) i++
  return Math.min(1, Math.max(0, i / (reference.length - 1)))
}

export async function buildProfile(ctx: ProfileContext, inputSeeds: Seed[]): Promise<TasteProfile> {
  if (!ctx.vocab) throw new Error('vocabulary required')
  const vocab = ctx.vocab
  const warnings: string[] = []
  const seeds = await attachTagProxies(ctx.qloo, inputSeeds)
  for (const s of seeds) if (s.kind === 'tag' && !s.proxies?.length) warnings.push(`tag ${s.name} has no proxy entities in Qloo`)
  const [lanes, cross, styleAffinity, interests] = await Promise.all([
    fetchLaneBrands(ctx, seeds, 25, warnings),
    fetchCrossDomain(ctx, seeds, 6, warnings),
    fetchStyleAffinity(ctx, seeds, warnings),
    ctx.interests ? buildInterests(ctx.qloo, ctx.interests, seeds, seedSignalParams(seeds), ctx.interestBaseline ?? null, warnings) : Promise.resolve([])
  ])

  const facets = new Map<string, Facet & { brandWeights: Map<string, number> }>()
  const priceSamples: { value: number; weight: number }[] = []
  const laneStrengthRaw: Record<string, number> = {}
  const topBrands: TasteProfile['topBrands'] = []
  let brandsUsed = 0
  let brandsFiltered = 0
  let totalWeight = 0
  const seedTouch: Record<string, number> = {}

  for (const { lane, brands, filtered } of lanes) {
    brandsFiltered += filtered.length
    brandsUsed += brands.length
    laneStrengthRaw[lane.id] = meanTop(brands.map(b => b.query?.affinity ?? 0), 5)
    brands.forEach((brand, rank) => {
      const affinity = brand.query?.affinity ?? 0
      const w = affinity * (1 - rank / (brands.length * 2 + 1))
      const shares = seedScoresOf(brand, seeds)
      totalWeight += w
      for (const [id, v] of Object.entries(shares)) seedTouch[id] = (seedTouch[id] ?? 0) + v * w
      topBrands.push({ name: brand.name, lane: lane.id, affinity })
      const seen = new Set<string>()
      for (const tag of brand.tags ?? []) {
        if (!dimensionOf(tag)) continue
        const term = vocab.resolve(tag)
        if (!term || seen.has(term.key)) continue
        seen.add(term.key)
        let facet = facets.get(term.key)
        if (!facet) {
          facet = { key: term.key, dimension: term.dimension, label: term.label, weight: 0, lift: 0, seedShare: {}, viaBrands: [], brandWeights: new Map() }
          facets.set(term.key, facet)
        }
        facet.weight += w
        for (const [seedId, share] of Object.entries(shares)) facet.seedShare[seedId] = (facet.seedShare[seedId] ?? 0) + w * share
        facet.brandWeights.set(brand.name, (facet.brandWeights.get(brand.name) ?? 0) + w)
      }
      const min = Number(brand.properties?.price_range_usd_min)
      const max = Number(brand.properties?.price_range_usd_max)
      if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) {
        priceSamples.push({ value: Math.sqrt(min * max), weight: w })
      }
    })
  }

  const baseline = vocab.vocab.totalBrands || 1
  const scoredFacets = [...facets.values()].map(f => {
    const term = vocab.terms.get(f.key)
    const expected = (term?.brandCount ?? 1) / baseline
    const observed = (f.weight + LIFT_SMOOTHING * expected) / (totalWeight + LIFT_SMOOTHING)
    const lift = observed / expected
    const score = lift > 1 && f.brandWeights.size >= 2 ? observed * Math.log(lift) : 0
    return { f, lift, score }
  })
  const maxScore = Math.max(1e-9, ...scoredFacets.map(x => x.score))
  const facetList: Facet[] = scoredFacets
    .filter(x => x.score > 0)
    .map(({ f: { brandWeights, ...f }, lift, score }) => {
      const shareTotal = Object.values(f.seedShare).reduce((a, b) => a + b, 0) || 1
      return {
        ...f,
        weight: score / maxScore,
        lift: Math.round(lift * 10) / 10,
        seedShare: Object.fromEntries(Object.entries(f.seedShare).map(([k, v]) => [k, v / shareTotal])),
        viaBrands: [...brandWeights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name)
      }
    })
    .filter(f => f.weight >= 0.03)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 80)

  const touchTotal = Object.values(seedTouch).reduce((a, b) => a + b, 0) || 1
  for (const s of seeds) {
    const share = (seedTouch[s.id] ?? 0) / touchTotal
    if (share < 0.05) warnings.push(`seed ${s.name} barely shaped brand results (${Math.round(share * 100)}%)`)
  }

  const crossDomain: CrossDomainNode[] = []
  const domainStrengthRaw: Record<string, number> = {}
  for (const { type, entities } of cross) {
    domainStrengthRaw[type] = meanTop(entities.map(e => e.query?.affinity ?? 0), 5)
    for (const e of entities.slice(0, 4)) {
      crossDomain.push({
        id: e.entity_id,
        name: e.name,
        type,
        affinity: e.query?.affinity ?? 0,
        seedShare: seedScoresOf(e, seeds),
        image: e.properties?.image?.url
      })
    }
  }

  const laneStrength = normalizeRange(laneStrengthRaw)
  const domainStrength = normalizeRange(domainStrengthRaw)
  const categoryRaw: Record<string, number> = {}
  for (const lane of ctx.lanes) {
    for (const cat of lane.categories) categoryRaw[cat] = Math.max(categoryRaw[cat] ?? 0, laneStrength[lane.id] ?? 0)
  }
  for (const [type, cats] of Object.entries(DOMAIN_CATEGORIES)) {
    for (const cat of cats) categoryRaw[cat] = Math.max(categoryRaw[cat] ?? 0, 0.8 * (domainStrength[type] ?? 0))
  }

  let priceComfort: PriceComfort | null = null
  if (priceSamples.length >= 4) {
    const median = weightedPercentile(priceSamples, 0.5)
    priceComfort = {
      p25: Math.round(weightedPercentile(priceSamples, 0.25)),
      median: Math.round(median),
      p75: Math.round(weightedPercentile(priceSamples, 0.75)),
      tier: Math.round(priceTier(median, vocab.vocab.priceReference) * 100) / 100,
      samples: priceSamples.length
    }
  }

  return {
    id: profileId(seeds),
    seeds,
    facets: facetList,
    interests,
    crossDomain,
    laneStrength,
    categoryWeights: categoryRaw,
    topBrands: topBrands.sort((a, b) => b.affinity - a.affinity).slice(0, 15),
    styleAffinity,
    priceComfort,
    brandsUsed,
    brandsFiltered,
    warnings
  }
}
