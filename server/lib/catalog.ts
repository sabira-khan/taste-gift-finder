import type { Product, StyleRef } from '../../shared/types'

export interface CatalogEntry {
  handle: string
  title: string
  description: string
  category: string
  price: number
  photo: { url: string; alt: string; photographer: string; photographerUrl: string; sourceUrl: string }
}

export interface ProductTagsFile {
  products: { handle: string; terms: { key: string }[]; similarStyle: { name: string; entityId: string }[]; interests: { id: string; strength: number }[] }[]
}

export function loadLocalCatalog(catalog: CatalogEntry[], tags: ProductTagsFile, currency = 'USD'): Product[] {
  const byHandle = new Map(tags.products.map(p => [p.handle, p]))
  return catalog.map(item => {
    const t = byHandle.get(item.handle)
    if (!t) throw new Error(`no tags for ${item.handle}`)
    const styleRefs: StyleRef[] = t.similarStyle.map(s => ({ name: s.name, entityId: s.entityId }))
    return {
      handle: item.handle,
      title: item.title,
      description: item.description,
      category: item.category,
      price: item.price,
      currency,
      image: item.photo.url,
      imageAlt: item.photo.alt || item.title,
      terms: t.terms.map(x => x.key),
      interests: t.interests.map(i => ({ id: i.id, strength: i.strength })),
      styleRefs,
      photoCredit: {
        photographer: item.photo.photographer,
        photographerUrl: item.photo.photographerUrl,
        sourceUrl: item.photo.sourceUrl
      }
    }
  })
}

export function styleBrandIds(products: Product[]): string[] {
  return [...new Set(products.flatMap(p => p.styleRefs.map(s => s.entityId)))]
}

export function applyShopify(products: Product[], shop: { handle: string; price: number; currency: string; image?: string; imageAlt?: string; variantId: string; available: boolean }[]): Product[] {
  const byHandle = new Map(shop.map(s => [s.handle, s]))
  return products.flatMap(p => {
    const s = byHandle.get(p.handle)
    if (!s || !s.available) return []
    return [{ ...p, price: s.price, currency: s.currency, image: s.image ?? p.image, imageAlt: s.imageAlt ?? p.imageAlt, variantId: s.variantId }]
  })
}
