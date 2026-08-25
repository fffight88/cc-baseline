---
name: DESIGN.md Brand Catalog
description: 68 ready-made brand DESIGN.md files design-director shortlists a greenfield project's direction from, with per-entry lane fit and trademark caution
type: reference
---

## ⚡ Key Rules Summary

- ✅ DO: Use this catalog **only** through design-director's Step 2 shortlist on a **greenfield** project — never to restyle a project that already has a design system
- ✅ DO: Respect the **Lane** column — a `marketing-web` entry's system assumes large imagery and sparse pacing and falls apart under a data table
- ✅ DO: Fetch the file at decision time (`https://getdesign.md/<slug>/design-md`) and copy **concrete token values** into the profile — the profile must stand alone after the URL rots
- ✅ DO: Copy the **system** (scale, density, type voice, token structure), and record the trademark caution in the report when the source is a real consumer brand
- ❌ DON'T: Copy a wordmark, logo, or proprietary typeface file — that is the brand's identity, not its system
- ❌ DON'T: Ship a real brand's trade dress on a commercial product without counsel; internal tools and practice work are the safe uses
- ❌ DON'T: Offer more than 3 candidates, or 3 variants of the same look — vary density, palette temperature, or type voice
- ❌ DON'T: Treat a missing entry as a blocker — the catalog is a shortlist aid, not the only legitimate direction

---

## How to Use

1. design-director classifies the lane (`product-ui` / `marketing-web`) from the product brief.
2. Shortlist **3** entries whose Lane column includes that lane, matching audience and any `vibe_words`.
3. After the user picks one, fetch it:

```
WebFetch https://getdesign.md/<slug>/design-md
prompt: "Extract the full DESIGN.md: color tokens, type scale/families, spacing scale,
radius/shadow, component rules, and the stated rationale for each. Verbatim values, not a summary."
```

4. Copy the extracted values into `.cc-audits/design-profile.md` under `## Design Tokens`, and record source + reason under `## Design Direction`.

> **If the fetch fails**, return `source_unavailable` and re-interview against the remaining candidates. Never invent a design system to cover a failed fetch.

---

## ⚠️ Trademark & Trade Dress

These are the visual systems of **real, live companies**. The upstream collection is published as a design *inspiration* reference.

- **Safe**: internal tools, prototypes, learning, and taking structural lessons (spacing rhythm, type scale, density) into your own palette.
- **Risky**: shipping a commercial product that a reasonable user would mistake for the brand — especially the photography-led consumer and automotive entries, whose identity *is* the look.
- **Never**: the wordmark, the logo, or a licensed typeface binary. Substitute an equivalent with a real fallback stack.

design-director records this caution in its report `notes` whenever a trademark-heavy entry is chosen. The catalog below is a pointer list; cc-baseline vendors none of these files.

---

## Catalog

68 entries · 42 usable for `product-ui` · source: [VoltAgent/awesome-claude-design](https://github.com/VoltAgent/awesome-claude-design) (MIT, index only — the DESIGN.md files are hosted at getdesign.md)

### AI & LLM Platforms

| Slug | Brand | Character | Lane |
|------|-------|-----------|------|
| `claude` | Claude | Anthropic's AI assistant. Warm terracotta accent, clean editorial layout | `marketing-web` |
| `cohere` | Cohere | Enterprise AI platform. Vibrant gradients, data-rich dashboard aesthetic | `product-ui` · `marketing-web` |
| `elevenlabs` | ElevenLabs | AI voice platform. Dark cinematic UI, audio-waveform aesthetics | `marketing-web` |
| `minimax` | Minimax | AI model provider. Bold dark interface with neon accents | `product-ui` · `marketing-web` |
| `mistral.ai` | Mistral AI | Open-weight LLM provider. French-engineered minimalism, purple-toned | `product-ui` · `marketing-web` |
| `ollama` | Ollama | Run LLMs locally. Terminal-first, monochrome simplicity | `product-ui` · `marketing-web` |
| `opencode.ai` | OpenCode AI | AI coding platform. Developer-centric dark theme | `product-ui` · `marketing-web` |
| `replicate` | Replicate | Run ML models via API. Clean white canvas, code-forward | `product-ui` · `marketing-web` |
| `runwayml` | RunwayML | AI video generation. Cinematic dark UI, media-rich layout | `marketing-web` |
| `together.ai` | Together AI | Open-source AI infrastructure. Technical, blueprint-style design | `product-ui` · `marketing-web` |
| `voltagent` | VoltAgent | AI agent framework. Void-black canvas, emerald accent, terminal-native | `product-ui` · `marketing-web` |
| `x.ai` | xAI | Elon Musk's AI lab. Stark monochrome, futuristic minimalism | `product-ui` · `marketing-web` |

### Developer Tools & IDEs

| Slug | Brand | Character | Lane |
|------|-------|-----------|------|
| `cursor` | Cursor | AI-first code editor. Sleek dark interface, gradient accents | `product-ui` · `marketing-web` |
| `expo` | Expo | React Native platform. Dark theme, tight letter-spacing, code-centric | `product-ui` · `marketing-web` |
| `lovable` | Lovable | AI full-stack builder. Playful gradients, friendly dev aesthetic | `product-ui` · `marketing-web` |
| `raycast` | Raycast | Productivity launcher. Sleek dark chrome, vibrant gradient accents | `product-ui` · `marketing-web` |
| `superhuman` | Superhuman | Fast email client. Premium dark UI, keyboard-first, purple glow | `product-ui` · `marketing-web` |
| `vercel` | Vercel | Frontend deployment platform. Black and white precision, Geist font | `product-ui` · `marketing-web` |
| `warp` | Warp | Modern terminal. Dark IDE-like interface, block-based command UI | `product-ui` · `marketing-web` |

### Backend, Database & DevOps

| Slug | Brand | Character | Lane |
|------|-------|-----------|------|
| `clickhouse` | ClickHouse | Fast analytics database. Yellow-accented, technical documentation style | `product-ui` · `marketing-web` |
| `composio` | Composio | Tool integration platform. Modern dark with colorful integration icons | `product-ui` · `marketing-web` |
| `hashicorp` | HashiCorp | Infrastructure automation. Enterprise-clean, black and white | `product-ui` · `marketing-web` |
| `mongodb` | MongoDB | Document database. Green leaf branding, developer documentation focus | `product-ui` · `marketing-web` |
| `posthog` | PostHog | Product analytics. Playful hedgehog branding, developer-friendly dark UI | `product-ui` · `marketing-web` |
| `sanity` | Sanity | Headless CMS. Red accent, content-first editorial layout | `product-ui` · `marketing-web` |
| `sentry` | Sentry | Error monitoring. Dark dashboard, data-dense, pink-purple accent | `product-ui` · `marketing-web` |
| `supabase` | Supabase | Open-source Firebase alternative. Dark emerald theme, code-first | `product-ui` · `marketing-web` |

### Productivity & SaaS

| Slug | Brand | Character | Lane |
|------|-------|-----------|------|
| `cal` | Cal.com | Open-source scheduling. Clean neutral UI, developer-oriented simplicity | `product-ui` · `marketing-web` |
| `intercom` | Intercom | Customer messaging. Friendly blue palette, conversational UI patterns | `product-ui` · `marketing-web` |
| `linear.app` | Linear | Project management for engineers. Ultra-minimal, precise, purple accent | `product-ui` · `marketing-web` |
| `mintlify` | Mintlify | Documentation platform. Clean, green-accented, reading-optimized | `product-ui` · `marketing-web` |
| `notion` | Notion | All-in-one workspace. Warm minimalism, serif headings, soft surfaces | `product-ui` · `marketing-web` |
| `resend` | Resend | Email API for developers. Minimal dark theme, monospace accents | `product-ui` · `marketing-web` |
| `zapier` | Zapier | Automation platform. Warm orange, friendly illustration-driven | `product-ui` · `marketing-web` |

### Design & Creative Tools

| Slug | Brand | Character | Lane |
|------|-------|-----------|------|
| `airtable` | Airtable | Spreadsheet-database hybrid. Colorful, friendly, structured data aesthetic | `product-ui` · `marketing-web` |
| `clay` | Clay | Creative agency. Organic shapes, soft gradients, art-directed layout | `marketing-web` |
| `figma` | Figma | Collaborative design tool. Vibrant multi-color, playful yet professional | `product-ui` · `marketing-web` |
| `framer` | Framer | Website builder. Bold black and blue, motion-first, design-forward | `product-ui` · `marketing-web` |
| `miro` | Miro | Visual collaboration. Bright yellow accent, infinite canvas aesthetic | `product-ui` · `marketing-web` |
| `webflow` | Webflow | Visual web builder. Blue-accented, polished marketing site aesthetic | `product-ui` · `marketing-web` |

### Fintech & Crypto

| Slug | Brand | Character | Lane |
|------|-------|-----------|------|
| `binance` | Binance | Crypto exchange. Bold Binance Yellow on monochrome, trading-floor urgency | `product-ui` · `marketing-web` |
| `coinbase` | Coinbase | Crypto exchange. Clean blue identity, trust-focused, institutional feel | `product-ui` · `marketing-web` |
| `kraken` | Kraken | Crypto trading platform. Purple-accented dark UI, data-dense dashboards | `product-ui` · `marketing-web` |
| `mastercard` | Mastercard | Global payments network. Warm cream canvas, orbital pill shapes, editorial warmth | `marketing-web` |
| `revolut` | Revolut | Digital banking. Sleek dark interface, gradient cards, fintech precision | `product-ui` · `marketing-web` |
| `stripe` | Stripe | Payment infrastructure. Signature purple gradients, weight-300 elegance | `product-ui` · `marketing-web` |
| `wise` | Wise | International money transfer. Bright green accent, friendly and clear | `product-ui` · `marketing-web` |

### E-commerce & Retail

| Slug | Brand | Character | Lane |
|------|-------|-----------|------|
| `airbnb` | Airbnb | Travel marketplace. Warm coral accent, photography-driven, rounded UI | `marketing-web` |
| `meta` | Meta | Tech retail store. Photography-first, binary light/dark surfaces, Meta Blue CTAs | `marketing-web` |
| `nike` | Nike | Athletic retail. Monochrome UI, massive uppercase Futura, full-bleed photography | `marketing-web` |
| `shopify` | Shopify | E-commerce platform. Dark-first cinematic, neon green accent, ultra-light display type | `marketing-web` |

### Media & Consumer Tech

| Slug | Brand | Character | Lane |
|------|-------|-----------|------|
| `apple` | Apple | Consumer electronics. Premium white space, SF Pro, cinematic imagery | `marketing-web` |
| `ibm` | IBM | Enterprise technology. Carbon design system, structured blue palette | `marketing-web` |
| `nvidia` | NVIDIA | GPU computing. Green-black energy, technical power aesthetic | `marketing-web` |
| `pinterest` | Pinterest | Visual discovery platform. Red accent, masonry grid, image-first | `marketing-web` |
| `playstation` | PlayStation | Gaming console retail. Three-surface channel layout, cyan hover-scale interaction | `marketing-web` |
| `spacex` | SpaceX | Space technology. Stark black and white, full-bleed imagery, futuristic | `marketing-web` |
| `spotify` | Spotify | Music streaming. Vibrant green on dark, bold type, album-art-driven | `marketing-web` |
| `theverge` | The Verge | Tech editorial media. Acid-mint and ultraviolet accents, Manuka display type | `marketing-web` |
| `uber` | Uber | Mobility platform. Bold black and white, tight type, urban energy | `marketing-web` |
| `vodafone` | Vodafone | Global telecom brand. Monumental uppercase display, Vodafone Red chapter bands | `marketing-web` |
| `wired` | WIRED | Tech magazine. Paper-white broadsheet density, custom serif, ink-blue links | `marketing-web` |

### Automotive

| Slug | Brand | Character | Lane |
|------|-------|-----------|------|
| `bmw` | BMW | Luxury automotive. Dark premium surfaces, precise German engineering aesthetic | `marketing-web` |
| `bugatti` | Bugatti | Luxury hypercar. Cinema-black canvas, monochrome austerity, monumental display type | `marketing-web` |
| `ferrari` | Ferrari | Luxury automotive. Chiaroscuro black-white editorial, Ferrari Red with extreme sparseness | `marketing-web` |
| `lamborghini` | Lamborghini | Luxury automotive. True black cathedral, gold accent, LamboType custom Neo-Grotesk | `marketing-web` |
| `renault` | Renault | French automotive. Vivid aurora gradients, NouvelR proprietary typeface, zero-radius buttons | `marketing-web` |
| `tesla` | Tesla | Electric vehicles. Radical subtraction, cinematic full-viewport photography, Universal Sans | `marketing-web` |

---

## ✅ Checklist (design-director, Step 2)

- [ ] Lane classified **before** opening this catalog
- [ ] All 3 candidates' Lane column includes the classified lane
- [ ] The 3 are genuinely different directions (density / palette temperature / type voice all vary)
- [ ] `product-ui` shortlist avoided photography-led and luxury-automotive entries
- [ ] Each candidate carries a product-specific `why`, not just the Character line copied over
- [ ] Any supplied `brand_assets` reconcilable with every candidate, and how is stated
- [ ] Trademark caution recorded in `notes` when the chosen entry is a real consumer brand
- [ ] Fetched values copied into the profile as concrete values, never as a link back to getdesign.md
