import { makeQloo, readJson, writeJson } from './lib/env'
import { resolveSeed, seedSignalParams, type SeedQuery } from '../server/lib/seeds'
import type { Seed } from '../shared/types'

const qloo = makeQloo()
const sets = readJson<{ id: string; seeds: SeedQuery[] }[]>('seed-sets.json')
const counts: Record<string, { name: string; type: string; count: number; sets: Set<string> }> = {}
const resolved: Record<string, Seed[]> = {}

for (const set of sets) {
  const seeds: Seed[] = []
  for (const q of set.seeds) {
    const seed = await resolveSeed(qloo, q)
    if (seed) seeds.push(seed)
    else console.warn(`unresolved ${set.id}: ${q.query}`)
  }
  resolved[set.id] = seeds
  const res = await qloo.insights({ 'filter.type': 'urn:entity:brand', ...seedSignalParams(seeds), take: 50 })
  for (const entity of res.results?.entities ?? []) {
    for (const tag of entity.tags ?? []) {
      if (!/genre:brand|industry:qloo|product_category:qloo/.test(tag.type)) continue
      const c = (counts[tag.id] ??= { name: tag.name, type: tag.type, count: 0, sets: new Set() })
      c.count++
      c.sets.add(set.id)
    }
  }
  console.log(set.id, seeds.map(s => `${s.name} [${s.type}]`).join(' | '))
}

const rows = Object.entries(counts)
  .map(([id, c]) => ({ id, name: c.name, type: c.type, count: c.count, sets: c.sets.size }))
  .sort((a, b) => b.count - a.count)
writeJson('discovered-tags.json', { resolvedSeeds: resolved, tags: rows })
console.log(`tags: ${rows.length}, calls: ${qloo.calls.length}, cached: ${qloo.calls.filter(c => c.cached).length}`)
