<script setup lang="ts">
const props = defineProps<{ available: boolean }>()
const emit = defineEmits<{ fallback: [] }>()
const gf = useGiftFinder()
const text = ref('')
const examples = [
  'Gift for my sister, she loves Fairuz, matcha and old films, under $50',
  'My nephew is obsessed with FIFA, Real Madrid and Cristiano Ronaldo',
  'A friend who watches K-dramas and is into Korean skincare'
]
async function submit() {
  if (text.value.trim().length < 4 || gf.loading.value) return
  await gf.askAgent(text.value.trim())
}
</script>

<template>
  <div>
    <div v-if="!props.available" class="rounded-xl bg-cream-deep p-4 text-sm text-ink-soft">
      Agent mode needs an LLM key on the server, so it's switched off on this deployment.
      <button class="ml-1 font-medium text-clay underline underline-offset-2" @click="emit('fallback')">Pick their favourites instead</button>
    </div>
    <form v-else @submit.prevent="submit">
      <label for="agent-text" class="sr-only">Describe the person you're shopping for</label>
      <textarea
        id="agent-text"
        v-model="text"
        rows="3"
        maxlength="600"
        placeholder="Who are they and what do they love? Add a budget if you have one."
        class="w-full resize-none rounded-xl border border-ink/10 bg-white px-4 py-3 text-[15px] leading-relaxed placeholder:text-ink-faint focus:border-clay focus:outline-none"
        @keydown.enter.exact.prevent="submit"
      />
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          v-for="ex in examples"
          :key="ex"
          type="button"
          class="chip h-auto max-w-full whitespace-normal py-1.5 text-left leading-snug bg-cream-deep text-ink-soft hover:text-ink"
          @click="text = ex"
        >
          {{ ex }}
        </button>
        <button type="submit" class="btn-clay ml-auto" :disabled="!!gf.loading.value || text.trim().length < 4">Find gifts</button>
      </div>
      <p class="mt-2 text-xs text-ink-faint">The agent can make up to 6 Qloo tool calls and retries when the results look weak. Every step appears in the trace below.</p>
    </form>
  </div>
</template>
