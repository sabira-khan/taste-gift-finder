import { searchEntities, searchTags, SEARCH_TYPES } from '../../lib/agent'

export default defineEventHandler(async event => {
  const query = getQuery(event)
  const q = String(query.q ?? '').trim().slice(0, 80)
  const type = String(query.type ?? '')
  if (q.length < 2) return { entities: [], tags: [] }
  const ctx = await pipelineContext()
  const [entities, tags] = await Promise.all([
    type === 'tag' ? Promise.resolve([]) : searchEntities(ctx, ctx.safety, q, SEARCH_TYPES[type] ? type : undefined, 8),
    type && type !== 'tag' ? Promise.resolve([]) : searchTags(ctx, q, 4)
  ])
  return {
    entities: entities.map(e => ({ ...e, tags: e.tags })),
    tags
  }
})
