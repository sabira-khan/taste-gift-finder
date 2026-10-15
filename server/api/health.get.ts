import { resolveLlm } from '../lib/llm'
import { shopifyConfigured } from '../lib/shopify'

export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const catalog = await catalogProducts()
  const llm = resolveLlm(llmConfig())
  return {
    ok: !!config.qlooApiKey,
    qloo: { configured: !!config.qlooApiKey, baseUrl: config.qlooBaseUrl },
    catalog: { source: catalog.source, products: catalog.products.length, error: catalog.error ? 'Shopify unavailable, using the local catalog' : undefined },
    shopify: { configured: shopifyConfigured(shopifyConfig()), storePassword: config.shopifyStorePassword || undefined },
    llm: llm ? { provider: llm.provider, model: llm.model } : null,
    agent: !!llm
  }
})
