Create, refresh or check the project's screen / feature wiki in `docs/wiki/` — the map of what is already built (route, files, components, APIs, states, links between screens) that `/plan` and publisher read before searching the code. Rules and page format: `~/.claude/memory/reference_wiki.md`. The script: `node ~/.claude/scripts/wiki.js` (`check` / `stamp` / `index` / `find`).

Usage: `/wiki init` · `/wiki update [slug…]` · `/wiki check`. No argument → `check`.

## `/wiki init`

1. Read `~/.claude/memory/reference_wiki.md`.
2. If `docs/wiki/` already has pages, stop and suggest `/wiki update` instead.
3. Find the screens: route definitions (router files, `pages/` / `app/` directories, server route tables, HTML entry points). Group screens that share one user flow into features (e.g. order cancel and refund across the order list and order detail screens).
4. Show the draft list to the user before writing anything: screens (slug · route · main file) and features (slug · screens), with the page count. Write only after the user confirms; drop or rename what they ask.
5. Write each page in the format of `reference_wiki.md` §2. Read the files you list — never guess `apis`, `states` or `components`. Use component names from `.cc-audits/design-profile.md` when it exists.
6. `node ~/.claude/scripts/wiki.js stamp --all`, then `node ~/.claude/scripts/wiki.js index`.
7. `node ~/.claude/scripts/wiki.js check --strict` must exit 0. Fix every page it reports, stamp again, re-run.
8. Report: pages written, anything left out and why. Do not commit unless the user asks.

## `/wiki update [slug…]`

1. Targets: the given slugs, or with none, every page `wiki.js check` reports as not `ok`.
2. For each target, re-read its `files` (and the code around them if a file moved or was split), then fix the frontmatter and the body. A `broken` page usually means a renamed file or a missing link target — fix the entry, never delete the line to silence it.
3. `wiki.js stamp <slugs>`, `wiki.js index`, `wiki.js check --strict`.

## `/wiki check`

Run `node ~/.claude/scripts/wiki.js check` and summarize: counts per status, and each page that is not `ok` with its problem. No `docs/wiki/` → say so and suggest `/wiki init` once.
