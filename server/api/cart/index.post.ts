import { cartAdd, cartCreate, cartGet, cartRemove, shopifyConfigured } from '../../lib/shopify'

export default defineEventHandler(async event => {
  const body = await readBody(event)
  const config = shopifyConfig()
  if (!shopifyConfigured(config)) return { mode: 'demo' as const, cart: null }
  const { products } = await catalogProducts()
  const add = (Array.isArray(body?.add) ? body.add : [])
    .map((l: any) => ({ product: products.find(p => p.handle === l?.handle), quantity: Math.min(10, Math.max(1, Number(l?.quantity) || 1)) }))
    .filter((l: any) => l.product?.variantId)
    .map((l: any) => ({ variantId: l.product.variantId as string, quantity: l.quantity as number }))
  const remove = Array.isArray(body?.remove) ? body.remove.map(String).slice(0, 50) : []
  const cartId = typeof body?.cartId === 'string' ? body.cartId : undefined
  let cart = cartId ? await cartGet(config, cartId) : null
  if (!cart && add.length) cart = await cartCreate(config, add)
  else if (cart && add.length) cart = await cartAdd(config, cart.id, add)
  if (cart && remove.length) cart = await cartRemove(config, cart.id, remove)
  return { mode: 'shopify' as const, cart }
})
