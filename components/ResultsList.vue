<script setup lang="ts">
import type { RecommendResponse } from '~/composables/useGiftFinder'

const props = defineProps<{ result: RecommendResponse }>()
const gf = useGiftFinder()
const count = computed(() => props.result.picks.length)
const cap = computed(() => props.result.refine.priceCap)
</script>

<template>
  <section aria-label="Gift picks">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 class="font-display font-bold text-2xl tracking-tight">
          <template v-if="count === 0">No strong matches yet</template>
          <template v-else-if="count < 5">We found {{ count }} strong {{ count === 1 ? 'match' : 'matches' }}</template>
          <template v-else>Five picks that fit their taste</template>
        </h2>
        <p class="mt-1 text-sm text-ink-soft">
          <template v-if="count < 5 && count > 0">Only products with a specific interest match are shown, so we skipped weaker fillers.</template>
          <template v-else-if="count === 0">Nothing in the catalog matches a specific interest at this budget. Try another seed or a higher budget.</template>
          <template v-else>Ranked by interest match first, then vibe, style and price.</template>
          <span v-if="cap" class="ml-1">Price cap ${{ cap }}.</span>
          <span v-if="result.excludedByBudget" class="ml-1">{{ result.excludedByBudget }} products were over budget.</span>
        </p>
      </div>
      <span v-if="result.explanationSource === 'template'" class="chip border-dashed bg-white text-ink-faint" title="The language model was unavailable, so each reason comes from a template filled with the Qloo evidence">Template explanations</span>
    </div>

    <div v-if="!result.quality.ok && result.quality.issues.length" class="mt-3 rounded-lg border border-ink bg-pop-light px-4 py-3 text-sm text-ink">
      <strong class="font-semibold text-ink">Heads up:</strong> {{ result.quality.issues[0] }}.
      <span v-if="result.quality.suggestions[0]">Tip: {{ result.quality.suggestions[0] }}.</span>
    </div>

    <TransitionGroup tag="div" name="list" class="mt-4 grid gap-4 sm:grid-cols-2">
      <GiftCard v-for="(p, i) in result.picks" :key="p.product.handle" :pick="p" :rank="i + 1" :seeds="result.profile.seeds" />
    </TransitionGroup>

    <div v-if="count === 0 && result.alternates.length" class="mt-4">
      <p class="eyebrow">Closest broader ideas</p>
      <ul class="mt-2 space-y-1 text-sm text-ink-soft">
        <li v-for="a in result.alternates.slice(0, 3)" :key="a.product.handle">{{ a.product.title }}: {{ a.interests.map(i => i.label).join(', ') || 'vibe match only' }}</li>
      </ul>
    </div>

    <p class="mt-4 text-xs text-ink-faint">Catalog: {{ result.catalogSource === 'shopify' ? 'live Shopify store' : 'local demo catalog' }} · {{ result.considered }} products considered</p>
  </section>
</template>

<style scoped>
.list-move,
.list-enter-active,
.list-leave-active {
  transition: all 0.35s ease;
}
.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
.list-leave-active {
  position: absolute;
}
</style>
