import { makeQloo, readJson, writeJson } from './lib/env'
import { resolveSeed, type SeedQuery } from '../server/lib/seeds'
import { createSafety, type Denylist } from '../server/lib/safety'
import { fetchLaneBrands } from '../server/lib/profile'
import { coreStem, dimensionOf } from '../server/lib/vocab'
import type { Lane, Seed, Vocabulary, VocabTerm } from '../shared/types'

const MIN_BRANDS = 3
const MIN_SETS = 2

interface Group {
  dimension: VocabTerm['dimension']
  stem: string
  ids: Map<string, number>
  labels: Map<string, number>
  brands: Set<string>
  sets: Set<string>
  score: number
}

const qloo = makeQloo()
const lanes = readJson<Lane[]>('lanes.json')
const safety = createSafety(readJson<Denylist>('denylist.json'))
const sets = readJson<{ id: string; seeds: SeedQuery[] }[]>('seed-sets.json')
const groups = new Map<string, Group>()
const allBrands = new Set<string>()
const brandPrices = new Map<string, number>()
const filteredLog: { set: string; lane: string; name: string; category?: string; matched?: string }[] = []
const resolvedSeeds: Record<string, Pick<Seed, 'id' | 'name' | 'type'>[]> = {}

for (const set of sets) {
  const seeds: Seed[] = []
  for (const q of set.seeds) {
    const seed = await resolveSeed(qloo, q)
    if (seed) seeds.push(seed)
  }
  resolvedSeeds[set.id] = seeds.map(({ id, name, type }) => ({ id, name, type }))
  const laneResults = await fetchLaneBrands({ qloo, lanes, safety, vocab: null }, seeds, 25)
  for (const { lane, brands, filtered } of laneResults) {
    for (const f of filtered) filteredLog.push({ set: set.id, lane: lane.id, ...f })
    for (const brand of brands) {
      const affinity = brand.query?.affinity ?? 0
      allBrands.add(brand.entity_id)
      const pMin = Number(brand.properties?.price_range_usd_min)
      const pMax = Number(brand.properties?.price_range_usd_max)
      if (Number.isFinite(pMin) && Number.isFinite(pMax) && pMin > 0 && pMax >= pMin) brandPrices.set(brand.entity_id, Math.sqrt(pMin * pMax))
      for (const tag of brand.tags ?? []) {
        const dimension = dimensionOf(tag)
        if (!dimension) continue
        const stem = coreStem(tag.name)
        if (!stem) continue
        const key = `${dimension}|${stem}`
        let g = groups.get(key)
        if (!g) {
          g = { dimension, stem, ids: new Map(), labels: new Map(), brands: new Set(), sets: new Set(), score: 0 }
          groups.set(key, g)
        }
        g.ids.set(tag.id, (g.ids.get(tag.id) ?? 0) + 1)
        g.labels.set(tag.name, (g.labels.get(tag.name) ?? 0) + 1)
        if (!g.brands.has(brand.entity_id)) g.score += affinity
        g.brands.add(brand.entity_id)
        g.sets.add(set.id)
      }
    }
  }
  console.log(`${set.id}: ${seeds.map(s => s.name).join(', ')}`)
}

const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])

const raw = [...groups.values()]
  .map(g => ({
    dimension: g.dimension,
    label: top(g.labels)[0]![0],
    key: top(g.ids)[0]![0],
    aliases: top(g.ids).slice(1).map(([id]) => id),
    brandCount: g.brands.size,
    seedSetCount: g.sets.size,
    idf: Number(Math.log(1 + allBrands.size / g.brands.size).toFixed(3)),
    score: Number(g.score.toFixed(3))
  }))
  .sort((a, b) => b.score - a.score)


const terms: VocabTerm[] = raw
  .filter(r => r.brandCount >= MIN_BRANDS && r.seedSetCount >= MIN_SETS)
  .map(({ score, ...term }) => term)

const sortedPrices = [...brandPrices.values()].sort((a, b) => a - b)
const priceReference = Array.from({ length: 21 }, (_, i) => Math.round(sortedPrices[Math.min(sortedPrices.length - 1, Math.floor((i / 20) * (sortedPrices.length - 1)))]!))

const vocabulary: Vocabulary = {
  version: '2',
  builtAt: new Date().toISOString(),
  seedSets: sets.map(s => s.id),
  lanes: lanes.map(l => l.id),
  totalBrands: allBrands.size,
  priceReference,
  terms
}

writeJson('vocabulary.json', vocabulary)
writeJson('vocab-raw.json', {
  resolvedSeeds,
  criteria: { minBrands: MIN_BRANDS, minSeedSets: MIN_SETS },
  safetyFiltered: filteredLog,
  groups: raw
})

const live = qloo.calls.filter(c => !c.cached).length
console.log(`brands: ${allBrands.size}, priced: ${brandPrices.size}, price reference: ${priceReference.join(',')}`)
console.log(`groups: ${raw.length}, vocabulary terms: ${terms.length}, filtered brands: ${filteredLog.length}`)
console.log(`qloo calls: ${qloo.calls.length} (live ${live}, cached ${qloo.calls.length - live})`)
