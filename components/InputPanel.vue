<script setup lang="ts">
const gf = useGiftFinder()
const agentOk = computed(() => !!gf.health.value?.agent)
</script>

<template>
  <section class="panel p-4 sm:p-6">
    <div class="flex flex-wrap items-center gap-2" role="tablist">
      <button
        role="tab"
        :aria-selected="gf.mode.value === 'describe'"
        class="chip px-3.5 py-1.5 text-sm"
        :class="gf.mode.value === 'describe' ? 'bg-ink text-cream' : 'bg-cream-deep text-ink-soft hover:text-ink'"
        @click="gf.mode.value = 'describe'"
      >
        Describe them
      </button>
      <button
        role="tab"
        :aria-selected="gf.mode.value === 'seeds'"
        class="chip px-3.5 py-1.5 text-sm"
        :class="gf.mode.value === 'seeds' ? 'bg-ink text-cream' : 'bg-cream-deep text-ink-soft hover:text-ink'"
        @click="gf.mode.value = 'seeds'"
      >
        Pick their favourites
      </button>
      <span class="ml-auto hidden text-xs text-ink-faint sm:inline">
        {{ gf.mode.value === 'describe' ? 'An agent turns your words into Qloo seeds' : 'You choose the exact Qloo entities' }}
      </span>
    </div>

    <div class="mt-4">
      <AgentBox v-if="gf.mode.value === 'describe'" :available="agentOk" @fallback="gf.mode.value = 'seeds'" />
      <SeedPicker v-else />
    </div>
  </section>
</template>
