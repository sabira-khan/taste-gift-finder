import { createHash } from 'node:crypto'

export type Params = Record<string, string | number | boolean | undefined | null>

export interface CacheStore {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
}

interface KeyValueStorage {
  getItem(key: string): Promise<unknown>
  setItem(key: string, value: any): Promise<void>
}

export function cleanParams(params: Params): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of Object.keys(params).sort()) {
    const value = params[key]
    if (value === undefined || value === null || value === '') continue
    out[key] = String(value)
  }
  return out
}

export function hashRequest(path: string, params: Params): string {
  return createHash('sha256').update(path + '?' + JSON.stringify(cleanParams(params))).digest('hex')
}

export function storageCache(storage: KeyValueStorage): CacheStore {
  return {
    async get<T>(key: string) {
      const value = await storage.getItem(key)
      if (value === null || value === undefined) return null
      return (typeof value === 'string' ? JSON.parse(value) : value) as T
    },
    async set<T>(key: string, value: T) {
      await storage.setItem(key, JSON.stringify(value))
    }
  }
}

export function memoryCache(): CacheStore {
  const map = new Map<string, unknown>()
  return {
    async get<T>(key: string) {
      return (map.get(key) as T) ?? null
    },
    async set<T>(key: string, value: T) {
      map.set(key, value)
    }
  }
}
