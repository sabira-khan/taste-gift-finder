import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { dataPath, makeQloo, readJson, root, writeJson } from './lib/env'
import { resolveSeed, type SeedQuery } from '../server/lib/seeds'
import { createSafety, type Denylist } from '../server/lib/safety'
import { createVocabIndex } from '../server/lib/vocab'
import { buildProfile } from '../server/lib/profile'
import { createInterestIndex, PARENT_ONLY_CAP, type InterestBaseline, type InterestTaxonomy } from '../server/lib/interests'
import { loadLocalCatalog, styleBrandIds, type CatalogEntry, type ProductTagsFile } from '../server/lib/catalog'
import { INTEREST_FLOOR, jaccard, matchProducts, RELEVANCE_MIN, WEIGHTS } from '../server/lib/matcher'
import { templateExplanation } from '../server/lib/explain'
import type { Lane, Seed, Vocabulary } from '../shared/types'

interface Persona {
  id: string
  label: string
  seeds: SeedQuery[]
}

const qloo = makeQloo()
const vocab = createVocabIndex(readJson<Vocabulary>('vocabulary.json'))
const safety = createSafety(readJson<Denylist>('denylist.json'))
const lanes = readJson<Lane[]>('lanes.json')
const products = loadLocalCatalog(readJson<CatalogEntry[]>('catalog.json'), readJson<ProductTagsFile>('product-tags.json'))
const personaFile = process.argv.includes('--personas') ? process.argv[process.argv.indexOf('--personas') + 1]! : 'personas.json'
const outName = personaFile.replace(/\.json$/, '').replace('personas', 'eval-results')
const personas = readJson<Persona[]>(personaFile)
const interestIndex = createInterestIndex(readJson<InterestTaxonomy>('interests.json'))
const ctx = {
  qloo,
  lanes,
  safety,
  vocab,
  styleBrandIds: styleBrandIds(products),
  interests: interestIndex,
  interestBaseline: readJson<InterestBaseline>('interest-baseline.json')
}
const baseline = readJson<{ baseline: Record<string, number> }>('product-baseline.json').baseline
const beforePath = process.argv.includes('--before') ? resolve(root, process.argv[process.argv.indexOf('--before') + 1]!) : null
const before = beforePath && existsSync(beforePath) ? JSON.parse(readFileSync(beforePath, 'utf8')) as { results: { id: string; picks: { title: string }[] }[] } : null

const pairwise = <T>(xs: T[], f: (a: T, b: T) => number) => {
  const vals: number[] = []
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) vals.push(f(xs[i]!, xs[j]!))
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
}
const r2 = (x: number) => Math.round(x * 100) / 100

const results = []
for (const persona of personas) {
  const callsBefore = qloo.calls.length
  const seeds: Seed[] = []
  for (const q of persona.seeds) {
    const seed = await resolveSeed(qloo, q)
    if (seed) seeds.push(seed)
    else console.warn(`unresolved seed ${q.query}`)
  }
  const profile = await buildProfile(ctx, seeds)
  const match = matchProducts(profile, products, vocab, { take: 5, alternates: 0, baseline, interestIndex })
  const { picks } = match
  const intraListDiversity = pairwise(picks, (a, b) => 1 - jaccard(a.product.interests.map(i => i.id), b.product.interests.map(i => i.id)))
  const coveredSeeds = seeds.filter(s => picks.some(p => (p.seedShare[s.id] ?? 0) >= 0.15)).length
  const calls = qloo.calls.slice(callsBefore)
  const sanity = picks.map(p => ({ title: p.product.title, interests: p.interests.map(i => i.label), pass: p.interests.length > 0 && p.score.interest > 0, specific: p.interests.some(i => i.level === 'specific') }))
  results.push({
    id: persona.id,
    label: persona.label,
    seeds: seeds.map(s => ({ name: s.name, type: s.type, kind: s.kind })),
    interests: profile.interests.slice(0, 8).map(i => ({ label: i.label, weight: i.weight, evidence: i.evidence.map(e => e.label) })),
    topFacets: profile.facets.slice(0, 8).map(f => f.label),
    priceComfort: profile.priceComfort,
    warnings: profile.warnings,
    strongMatches: match.strongMatches,
    picks: picks.map(p => ({
      handle: p.product.handle,
      title: p.product.title,
      category: p.product.category,
      price: p.product.price,
      score: p.score,
      contrast: p.contrast,
      interests: p.interests.map(i => ({ label: i.level === 'broad' ? `${i.label} (broad)` : i.label, level: i.level, weight: i.weight, strength: i.strength })),
      matched: p.matched.map(m => m.label),
      seedShare: Object.fromEntries(seeds.map(s => [s.name, p.seedShare[s.id] ?? 0])),
      styleRefHits: p.styleRefHits,
      explanation: templateExplanation(p, seeds)
    })),
    sanity,
    metrics: {
      shown: picks.length,
      fails: sanity.filter(s => !s.pass).length,
      broadOnly: sanity.filter(s => s.pass && !s.specific).length,
      categoryDiversity: r2(new Set(picks.map(p => p.product.category)).size / Math.max(1, picks.length)),
      intraListDiversity: r2(intraListDiversity),
      seedCoverage: r2(coveredSeeds / Math.max(1, seeds.length)),
      meanInterest: r2(picks.reduce((a, p) => a + p.score.interest, 0) / Math.max(1, picks.length)),
      meanScore: r2(picks.reduce((a, p) => a + p.score.total, 0) / Math.max(1, picks.length))
    },
    qloo: { calls: calls.length, cached: calls.filter(c => c.cached).length }
  })
}

const summary = {
  personas: results.length,
  weights: WEIGHTS,
  interestFloor: INTEREST_FLOOR,
  relevanceMin: RELEVANCE_MIN,
  totalFails: results.reduce((a, r) => a + r.metrics.fails, 0),
  totalBroadOnly: results.reduce((a, r) => a + r.metrics.broadOnly, 0),
  meanInterestMatch: r2(results.reduce((a, r) => a + r.metrics.meanInterest, 0) / results.length),
  meanSeedCoverage: r2(results.reduce((a, r) => a + r.metrics.seedCoverage, 0) / results.length),
  meanCategoryDiversity: r2(results.reduce((a, r) => a + r.metrics.categoryDiversity, 0) / results.length),
  crossPersonaOverlap: r2(pairwise(results, (a, b) => jaccard(a.picks.map(p => p.handle), b.picks.map(p => p.handle)))),
  distinctProductsAcrossPersonas: new Set(results.flatMap(r => r.picks.map(p => p.handle))).size,
  catalogSize: products.length
}

writeJson(`${outName}.json`, { generatedAt: new Date().toISOString(), summary, results })

const lines: string[] = []
lines.push('### Sanity check: every pick must match a concrete interest')
lines.push('')
lines.push('| Persona | Seeds | Top interests (Qloo) | Picks (score) and matched interests | Check |')
lines.push('|---|---|---|---|---|')
for (const r of results) {
  const gifts = r.picks.map((p, i) => `${p.title} (${p.score.total.toFixed(2)}): ${p.interests.map(x => x.label).join(', ') || 'none'} ${!r.sanity[i]!.pass ? '**FAIL**' : r.sanity[i]!.specific ? 'PASS' : 'PASS (broad only)'}`).join('<br>')
  const note = r.picks.length < 5 ? `<br>_We found ${r.picks.length} strong matches_` : ''
  lines.push(`| ${r.label} | ${r.seeds.map(s => s.name).join(', ')} | ${r.interests.slice(0, 4).map(i => `${i.label} ${i.weight.toFixed(2)}`).join('<br>')} | ${gifts}${note} | ${r.metrics.fails ? `${r.metrics.fails} FAIL` : 'all pass'} |`)
}
lines.push('')
lines.push(`FAILs: ${summary.totalFails}. Broad-only picks (parent match, capped at ${PARENT_ONLY_CAP}): ${summary.totalBroadOnly}. Mean interest match ${summary.meanInterestMatch}, seed coverage ${summary.meanSeedCoverage}, category diversity ${summary.meanCategoryDiversity} (not forced), cross-persona overlap ${summary.crossPersonaOverlap}, ${summary.distinctProductsAcrossPersonas} distinct products of ${summary.catalogSize}.`)
if (before) {
  lines.push('')
  lines.push('### Before and after the interest layer')
  lines.push('')
  lines.push('| Persona | Before (forced category diversity) | After (interest-first) |')
  lines.push('|---|---|---|')
  for (const r of results) {
    const old = before.results.find(b => b.id === r.id)
    lines.push(`| ${r.label} | ${(old?.picks ?? []).map(p => p.title).join('<br>')} | ${r.picks.map(p => p.title).join('<br>')} |`)
  }
}
writeFileSync(dataPath(`${outName}.md`), lines.join('\n') + '\n')

for (const r of results) {
  console.log(`\n== ${r.label}  [${r.seeds.map(s => s.name).join(' | ')}]  strong matches ${r.strongMatches}`)
  console.log(`   interests: ${r.interests.map(i => `${i.label} ${i.weight.toFixed(2)}`).join(', ')}`)
  if (r.warnings.length) console.log(`   warnings: ${r.warnings.join('; ')}`)
  for (const [i, p] of r.picks.entries()) {
    console.log(`   ${p.score.total.toFixed(3)}  ${p.title} $${p.price}  i=${p.score.interest} p=${p.score.property} s=${p.score.styleRef} $=${p.score.price}  ${!r.sanity[i]!.pass ? 'FAIL' : r.sanity[i]!.specific ? 'PASS' : 'PASS broad'}`)
    console.log(`          interests: ${p.interests.map(x => `${x.label} [${x.level}] (${x.weight}×${x.strength})`).join(', ')} | vibe: ${p.matched.slice(0, 3).join(', ')}`)
  }
}
console.log('\nsummary', summary)
