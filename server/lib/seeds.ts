import type { Seed } from '../../shared/types'
import type { QlooClient } from './qloo'

export interface SeedQuery {
  query: string
  type?: string
  kind?: 'entity' | 'tag'
  tag?: string
}

export async function resolveSeed(qloo: QlooClient, q: SeedQuery): Promise<Seed | null> {
  if (q.kind === 'tag') {
    if (q.tag) return { id: q.tag, kind: 'tag', name: q.query, type: q.tag.split(':').slice(0, 4).join(':'), tags: [{ id: q.tag, name: q.query, type: q.tag.split(':').slice(0, 4).join(':') }] }
    const tags = await qloo.searchTags(q.query, { take: 5 })
    const tag = tags[0]
    return tag ? { id: tag.id, kind: 'tag', name: tag.name, type: tag.type, tags: [{ id: tag.id, name: tag.name, type: tag.type }] } : null
  }
  const results = await qloo.search(q.query, { types: q.type, take: 5 })
  const exact = results.find(r => r.name.toLowerCase() === q.query.toLowerCase())
  const hit = exact ?? results[0]
  if (!hit) return null
  return {
    id: hit.entity_id,
    kind: 'entity',
    name: hit.name,
    type: hit.types?.[0] ?? hit.subtype ?? q.type ?? 'urn:entity',
    image: hit.properties?.image?.url,
    description: hit.properties?.short_description,
    tags: (hit.tags ?? []).slice(0, 80).map(t => ({ id: t.id, name: t.name, type: t.type }))
  }
}

const PROXY_TYPES = ['urn:entity:artist', 'urn:entity:brand', 'urn:entity:movie', 'urn:entity:tv_show', 'urn:entity:book', 'urn:entity:place']

export async function attachTagProxies(qloo: QlooClient, seeds: Seed[], perTag = 3): Promise<Seed[]> {
  return Promise.all(
    seeds.map(async seed => {
      if (seed.kind !== 'tag' || seed.proxies?.length) return seed
      for (const type of PROXY_TYPES) {
        const res = await qloo.insights({ 'filter.type': type, 'filter.tags': seed.id, take: perTag })
        const entities = res.results?.entities ?? []
        if (entities.length) return { ...seed, proxies: entities.map(e => ({ id: e.entity_id, name: e.name, type })) }
      }
      return seed
    })
  )
}

export function proxyOwners(seeds: Seed[]): Map<string, { owner: string; share: number }> {
  const map = new Map<string, { owner: string; share: number }>()
  for (const s of seeds) {
    map.set(s.id, { owner: s.id, share: 1 })
    const proxies = s.proxies ?? []
    for (const p of proxies) map.set(p.id, { owner: s.id, share: 1 / proxies.length })
  }
  return map
}

export function seedSignalParams(seeds: Seed[]) {
  const entities = [
    ...seeds.filter(s => s.kind === 'entity').map(s => s.id),
    ...seeds.flatMap(s => (s.proxies ?? []).map(p => p.id))
  ]
  const tags = seeds.filter(s => s.kind === 'tag').map(s => s.id)
  return {
    'signal.interests.entities': entities.length ? entities.join(',') : undefined,
    'signal.interests.tags': tags.length ? tags.join(',') : undefined
  }
}
