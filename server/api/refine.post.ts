import { applyRefine, recommend } from '../lib/pipeline'
import { emptyRefine } from '../lib/matcher'
import type { RefineAction } from '../../shared/types'

const ACTIONS = new Set(['more_like', 'not_style', 'too_expensive'])

export default defineEventHandler(async event => {
  const body = await readBody(event)
  const action = body?.action as RefineAction | undefined
  if (!action || !ACTIONS.has(action.type)) throw createError({ statusCode: 400, statusMessage: 'unknown refine action' })
  const ctx = await pipelineContext()
  const shown = Array.isArray(body?.shown) ? body.shown.filter((s: any) => typeof s?.handle === 'string').map((s: any) => ({ handle: s.handle, price: Number(s.price) || 0 })) : []
  const refine = applyRefine(readRefine(body?.refine) ?? emptyRefine(), action, ctx.products, shown)
  const out = await recommend(ctx, { seeds: readSeeds(body?.seeds), budget: readBudget(body?.budget), refine })
  return { ...out, catalogSource: ctx.catalogSource }
})
