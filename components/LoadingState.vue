<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <div class="flex items-center gap-3 rounded-xl bg-white/70 px-4 py-3 text-sm text-ink-soft ring-1 ring-ink/5" role="status" aria-live="polite">
    <span class="h-4 w-4 animate-spin rounded-full border-2 border-ink/15 border-t-clay" aria-hidden="true" />
    {{ label }}…
  </div>
</template>
