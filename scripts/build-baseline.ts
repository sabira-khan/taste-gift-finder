import { makeQloo, readJson, writeJson } from './lib/env'
import { resolveSeed, type SeedQuery } from '../server/lib/seeds'
import { createSafety, type Denylist } from '../server/lib/safety'
import { createVocabIndex } from '../server/lib/vocab'
import { buildProfile } from '../server/lib/profile'
import { loadLocalCatalog, styleBrandIds, type CatalogEntry, type ProductTagsFile } from '../server/lib/catalog'
import { propertyFit } from '../server/lib/matcher'
import { createInterestIndex, type InterestBaseline, type InterestTaxonomy } from '../server/lib/interests'
import type { Lane, Seed, Vocabulary } from '../shared/types'

const qloo = makeQloo()
const vocab = createVocabIndex(readJson<Vocabulary>('vocabulary.json'))
const products = loadLocalCatalog(readJson<CatalogEntry[]>('catalog.json'), readJson<ProductTagsFile>('product-tags.json'))
const ctx = {
  qloo,
  vocab,
  lanes: readJson<Lane[]>('lanes.json'),
  safety: createSafety(readJson<Denylist>('denylist.json')),
  styleBrandIds: styleBrandIds(products),
  interests: createInterestIndex(readJson<InterestTaxonomy>('interests.json')),
  interestBaseline: readJson<InterestBaseline>('interest-baseline.json')
}
const sets = readJson<{ id: string; seeds: SeedQuery[] }[]>('seed-sets.json')

const sums: Record<string, number> = Object.fromEntries(products.map(p => [p.handle, 0]))
for (const set of sets) {
  const seeds: Seed[] = []
  for (const q of set.seeds) {
    const seed = await resolveSeed(qloo, q)
    if (seed) seeds.push(seed)
  }
  const profile = await buildProfile(ctx, seeds)
  for (const p of products) sums[p.handle]! += propertyFit(profile, p, vocab)
  console.log(`${set.id}: ${profile.facets.slice(0, 5).map(f => f.label).join(', ')}`)
}

const baseline = Object.fromEntries(Object.entries(sums).map(([h, v]) => [h, Math.round((v / sets.length) * 10000) / 10000]))
writeJson('product-baseline.json', { seedSets: sets.map(s => s.id), builtAt: new Date().toISOString(), baseline })
const live = qloo.calls.filter(c => !c.cached).length
console.log(`baseline for ${products.length} products from ${sets.length} profiles, qloo calls ${qloo.calls.length} (live ${live})`)
console.log(Object.entries(baseline).sort((a, b) => b[1] - a[1]).map(([h, v]) => `${v} ${h}`).join('\n'))
