export type SeedKind = 'entity' | 'tag'

export interface Seed {
  id: string
  kind: SeedKind
  name: string
  type: string
  image?: string
  description?: string
  proxies?: { id: string; name: string; type: string }[]
  tags?: { id: string; name: string; type: string }[]
}

export type Dimension = 'aesthetic' | 'tone' | 'lifestyle' | 'interest'

export interface VocabTerm {
  key: string
  dimension: Dimension
  label: string
  aliases: string[]
  brandCount: number
  seedSetCount: number
  idf: number
}

export interface Vocabulary {
  version: string
  builtAt: string
  seedSets: string[]
  lanes: string[]
  totalBrands: number
  priceReference: number[]
  terms: VocabTerm[]
}

export interface Lane {
  id: string
  label: string
  tags: string[]
  categories: string[]
}

export interface BrandSignal {
  id: string
  name: string
  lane: string
  affinity: number
  seedScores: Record<string, number>
  terms: string[]
  priceMin?: number
  priceMax?: number
}

export interface Facet {
  key: string
  dimension: Dimension
  label: string
  weight: number
  lift: number
  seedShare: Record<string, number>
  viaBrands: string[]
}

export interface InterestEvidence {
  source: 'domain' | 'seed' | 'qloo'
  label: string
  seedId?: string
}

export interface InterestSignal {
  id: string
  label: string
  parent?: string
  weight: number
  seedShare: Record<string, number>
  evidence: InterestEvidence[]
}

export interface ProductInterest {
  id: string
  strength: number
}

export interface MatchedInterest {
  id: string
  label: string
  level: 'specific' | 'broad'
  via?: string
  weight: number
  strength: number
  evidence: InterestEvidence[]
}

export interface CrossDomainNode {
  id: string
  name: string
  type: string
  affinity: number
  seedShare: Record<string, number>
  image?: string
}

export interface PriceComfort {
  p25: number
  median: number
  p75: number
  tier: number
  samples: number
}

export interface TasteProfile {
  id: string
  seeds: Seed[]
  facets: Facet[]
  interests: InterestSignal[]
  crossDomain: CrossDomainNode[]
  laneStrength: Record<string, number>
  categoryWeights: Record<string, number>
  topBrands: { name: string; lane: string; affinity: number }[]
  styleAffinity: Record<string, number>
  priceComfort: PriceComfort | null
  brandsUsed: number
  brandsFiltered: number
  warnings: string[]
}

export interface Product {
  handle: string
  title: string
  description: string
  category: string
  price: number
  currency: string
  image: string
  imageAlt: string
  variantId?: string
  terms: string[]
  interests: ProductInterest[]
  styleRefs: StyleRef[]
  photoCredit?: PhotoCredit
}

export interface StyleRef {
  name: string
  entityId: string
}

export interface PhotoCredit {
  photographer: string
  photographerUrl: string
  sourceUrl: string
}

export interface ScoreBreakdown {
  interest: number
  property: number
  styleRef: number
  price: number
  total: number
}

export interface MatchedTerm {
  key: string
  label: string
  dimension: Dimension
  weight: number
}

export interface Pick {
  product: Product
  score: ScoreBreakdown
  contrast: number | null
  matched: MatchedTerm[]
  interests: MatchedInterest[]
  seedShare: Record<string, number>
  styleRefHits: { name: string; affinity: number }[]
  explanation: string
  explanationSource: 'llm' | 'template'
}

export type RefineAction =
  | { type: 'more_like'; handle: string }
  | { type: 'not_style'; handle: string }
  | { type: 'too_expensive'; handle?: string }

export interface RefineState {
  boosts: Record<string, number>
  suppress: Record<string, number>
  excludedHandles: string[]
  categoryPenalty: Record<string, number>
  priceCap?: number
}

export interface TraceStep {
  step: string
  reason: string
  detail?: string
  qlooCalls: number
  cacheHits: number
  ms: number
}
