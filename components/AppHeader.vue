<script setup lang="ts">
const gf = useGiftFinder()
const count = computed(() => gf.cart.value.reduce((a, l) => a + l.quantity, 0))
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-ink bg-paper" style="top: env(safe-area-inset-top, 0px)">
    <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
      <button class="flex items-center gap-2" @click="gf.reset()">
        <img src="/favicon.svg" alt="" class="h-8 w-8" />
        <span class="font-display text-xl font-extrabold tracking-tight">Taste Gifts</span>
      </button>
      <button class="btn-ghost relative" :aria-label="`Open cart, ${count} items`" @click="gf.cartOpen.value = true">
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 7h12l-1 13H7L6 7z" /><path d="M9 7a3 3 0 0 1 6 0" /></svg>
        Cart
        <span v-if="count" class="ml-0.5 rounded-md bg-cobalt px-1.5 font-mono text-[11px] font-semibold text-white">{{ count }}</span>
      </button>
    </div>
  </header>
</template>
