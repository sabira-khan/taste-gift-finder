<script setup lang="ts">
import type { InterestSignal, TasteProfile } from '~/shared/types'

const props = defineProps<{ profile: TasteProfile; influence: Record<string, number> }>()

const PALETTE = ['#c2562b', '#5f7a63', '#b98b2e', '#5b6c9a', '#8a5a83']
const W = 320
const ROW = 34

const interests = computed<InterestSignal[]>(() => {
  const list = props.profile.interests
  const childParents = new Set(list.filter(i => i.parent && i.weight >= 0.3).map(i => i.parent))
  return list.filter(i => !childParents.has(i.id)).slice(0, 7)
})
const seeds = computed(() => props.profile.seeds)
const height = computed(() => Math.max(seeds.value.length, interests.value.length) * ROW + 16)
const seedY = (i: number) => 8 + ((height.value - 16) * (i + 0.5)) / Math.max(1, seeds.value.length)
const interestY = (i: number) => 8 + ((height.value - 16) * (i + 0.5)) / Math.max(1, interests.value.length)

const links = computed(() =>
  interests.value.flatMap((interest, ii) =>
    seeds.value.map((seed, si) => {
      const share = interest.seedShare[seed.id] ?? 0
      const w = interest.weight * share
      if (w < 0.04) return null
      const y1 = seedY(si)
      const y2 = interestY(ii)
      const x1 = 104
      const x2 = 166
      return { d: `M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`, width: 1 + w * 9, color: PALETTE[si % PALETTE.length]!, key: `${seed.id}-${interest.id}` }
    }).filter(Boolean) as { d: string; width: number; color: string; key: string }[]
  )
)

const dims = computed(() => {
  const out: Record<string, string[]> = { tone: [], aesthetic: [], lifestyle: [] }
  for (const f of props.profile.facets) {
    const key = f.dimension === 'interest' ? 'lifestyle' : f.dimension
    if (out[key] && out[key]!.length < 4) out[key]!.push(f.label)
  }
  return out
})
const DIM_LABELS: Record<string, string> = { tone: 'Mood', aesthetic: 'Look', lifestyle: 'Lifestyle' }

const crossDomain = computed(() => {
  const byType = new Map<string, string[]>()
  for (const n of props.profile.crossDomain) {
    const list = byType.get(n.type) ?? []
    if (list.length < 2) list.push(n.name)
    byType.set(n.type, list)
  }
  const label: Record<string, string> = { 'urn:entity:movie': 'Films', 'urn:entity:artist': 'Music', 'urn:entity:book': 'Books', 'urn:entity:tv_show': 'TV' }
  return [...byType.entries()].map(([t, names]) => ({ label: label[t] ?? t, names }))
})

function short(text: string, n = 16) {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text
}
</script>

<template>
  <aside class="panel h-fit p-4 lg:sticky lg:top-20" aria-label="Taste map">
    <p class="eyebrow">Taste map</p>
    <h2 class="mt-1 font-display text-xl leading-tight">What Qloo sees in their taste</h2>

    <div class="mt-3 overflow-x-auto">
      <svg :viewBox="`0 0 ${W} ${height}`" class="w-full min-w-[280px]" role="img" :aria-label="`Seeds linked to interests: ${interests.map(i => i.label).join(', ')}`">
        <path v-for="l in links" :key="l.key" :d="l.d" :stroke="l.color" :stroke-width="l.width" fill="none" stroke-linecap="round" opacity="0.55" />
        <g v-for="(s, i) in seeds" :key="s.id">
          <circle :cx="104" :cy="seedY(i)" r="4" :fill="PALETTE[i % PALETTE.length]" />
          <text :x="96" :y="seedY(i) + 4" text-anchor="end" class="fill-ink text-[11px] font-medium">{{ short(s.name) }}</text>
        </g>
        <g v-for="(it, i) in interests" :key="it.id">
          <rect :x="166" :y="interestY(i) - 9" :width="Math.max(6, it.weight * 150)" height="18" rx="9" class="fill-cream-deep" />
          <text :x="173" :y="interestY(i) + 4" class="fill-ink text-[11px] font-medium">{{ short(it.label, 24) }}</text>
        </g>
      </svg>
    </div>
    <p class="mt-1 text-[11px] leading-snug text-ink-faint">Line width shows how much each seed drives an interest. Bar length is the interest's strength, from Qloo tag insights and the seeds' own tags.</p>

    <div class="mt-4 space-y-2">
      <div v-for="(labels, dim) in dims" :key="dim" class="flex flex-wrap items-center gap-1.5">
        <span class="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{{ DIM_LABELS[dim] }}</span>
        <span v-for="l in labels" :key="l" class="chip bg-cream text-ink-soft ring-1 ring-ink/5">{{ l }}</span>
      </div>
    </div>

    <div v-if="crossDomain.length" class="mt-4 border-t border-ink/5 pt-3">
      <p class="eyebrow">Across culture, they'd also like</p>
      <dl class="mt-2 space-y-1 text-xs">
        <div v-for="c in crossDomain" :key="c.label" class="flex gap-2">
          <dt class="w-12 shrink-0 font-semibold text-ink-faint">{{ c.label }}</dt>
          <dd class="text-ink-soft">{{ c.names.join(' · ') }}</dd>
        </div>
      </dl>
    </div>

    <p v-if="profile.priceComfort" class="mt-4 border-t border-ink/5 pt-3 text-xs text-ink-soft">
      Brands they gravitate to sit around <strong class="text-ink">${{ profile.priceComfort.median }}</strong> (middle half ${{ profile.priceComfort.p25 }}–${{ profile.priceComfort.p75 }}).
    </p>
  </aside>
</template>
