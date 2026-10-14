import { readJson } from './lib/env'

interface CatalogItem {
  handle: string
  title: string
  description: string
  category: string
  price: number
  photo: { url: string; alt: string; photographer: string; sourceUrl: string }
}

interface TagsFile {
  products: { handle: string; terms: { label: string; dimension: string }[]; similarStyle: { name: string; entityId: string }[]; interests: { id: string; label: string; strength: number }[] }[]
}

const domain = process.env.SHOPIFY_STORE_DOMAIN
const token = process.env.SHOPIFY_ADMIN_TOKEN
const version = process.env.SHOPIFY_API_VERSION || '2025-07'
const dryRun = process.argv.includes('--dry-run')
if (!dryRun && (!domain || !token)) {
  console.error('Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN in .env, or run with --dry-run')
  process.exit(1)
}

async function admin<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token! },
      body: JSON.stringify({ query, variables })
    })
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      continue
    }
    const body = (await res.json()) as { data?: T; errors?: unknown }
    if (!res.ok || body.errors) throw new Error(`Admin API ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 400)}`)
    const throttle = (body as any).extensions?.cost?.throttleStatus
    if (throttle && throttle.currentlyAvailable < 200) await new Promise(r => setTimeout(r, 1000))
    return body.data as T
  }
  throw new Error('Admin API kept failing')
}

const catalog = readJson<CatalogItem[]>('catalog.json')
const tags = new Map(readJson<TagsFile>('product-tags.json').products.map(p => [p.handle, p]))

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function shopifyTags(item: CatalogItem) {
  const t = tags.get(item.handle)
  if (!t) throw new Error(`no tags for ${item.handle}`)
  return [
    `cat:${item.category}`,
    ...t.interests.map(i => `interest:${i.id}`),
    ...t.terms.map(term => `${term.dimension}:${slug(term.label)}`)
  ]
}

const PRODUCT_SET = `mutation($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
  productSet(input: $input, identifier: $identifier, synchronous: true) {
    product { id handle }
    userErrors { field message }
  }
}`

async function publicationIds(): Promise<string[]> {
  const data: any = await admin(`{ publications(first: 20) { nodes { id name } } }`)
  return data.publications.nodes.map((p: any) => p.id)
}

const publications = dryRun ? [] : await publicationIds()
let created = 0
for (const item of catalog) {
  const t = tags.get(item.handle)!
  const input = {
    title: item.title,
    handle: item.handle,
    descriptionHtml: `<p>${item.description}</p><p><small>Photo by ${item.photo.photographer} on Unsplash.</small></p>`,
    productType: item.category,
    vendor: 'Taste Gifts',
    status: 'ACTIVE',
    tags: shopifyTags(item),
    productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
    variants: [{ optionValues: [{ optionName: 'Title', name: 'Default Title' }], price: item.price.toFixed(2), inventoryPolicy: 'CONTINUE' }],
    files: [{ originalSource: item.photo.url, contentType: 'IMAGE', alt: item.photo.alt || item.title }],
    metafields: [
      { namespace: 'gf', key: 'similar_style', type: 'list.single_line_text_field', value: JSON.stringify(t.similarStyle.map(s => s.name)) },
      { namespace: 'gf', key: 'interests', type: 'json', value: JSON.stringify(t.interests) },
      { namespace: 'gf', key: 'photo_credit', type: 'single_line_text_field', value: `${item.photo.photographer} | ${item.photo.sourceUrl}` }
    ]
  }
  if (dryRun) {
    if (created === 0) console.log(JSON.stringify(input, null, 2))
    created++
    continue
  }
  const data: any = await admin(PRODUCT_SET, { input, identifier: { handle: item.handle } })
  const errors = data.productSet.userErrors
  if (errors.length) throw new Error(`${item.handle}: ${JSON.stringify(errors)}`)
  const id = data.productSet.product.id
  if (publications.length) {
    const pub: any = await admin(`mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { message } } }`, {
      id,
      input: publications.map(publicationId => ({ publicationId }))
    })
    const pubErrors = pub.publishablePublish.userErrors
    if (pubErrors.length) console.warn(`${item.handle}: publish warning ${JSON.stringify(pubErrors)}`)
  }
  created++
  console.log(`${created}/${catalog.length} ${item.handle}`)
}
console.log(`${dryRun ? 'validated' : 'upserted'} ${created} products${dryRun ? '' : ` and published to ${publications.length} sales channels`}`)
