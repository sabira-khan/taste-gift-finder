import type { Dimension, Vocabulary, VocabTerm } from '../../shared/types'
import type { QlooTag } from './qloo'

export const DIMENSION_TAG_TYPES: Record<string, Dimension> = {
  'urn:tag:aesthetic_property:qloo': 'aesthetic',
  'urn:tag:emotional_tone:qloo': 'tone',
  'urn:tag:lifestyle:qloo': 'lifestyle',
  'urn:tag:interest_adjacency:qloo': 'interest'
}

export const DIMENSION_LABELS: Record<Dimension, string> = {
  aesthetic: 'Aesthetic',
  tone: 'Emotional tone',
  lifestyle: 'Lifestyle',
  interest: 'Interests'
}

const STOP = new Set(['and', 'the', 'of', 'a', 'an', 'with', 'for', 'in', 'on', '&'])
const GENERIC_ROOTS = ['design', 'brand', 'packag', 'palette', 'color', 'colour', 'tone', 'toned', 'global', 'international', 'style', 'aesthetic', 'routine']

function stemWord(word: string): string {
  let w = word
  for (const suffix of ['istic', 'ism', 'ist', 'ness', 'ity', 'ing', 'ly', 'al', 'ed', 'es', 's']) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length)
      break
    }
  }
  if (w.length >= 6 && w.endsWith('y')) w = w.slice(0, -1)
  return w
}

function words(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(w => w && !STOP.has(w))
}

export function stemLabel(label: string): string {
  return words(label).map(stemWord).sort().join('-')
}

export function coreStem(label: string): string {
  const all = words(label)
  const core = all.filter(w => !GENERIC_ROOTS.some(root => w.startsWith(root)))
  return (core.length ? core : all).map(stemWord).sort().join('-')
}

export function dimensionOf(tag: Pick<QlooTag, 'type'>): Dimension | null {
  return DIMENSION_TAG_TYPES[tag.type] ?? null
}

export interface VocabIndex {
  vocab: Vocabulary
  terms: Map<string, VocabTerm>
  resolve(tag: QlooTag): VocabTerm | null
  resolveLabel(label: string, dimension?: Dimension): VocabTerm | null
}

export function createVocabIndex(vocab: Vocabulary): VocabIndex {
  const terms = new Map<string, VocabTerm>()
  const byId = new Map<string, VocabTerm>()
  const byStem = new Map<string, VocabTerm>()
  const byStemAnyDim = new Map<string, VocabTerm>()
  for (const term of vocab.terms) {
    terms.set(term.key, term)
    byId.set(term.key, term)
    for (const alias of term.aliases) byId.set(alias, term)
    const stem = coreStem(term.label)
    byStem.set(`${term.dimension}|${stem}`, term)
    if (!byStemAnyDim.has(stem)) byStemAnyDim.set(stem, term)
  }

  function resolveLabel(label: string, dimension?: Dimension) {
    const stem = coreStem(label)
    if (dimension) return byStem.get(`${dimension}|${stem}`) ?? null
    return byStemAnyDim.get(stem) ?? null
  }

  return {
    vocab,
    terms,
    resolveLabel,
    resolve(tag) {
      const direct = byId.get(tag.id)
      if (direct) return direct
      const dim = dimensionOf(tag)
      return dim ? resolveLabel(tag.name, dim) : null
    }
  }
}
