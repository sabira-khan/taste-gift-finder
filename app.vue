<script setup lang="ts">
const gf = useGiftFinder()
onMounted(() => gf.loadHealth())
const showResults = computed(() => !!gf.result.value)
const stages = computed(() => {
  const label = gf.loading.value ?? ''
  if (label.startsWith('The agent'))
    return [
      { text: 'Reading your description', at: 0 },
      { text: 'Finding each favourite in Qloo', at: 3 },
      { text: 'Building a cross-domain taste profile', at: 7 },
      { text: 'Matching the profile against the store', at: 12 },
      { text: 'Checking quality and writing a reason for each pick', at: 16 }
    ]
  if (label.startsWith('Reading their taste'))
    return [
      { text: 'Asking Qloo what their favourites have in common', at: 0 },
      { text: 'Building a cross-domain taste profile', at: 3 },
      { text: 'Matching the profile against the store', at: 6 },
      { text: 'Writing a reason for each pick', at: 8 }
    ]
  return undefined
})
</script>

<template>
  <div class="min-h-screen">
    <AppHeader />
    <main class="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <section class="pt-6 sm:pt-12" :class="showResults ? 'pb-4' : 'pb-10'">
        <p class="eyebrow">Cold-start gifting · Powered by Qloo</p>
        <h1 class="mt-2 max-w-3xl font-display text-[2rem] leading-[1.08] tracking-tight sm:text-5xl">
          Name a few things they love.{{ ' ' }}<br class="hidden sm:block" />
          <span class="text-clay">We'll map their taste to gifts.</span>
        </h1>
        <p class="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
          No purchase history needed. Qloo connects their films, music, books and brands to the interests and style behind them, and every pick shows exactly why it fits.
        </p>
      </section>

      <InputPanel />

      <div v-if="gf.error.value" class="mt-4 rounded-xl bg-clay-light px-4 py-3 text-sm text-clay-dark" role="alert">{{ gf.error.value }}</div>

      <LoadingState v-if="gf.loading.value" :key="gf.loading.value" :label="gf.loading.value" :stages="stages" class="mt-6" />

      <TraceStrip v-if="gf.trace.value.length" :steps="gf.trace.value" class="mt-6" />

      <template v-if="gf.result.value">
        <p v-if="gf.agentMessage.value" class="mt-6 max-w-3xl font-display text-xl leading-snug">{{ gf.agentMessage.value }}</p>
        <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <ResultsList :result="gf.result.value" />
          <TasteMap :profile="gf.result.value.profile" :influence="gf.result.value.quality.seedInfluence" />
        </div>
      </template>
    </main>
    <AppFooter />
    <WhyPanel />
    <CartDrawer />
  </div>
</template>
