import { recommend } from '../lib/pipeline'

export default defineEventHandler(async event => {
  const body = await readBody(event)
  const ctx = await pipelineContext()
  const out = await recommend(ctx, { seeds: readSeeds(body?.seeds), budget: readBudget(body?.budget), refine: readRefine(body?.refine) })
  return { ...out, catalogSource: ctx.catalogSource }
})
