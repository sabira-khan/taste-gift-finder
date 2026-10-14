export interface ShopifyConfig {
  storeDomain: string
  storefrontToken: string
  apiVersion: string
}

export interface ShopifyProduct {
  handle: string
  title: string
  price: number
  currency: string
  image?: string
  imageAlt?: string
  variantId: string
  available: boolean
  tags: string[]
}

export interface CartLineInput {
  variantId: string
  quantity: number
}

export interface CartSummary {
  id: string
  checkoutUrl: string
  totalQuantity: number
  subtotal: { amount: number; currency: string }
  lines: { id: string; quantity: number; variantId: string; handle: string; title: string; image?: string; price: number }[]
}

export function shopifyConfigured(config: Partial<ShopifyConfig>): config is ShopifyConfig {
  return !!(config.storeDomain && config.storefrontToken && config.apiVersion)
}

async function storefront<T>(config: ShopifyConfig, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://${config.storeDomain}/api/${config.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': config.storefrontToken },
    body: JSON.stringify({ query, variables })
  })
  if (!res.ok) throw new Error(`Shopify Storefront ${res.status}`)
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (body.errors?.length) throw new Error(`Shopify Storefront: ${body.errors.map(e => e.message).join('; ')}`)
  return body.data as T
}

const PRODUCTS_QUERY = `query Products($cursor: String) {
  products(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      handle
      title
      tags
      featuredImage { url altText }
      variants(first: 1) { nodes { id availableForSale price { amount currencyCode } } }
    }
  }
}`

export async function fetchShopifyProducts(config: ShopifyConfig): Promise<ShopifyProduct[]> {
  const out: ShopifyProduct[] = []
  let cursor: string | null = null
  do {
    const data: any = await storefront(config, PRODUCTS_QUERY, { cursor })
    for (const node of data.products.nodes) {
      const variant = node.variants.nodes[0]
      if (!variant) continue
      out.push({
        handle: node.handle,
        title: node.title,
        price: Number(variant.price.amount),
        currency: variant.price.currencyCode,
        image: node.featuredImage?.url,
        imageAlt: node.featuredImage?.altText ?? undefined,
        variantId: variant.id,
        available: variant.availableForSale,
        tags: node.tags
      })
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null
  } while (cursor)
  return out
}

const CART_FIELDS = `
  id
  checkoutUrl
  totalQuantity
  cost { subtotalAmount { amount currencyCode } }
  lines(first: 50) {
    nodes {
      id
      quantity
      merchandise {
        ... on ProductVariant {
          id
          price { amount }
          image { url }
          product { handle title }
        }
      }
    }
  }`

function toCart(cart: any): CartSummary {
  return {
    id: cart.id,
    checkoutUrl: cart.checkoutUrl,
    totalQuantity: cart.totalQuantity,
    subtotal: { amount: Number(cart.cost.subtotalAmount.amount), currency: cart.cost.subtotalAmount.currencyCode },
    lines: cart.lines.nodes.map((l: any) => ({
      id: l.id,
      quantity: l.quantity,
      variantId: l.merchandise.id,
      handle: l.merchandise.product.handle,
      title: l.merchandise.product.title,
      image: l.merchandise.image?.url,
      price: Number(l.merchandise.price.amount)
    }))
  }
}

function userErrors(payload: any) {
  const errors = payload?.userErrors ?? []
  if (errors.length) throw new Error(`Shopify cart: ${errors.map((e: any) => e.message).join('; ')}`)
}

export async function cartCreate(config: ShopifyConfig, lines: CartLineInput[]): Promise<CartSummary> {
  const data: any = await storefront(config, `mutation($lines: [CartLineInput!]) { cartCreate(input: { lines: $lines }) { cart { ${CART_FIELDS} } userErrors { message } } }`, {
    lines: lines.map(l => ({ merchandiseId: l.variantId, quantity: l.quantity }))
  })
  userErrors(data.cartCreate)
  return toCart(data.cartCreate.cart)
}

export async function cartAdd(config: ShopifyConfig, cartId: string, lines: CartLineInput[]): Promise<CartSummary> {
  const data: any = await storefront(config, `mutation($cartId: ID!, $lines: [CartLineInput!]!) { cartLinesAdd(cartId: $cartId, lines: $lines) { cart { ${CART_FIELDS} } userErrors { message } } }`, {
    cartId,
    lines: lines.map(l => ({ merchandiseId: l.variantId, quantity: l.quantity }))
  })
  userErrors(data.cartLinesAdd)
  return toCart(data.cartLinesAdd.cart)
}

export async function cartRemove(config: ShopifyConfig, cartId: string, lineIds: string[]): Promise<CartSummary> {
  const data: any = await storefront(config, `mutation($cartId: ID!, $lineIds: [ID!]!) { cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { ${CART_FIELDS} } userErrors { message } } }`, { cartId, lineIds })
  userErrors(data.cartLinesRemove)
  return toCart(data.cartLinesRemove.cart)
}

export async function cartGet(config: ShopifyConfig, cartId: string): Promise<CartSummary | null> {
  const data: any = await storefront(config, `query($id: ID!) { cart(id: $id) { ${CART_FIELDS} } }`, { id: cartId })
  return data.cart ? toCart(data.cart) : null
}
