import type { QlooEntity } from './qloo'

export interface Denylist {
  excludeTagIds: string[]
  categories: Record<string, string[]>
}

export interface SafetyVerdict {
  blocked: boolean
  category?: string
  matched?: string
}

export interface Safety {
  excludeParam: string
  check(entity: QlooEntity): SafetyVerdict
  checkText(text: string): SafetyVerdict
}

const SCREEN_TAG_TYPES = /genre:brand|industry:qloo|product_category:qloo|keyword:qloo/

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string')
  if (typeof value === 'string') return [value]
  return []
}

export function screenText(entity: QlooEntity): string[] {
  const p = entity.properties ?? {}
  const tags = (entity.tags ?? [])
    .filter(t => SCREEN_TAG_TYPES.test(t.type))
    .flatMap(t => [t.name, t.id.split(':').pop()!.replace(/_/g, ' ')])
  return [entity.name, ...asList(p.industry), ...asList(p.industries), ...asList(p.keywords), ...tags]
}

export function createSafety(denylist: Denylist): Safety {
  const excluded = new Set(denylist.excludeTagIds)
  const rules = Object.entries(denylist.categories).map(([category, patterns]) => ({
    category,
    re: new RegExp(patterns.join('|'), 'i')
  }))

  function checkText(text: string): SafetyVerdict {
    for (const rule of rules) {
      const m = text.match(rule.re)
      if (m) return { blocked: true, category: rule.category, matched: m[0] }
    }
    return { blocked: false }
  }

  return {
    excludeParam: denylist.excludeTagIds.join(','),
    checkText,
    check(entity) {
      const hitTag = entity.tags?.find(t => excluded.has(t.id))
      if (hitTag) return { blocked: true, category: 'excluded-tag', matched: hitTag.id }
      for (const text of screenText(entity)) {
        const verdict = checkText(text)
        if (verdict.blocked) return verdict
      }
      return { blocked: false }
    }
  }
}
