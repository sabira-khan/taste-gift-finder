const isNetlify = !!process.env.NETLIFY

const serverConfig: any = {
  storage: {
    qloo: isNetlify ? { driver: 'netlify-blobs', name: 'qloo-cache' } : { driver: 'fs', base: './.data/qloo' },
    app: isNetlify ? { driver: 'netlify-blobs', name: 'app-cache' } : { driver: 'fs', base: './.data/app' }
  }
}

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  modules: ['@nuxtjs/tailwindcss'],
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Taste-matched gift finder',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Tell us 3 to 5 things they love. Qloo maps their taste across culture to gifts they will actually want.' },
        { name: 'theme-color', content: '#fafaf7' }
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap' }
      ]
    }
  },
  runtimeConfig: {
    qlooApiKey: process.env.QLOO_API_KEY ?? '',
    qlooBaseUrl: process.env.QLOO_BASE_URL ?? 'https://hackathon.api.qloo.com',
    shopifyStoreDomain: process.env.SHOPIFY_STORE_DOMAIN ?? '',
    shopifyStorefrontToken: process.env.SHOPIFY_STOREFRONT_TOKEN ?? '',
    shopifyStorePassword: process.env.SHOPIFY_STORE_PASSWORD ?? '',
    shopifyApiVersion: process.env.SHOPIFY_API_VERSION ?? '2025-07',
    llmProvider: process.env.LLM_PROVIDER ?? '',
    llmModel: process.env.LLM_MODEL ?? '',
    llmSpendCapUsd: process.env.LLM_SPEND_CAP_USD || (isNetlify ? '4' : '1'),
    llmDailyCapUsd: process.env.LLM_DAILY_CAP_USD || '1',
    llmPriceInput: process.env.LLM_PRICE_INPUT_PER_M || '',
    llmPriceOutput: process.env.LLM_PRICE_OUTPUT_PER_M || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    geminiApiKey: process.env.GEMINI_API_KEY ?? ''
  },
  nitro: serverConfig,
  typescript: { strict: true }
})
