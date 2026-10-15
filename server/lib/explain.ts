import type { InterestEvidence, MatchedInterest, Pick, Seed } from '../../shared/types'
import { chat, parseJsonBlock, resolveLlm, type LlmConfig } from './llm'

export type Draft = Omit<Pick, 'explanation' | 'explanationSource'>

function joinAnd(items: string[]) {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export function topSeeds(draft: Draft, seeds: Seed[], max = 2) {
  const byId = new Map(seeds.map(s => [s.id, s]))
  const ranked = Object.entries(draft.seedShare)
    .filter(([id]) => byId.has(id))
    .sort((a, b) => b[1] - a[1])
  const strong = ranked.filter(([, v]) => v >= 0.2).slice(0, max)
  return (strong.length ? strong : ranked.slice(0, 1)).map(([id]) => byId.get(id)!)
}

export function leadInterest(draft: Draft): MatchedInterest | undefined {
  const specific = draft.interests.filter(i => i.level === 'specific')
  const pool = specific.length ? specific : draft.interests
  return [...pool].sort((a, b) => b.weight * b.strength - a.weight * a.strength)[0]
}

function interestSeeds(interest: MatchedInterest, seeds: Seed[], fallback: Seed[]) {
  const named = interest.evidence.map(e => e.seedId).filter((id): id is string => !!id)
  const unique = [...new Set(named)].map(id => seeds.find(s => s.id === id)).filter((s): s is Seed => !!s).slice(0, 2)
  return unique.length ? unique : fallback
}

function shortName(name: string) {
  return name.split(':')[0]!.trim()
}

function evidenceClause(evidence: InterestEvidence[], seeds: Seed[]) {
  const qloo = evidence.find(e => e.source === 'qloo' && !e.label.startsWith('via '))
  const labels = qloo?.label.split(', ').filter(l => !/^(other|general|misc)\b/i.test(l)).slice(0, 2) ?? []
  if (labels.length) return ` (Qloo links that taste to ${labels.map(l => `“${l}”`).join(' and ')})`
  const seedEvidence = evidence.find(e => e.source === 'seed')
  const seed = seeds.find(x => x.id === seedEvidence?.seedId)
  if (seedEvidence && seed && seedEvidence.label.startsWith(`${seed.name}: `)) {
    const tags = seedEvidence.label.slice(seed.name.length + 2).split(', ').slice(0, 2)
    return ` (Qloo tags ${shortName(seed.name)} with ${tags.map(l => `“${l}”`).join(' and ')})`
  }
  return ''
}

const PROPER = /^(arabic|gulf|korean|japanese|tv|k-drama|k-beauty)$/i

function lower(label: string) {
  return label.split(' ').map(w => (PROPER.test(w) ? w : w.toLowerCase())).join(' ')
}

export function templateExplanation(draft: Draft, seeds: Seed[]): string {
  const fallbackSeeds = topSeeds(draft, seeds)
  const interest = leadInterest(draft)
  const tones = draft.matched.filter(m => m.dimension === 'tone').map(m => m.label.toLowerCase())
  const aesthetics = draft.matched.filter(m => m.dimension === 'aesthetic' && !m.label.includes(' ')).map(m => m.label.toLowerCase())
  const adjectives = [...tones, ...aesthetics].slice(0, 2)
  const feel = adjectives.length ? `, with the ${joinAnd(adjectives)} feel their taste leans toward` : ''
  const product = lower(draft.product.title)
  if (!interest) return `Fans of ${joinAnd(fallbackSeeds.map(s => shortName(s.name)))} tend to like things in this spirit. This ${product} fits${feel}.`
  const people = interestSeeds(interest, seeds, fallbackSeeds)
  const who = joinAnd(people.map(s => shortName(s.name)))
  const one = people.length === 1
  if (interest.level === 'broad') return `${who} ${one ? 'points' : 'point'} toward ${lower(interest.label)} in general${evidenceClause(interest.evidence, seeds)}. This ${product} is a broader pick in that space${feel}.`
  return `${who} ${one ? 'puts' : 'put'} ${lower(interest.label)} at the heart of their taste${evidenceClause(interest.evidence, seeds)}. This ${product} is made for that${feel}.`
}

export function explanationFacts(draft: Draft, seeds: Seed[]) {
  return {
    handle: draft.product.handle,
    product: draft.product.title,
    description: draft.product.description,
    seeds: topSeeds(draft, seeds, 3).map(s => ({ name: s.name, share: draft.seedShare[s.id] })),
    interests: draft.interests.map(i => ({ label: i.label, level: i.level, evidence: i.evidence.map(e => e.label).slice(0, 3) })),
    vibe: draft.matched.map(m => m.label).slice(0, 4),
    styleAffinity: draft.styleRefHits.map(h => h.name)
  }
}

const SYSTEM = `You write one-line gift explanations for a gift finder powered by Qloo taste data.
For each product, write one sentence of at most 28 words that tells the shopper why it suits the recipient.
Rules:
- Name the matched interest and at least one of the recipient's seeds by name.
- Use only the facts given. Do not invent features, brands or claims.
- Plain, warm, specific language. No exclamation marks, no superlatives, no emojis.
- If an interest has level "broad", present the pick as a broader idea, not a perfect match.
Return only JSON: {"<handle>": "<sentence>", ...}`

function grounded(sentence: string, facts: ReturnType<typeof explanationFacts>) {
  const text = sentence.toLowerCase()
  const seedHit = facts.seeds.some(s => text.includes(s.name.toLowerCase().split(/[\s:(]/)[0]!))
  const interestHit = facts.interests.some(i => i.label.toLowerCase().split(/[\s&]+/).some(w => w.length > 3 && text.includes(w)))
  return seedHit && interestHit && sentence.length <= 260
}

export async function explainPicks(drafts: Draft[], seeds: Seed[], llm: LlmConfig): Promise<{ picks: Pick[]; source: 'llm' | 'template'; error?: string }> {
  const template = (d: Draft): Pick => ({ ...d, explanation: templateExplanation(d, seeds), explanationSource: 'template' })
  if (!drafts.length || !resolveLlm(llm)) return { picks: drafts.map(template), source: 'template' }
  const facts = drafts.map(d => explanationFacts(d, seeds))
  try {
    const res = await chat(llm, {
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify({ recipientSeeds: seeds.map(s => s.name), products: facts }) }],
      maxTokens: 900,
      temperature: 0.4
    })
    const out = parseJsonBlock<Record<string, string>>(res.text) ?? {}
    const picks = drafts.map((d, i) => {
      const sentence = out[d.product.handle]?.trim()
      return sentence && grounded(sentence, facts[i]!) ? { ...d, explanation: sentence, explanationSource: 'llm' as const } : template(d)
    })
    return { picks, source: picks.some(p => p.explanationSource === 'llm') ? 'llm' : 'template' }
  } catch (err) {
    return { picks: drafts.map(template), source: 'template', error: (err as Error).message.slice(0, 160) }
  }
}
