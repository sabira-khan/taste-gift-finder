import { makeQloo, readJson, writeJson } from './lib/env'
import { resolveSeed, seedSignalParams, attachTagProxies, type SeedQuery } from '../server/lib/seeds'
import { createInterestIndex, fetchTagInsights, qlooOnly, qlooTagItems, TAG_SOURCES, type InterestTaxonomy } from '../server/lib/interests'
import type { Seed } from '../shared/types'

const qloo = makeQloo()
const index = createInterestIndex(readJson<InterestTaxonomy>('interests.json'))
const sets = readJson<{ id: string; seeds: SeedQuery[] }[]>('seed-sets.json')

const counts: Record<string, number> = {}
const names: Record<string, string> = {}
const perSet: Awaited<ReturnType<typeof fetchTagInsights>>[] = []
for (const set of sets) {
  const seeds: Seed[] = []
  for (const q of set.seeds) {
    const seed = await resolveSeed(qloo, q)
    if (seed) seeds.push(seed)
  }
  const lists = await fetchTagInsights(qloo, seedSignalParams(await attachTagProxies(qloo, seeds)))
  perSet.push(lists)
  const seen = new Set<string>()
  for (const { tags } of lists) for (const t of tags) {
    seen.add(t.tag_id)
    names[t.tag_id] = t.name.trim()
  }
  for (const id of seen) counts[id] = (counts[id] ?? 0) + 1
}

const df = Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id, c]) => [id, Math.round((c / sets.length) * 1000) / 1000]))
const sums: Record<string, number> = {}
for (const lists of perSet) {
  for (const [id, v] of Object.entries(qlooOnly(qlooTagItems(index, lists, { sets: sets.length, df, qlooMean: {} })))) sums[id] = (sums[id] ?? 0) + v
}
const qlooMean = Object.fromEntries(index.taxonomy.interests.map(i => [i.id, Math.round(((sums[i.id] ?? 0) / sets.length) * 1000) / 1000]))
writeJson('interest-baseline.json', { sets: sets.length, sources: TAG_SOURCES.map(s => s.id), builtAt: new Date().toISOString(), qlooMean, df })
console.log('typical Qloo interest weight across seed sets:')
for (const [id, v] of Object.entries(qlooMean).sort((a, b) => b[1] - a[1])) console.log(`  ${v.toFixed(2)} ${id}`)
