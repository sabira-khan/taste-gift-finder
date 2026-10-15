<script setup lang="ts">
const gf = useGiftFinder()
onMounted(() => gf.loadHealth())
const showResults = computed(() => !!gf.result.value)
const HOW = [
  { title: 'Name 3 to 5 favourites', text: 'A film, an artist, a book, a brand, or a taste like matcha. No account or purchase history.', bg: 'bg-pop-light' },
  { title: 'Qloo maps their taste', text: 'Qloo’s cultural graph links those favourites to interests and a style across domains.', bg: 'bg-cobalt-light' },
  { title: 'Picks with a reason', text: 'Every gift shows the interest it matches, the evidence and a transparent fit score.', bg: 'bg-mint-light' }
]
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
        <h1 class="mt-3 max-w-4xl font-display text-[2.4rem] font-extrabold leading-[1.02] tracking-[-0.03em] sm:text-[4.2rem]">
          Name a few things they love.{{ ' ' }}<br class="hidden sm:block" />
          We'll find the <span class="marker">gift</span> that fits.
        </h1>
        <p class="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft sm:text-lg">
          No purchase history needed. Qloo connects their films, music, books and brands to the interests and style behind them, and every pick shows exactly why it fits.
        </p>
      </section>

      <InputPanel />

      <ol v-if="!gf.result.value && !gf.loading.value" class="mt-8 grid gap-3 sm:grid-cols-3">
        <li v-for="(s, i) in HOW" :key="s.title" class="rounded-xl border border-ink p-4" :class="s.bg">
          <span class="font-mono text-xs font-semibold">0{{ i + 1 }}</span>
          <p class="mt-2 font-display text-lg font-bold leading-tight">{{ s.title }}</p>
          <p class="mt-1 text-sm leading-snug text-ink-soft">{{ s.text }}</p>
        </li>
      </ol>

      <div v-if="gf.error.value" class="mt-4 rounded-xl bg-coral-light px-4 py-3 text-sm text-ink" role="alert">{{ gf.error.value }}</div>

      <LoadingState v-if="gf.loading.value" :key="gf.loading.value" :label="gf.loading.value" :stages="stages" class="mt-6" />

      <TraceStrip v-if="gf.trace.value.length" :steps="gf.trace.value" class="mt-6" />

      <template v-if="gf.result.value">
        <div v-if="gf.agentMessage.value" class="mt-6 flex max-w-3xl items-start gap-3">
          <span class="mt-0.5 shrink-0 rounded-md border border-ink bg-lilac-light px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase">Agent</span>
          <p class="text-lg font-medium leading-snug">{{ gf.agentMessage.value }}</p>
        </div>
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
