# DESIGN.md preview pages — maintainer notes

`templates/design-previews/` holds one page per entry in `templates/memory/reference_design_md_index.md`, plus `index.html`, a gallery of all of them. The installer copies the folder to `~/.claude/design-previews/`, and `~/.claude/scripts/design-preview.js` serves it on `127.0.0.1` during the design-director interview.

Each page is built from that brand's DESIGN.md at the catalog's pinned commit (`3b605329`): its own signature components, layout rules and Do's/Don'ts, with the token values copied verbatim. Fonts are open-source substitutes, imagery is drawn with CSS/SVG, and every page ends with a neutral "DESIGN.md preview · not affiliated" footer. Pages are self-contained single HTML files; the only external request is Google Fonts.

## When to rebuild

- A page was added or edited → rebuild the gallery so its thumbnail matches.
- A catalog row changed (brand, one-liner, category, lane) → rebuild the gallery; it reads those fields from the catalog.
- The catalog's pinned commit was bumped → rebuild the affected pages first.

## Rebuild the gallery

```bash
npm i --no-save playwright && npx playwright install chromium
node tools/design-previews/thumbs.js        # writes tools/design-previews/.thumbs/*.jpg
node tools/design-previews/build-index.js   # writes templates/design-previews/index.html
```

Thumbnails are embedded in `index.html` as data URIs because the installer copies templates as UTF-8 text and cannot carry binary files. `.thumbs/` is not committed.

`npm test` checks that every catalog slug has a page and every page has a catalog row.
