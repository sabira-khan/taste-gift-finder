<script setup lang="ts">
import type { Seed } from '~/shared/types'

const gf = useGiftFinder()
const query = ref('')
const results = ref<{ entities: Seed[]; tags: Seed[] }>({ entities: [], tags: [] })
const searching = ref(false)
const open = ref(false)
const active = ref(-1)
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0

const TYPE_LABELS: Record<string, string> = {
  'urn:entity:movie': 'Film',
  'urn:entity:tv_show': 'TV show',
  'urn:entity:artist': 'Artist',
  'urn:entity:book': 'Book',
  'urn:entity:author': 'Author',
  'urn:entity:brand': 'Brand',
  'urn:entity:videogame': 'Video game',
  'urn:entity:person': 'Person',
  'urn:entity:podcast': 'Podcast',
  'urn:entity:place': 'Place'
}
function typeLabel(seed: Seed) {
  if (seed.kind === 'tag') return 'Taste tag'
  return TYPE_LABELS[seed.type] ?? seed.type.split(':').pop()?.replace('_', ' ') ?? ''
}

const options = computed(() => [...results.value.entities, ...results.value.tags].filter(s => !gf.seeds.value.some(x => x.id === s.id)))

watch(query, q => {
  clearTimeout(timer)
  active.value = -1
  if (q.trim().length < 2) {
    results.value = { entities: [], tags: [] }
    return
  }
  timer = setTimeout(async () => {
    const mine = ++seq
    searching.value = true
    try {
      const res = await $fetch<{ entities: Seed[]; tags: Seed[] }>('/api/entities/search', { query: { q: q.trim() } })
      if (mine === seq) {
        results.value = res
        open.value = true
      }
    } catch {
      if (mine === seq) results.value = { entities: [], tags: [] }
    } finally {
      if (mine === seq) searching.value = false
    }
  }, 250)
})

function choose(seed: Seed) {
  if (gf.seeds.value.length >= 5) return
  gf.seeds.value = [...gf.seeds.value, seed]
  query.value = ''
  results.value = { entities: [], tags: [] }
  open.value = false
}
function onBlur() {
  setTimeout(() => (open.value = false), 150)
}
function remove(id: string) {
  gf.seeds.value = gf.seeds.value.filter(s => s.id !== id)
}
function onKey(e: KeyboardEvent) {
  if (!options.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = (active.value + 1) % options.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = (active.value - 1 + options.value.length) % options.value.length
  } else if (e.key === 'Enter' && active.value >= 0) {
    e.preventDefault()
    choose(options.value[active.value]!)
  } else if (e.key === 'Escape') open.value = false
}

const PRESETS: { label: string; seeds: { q: string; type?: string; tag?: string }[] }[] = [
  { label: 'Anime + lo-fi', seeds: [{ q: 'Spirited Away', type: 'movie' }, { q: 'Attack on Titan', type: 'tv_show' }, { q: 'Lo-fi', tag: 'urn:tag:genre:music:lo_fi_hip_hop' }] },
  { label: 'Fairuz + Arabic coffee', seeds: [{ q: 'Fairuz', type: 'artist' }, { q: 'Arabic coffee', tag: 'urn:tag:menu_highlight:qloo:arabic_coffee' }, { q: 'Ziad Rahbani', type: 'artist' }] },
  { label: 'Classic films + jazz', seeds: [{ q: 'Casablanca', type: 'movie' }, { q: 'Miles Davis', type: 'artist' }, { q: 'Roman Holiday', type: 'movie' }] },
  { label: 'K-drama + skincare', seeds: [{ q: 'Crash Landing on You', type: 'tv_show' }, { q: 'Laneige', type: 'brand' }, { q: 'Sulwhasoo', type: 'brand' }] }
]
const presetLoading = ref<string | null>(null)
async function usePreset(preset: (typeof PRESETS)[number]) {
  presetLoading.value = preset.label
  try {
    const seeds = await Promise.all(preset.seeds.map(async s => {
      if (s.tag) return { id: s.tag, kind: 'tag', name: s.q, type: s.tag.split(':').slice(0, 4).join(':'), tags: [{ id: s.tag, name: s.q, type: s.tag.split(':').slice(0, 4).join(':') }] } as Seed
      const res = await $fetch<{ entities: Seed[] }>('/api/entities/search', { query: { q: s.q, type: s.type } })
      return res.entities.find(e => e.name.toLowerCase() === s.q.toLowerCase()) ?? res.entities[0] ?? null
    }))
    gf.seeds.value = seeds.filter((s): s is Seed => !!s)
    await gf.findGifts()
  } finally {
    presetLoading.value = null
  }
}

const BUDGETS = [null, 30, 50, 100, 150]
</script>

<template>
  <div>
    <div class="relative">
      <label for="seed-input" class="eyebrow">Things they love · {{ gf.seeds.value.length }}/5</label>
      <div class="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-ink bg-white p-2 transition-shadow focus-within:shadow-hard">
        <span v-for="s in gf.seeds.value" :key="s.id" class="chip bg-ink py-1.5 pl-1.5 pr-2 text-paper">
          <img v-if="s.image" :src="s.image" alt="" class="h-5 w-5 rounded-full object-cover" />
          <span class="max-w-[12rem] truncate">{{ s.name }}</span>
          <span class="text-paper/60">{{ typeLabel(s) }}</span>
          <button class="ml-0.5 rounded-full px-1 text-paper/70 hover:text-paper" :aria-label="`Remove ${s.name}`" @click="remove(s.id)">×</button>
        </span>
        <input
          id="seed-input"
          v-model="query"
          :disabled="gf.seeds.value.length >= 5"
          type="text"
          autocomplete="off"
          role="combobox"
          :aria-expanded="open && options.length > 0"
          aria-controls="seed-options"
          :placeholder="gf.seeds.value.length ? 'Add another…' : 'A film, artist, book, show, brand, game or taste like “matcha”'"
          class="min-w-[10rem] flex-1 bg-transparent px-2 py-1.5 text-[15px] placeholder:text-ink-faint focus:outline-none"
          @keydown="onKey"
          @focus="open = true"
          @blur="onBlur"
        />
        <span v-if="searching" class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-ink/20 border-t-cobalt" aria-hidden="true" />
      </div>
      <ul
        v-if="open && options.length"
        id="seed-options"
        role="listbox"
        class="absolute left-0 right-0 z-20 mt-2 max-h-80 overflow-auto rounded-xl bg-white p-1 shadow-card ring-1 ring-ink/10"
      >
        <li
          v-for="(o, i) in options"
          :key="o.id"
          role="option"
          :aria-selected="i === active"
          class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2"
          :class="i === active ? 'bg-paper' : 'hover:bg-paper'"
          @mousedown.prevent="choose(o)"
        >
          <img v-if="o.image" :src="o.image" alt="" class="h-9 w-9 shrink-0 rounded-md object-cover" />
          <span v-else class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-paper-deep text-xs text-ink-faint">{{ o.kind === 'tag' ? '#' : '•' }}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">{{ o.name }}</span>
            <span class="block truncate text-xs text-ink-faint">{{ typeLabel(o) }}<template v-if="o.description"> · {{ o.description }}</template></span>
          </span>
        </li>
      </ul>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <span class="eyebrow mr-1">Budget</span>
      <button
        v-for="b in BUDGETS"
        :key="String(b)"
        class="chip px-3 py-1.5"
        :class="gf.budget.value === b ? 'bg-ink text-paper' : 'bg-paper-deep text-ink-soft hover:text-ink'"
        @click="gf.budget.value = b"
      >
        {{ b ? `Under $${b}` : 'Any' }}
      </button>
      <button class="btn-pop ml-auto" :disabled="!gf.seeds.value.length || !!gf.loading.value" @click="gf.findGifts()">Find gifts</button>
    </div>

    <div v-if="!gf.seeds.value.length" class="mt-5 border-t border-ink/5 pt-4">
      <span class="eyebrow">Or try a taste</span>
      <div class="mt-2 flex flex-wrap gap-2">
        <button v-for="p in PRESETS" :key="p.label" class="btn-ghost py-1.5" :disabled="!!presetLoading || !!gf.loading.value" @click="usePreset(p)">
          {{ presetLoading === p.label ? 'Loading…' : p.label }}
        </button>
      </div>
    </div>
  </div>
</template>
