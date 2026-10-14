import type { Seed } from '../../shared/types'
import type { PipelineContext } from '../lib/pipeline'

export async function pipelineContext(): Promise<PipelineContext & { safety: GiftContext['safety']; catalogSource: string }> {
  const g = await giftContext()
  return {
    qloo: g.qloo,
    vocab: g.vocab,
    interests: g.interests,
    profileCtx: g.profileCtx,
    productBaseline: g.productBaseline,
    products: g.catalog.products,
    llm: llmConfig(),
    safety: g.safety,
    catalogSource: g.catalog.source
  }
}

export function readSeeds(raw: unknown): Seed[] {
  if (!Array.isArray(raw)) throw createError({ statusCode: 400, statusMessage: 'seeds must be an array' })
  const seeds = raw
    .filter((s: any) => s && typeof s.id === 'string' && typeof s.name === 'string' && (s.kind === 'entity' || s.kind === 'tag'))
    .slice(0, 5)
    .map((s: any): Seed => ({
      id: s.id.slice(0, 200),
      kind: s.kind,
      name: String(s.name).slice(0, 200),
      type: String(s.type ?? '').slice(0, 100),
      image: typeof s.image === 'string' ? s.image : undefined,
      description: typeof s.description === 'string' ? s.description.slice(0, 300) : undefined,
      tags: Array.isArray(s.tags) ? s.tags.slice(0, 80).filter((t: any) => t && typeof t.id === 'string').map((t: any) => ({ id: String(t.id), name: String(t.name ?? ''), type: String(t.type ?? '') })) : []
    }))
  if (!seeds.length) throw createError({ statusCode: 400, statusMessage: 'add at least one thing they love' })
  return seeds
}

export function readBudget(raw: unknown): number | undefined {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function readRefine(raw: any) {
  if (!raw || typeof raw !== 'object') return undefined
  const nums = (o: any) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => typeof v === 'number').slice(0, 300)) as Record<string, number>
  return {
    boosts: nums(raw.boosts),
    suppress: nums(raw.suppress),
    excludedHandles: Array.isArray(raw.excludedHandles) ? raw.excludedHandles.map(String).slice(0, 100) : [],
    categoryPenalty: nums(raw.categoryPenalty),
    priceCap: typeof raw.priceCap === 'number' ? raw.priceCap : undefined
  }
}
