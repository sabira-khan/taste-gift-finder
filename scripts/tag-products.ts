import { makeQloo, readJson, writeJson } from './lib/env'
import { createVocabIndex } from '../server/lib/vocab'
import { createSafety, type Denylist } from '../server/lib/safety'
import { createInterestIndex, type InterestTaxonomy } from '../server/lib/interests'
import type { Dimension, Vocabulary } from '../shared/types'

interface CatalogItem {
  handle: string
  title: string
  category: string
  price: number
  descriptors: string[]
  similarStyle: string[]
  interests: Record<string, number>
}

const vocab = createVocabIndex(readJson<Vocabulary>('vocabulary.json'))
const catalog = readJson<CatalogItem[]>('catalog.json')
const interestIndex = createInterestIndex(readJson<InterestTaxonomy>('interests.json'))

const qloo = makeQloo()
const safety = createSafety(readJson<Denylist>('denylist.json'))
const brandCache = new Map<string, { entityId: string; qlooName: string } | null>()

async function resolveBrand(name: string) {
  if (brandCache.has(name)) return brandCache.get(name)!
  const results = await qloo.search(name, { types: 'urn:entity:brand', take: 5 })
  const lower = name.toLowerCase()
  const hit = results.find(r => r.name.toLowerCase() === lower) ?? null
  if (hit && safety.check(hit).blocked) throw new Error(`style ref ${name} blocked by safety: ${JSON.stringify(safety.check(hit))}`)
  const value = hit ? { entityId: hit.entity_id, qlooName: hit.name } : null
  brandCache.set(name, value)
  return value
}

const problems: string[] = []
const products: { handle: string; title: string; category: string; price: number; terms: { key: string; dimension: Dimension; label: string; idf: number; brandCount: number }[]; similarStyle: { name: string; entityId: string; qlooName: string }[]; interests: { id: string; label: string; strength: number }[] }[] = []
for (const item of catalog) {
  const terms = item.descriptors.flatMap(d => {
    const [dim, label] = d.split(':') as [Dimension, string]
    const exact = vocab.vocab.terms.find(t => t.dimension === dim && t.label.toLowerCase() === label.toLowerCase())
    const term = exact ?? vocab.resolveLabel(label, dim)
    if (!term) {
      problems.push(`${item.handle}: "${d}" not in vocabulary`)
      return []
    }
    return [{ key: term.key, dimension: term.dimension, label: term.label, idf: term.idf, brandCount: term.brandCount }]
  })
  const unique = [...new Map(terms.map(t => [t.key, t])).values()]
  const similarStyle = []
  for (const name of item.similarStyle) {
    const brand = await resolveBrand(name)
    if (brand) similarStyle.push({ name, ...brand })
    else problems.push(`${item.handle}: style ref "${name}" not found as a Qloo brand`)
  }
  const interests = Object.entries(item.interests ?? {}).flatMap(([id, strength]) => {
    const def = interestIndex.defs.get(id)
    if (!def) {
      problems.push(`${item.handle}: interest "${id}" not in taxonomy`)
      return []
    }
    return [{ id, label: def.label, strength }]
  })
  if (!interests.length) problems.push(`${item.handle}: no interests`)
  products.push({ handle: item.handle, title: item.title, category: item.category, price: item.price, terms: unique, similarStyle, interests })
}

writeJson('product-tags.json', { vocabularyVersion: vocab.vocab.version, builtAt: new Date().toISOString(), products })

const dims = (p: { terms: { dimension: string }[] }) => new Set(p.terms.map(t => t.dimension)).size
console.log(`products: ${products.length}, avg terms: ${(products.reduce((a, p) => a + p.terms.length, 0) / products.length).toFixed(1)}`)
console.log(`products covering all 4 dimensions: ${products.filter(p => dims(p) === 4).length}`)
const coverage = new Map<string, string[]>()
for (const p of products) for (const i of p.interests) if (i.strength >= 0.5) coverage.set(i.id, [...(coverage.get(i.id) ?? []), p.handle])
console.log('products per interest (strength >= 0.5):')
for (const def of interestIndex.taxonomy.interests) console.log(`  ${String(coverage.get(def.id)?.length ?? 0).padStart(2)} ${def.label}`)
const brands = new Set(products.flatMap(p => p.similarStyle.map(s => s.entityId)))
console.log(`distinct style-reference brands resolved in Qloo: ${brands.size}`)
for (const p of products) for (const s of p.similarStyle) if (s.qlooName.toLowerCase() !== s.name.toLowerCase()) console.log(`  ${s.name} -> ${s.qlooName}`)
if (problems.length) {
  console.log(`unresolved descriptors (${problems.length}):\n  ${problems.join('\n  ')}`)
  process.exitCode = 1
}
