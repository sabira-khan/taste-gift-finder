<script setup lang="ts">
const gf = useGiftFinder()
const pick = computed(() => {
  const r = gf.result.value
  if (!r || !gf.whyHandle.value) return null
  return [...r.picks, ...r.alternates].find(p => p.product.handle === gf.whyHandle.value) ?? null
})
const seeds = computed(() => gf.result.value?.profile.seeds ?? [])
const seedRows = computed(() => {
  const p = pick.value
  if (!p) return []
  return seeds.value.map(s => ({ name: s.name, share: p.seedShare[s.id] ?? 0 })).sort((a, b) => b.share - a.share)
})
const scoreRows = computed(() => {
  const p = pick.value
  if (!p) return []
  return [
    { label: 'Interest match', weight: 0.55, value: p.score.interest },
    { label: 'Vibe (Qloo brand properties)', weight: 0.25, value: p.score.property },
    { label: 'Style references', weight: 0.1, value: p.score.styleRef },
    { label: 'Price comfort', weight: 0.1, value: p.score.price }
  ]
})
const DIM: Record<string, string> = { tone: 'Mood', aesthetic: 'Look', lifestyle: 'Lifestyle', interest: 'Interest' }
function close() {
  gf.whyHandle.value = null
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition name="fade">
    <div v-if="pick" class="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6" @click.self="close">
      <section role="dialog" aria-modal="true" :aria-label="`Why ${pick.product.title}`" class="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-cream p-5 shadow-card sm:rounded-3xl" style="padding-bottom: calc(1.25rem + env(safe-area-inset-bottom, 0px))">
        <div class="flex items-start gap-3">
          <img :src="pick.product.image" alt="" class="h-16 w-16 shrink-0 rounded-xl object-cover" />
          <div class="min-w-0 flex-1">
            <p class="eyebrow">Why this pick</p>
            <h2 class="font-display text-xl leading-tight">{{ pick.product.title }}</h2>
          </div>
          <button class="btn-ghost h-9 w-9 p-0" aria-label="Close" @click="close">×</button>
        </div>
        <p class="mt-3 text-sm leading-relaxed text-ink-soft">{{ pick.explanation }}</p>

        <h3 class="eyebrow mt-5">Interests it matches</h3>
        <ul class="mt-2 space-y-2">
          <li v-for="i in pick.interests" :key="i.id" class="rounded-xl bg-white/80 p-3 ring-1 ring-ink/5">
            <div class="flex items-center justify-between gap-2 text-sm">
              <span class="font-medium">{{ i.label }}</span>
              <span class="chip" :class="i.level === 'specific' ? 'bg-sage-light text-sage' : 'bg-cream-deep text-ink-faint'">{{ i.level === 'specific' ? 'specific match' : `broad match${i.via ? ` (product is ${i.via})` : ''}, capped at 40%` }}</span>
            </div>
            <p class="mt-1 text-xs text-ink-faint">Their interest strength {{ Math.round(i.weight * 100) }}% · product fit {{ Math.round(i.strength * 100) }}%</p>
            <ul class="mt-1.5 space-y-0.5 text-xs text-ink-soft">
              <li v-for="(e, k) in i.evidence.slice(0, 3)" :key="k">
                <span class="font-semibold text-ink-faint">{{ e.source === 'qloo' ? 'Qloo tag insights' : e.source === 'domain' ? 'Seed type' : 'Seed tags' }}:</span> {{ e.label }}
              </li>
            </ul>
          </li>
        </ul>

        <h3 class="eyebrow mt-5">Which of their favourites drove it</h3>
        <ul class="mt-2 space-y-1.5">
          <li v-for="s in seedRows" :key="s.name" class="text-xs">
            <div class="flex justify-between"><span class="font-medium">{{ s.name }}</span><span class="text-ink-faint">{{ Math.round(s.share * 100) }}%</span></div>
            <div class="mt-1 h-1.5 rounded-full bg-cream-deep"><div class="h-1.5 rounded-full bg-clay" :style="{ width: `${Math.round(s.share * 100)}%` }" /></div>
          </li>
        </ul>
        <p class="mt-1 text-[11px] text-ink-faint">From Qloo explainability on the brands and tags behind each matched signal.</p>

        <template v-if="pick.matched.length">
          <h3 class="eyebrow mt-5">Vibe signals it shares with their brands</h3>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span v-for="m in pick.matched" :key="m.key" class="chip bg-white text-ink-soft ring-1 ring-ink/5">{{ DIM[m.dimension] }}: {{ m.label }}</span>
          </div>
        </template>

        <p v-if="pick.styleRefHits.length" class="mt-4 text-xs text-ink-soft">
          Qloo predicts their taste also fits <strong class="text-ink">{{ pick.styleRefHits.map(h => h.name).join(' and ') }}</strong>, the brands this product's style echoes.
        </p>
        <p v-if="pick.contrast" class="mt-2 text-xs text-ink-soft">This product's vibe fits them {{ pick.contrast.toFixed(1) }}× better than it fits the average of 13 baseline taste profiles.</p>

        <h3 class="eyebrow mt-5">Score</h3>
        <ul class="mt-2 space-y-1.5">
          <li v-for="r in scoreRows" :key="r.label" class="text-xs">
            <div class="flex justify-between"><span>{{ r.label }} <span class="text-ink-faint">× {{ r.weight }}</span></span><span class="text-ink-faint">{{ Math.round(r.value * 100) }}%</span></div>
            <div class="mt-1 h-1.5 rounded-full bg-cream-deep"><div class="h-1.5 rounded-full bg-ink" :style="{ width: `${Math.round(r.value * 100)}%` }" /></div>
          </li>
        </ul>
        <p class="mt-3 text-sm font-semibold">Total {{ Math.round(pick.score.total * 100) }}%</p>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
