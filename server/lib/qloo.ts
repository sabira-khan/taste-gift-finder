import { cleanParams, hashRequest, type CacheStore, type Params } from './cache'

export interface QlooTag {
  id: string
  name: string
  type: string
}

export interface QlooExplain {
  entity_id?: string
  tag_id?: string
  id?: string
  score: number
}

export interface QlooEntity {
  entity_id: string
  name: string
  type?: string
  subtype?: string
  types?: string[]
  popularity?: number
  disambiguation?: string
  properties?: Record<string, any>
  tags?: QlooTag[]
  query?: {
    affinity?: number
    explainability?: Record<string, QlooExplain[]>
  }
}

export interface QlooTagInsight {
  tag_id: string
  name: string
  subtype?: string
  query?: { affinity?: number }
}

export interface InsightsResponse {
  success?: boolean
  results?: { entities?: QlooEntity[]; tags?: QlooTagInsight[] }
  query?: Record<string, any>
}

export interface QlooCallLog {
  path: string
  params: Record<string, string>
  cached: boolean
  ms: number
  status: number
}

export interface QlooClient {
  search(query: string, opts?: { types?: string; take?: number }): Promise<QlooEntity[]>
  searchTags(query: string, opts?: { types?: string; take?: number }): Promise<QlooTag[]>
  insights(params: Params): Promise<InsightsResponse>
  calls: QlooCallLog[]
}

export class QlooError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function normalizeTags(entities: QlooEntity[] | undefined): QlooEntity[] {
  return (entities ?? []).map(e => ({
    ...e,
    tags: e.tags?.map(t => ({ id: (t as any).id ?? (t as any).tag_id, name: t.name, type: t.type })).filter(t => t.id)
  }))
}

export function createQloo(config: { apiKey?: string; baseUrl?: string; cache: CacheStore; offline?: boolean }): QlooClient {
  const baseUrl = (config.baseUrl || 'https://hackathon.api.qloo.com').replace(/\/$/, '')
  const calls: QlooCallLog[] = []

  async function get<T>(path: string, params: Params): Promise<T> {
    const clean = cleanParams(params)
    const key = hashRequest(path, clean)
    const started = Date.now()
    const hit = await config.cache.get<T>(key)
    if (hit) {
      calls.push({ path, params: clean, cached: true, ms: Date.now() - started, status: 200 })
      return hit
    }
    if (config.offline || !config.apiKey) throw new QlooError(503, `Qloo response not cached and no live key: ${path}`)
    const url = `${baseUrl}${path}?${new URLSearchParams(clean).toString()}`
    let attempt = 0
    while (true) {
      const res = await fetch(url, { headers: { 'X-Api-Key': config.apiKey, accept: 'application/json' } })
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        attempt++
        await sleep(500 * 2 ** attempt)
        continue
      }
      const body = await res.text()
      calls.push({ path, params: clean, cached: false, ms: Date.now() - started, status: res.status })
      if (!res.ok) throw new QlooError(res.status, `Qloo ${res.status} on ${path} ${JSON.stringify(clean)}: ${body.replace(/\s+/g, ' ').slice(0, 160)}`)
      const data = JSON.parse(body) as T
      await config.cache.set(key, data)
      return data
    }
  }

  return {
    calls,
    async search(query, opts = {}) {
      const data = await get<{ results?: QlooEntity[] }>('/search', { query, types: opts.types, take: opts.take ?? 8 })
      return normalizeTags(data.results)
    },
    async searchTags(query, opts = {}) {
      const data = await get<{ results?: { tags?: QlooTag[] } }>('/v2/tags', {
        'filter.query': query,
        'filter.tag.types': opts.types,
        take: opts.take ?? 10
      })
      return data.results?.tags ?? []
    },
    async insights(params) {
      const data = await get<InsightsResponse>('/v2/insights', params)
      return { ...data, results: { ...data.results, entities: normalizeTags(data.results?.entities) } }
    }
  }
}
