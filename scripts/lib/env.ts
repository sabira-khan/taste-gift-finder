import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'
import { storageCache } from '../../server/lib/cache'
import { createQloo } from '../../server/lib/qloo'

export const root = resolve(import.meta.dirname, '../..')

export function dataPath(name: string) {
  return resolve(root, 'data', name)
}

export function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(dataPath(name), 'utf8')) as T
}

export function writeJson(name: string, value: unknown) {
  writeFileSync(dataPath(name), JSON.stringify(value, null, 2) + '\n')
}

export function makeQloo() {
  const storage = createStorage({ driver: fsDriver({ base: resolve(root, '.data/qloo') }) })
  return createQloo({
    apiKey: process.env.QLOO_API_KEY,
    baseUrl: process.env.QLOO_BASE_URL,
    cache: storageCache(storage)
  })
}
