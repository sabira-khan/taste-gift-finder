# Taste Gifts: a taste-matched gift finder powered by Qloo

Tell us 3 to 5 things someone loves, such as a film, an artist, a show, a brand or a taste like "Arabic coffee". An agent builds a cross-domain taste profile with the Qloo Taste AI API and maps it to real products in a Shopify store. Every pick comes with a one-line explanation traced back to the person's tastes.

Built for the **Qloo Agentic Hackathon**.

- **Live demo:** _link added after deploy_
- **License:** [MIT](LICENSE)

## The problem: cold-start gifting

Recommendation engines need purchase history, and a gift buyer has none for the recipient. All they know is "she loves Fairuz, matcha and old films." Qloo's cultural taste graph links tastes across films, music, books, brands, places and more, so a handful of favourites from *any* domain can be turned into concrete shopping signals. **Without Qloo the app has no profile, no interests, no ranking and no explanation; it cannot produce a single pick.**

## What it does

| Feature | What the shopper sees |
|---|---|
| **Describe them** (agent mode) | Free text like _"gift for my sister, she loves Fairuz, matcha and old films, under $50"_. An LLM agent turns it into Qloo seeds, builds the profile, checks result quality and retries when results are weak. It is capped at 6 tool calls, and every step and its reason appear in the trace strip. |
| **Pick their favourites** (no-LLM mode) | Autocomplete over Qloo entities and tags. The shopper confirms the exact entity, e.g. *Casablanca (1942, film)*, not one of the other films with that name. |
| **Taste map** | Seeds on the left, concrete interests on the right. Line width shows how much each seed drives each interest. It also shows mood, look and lifestyle facets, cross-domain suggestions (films, music, books, TV) and the price comfort zone of brands they gravitate to. |
| **Gift picks** | Up to 5 products. Relevance comes first: if only 3 products are strong matches, the app says "We found 3 strong matches" instead of padding the list with weak ones. |
| **Why this pick** | The matched interests with their Qloo evidence, which seeds drove the pick (from Qloo explainability), shared vibe signals, style-reference brand affinity, how much better the product fits this person than a typical shopper, and the full score breakdown. |
| **Refine** | "More like this", "Not their style" and "Too expensive" re-rank the picks instantly. |
| **Budget and cart** | Budget chips filter the catalog. Add to cart uses the Shopify Storefront API and checks out on Shopify. |
| **Explanations** | An LLM writes one line per pick using only Qloo facts. Any line that does not name a seed and a matched interest is replaced by a deterministic template, so the app works without an LLM key. |

## How Qloo powers each step

| Step | Qloo endpoint and usage | Why it matters |
|---|---|---|
| **1. Resolve seeds** | `GET /search` across movies, TV, artists, books, brands, games, people and podcasts; `GET /v2/tags` for tastes that are not an entity (e.g. `urn:tag:genre:music:lo_fi_hip_hop`, `urn:tag:menu_highlight:qloo:arabic_coffee`) | The shopper confirms the exact entity, and the entity's own Qloo tags ("Shonen anime animation", "Classic cinema", "K-Beauty Movement") become first-hand interest evidence. |
| **2. Tag proxies** | `GET /v2/insights` with `filter.tags=<tag>` finds the most representative entities for a tag seed. For example, Arabic coffee resolves to cafés whose brand insights surface Bateel, Patchi and Rabea Tea. | Tag signals alone give flat brand affinities; proxy entities give them real cross-domain reach. Proxies are only used as hidden signals and are never recommended. |
| **3. Concrete interests** | `GET /v2/insights?filter.type=urn:tag` with `filter.tag.types` for audiences, interests, interest adjacencies, media genres, brand genres and keywords (e.g. "Animation Enthusiasts", "Soccer Enthusiasts", "Jazz Aficionados") | Combined with each seed's domain and own tags, this yields a **two-level interest profile** (e.g. Music > Jazz, Film > Anime, Art > Manga). Every tag is weighted by how distinctive it is against 13 baseline taste profiles, so generic tags such as "Fashion" or "Fiction" don't dominate. |
| **4. Vibe facets** | `GET /v2/insights?filter.type=urn:entity:brand` in 6 gift "lanes" (accessories, apparel, beauty, home, treats, play) using `filter.tags`, with `filter.exclude.tags` for safety | Qloo brand properties such as emotional tone, aesthetic, lifestyle and interest adjacency become mood, look and lifestyle facets, weighted by lift over a 725-brand baseline. The lanes stop a single seed from drifting into banks and telecoms. |
| **5. Seed attribution** | `feature.explainability=true` on the brand-lane and cross-domain insights calls | Each facet and pick knows which seed drove it. That powers the taste map, the "which favourites drove it" bars and the agent's "one seed dominates" check. |
| **6. Cross-domain** | `GET /v2/insights` for movies, artists, books and TV shows | Shown on the taste map as "across culture, they'd also like". |
| **7. Style affinity** | `GET /v2/insights` with `filter.results.entities=<style reference brands>` | Each product names 1 or 2 real reference brands (e.g. Bateel, Muji), and Qloo scores how strongly this taste predicts them. This is capped at 10% of the score and only counts alongside a vibe match. |
| **8. Price comfort** | `price_range_usd_min/max` properties of the affinity-weighted brands | Sets the person's price tier for the price-fit component. |
| **9. Catalog tagging** | A vocabulary built from Qloo property values across 13 diverse seed sets: 1,031 terms, each seen on at least 3 brands in at least 2 sets | Products are tagged with Qloo's own vocabulary and concrete interests at seed time, so matching happens on Qloo signals, never on brand names. |

### Ranking

```
score = 0.55 × interest match   (child-level match = full weight, parent-only match ≤ 0.4)
      + 0.25 × vibe match       (Qloo facets, normalised against a typical shopper)
      + 0.10 × style references (Qloo affinity for the product's reference brands)
      + 0.10 × price fit        (Qloo brand price comfort)
```

A product can only be shown if it has a **specific** interest match of at least 0.35 and a total score of at least 0.45. Diversity is only a tie-breaker between products within 0.02 of each other.

### Safety

Every brand call excludes 16 Qloo tag IDs (alcohol, telecom, financial services, lingerie and others) through `filter.exclude.tags`. A second local check screens names, industries and keywords for alcohol, tobacco, gambling, telecom and utilities, finance and insurance, weapons, adult content and pork. The audience includes GCC shoppers.

### Caching

Every Qloo response is cached by a SHA-256 hash of path plus sorted parameters: on disk in development and in Netlify Blobs in production. Repeated demo runs don't hit rate limits, and the trace strip shows how many calls were served from cache.

## Agent mode

The agent (Anthropic, OpenAI or Gemini, chosen in `.env`) gets five tools that wrap the same pipeline: `search_entities`, `search_tags`, `build_profile`, `recommend` and `refine`. After each `recommend` it receives a quality report covering too few strong matches, one seed dominating the picks, a seed that barely shaped the results, or no strong concrete interest. It is instructed to fix the cause and retry, for example by swapping a seed or trying another domain, within a hard cap of **6 tool calls**. The agent never chooses products itself; the deterministic Qloo-backed matcher does.

## Evaluation

`npm run eval` runs fixed personas through the full pipeline against the catalog and writes `data/eval-results.md`. Every pick must match a concrete interest, or it is marked **FAIL**.

### Tuning personas: 0 FAILs

| Persona | Top picks | Matched interests |
|---|---|---|
| Anime + lo-fi (Spirited Away, Attack on Titan, lo-fi) | Risograph zine pack, Dusk street art print, Manga drawing kit, Kalimba, Over-ear headphones | Illustration, Manga, Anime, Lo-fi, Vinyl & hi-fi |
| Fairuz + Arabic coffee (Fairuz, Arabic coffee, Ziad Rahbani) | Medjool dates box, Brass dallah set, Arabic calligraphy print, Finjan cups, Bakhoor burner | Arabic & Gulf heritage, Coffee |
| Football + gaming (FIFA, Real Madrid, Cristiano Ronaldo) | Tabletop foosball, Leather football, LED light bars, Aerial pitch print, Tactics board | Football, Gaming |
| Classic films + jazz (Casablanca, Miles Davis, Roman Holiday) | Suitcase record player, Waxed canvas weekender, Picture Palace print, Headphones, Walnut speaker | Jazz, Vinyl & hi-fi, Classic cinema, Travel |
| K-drama + skincare (Crash Landing on You, Laneige, Sulwhasoo) | K-beauty sheet masks, Jade roller, Skincare ritual set, Gua sha, Celadon tea set | Beauty & skincare, Korean culture |

Mean interest match 0.89, every seed shapes at least one pick, and cross-persona overlap is 0.01 (each persona gets its own set).

### Before and after the interest layer

The first version ranked by vibe and forced one product per category. A human would have rejected several picks:

| Persona | Before | After |
|---|---|---|
| Anime + lo-fi | …, **Leather football**, **Crewneck** | Manga drawing kit, Dusk street art print, … |
| Fairuz + Arabic coffee | **Gold pendant**, **Leather cardholder**, **Silk sleep set**, … | Dallah set, Finjan cups, Calligraphy print, … |
| Classic films + jazz | **Leather cardholder**, **Botanical prints**, **Chess set**, … | Record player, Picture Palace print, Headphones, … |
| K-drama + skincare | **Leather cardholder**, **Crewneck**, **Botanical prints**, … | Sheet masks, Gua sha, Celadon tea set, … |

Full tables are in [`data/eval-results.md`](data/eval-results.md).

### Held-out personas (never used for tuning)

| Persona | Top picks | Honest read |
|---|---|---|
| Hiking + podcasts (Radiolab, Patagonia, hiking) | Weekender, Cardholder, Scarf, Pendant, Crewneck | The weekender fits. The rest come from Patagonia's fashion signal because the catalog has only one outdoors product, and podcasts are not yet an interest. |
| Bollywood + cooking (Kabhi Khushi Kabhie Gham, A. R. Rahman, Salt Fat Acid Heat) | Dusk street print, Riso zine, Cast iron pot, Botanical prints, Watercolor set | The pot fits. The catalog has no Indian-culture products, so illustration tags from the cookbook dominate. |
| Minimalism + architecture (Tadao Ando, Dieter Rams, Kinfolk) | Linen throw, Scarf, Serving board, Weekender, Dried flowers | Reasonable, but architecture is not yet an interest and the two people seeds add little brand signal. |

All three pass the formal check (0 FAILs), but two would fail a human review. The cause is catalog and taxonomy coverage, not the pipeline: adding outdoors, Indian-culture and architecture products and interests is the next step. Full tables are in [`data/eval-results-holdout.md`](data/eval-results-holdout.md).

## Architecture

```
app.vue, components/          Nuxt 3 + Tailwind UI (mobile first)
server/api/                   Nitro routes: entities/search, recommend, refine, agent, cart, health
server/lib/
  qloo.ts                     Qloo client: retries, error capture, call log, request-hash cache
  seeds.ts                    Seed resolution and tag proxies
  interests.ts                Two-level concrete interest profile from Qloo signals
  profile.ts                  Brand lanes, vibe facets, cross-domain, style affinity, price comfort
  matcher.ts                  Interest-first scoring, relevance threshold, tie-break diversity
  explain.ts                  LLM explanations grounded in Qloo facts, template fallback
  agent.ts                    Tool-calling agent, 6-call cap, quality-driven retries
  pipeline.ts                 Orchestration, trace, quality report, refinement
  llm.ts                      Anthropic / OpenAI / Gemini adapter
  shopify.ts                  Storefront API products and cart
  safety.ts                   Denylist screening
data/                         Vocabulary, interest taxonomy, catalog, product tags, baselines, eval results
scripts/                      Vocabulary build, tagging, photo search, baselines, eval, Shopify seeding
```

## Run it locally

Requires Node 22 (`.nvmrc`).

```bash
npm install
cp .env.example .env    # add your keys, see below
npm run dev             # http://localhost:3000
```

Only `QLOO_API_KEY` is required. Without Shopify keys the app uses the local catalog with a demo cart. Without an LLM key, agent mode is turned off and explanations use the template.

| Variable | Purpose |
|---|---|
| `QLOO_API_KEY`, `QLOO_BASE_URL` | Qloo Taste AI API (`https://hackathon.api.qloo.com`) |
| `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, `SHOPIFY_API_VERSION` | Storefront API for products and cart |
| `SHOPIFY_ADMIN_TOKEN` | Only for `npm run seed:shopify` |
| `LLM_PROVIDER` (`anthropic`, `openai` or `gemini`), `LLM_MODEL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | Agent mode and explanations |
| `UNSPLASH_ACCESS_KEY` | Optional, for `npm run photos` |

### Scripts

| Command | What it does |
|---|---|
| `npm run vocab` | Builds the Qloo property vocabulary from the 13 seed sets |
| `npm run tag` | Validates product descriptors, interests and style-reference brands against Qloo |
| `npm run baseline` | Rebuilds the interest and product baselines (the "typical shopper") |
| `npm run eval` | Runs the persona eval; add `-- --personas personas-holdout.json` for the held-out set |
| `npm run seed:shopify` | Upserts all 70 products into the Shopify dev store and publishes them (`-- --dry-run` to validate) |

### Deploy to Netlify

Connect the repo, set the environment variables above, and deploy. `netlify.toml` builds with the Nitro Netlify preset, and the Qloo cache moves to Netlify Blobs automatically.

## Product photos

All product photos are from [Unsplash](https://unsplash.com) under the [Unsplash License](https://unsplash.com/license). Each photo was checked by hand for logos and brand marks, and products were rewritten where needed to match a clean photo. Credits are also shown on every product card and stored in `data/catalog.json`.

| Product | Photographer | Photo |
|---|---|---|
| 1000-Piece Illustrated Jigsaw | [Nathalia Segato](https://unsplash.com/@trintaycinco) | [Unsplash](https://unsplash.com/photos/red-white-and-gray-jigsaw-puzzle-V9qc-JVKIBo) |
| Aerial Pitch Photo Print | [untldshots](https://unsplash.com/@rajabbarack) | [Unsplash](https://unsplash.com/photos/aerial-view-of-soccer-field-kuViFO5d1UE) |
| Ambient LED Light Bars | [Gavin Phillips](https://unsplash.com/@gavinspavin) | [Unsplash](https://unsplash.com/photos/gaming-setup-with-laptop-keyboard-and-rgb-lighting-Y-05vRRw3ng) |
| Arabic Calligraphy Art Print | [Agnieszka Stankiewicz](https://unsplash.com/@dubai_love_story) | [Unsplash](https://unsplash.com/photos/arabic-calligraphy-on-the-ceiling-of-a-building-MVrgqBB-fqU) |
| Artisan Chocolate Collection | [Jessica Johnston](https://unsplash.com/@jdjohnston) | [Unsplash](https://unsplash.com/photos/chocolate-box-SAlVV13XgTo) |
| Bakhoor Burner and Oud Chips | [Cosmin Ursea](https://unsplash.com/@cosminursea) | [Unsplash](https://unsplash.com/photos/a-smokestack-sitting-in-a-bowl-on-a-table-k0bv_oE34DQ) |
| Botanical Skincare Ritual Set | [Birgith Roosipuu](https://unsplash.com/@msbirgith) | [Unsplash](https://unsplash.com/photos/black-and-orange-bottle-beside-white-round-container-W71jxsXrwyQ) |
| Brass Bedside Reading Lamp | [Nguyễn Hiệp](https://unsplash.com/@hieptltb97) | [Unsplash](https://unsplash.com/photos/a-lamp-that-is-sitting-on-a-table-z8Bu78gaMPA) |
| Brass Dallah Coffee Set | [mostafa mahmoudi](https://unsplash.com/@mostafa_mahmoudi24) | [Unsplash](https://unsplash.com/photos/gold-and-silver-teapot-on-brown-coffee-beans-yHiljmYZrck) |
| Cashmere Blend Scarf | [Maria Kovalets](https://unsplash.com/@marylooo) | [Unsplash](https://unsplash.com/photos/a-pair-of-gray-gloves-sitting-on-top-of-each-other-t-hk95zvjSQ) |
| Cast Iron Tetsubin Teapot | [Christina Spoerer](https://unsplash.com/@christinaspoerer) | [Unsplash](https://unsplash.com/photos/a-black-teapot-sitting-on-top-of-a-wooden-table-uJnKfYG5jxA) |
| Celadon Tea Set | [Ivenory](https://unsplash.com/@ivenory) | [Unsplash](https://unsplash.com/photos/traditional-brown-teapot-and-green-teacups-arranged-on-wood-ofrFmR6uWNw) |
| Ceramic Ramen Bowl Set | [Xavier Chng](https://unsplash.com/@cohesionsingapore) | [Unsplash](https://unsplash.com/photos/a-person-holding-chopsticks-over-a-bowl-of-noodles-qguuVUzsavg) |
| Ceremonial Matcha Starter Kit | [Alice Pasqual](https://unsplash.com/@stri_khedonia) | [Unsplash](https://unsplash.com/photos/filled-clear-drinking-glass-u_8m7fCJQmw) |
| Cinema Marquee Letter Lightbox | [philippe spitalier](https://unsplash.com/@spit) | [Unsplash](https://unsplash.com/photos/a-lit-up-sign-that-says-you-are-here-Mp0-gA2R-X0) |
| Curated Vintage Hardcover Bundle | [Priscilla Du Preez 🇨🇦](https://unsplash.com/@priscilladupreez) | [Unsplash](https://unsplash.com/photos/stack-of-books-on-white-table-FSLWtjqMa0c) |
| Dried Flower Bundle with Bud Vase | [Gaelle Marcel](https://unsplash.com/@gaellemarcel) | [Unsplash](https://unsplash.com/photos/white-flowers-in-brown-glass-bottle-720f6XT65tg) |
| Dusk Street Art Print | [The Walters Art Museum](https://unsplash.com/@thewalters) | [Unsplash](https://unsplash.com/photos/street-scene-at-dusk-with-traditional-japanese-buildings-gjIIkr9-8qc) |
| Embroidered Organic Crewneck | [Moonstarious Project](https://unsplash.com/@moonstariousproject) | [Unsplash](https://unsplash.com/photos/a-stack-of-folded-cloths-with-a-cotton-ball-on-top-wl2TODALiAY) |
| Enamel Cast Iron Pot | [Cooker King](https://unsplash.com/@cookerking) | [Unsplash](https://unsplash.com/photos/orange-plastic-container-on-white-table-hRwSIjkn-LE) |
| Extended Gaming Desk Mat | [Jessica Lam](https://unsplash.com/@lovelle) | [Unsplash](https://unsplash.com/photos/black-computer-keyboard-on-brown-wooden-table-fq-Ks10WtWI) |
| Fig, Cedar and Rain Candle Trio | [No Revisions](https://unsplash.com/@norevisions) | [Unsplash](https://unsplash.com/photos/hand-lighting-candle-in-glass-jar-OAW0OCLn52I) |
| Finjan Coffee Cup Set | [حثل](https://unsplash.com/@e_i9) | [Unsplash](https://unsplash.com/photos/a-man-holding-a-cup-in-his-hand-8DxSIJO1EZ4) |
| Folding Football Tactics Board | [Nguyen Thu Hoai](https://unsplash.com/@thwhoai) | [Unsplash](https://unsplash.com/photos/man-in-blue-crew-neck-t-shirt-standing-on-track-field-during-daytime-v0H-vn0BixI) |
| Fountain Pen Gift Set | [Art Lasovsky](https://unsplash.com/@artlasovsky) | [Unsplash](https://unsplash.com/photos/gold-fountain-pen-on-white-8XddFc6NkBY) |
| Glass Pour-Over Set | [Beau Carpenter](https://unsplash.com/@btcarpenter) | [Unsplash](https://unsplash.com/photos/a-coffee-maker-pouring-coffee-into-a-cup-KGR2u2rG6c4) |
| Gold Vermeil Medallion Pendant | [Carmen Roman](https://unsplash.com/@ccroman) | [Unsplash](https://unsplash.com/photos/a-silver-necklace-with-a-small-medallion-on-it-Uyuz3a-4Vq0) |
| Great Wave Woodblock Print | [The Metropolitan Museum of Art](https://unsplash.com/@metropolitanmuseum) | [Unsplash](https://unsplash.com/photos/wave-and-mount-fuji-in-japan-ZBH-w0cjl6E) |
| Hand-Painted Clay Darbuka | [Margo Evardson](https://unsplash.com/@stadinstudio) | [Unsplash](https://unsplash.com/photos/a-collection-of-traditional-handcrafted-drums-and-decorative-items-qDjyLsqHqN8) |
| Hand-Thrown Matcha Bowl | [Andrea Lacasse](https://unsplash.com/@andrealacasse) | [Unsplash](https://unsplash.com/photos/a-bowl-of-green-liquid-next-to-a-whisk-Jge6KRP6t94) |
| Illustrated Classics Box Set | [Paige Cody](https://unsplash.com/@paige_cody) | [Unsplash](https://unsplash.com/photos/four-assorted-title-books--esAIGzeMqU) |
| Insulated Steel Sports Bottle | [Vanesa Giaconi](https://unsplash.com/@vanesagiaconi) | [Unsplash](https://unsplash.com/photos/white-bottle-on-white-table-Aej5gA11eHQ) |
| Jade Facial Roller Set | [Content Pixie](https://unsplash.com/@contentpixie) | [Unsplash](https://unsplash.com/photos/silver-spoon-and-fork-on-white-surface-0z4h9qneDMA) |
| K-Beauty Sheet Mask Set | [Christian Agbede](https://unsplash.com/@chriscreations__) | [Unsplash](https://unsplash.com/photos/woman-applying-a-sheet-mask-to-her-face-BAPMUZJNyGs) |
| Leather-Bound Journal | [Rich Smith](https://unsplash.com/@richwilliamsmith) | [Unsplash](https://unsplash.com/photos/red-leather-long-wallet-on-white-table-i-ut6Z7qOnc) |
| Linen Reading Journal | [Andres Molina](https://unsplash.com/@nomadicfitlust) | [Unsplash](https://unsplash.com/photos/a-cup-of-coffee-and-a-notebook-on-a-table-8CGOX7oSMbI) |
| Manga Drawing Kit | [pure julia](https://unsplash.com/@purejulia) | [Unsplash](https://unsplash.com/photos/white-printer-paper-with-sketch-of-woman-huceKxh5o3Y) |
| Mini Home Cinema Projector | [Projector1](https://unsplash.com/@projector1) | [Unsplash](https://unsplash.com/photos/a-white-projector-sitting-on-top-of-a-table-TiHLKH9qvEo) |
| Minimal Leather Cardholder | [Konstantin Evdokimov](https://unsplash.com/@constantinevdokimov) | [Unsplash](https://unsplash.com/photos/a-leather-wallet-a-comb-thread-and-scissors-on-a-table-rhP8U-86GZA) |
| Movie Night Popcorn Kit | [personalgraphic.com](https://unsplash.com/@personal_graphic) | [Unsplash](https://unsplash.com/photos/a-yellow-and-white-striped-cup-filled-with-popcorn-CkgqmxCRh5g) |
| Mulberry Silk Sleep Set | [Susan Wilkinson](https://unsplash.com/@susan_wilkinson) | [Unsplash](https://unsplash.com/photos/white-and-gray-floral-bed-linen-WSFIGaEp6JA) |
| Natural Cork Yoga Mat | [Samantha Sheppard](https://unsplash.com/@samsheppardphoto) | [Unsplash](https://unsplash.com/photos/a-yoga-mat-with-two-blocks-on-top-of-it-b8Q5fHBsyik) |
| Oak Floating Book Ledge | [swabdesign](https://unsplash.com/@swabdesign_official) | [Unsplash](https://unsplash.com/photos/books-on-brown-wooden-shelf-BKu77TRA0tY) |
| Picture Palace Art Print | [Liam McGarry](https://unsplash.com/@liammcgarry) | [Unsplash](https://unsplash.com/photos/brown-and-red-theater-interior-4txHVae2MJ0) |
| Pierced Brass Lantern | [Christopher Etchells](https://unsplash.com/@chris_j_etchells) | [Unsplash](https://unsplash.com/photos/black-and-white-floral-lamp-zMaXnvwxa4E) |
| Polyhedral Dice Set with Pouch | [Nika Benedictova](https://unsplash.com/@nika_benedictova) | [Unsplash](https://unsplash.com/photos/a-bag-filled-with-dice-sitting-on-top-of-a-wooden-table-TMZFTJXtorc) |
| Retro Mechanical Keyboard | [Alphacolor](https://unsplash.com/@duck58cth) | [Unsplash](https://unsplash.com/photos/black-computer-keyboard-on-brown-wooden-table-NiZy4dwvbB8) |
| Retro Pixel Art Print | [Vadim Bogulov](https://unsplash.com/@franku84) | [Unsplash](https://unsplash.com/photos/a-group-of-pink-and-white-squares-rP_pS1VMd7c) |
| Risograph Zine and Sticker Pack | [tommao wang](https://unsplash.com/@tommaomaoer) | [Unsplash](https://unsplash.com/photos/a-table-topped-with-notebooks-and-papers-on-top-of-a-wooden-table-hhajZMO_tOg) |
| Rose Quartz Gua Sha | [KARLY VANCUYLENBERG](https://unsplash.com/@karlzmate) | [Unsplash](https://unsplash.com/photos/a-close-up-of-a-knife-and-a-knife-mGKBxiFXieM) |
| Round Hardwood Serving Board | [Sergey Kotenev](https://unsplash.com/@sergeykotenev) | [Unsplash](https://unsplash.com/photos/a-wooden-cutting-board-surrounded-by-various-ingredients-AqEtPR8ahdQ) |
| Sadu-Inspired Woven Cushion | [Juan Burgos](https://unsplash.com/@jphotomedia) | [Unsplash](https://unsplash.com/photos/blue-and-white-throw-pillow-on-brown-wicker-armchair-sGjKjqIJ7Dw) |
| Single-Origin Coffee Flight | [Nadia Valko](https://unsplash.com/@nadiavalko) | [Unsplash](https://unsplash.com/photos/brown-coffee-beans-inside-white-sack-7QlJ79Cj43w) |
| Solid Wood Vinyl Record Crate | [Jonathan Kemper](https://unsplash.com/@jupp) | [Unsplash](https://unsplash.com/photos/a-couple-of-wooden-crates-sitting-on-top-of-a-counter-oy0P04JuhOM) |
| Speckled Stoneware Mug Pair | [Katja Vogt](https://unsplash.com/@folkmade) | [Unsplash](https://unsplash.com/photos/two-white-ceramic-mug-CipURjPCXOo) |
| Stuffed Medjool Dates Box | [Glenov Brankovic](https://unsplash.com/@glenovbrankovic) | [Unsplash](https://unsplash.com/photos/a-group-of-small-wooden-bowls-with-brown-objects-in-them-MdaNz3uaJUI) |
| Suitcase Record Player | [Dorien Monnens](https://unsplash.com/@dorienmonnens) | [Unsplash](https://unsplash.com/photos/vinyl-record-player-on-table-UaSpWm8pTOc) |
| Tabletop Foosball Game | [Kultar Ruprai](https://unsplash.com/@ksruprai) | [Unsplash](https://unsplash.com/photos/a-group-of-people-in-blue-suits-RMPpCjyTZr4) |
| Vegan Makeup Brush Set | [Edz Norton](https://unsplash.com/@edznorton) | [Unsplash](https://unsplash.com/photos/black-and-brown-makeup-brush-set-PEttXYw9hi8) |
| Vintage Botanical Print Set | [Harsh Vardhan Yadav](https://unsplash.com/@_varrdhan) | [Unsplash](https://unsplash.com/photos/botanical-prints-on-green-wall-XV847lPfgA4) |
| Vintage Leather Football | [Bernd 📷 Dittrich](https://unsplash.com/@hdbernd) | [Unsplash](https://unsplash.com/photos/close-up-of-a-vintage-leather-soccer-ball-W5IZKe3bGgM) |
| Walnut Bluetooth Speaker | [Behnam Norouzi](https://unsplash.com/@behy_studio) | [Unsplash](https://unsplash.com/photos/black-and-brown-speaker-ziosREb7628) |
| Walnut and Maple Chess Set | [Leanna Cushman](https://unsplash.com/@leannacushman) | [Unsplash](https://unsplash.com/photos/a-wooden-chess-board-with-black-and-white-chess-pieces-_GF3sgGkSB0) |
| Washed Linen Throw | [Caroline Badran](https://unsplash.com/@___atmos) | [Unsplash](https://unsplash.com/photos/a-neutral-toned-sofa-with-a-textured-vase-Os53eXcWy2I) |
| Washi Tape and Sticker Set | [Madeline Liu](https://unsplash.com/@madeline_sd) | [Unsplash](https://unsplash.com/photos/four-rolls-of-decorative-tape-with-cute-designs-gBgUy1hrx54) |
| Watercolor Travel Set | [Wioleta Zakrzewska](https://unsplash.com/@wiozak) | [Unsplash](https://unsplash.com/photos/person-holding-white-and-green-wooden-chopsticks-BZUo9Tf83HQ) |
| Waxed Canvas Weekender | [Erol Ahmed](https://unsplash.com/@erol) | [Unsplash](https://unsplash.com/photos/brown-duffel-bag-beside-white-and-brown-wooden-chair-9XiN0r2NWSM) |
| Wireless Over-Ear Headphones | [Sebastian Banasiewcz](https://unsplash.com/@kamiseba) | [Unsplash](https://unsplash.com/photos/black-and-white-photo-of-headphones-oXXc-s5nNy8) |
| Wooden Director Clapperboard | [Leuchtturm Entertainment](https://unsplash.com/@leuchtturm_entertainment) | [Unsplash](https://unsplash.com/photos/a-movie-clapper-sitting-on-a-chair-next-to-a-potted-plant-eFbou-gmoKI) |
| Wooden Kalimba Thumb Piano | [Maria Nikolova](https://unsplash.com/@marianikolova) | [Unsplash](https://unsplash.com/photos/a-wooden-cutting-board-with-flowers-on-top-of-it-mSWuIvoe9bc) |
