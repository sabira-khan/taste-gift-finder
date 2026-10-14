import type { InterestEvidence, InterestSignal, Seed } from '../../shared/types'
import type { QlooClient, QlooTagInsight } from './qloo'

export interface InterestDef {
  id: string
  label: string
  parent?: string
  match: string[]
  matchId?: string[]
  exclude?: string[]
}

export interface InterestTaxonomy {
  version: string
  seedTagTypeExclude: string[]
  weakSeedTagTypes: string[]
  domains: Record<string, string[]>
  interests: InterestDef[]
}

export interface InterestBaseline {
  sets: number
  df: Record<string, number>
  qlooMean: Record<string, number>
}

export const TAG_SOURCES = [
  { id: 'audience', types: 'urn:tag:audience:qloo', weight: 1 },
  { id: 'interests', types: 'urn:tag:interests:qloo,urn:tag:interest_adjacency:qloo', weight: 1 },
  { id: 'media-genre', types: 'urn:tag:genre:media', weight: 0.7 },
  { id: 'brand-genre', types: 'urn:tag:genre:brand', weight: 0.6 },
  { id: 'keyword', types: 'urn:tag:keyword:qloo', weight: 0.5 }
] as const

export const TAG_TAKE = 30
export const DOMAIN_EVIDENCE = 0.9
export const SEED_TAG_EVIDENCE = 0.35
export const WEAK_SEED_TAG_EVIDENCE = 0.2
export const SEED_TAG_CAP = 0.9
export const QLOO_ITEM_SCALE = 0.5
export const QLOO_SOURCE_CAP = 0.9
export const INTEREST_MIN_WEIGHT = 0.12
export const PARENT_ONLY_CAP = 0.4

export interface InterestIndex {
  taxonomy: InterestTaxonomy
  defs: Map<string, InterestDef>
  children: Map<string, string[]>
  classify(text: string, tagId?: string): string[]
}

export function createInterestIndex(taxonomy: InterestTaxonomy): InterestIndex {
  const compiled = taxonomy.interests.map(def => ({
    def,
    match: def.match.map(p => new RegExp(p, 'i')),
    matchId: (def.matchId ?? []).map(p => new RegExp(p, 'i')),
    exclude: (def.exclude ?? []).map(p => new RegExp(p, 'i'))
  }))
  const children = new Map<string, string[]>()
  for (const d of taxonomy.interests) if (d.parent) children.set(d.parent, [...(children.get(d.parent) ?? []), d.id])
  return {
    taxonomy,
    defs: new Map(taxonomy.interests.map(d => [d.id, d])),
    children,
    classify(text: string, tagId?: string) {
      return compiled
        .filter(c => (c.match.some(r => r.test(text)) || (!!tagId && c.matchId.some(r => r.test(tagId)))) && !c.exclude.some(r => r.test(text)))
        .map(c => c.def.id)
    }
  }
}

function tagTypeOf(id: string) {
  return id.replace(/^urn:tag:/, '').split(':').slice(0, 2).join(':')
}

function tagText(tag: { id: string; name: string }) {
  const tail = tag.id.split(':').pop()?.replace(/_/g, ' ') ?? ''
  return `${tag.name} ${tail}`.trim()
}

function noisyOr(values: number[]) {
  return 1 - values.reduce((acc, v) => acc * (1 - Math.max(0, Math.min(1, v))), 1)
}

interface Item {
  interest: string
  value: number
  source: string
  evidence: InterestEvidence
}

export function seedInterestItems(index: InterestIndex, seeds: Seed[]): Item[] {
  const items: Item[] = []
  for (const seed of seeds) {
    for (const interest of index.taxonomy.domains[seed.type] ?? []) {
      items.push({ interest, value: DOMAIN_EVIDENCE, source: `domain:${seed.id}`, evidence: { source: 'domain', label: `${seed.name} is a ${seed.type.split(':').pop()?.replace('_', ' ')}`, seedId: seed.id } })
    }
    const hits = new Map<string, { values: number[]; weak: boolean; labels: string[] }>()
    for (const tag of seed.tags ?? []) {
      const type = tagTypeOf(tag.id)
      if (index.taxonomy.seedTagTypeExclude.some(t => type.startsWith(t))) continue
      const weak = seed.kind === 'entity' && index.taxonomy.weakSeedTagTypes.some(t => type.startsWith(t))
      for (const interest of index.classify(tagText(tag), tag.id)) {
        const h = hits.get(interest) ?? { values: [], weak: false, labels: [] }
        if (seed.kind === 'tag') h.values.push(DOMAIN_EVIDENCE)
        else if (!weak) h.values.push(SEED_TAG_EVIDENCE)
        else if (!h.weak) {
          h.weak = true
          h.values.push(WEAK_SEED_TAG_EVIDENCE)
        }
        if (h.labels.length < 3 && !h.labels.includes(tag.name.trim())) h.labels.push(tag.name.trim())
        hits.set(interest, h)
      }
    }
    for (const [interest, h] of hits) {
      items.push({ interest, value: Math.min(SEED_TAG_CAP, noisyOr(h.values)), source: `seed:${seed.id}`, evidence: { source: 'seed', label: `${seed.name}: ${h.labels.join(', ')}`, seedId: seed.id } })
    }
  }
  return items
}

export function qlooTagItems(index: InterestIndex, lists: { source: (typeof TAG_SOURCES)[number]; tags: QlooTagInsight[] }[], baseline: InterestBaseline | null): Item[] {
  const items: Item[] = []
  for (const { source, tags } of lists) {
    tags.forEach((tag, rank) => {
      const decay = 1 - 0.7 * (rank / Math.max(1, TAG_TAKE))
      const df = baseline?.df[tag.tag_id] ?? 0
      const specificity = Math.max(0, 1 - df)
      if (specificity <= 0) return
      for (const interest of index.classify(tagText({ id: tag.tag_id, name: tag.name }), tag.tag_id)) {
        items.push({
          interest,
          value: QLOO_ITEM_SCALE * source.weight * decay * specificity,
          source: `qloo:${source.id}`,
          evidence: { source: 'qloo', label: tag.name.trim() }
        })
      }
    })
  }
  return items
}

export async function fetchTagInsights(qloo: QlooClient, signal: Record<string, string | undefined>, warnings?: string[]) {
  return Promise.all(
    TAG_SOURCES.map(async source => {
      try {
        const res = await qloo.insights({ 'filter.type': 'urn:tag', 'filter.tag.types': source.types, ...signal, take: TAG_TAKE })
        return { source, tags: res.results?.tags ?? [] }
      } catch (err) {
        warnings?.push(`tag insights ${source.id}: ${(err as Error).message.slice(0, 120)}`)
        return { source, tags: [] }
      }
    })
  )
}

export function qlooOnly(items: Item[]) {
  const out: Record<string, number> = {}
  const groups = new Map<string, number[]>()
  for (const item of items) {
    if (!item.source.startsWith('qloo:')) continue
    const key = `${item.interest}|${item.source}`
    groups.set(key, [...(groups.get(key) ?? []), item.value])
  }
  const perInterest = new Map<string, number[]>()
  for (const [key, values] of groups) {
    const interest = key.split('|')[0]!
    perInterest.set(interest, [...(perInterest.get(interest) ?? []), Math.min(QLOO_SOURCE_CAP, noisyOr(values))])
  }
  for (const [interest, values] of perInterest) out[interest] = noisyOr(values)
  return out
}

export function combineInterests(index: InterestIndex, items: Item[], seeds: Seed[], baseline: InterestBaseline | null): InterestSignal[] {
  const byInterest = new Map<string, Item[]>()
  for (const item of items) byInterest.set(item.interest, [...(byInterest.get(item.interest) ?? []), item])
  const out: InterestSignal[] = []
  for (const [id, list] of byInterest) {
    const bySource = new Map<string, Item[]>()
    for (const item of list) bySource.set(item.source, [...(bySource.get(item.source) ?? []), item])
    const sourceValues = [...bySource.entries()].map(([source, xs]) => {
      const v = noisyOr(xs.map(x => x.value))
      return { source, value: source.startsWith('qloo:') ? Math.min(QLOO_SOURCE_CAP, v) : v, items: xs }
    })
    const direct = noisyOr(sourceValues.filter(s => !s.source.startsWith('qloo:')).map(s => s.value))
    const qloo = noisyOr(sourceValues.filter(s => s.source.startsWith('qloo:')).map(s => s.value))
    const typical = baseline?.qlooMean[id] ?? 0
    const qlooLift = typical < 1 ? Math.max(0, (qloo - typical) / (1 - typical)) : 0
    const weight = noisyOr([direct, qlooLift])
    if (weight < INTEREST_MIN_WEIGHT) continue
    const kept = sourceValues.filter(s => !s.source.startsWith('qloo:') || qlooLift > 0)
    const seedRaw: Record<string, number> = {}
    for (const s of kept) {
      const seedId = s.items[0]?.evidence.seedId
      if (seedId) seedRaw[seedId] = (seedRaw[seedId] ?? 0) + s.value
    }
    const seedTotal = Object.values(seedRaw).reduce((a, b) => a + b, 0)
    const seedShare = seedTotal > 0
      ? Object.fromEntries(Object.entries(seedRaw).map(([k, v]) => [k, v / seedTotal]))
      : Object.fromEntries(seeds.map(s => [s.id, 1 / Math.max(1, seeds.length)]))
    const ranked = [...kept].sort((a, b) => b.value - a.value)
    const evidence: InterestEvidence[] = []
    for (const s of ranked) {
      if (s.items[0]!.evidence.source === 'qloo') {
        const labels = [...new Set([...s.items].sort((a, b) => b.value - a.value).map(x => x.evidence.label))].slice(0, 3)
        evidence.push({ source: 'qloo', label: labels.join(', ') })
      } else evidence.push(s.items[0]!.evidence)
      if (evidence.length >= 4) break
    }
    out.push({ id, label: index.defs.get(id)?.label ?? id, parent: index.defs.get(id)?.parent, weight: Math.round(weight * 1000) / 1000, seedShare, evidence })
  }
  return rollUpParents(index, out, seeds).sort((a, b) => b.weight - a.weight)
}

export function rollUpParents(index: InterestIndex, signals: InterestSignal[], seeds: Seed[]): InterestSignal[] {
  const byId = new Map(signals.map(s => [s.id, s]))
  for (const [parentId, childIds] of index.children) {
    const kids = childIds.map(id => byId.get(id)).filter((x): x is InterestSignal => !!x)
    if (!kids.length) continue
    const strongest = kids.reduce((a, b) => (b.weight > a.weight ? b : a))
    const own = byId.get(parentId)
    if (own) {
      own.weight = Math.round(noisyOr([own.weight, strongest.weight]) * 1000) / 1000
      continue
    }
    byId.set(parentId, {
      id: parentId,
      label: index.defs.get(parentId)?.label ?? parentId,
      weight: strongest.weight,
      seedShare: strongest.seedShare,
      evidence: [{ source: strongest.evidence[0]?.source ?? 'qloo', label: `via ${strongest.label}` }]
    })
  }
  return [...byId.values()].map(s => (s.seedShare && Object.keys(s.seedShare).length ? s : { ...s, seedShare: Object.fromEntries(seeds.map(x => [x.id, 1 / Math.max(1, seeds.length)])) }))
}

export async function buildInterests(qloo: QlooClient, index: InterestIndex, seeds: Seed[], signal: Record<string, string | undefined>, baseline: InterestBaseline | null, warnings?: string[]) {
  const lists = await fetchTagInsights(qloo, signal, warnings)
  const items = [...seedInterestItems(index, seeds), ...qlooTagItems(index, lists, baseline)]
  return combineInterests(index, items, seeds, baseline)
}
