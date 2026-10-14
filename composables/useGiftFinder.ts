import type { Pick, RefineAction, RefineState, Seed, TasteProfile, TraceStep } from '~/shared/types'

export interface RecommendResponse {
  profile: TasteProfile
  picks: Pick[]
  alternates: Pick[]
  strongMatches: number
  considered: number
  excludedByBudget: number
  quality: { ok: boolean; issues: string[]; suggestions: string[]; seedInfluence: Record<string, number> }
  explanationSource: 'llm' | 'template'
  trace: TraceStep[]
  refine: RefineState
  catalogSource: string
}

export interface AgentResponse {
  message: string
  seeds: Seed[]
  budget?: number
  result: RecommendResponse | null
  trace: TraceStep[]
  toolCalls: number
  provider?: string
}

export interface Health {
  ok: boolean
  catalog: { source: string; products: number; error?: string }
  shopify: { configured: boolean }
  llm: { provider: string; model: string } | null
  agent: boolean
}

export interface CartLine {
  handle: string
  title: string
  price: number
  image: string
  quantity: number
  lineId?: string
}

const CART_KEY = 'gf-cart'

export function useGiftFinder() {
  const mode = useState<'describe' | 'seeds'>('gf-mode', () => 'seeds')
  const seeds = useState<Seed[]>('gf-seeds', () => [])
  const budget = useState<number | null>('gf-budget', () => null)
  const result = useState<RecommendResponse | null>('gf-result', () => null)
  const agentMessage = useState<string>('gf-agent-message', () => '')
  const trace = useState<TraceStep[]>('gf-trace', () => [])
  const loading = useState<string | null>('gf-loading', () => null)
  const error = useState<string | null>('gf-error', () => null)
  const health = useState<Health | null>('gf-health', () => null)
  const cart = useState<CartLine[]>('gf-cart-lines', () => [])
  const cartId = useState<string | null>('gf-cart-id', () => null)
  const checkoutUrl = useState<string | null>('gf-checkout', () => null)
  const cartOpen = useState<boolean>('gf-cart-open', () => false)
  const whyHandle = useState<string | null>('gf-why', () => null)

  function errorText(err: any) {
    return err?.data?.data?.reason ?? err?.data?.statusMessage ?? err?.statusMessage ?? err?.message ?? 'Something went wrong'
  }

  async function loadHealth() {
    try {
      health.value = await $fetch<Health>('/api/health')
      if (health.value.agent && !seeds.value.length && !result.value) mode.value = 'describe'
    } catch {
      health.value = null
    }
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY) ?? 'null')
      if (saved && Array.isArray(saved.lines)) {
        cart.value = saved.lines
        cartId.value = saved.cartId ?? null
        checkoutUrl.value = saved.checkoutUrl ?? null
      }
    } catch {}
  }

  function persistCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ lines: cart.value, cartId: cartId.value, checkoutUrl: checkoutUrl.value }))
    } catch {}
  }

  async function findGifts() {
    if (!seeds.value.length) return
    loading.value = 'Reading their taste across film, music, books and brands'
    error.value = null
    try {
      const res = await $fetch<RecommendResponse>('/api/recommend', { method: 'POST', body: { seeds: seeds.value, budget: budget.value } })
      result.value = res
      trace.value = res.trace
      agentMessage.value = ''
    } catch (err) {
      error.value = errorText(err)
    } finally {
      loading.value = null
    }
  }

  async function askAgent(message: string) {
    loading.value = 'The agent is reading your description and asking Qloo'
    error.value = null
    try {
      const res = await $fetch<AgentResponse>('/api/agent', { method: 'POST', body: { message } })
      agentMessage.value = res.message
      trace.value = res.trace
      seeds.value = res.seeds
      if (res.budget) budget.value = res.budget
      result.value = res.result
    } catch (err) {
      error.value = errorText(err)
    } finally {
      loading.value = null
    }
  }

  async function refine(action: RefineAction) {
    if (!result.value) return
    const labels: Record<RefineAction['type'], string> = { more_like: 'Finding more like that', not_style: 'Steering away from that style', too_expensive: 'Looking for lower prices' }
    loading.value = labels[action.type]
    error.value = null
    try {
      const res = await $fetch<RecommendResponse>('/api/refine', {
        method: 'POST',
        body: {
          seeds: result.value.profile.seeds,
          budget: budget.value,
          refine: result.value.refine,
          action,
          shown: result.value.picks.map(p => ({ handle: p.product.handle, price: p.product.price }))
        }
      })
      result.value = res
      trace.value = [...trace.value.filter(t => !t.step.startsWith('Refine')), { step: `Refine: ${action.type.replace('_', ' ')}`, reason: 'Re-ranked with your feedback', detail: `${res.strongMatches} strong matches`, qlooCalls: res.trace.reduce((a, t) => a + t.qlooCalls, 0), cacheHits: res.trace.reduce((a, t) => a + t.cacheHits, 0), ms: res.trace.reduce((a, t) => a + t.ms, 0) }]
    } catch (err) {
      error.value = errorText(err)
    } finally {
      loading.value = null
    }
  }

  async function syncCart(body: { add?: { handle: string; quantity: number }[]; remove?: string[] }) {
    try {
      const res = await $fetch<{ mode: 'demo' | 'shopify'; cart: any }>('/api/cart', { method: 'POST', body: { cartId: cartId.value, ...body } })
      if (res.mode === 'shopify' && res.cart) {
        cartId.value = res.cart.id
        checkoutUrl.value = res.cart.checkoutUrl
        cart.value = res.cart.lines.map((l: any) => ({ handle: l.handle, title: l.title, price: l.price, image: l.image, quantity: l.quantity, lineId: l.id }))
      }
    } catch (err) {
      error.value = errorText(err)
    }
    persistCart()
  }

  async function addToCart(pick: Pick) {
    const existing = cart.value.find(l => l.handle === pick.product.handle)
    if (existing) existing.quantity++
    else cart.value.push({ handle: pick.product.handle, title: pick.product.title, price: pick.product.price, image: pick.product.image, quantity: 1 })
    cartOpen.value = true
    persistCart()
    await syncCart({ add: [{ handle: pick.product.handle, quantity: 1 }] })
  }

  async function removeFromCart(line: CartLine) {
    cart.value = cart.value.filter(l => l.handle !== line.handle)
    persistCart()
    if (line.lineId) await syncCart({ remove: [line.lineId] })
  }

  function reset() {
    result.value = null
    trace.value = []
    agentMessage.value = ''
    error.value = null
  }

  return { mode, seeds, budget, result, agentMessage, trace, loading, error, health, cart, cartId, checkoutUrl, cartOpen, whyHandle, loadHealth, findGifts, askAgent, refine, addToCart, removeFromCart, reset }
}
