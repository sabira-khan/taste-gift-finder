<script setup lang="ts">
const gf = useGiftFinder()
const subtotal = computed(() => gf.cart.value.reduce((a, l) => a + l.price * l.quantity, 0))
const live = computed(() => !!gf.health.value?.shopify.configured && !!gf.checkoutUrl.value)
</script>

<template>
  <Transition name="slide">
    <div v-if="gf.cartOpen.value" class="fixed inset-0 z-40 flex justify-end bg-ink/30" @click.self="gf.cartOpen.value = false">
      <aside role="dialog" aria-modal="true" aria-label="Cart" class="flex h-full w-full max-w-sm flex-col bg-cream shadow-card" style="padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px)">
        <div class="flex items-center justify-between border-b border-ink/5 px-5 py-4">
          <h2 class="font-display text-xl">Your cart</h2>
          <button class="btn-ghost h-9 w-9 p-0" aria-label="Close cart" @click="gf.cartOpen.value = false">×</button>
        </div>
        <ul class="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <li v-if="!gf.cart.value.length" class="text-sm text-ink-soft">Nothing here yet. Add a pick you like.</li>
          <li v-for="l in gf.cart.value" :key="l.handle" class="flex items-center gap-3">
            <img :src="l.image" alt="" class="h-14 w-14 shrink-0 rounded-lg object-cover" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ l.title }}</p>
              <p class="text-xs text-ink-faint">{{ l.quantity }} × ${{ l.price }}</p>
            </div>
            <button class="text-xs font-medium text-ink-soft hover:text-clay" @click="gf.removeFromCart(l)">Remove</button>
          </li>
        </ul>
        <div class="border-t border-ink/5 px-5 py-4">
          <div class="flex justify-between text-sm"><span>Subtotal</span><strong>${{ subtotal.toFixed(2) }}</strong></div>
          <a v-if="live" :href="gf.checkoutUrl.value!" class="btn-clay mt-3 w-full" target="_blank" rel="noopener">Checkout on Shopify</a>
          <p v-if="live && gf.health.value?.shopify.storePassword" class="mt-3 rounded-lg bg-cream-deep px-3 py-2 text-xs text-ink-soft">
            This is a Shopify development store. If asked, the store password is <strong class="font-semibold text-ink">{{ gf.health.value.shopify.storePassword }}</strong>. Pay with the test card <strong class="font-semibold text-ink">1</strong> (Bogus Gateway); nothing is charged.
          </p>
          <p v-else class="mt-3 rounded-lg bg-cream-deep px-3 py-2 text-xs text-ink-soft">Demo cart. Checkout turns on once the Shopify store is connected.</p>
        </div>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: opacity 0.2s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
}
</style>
