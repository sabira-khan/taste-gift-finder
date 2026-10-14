<script setup lang="ts">
import type { Pick, Seed } from '~/shared/types'

const props = defineProps<{ pick: Pick; rank: number; seeds: Seed[] }>()
const gf = useGiftFinder()
const p = computed(() => props.pick)
const busy = computed(() => !!gf.loading.value)
const fit = computed(() => Math.round(p.value.score.total * 100))
const contrast = computed(() => (p.value.contrast && p.value.contrast >= 1.3 ? `${p.value.contrast.toFixed(1)}× their vibe vs a typical shopper` : null))
const added = computed(() => gf.cart.value.some(l => l.handle === p.value.product.handle))
</script>

<template>
  <article class="panel flex flex-col overflow-hidden">
    <div class="relative aspect-[4/3] overflow-hidden bg-cream-deep">
      <img :src="p.product.image" :alt="p.product.imageAlt" loading="lazy" class="h-full w-full object-cover" />
      <span class="absolute left-3 top-3 chip bg-white/90 text-ink shadow-sm">#{{ rank }} · {{ fit }}% fit</span>
      <a
        v-if="p.product.photoCredit"
        :href="p.product.photoCredit.sourceUrl"
        target="_blank"
        rel="noopener"
        class="absolute bottom-2 right-2 rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-white/90 hover:bg-black/60"
      >
        Photo: {{ p.product.photoCredit.photographer }} / Unsplash
      </a>
    </div>
    <div class="flex flex-1 flex-col p-4">
      <div class="flex items-start justify-between gap-3">
        <h3 class="font-display text-lg leading-snug">{{ p.product.title }}</h3>
        <span class="shrink-0 text-base font-semibold">${{ p.product.price }}</span>
      </div>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <span
          v-for="i in p.interests.slice(0, 3)"
          :key="i.id"
          class="chip"
          :class="i.level === 'specific' ? 'bg-sage-light text-sage' : 'bg-cream-deep text-ink-faint'"
          :title="i.level === 'specific' ? 'Specific interest match' : 'Broader interest match'"
        >
          {{ i.label }}
        </span>
        <span v-if="contrast" class="chip bg-gold-light text-gold">{{ contrast }}</span>
      </div>
      <p class="mt-3 flex-1 text-sm leading-relaxed text-ink-soft">{{ p.explanation }}</p>
      <div class="mt-4 flex flex-wrap gap-2">
        <button class="btn-primary flex-1 sm:flex-none" @click="gf.addToCart(p)">{{ added ? 'Add another' : 'Add to cart' }}</button>
        <button class="btn-ghost" @click="gf.whyHandle.value = p.product.handle">Why this pick</button>
      </div>
      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink/5 pt-3 text-xs">
        <button class="font-medium text-ink-soft hover:text-clay disabled:opacity-50" :disabled="busy" @click="gf.refine({ type: 'more_like', handle: p.product.handle })">More like this</button>
        <button class="font-medium text-ink-soft hover:text-clay disabled:opacity-50" :disabled="busy" @click="gf.refine({ type: 'not_style', handle: p.product.handle })">Not their style</button>
        <button class="font-medium text-ink-soft hover:text-clay disabled:opacity-50" :disabled="busy" @click="gf.refine({ type: 'too_expensive', handle: p.product.handle })">Too expensive</button>
      </div>
    </div>
  </article>
</template>
