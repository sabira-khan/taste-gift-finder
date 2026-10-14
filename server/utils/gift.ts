import vocabulary from '../../data/vocabulary.json'
import denylist from '../../data/denylist.json'
import lanes from '../../data/lanes.json'
import interestTaxonomy from '../../data/interests.json'
import interestBaseline from '../../data/interest-baseline.json'
import productBaseline from '../../data/product-baseline.json'
import catalogJson from '../../data/catalog.json'
import productTags from '../../data/product-tags.json'
import { createQloo, type QlooClient } from '../lib/qloo'
import { storageCache } from '../lib/cache'
import { createVocabIndex, type VocabIndex } from '../lib/vocab'
import { createSafety, type Denylist, type Safety } from '../lib/safety'
import { createInterestIndex, type InterestBaseline, type InterestIndex, type InterestTaxonomy } from '../lib/interests'
import { applyShopify, loadLocalCatalog, styleBrandIds, type CatalogEntry, type ProductTagsFile } from '../lib/catalog'
import { fetchShopifyProducts, shopifyConfigured, type ShopifyConfig } from '../lib/shopify'
import type { ProfileContext } from '../lib/profile'
import type { Lane, Product, Vocabulary } from '../../shared/types'
import type { LlmConfig } from '../lib/llm'

interface Static {
  vocab: VocabIndex
  safety: Safety
  lanes: Lane[]
  interests: InterestIndex
  interestBaseline: InterestBaseline
  productBaseline: Record<string, number>
  localProducts: Product[]
}

let statics: Static | null = null
let shopCache: { at: number; products: Product[]; source: 'shopify' | 'local'; error?: string } | null = null
const SHOP_TTL_MS = 10 * 60 * 1000

function loadStatics(): Static {
  if (statics) return statics
  statics = {
    vocab: createVocabIndex(vocabulary as unknown as Vocabulary),
    safety: createSafety(denylist as unknown as Denylist),
    lanes: lanes as Lane[],
    interests: createInterestIndex(interestTaxonomy as unknown as InterestTaxonomy),
    interestBaseline: interestBaseline as unknown as InterestBaseline,
    productBaseline: (productBaseline as { baseline: Record<string, number> }).baseline,
    localProducts: loadLocalCatalog(catalogJson as unknown as CatalogEntry[], productTags as unknown as ProductTagsFile)
  }
  return statics
}

export function shopifyConfig(): Partial<ShopifyConfig> {
  const config = useRuntimeConfig()
  return { storeDomain: config.shopifyStoreDomain, storefrontToken: config.shopifyStorefrontToken, apiVersion: config.shopifyApiVersion }
}

export function llmConfig(): LlmConfig {
  const config = useRuntimeConfig()
  return {
    provider: (config.llmProvider || '') as LlmConfig['provider'],
    model: config.llmModel || undefined,
    keys: { anthropic: config.anthropicApiKey, openai: config.openaiApiKey, gemini: config.geminiApiKey }
  }
}

export async function catalogProducts(): Promise<{ products: Product[]; source: 'shopify' | 'local'; error?: string }> {
  const s = loadStatics()
  const shop = shopifyConfig()
  if (!shopifyConfigured(shop)) return { products: s.localProducts, source: 'local' }
  if (shopCache && Date.now() - shopCache.at < SHOP_TTL_MS) return shopCache
  try {
    const products = applyShopify(s.localProducts, await fetchShopifyProducts(shop))
    shopCache = { at: Date.now(), products, source: 'shopify' }
  } catch (err) {
    shopCache = { at: Date.now(), products: s.localProducts, source: 'local', error: (err as Error).message }
  }
  return shopCache
}

export function requestQloo(): QlooClient {
  const config = useRuntimeConfig()
  return createQloo({ apiKey: config.qlooApiKey, baseUrl: config.qlooBaseUrl, cache: storageCache(useStorage('qloo')) })
}

export async function giftContext() {
  const s = loadStatics()
  const qloo = requestQloo()
  const catalog = await catalogProducts()
  const profileCtx: ProfileContext = {
    qloo,
    lanes: s.lanes,
    safety: s.safety,
    vocab: s.vocab,
    styleBrandIds: styleBrandIds(catalog.products),
    interests: s.interests,
    interestBaseline: s.interestBaseline
  }
  return { ...s, qloo, catalog, profileCtx }
}

export type GiftContext = Awaited<ReturnType<typeof giftContext>>
