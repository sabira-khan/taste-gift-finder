import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { readJson, root, writeJson } from './lib/env'

interface CatalogItem {
  handle: string
  photoQuery: string
  photo?: { id: string }
  [key: string]: unknown
}

interface Candidate {
  id: string
  description: string
  thumb: string
  regular: string
  raw: string
  photographer: string
  username: string
  page: string
}

const mode = process.argv[2] ?? 'search'
const candidatesPath = resolve(root, '.data/photo-candidates.json')
const accessKey = process.env.UNSPLASH_ACCESS_KEY

async function unsplash(path: string) {
  const base = accessKey ? 'https://api.unsplash.com' : 'https://unsplash.com/napi'
  const res = await fetch(`${base}${path}`, { headers: accessKey ? { Authorization: `Client-ID ${accessKey}` } : {} })
  if (!res.ok) throw new Error(`Unsplash ${res.status} on ${path}`)
  return res.json() as Promise<any>
}

function toCandidate(p: any): Candidate {
  return {
    id: p.id,
    description: p.alt_description ?? p.description ?? '',
    thumb: p.urls.small,
    regular: p.urls.regular,
    raw: p.urls.raw,
    photographer: p.user.name,
    username: p.user.username,
    page: p.links.html
  }
}

const catalog = readJson<CatalogItem[]>('catalog.json')

if (mode === 'search') {
  const all = process.argv.includes('--all')
  const out: Record<string, Candidate[]> = existsSync(candidatesPath) ? JSON.parse(readFileSync(candidatesPath, 'utf8')) : {}
  for (const item of catalog) {
    if (item.photo && !all) continue
    const data = await unsplash(`/search/photos?query=${encodeURIComponent(item.photoQuery)}&per_page=24`)
    out[item.handle] = (data.results ?? [])
      .filter((p: any) => !p.premium && !p.plus && !p.sponsorship)
      .slice(0, 6)
      .map(toCandidate)
    console.log(`${item.handle}: ${out[item.handle]!.length} candidates`)
  }
  mkdirSync(resolve(root, '.data'), { recursive: true })
  writeFileSync(candidatesPath, JSON.stringify(out, null, 2))
}

if (mode === 'apply') {
  const picks = JSON.parse(readFileSync(resolve(root, process.argv[3] ?? '.data/photo-picks.json'), 'utf8')) as Record<string, string>
  const candidates = existsSync(candidatesPath) ? (JSON.parse(readFileSync(candidatesPath, 'utf8')) as Record<string, Candidate[]>) : {}
  for (const item of catalog) {
    const id = picks[item.handle] ?? item.photo?.id
    if (!id) throw new Error(`no photo picked for ${item.handle}`)
    const c = candidates[item.handle]?.find(x => x.id === id) ?? toCandidate(await unsplash(`/photos/${id}`))
    item.photo = {
      id: c.id,
      url: `${c.raw}&w=1200&h=1200&fit=crop&crop=entropy&fm=jpg&q=80`,
      alt: c.description,
      photographer: c.photographer,
      photographerUrl: `https://unsplash.com/@${c.username}`,
      sourceUrl: c.page,
      license: 'Unsplash License'
    } as CatalogItem['photo']
  }
  writeJson('catalog.json', catalog)
  console.log(`applied ${catalog.length} photos`)
}
