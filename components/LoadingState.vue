<script setup lang="ts">
const props = defineProps<{ label: string; stages?: { text: string; at: number }[] }>()
const elapsed = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  const start = Date.now()
  timer = setInterval(() => (elapsed.value = (Date.now() - start) / 1000), 250)
})
onBeforeUnmount(() => clearInterval(timer))
const current = computed(() => (props.stages ?? []).filter(s => elapsed.value >= s.at).length - 1)
</script>

<template>
  <div class="rounded-xl bg-white/70 px-4 py-3 text-sm text-ink-soft ring-1 ring-ink/5" role="status" aria-live="polite">
    <div class="flex items-center gap-3">
      <span class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-ink/15 border-t-clay" aria-hidden="true" />
      <span class="flex-1">{{ label }}…</span>
      <span class="tabular-nums text-xs text-ink-faint">{{ Math.floor(elapsed) }}s</span>
    </div>
    <ol v-if="stages?.length" class="mt-3 space-y-1.5 border-t border-ink/5 pt-3 text-xs">
      <li v-for="(s, i) in stages" :key="s.text" class="flex items-center gap-2" :class="i < current ? 'text-ink-soft' : i === current ? 'font-medium text-ink' : 'text-ink-faint/70'">
        <span class="grid h-4 w-4 place-items-center rounded-full text-[10px]" :class="i < current ? 'bg-sage text-white' : i === current ? 'bg-clay text-white' : 'bg-cream-deep'" aria-hidden="true">{{ i < current ? '✓' : i + 1 }}</span>
        {{ s.text }}
      </li>
    </ol>
  </div>
</template>
