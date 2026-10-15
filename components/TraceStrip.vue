<script setup lang="ts">
import type { TraceStep } from '~/shared/types'

const props = defineProps<{ steps: TraceStep[] }>()
const open = ref(false)
const totals = computed(() => ({
  calls: props.steps.reduce((a, s) => a + s.qlooCalls, 0),
  cached: props.steps.reduce((a, s) => a + s.cacheHits, 0)
}))
</script>

<template>
  <section aria-label="How we got here">
    <button class="flex w-full items-center gap-2 text-left" :aria-expanded="open" @click="open = !open">
      <span class="eyebrow">How we got here</span>
      <span class="font-mono text-xs text-ink-faint">{{ steps.length }} steps · {{ totals.calls }} Qloo calls ({{ totals.cached }} cached)</span>
      <span class="ml-auto text-xs font-semibold text-cobalt underline underline-offset-2">{{ open ? 'Hide' : 'Show' }}</span>
    </button>
    <ol class="mt-2 flex gap-2 overflow-x-auto pb-2" :class="open ? 'flex-col sm:flex-row sm:flex-wrap' : ''">
      <li
        v-for="(s, i) in steps"
        :key="i"
        class="shrink-0 rounded-lg border border-ink bg-white px-3 py-2"
        :class="open ? 'sm:max-w-xs' : 'max-w-[15rem]'"
      >
        <div class="flex items-center gap-2 text-xs font-semibold">
          <span class="flex h-5 w-5 items-center justify-center rounded bg-ink font-mono text-[10px] text-paper">{{ i + 1 }}</span>
          <span class="truncate">{{ s.step }}</span>
        </div>
        <p v-if="open && s.reason" class="mt-1 text-xs leading-snug text-ink-soft">{{ s.reason }}</p>
        <p v-if="s.detail" class="mt-1 text-xs leading-snug text-ink-faint" :class="open ? '' : 'truncate'">{{ s.detail }}</p>
        <p v-if="open && s.qlooCalls" class="mt-1 text-[11px] text-ink-faint">{{ s.qlooCalls }} Qloo calls, {{ s.cacheHits }} from cache</p>
      </li>
    </ol>
  </section>
</template>
