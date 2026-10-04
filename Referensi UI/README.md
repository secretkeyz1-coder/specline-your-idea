# UI reference assets — not vendor applications

This tracked collection contains script-free HTML, linked CSS, fonts, icons and images, and unchanged original license/NOTICE files. It preserves the 15 published source roots, all 393 HTML pages and the 294-page application catalogue from publication revision `cb049a4`. Component demos remain files but are not all offered in the gallery. It is not an HTML-only copy: local stylesheet dependencies, CSS imports and image/font URLs are retained at their original relative paths.

The complete local publication collection was copied and SHA256-verified **before replacement** into the dedicated sibling archive `../SPECLINE VENDOR ARCHIVE cb049a4/Referensi UI`. Its `inventory.sha256.json` covers 6,099 files / 205,454,391 bytes, including build sources, manifests, locks and scripts. Inventory SHA256: `ab729accd50c3690322838435161da49bc5036311625866c40b4ca1b9f17f0f9`. The independent original `../NEW SPEC KIT/Referensi UI` was never modified. The sibling archive is owner-local, not part of Git or a Docker context.

`asset-inventory.json` records each distributed file's SHA256, pre-curation SHA256, source revision, archive inventory digest, external references and unresolved local links. It is evidence of local bytes, **not** a claim of exact upstream version or legal clearance. 1,506 archived files are retained; 4,593 files are removed from this public tree. This README and the inventory are packaging metadata.

## Rebuild and restore

From the repository root, with the verified local archive available:

```bash
bun apps/web/scripts/curate-ui-references.ts "../SPECLINE VENDOR ARCHIVE cb049a4" "../references-new"
```

The output must not exist. Curation verifies every archive hash first, never installs/executes vendor tooling, and writes deterministic output. Review its inventory and tests before replacing this collection. To restore the full local sources, copy the archived `Referensi UI` to a **new directory outside this repository**, then compare every byte hash with the archive inventory. Do not restore the full tree into the published collection or overwrite the original NEW SPEC KIT source.

Six Tailwind CDN-dependent pages have static CSS compiled using the pinned Tailwind 3 compiler from literal class evidence and their literal sans font list; their vendor scripts/config are not evaluated. Preserve generated CSS attribution comments. Other scripts, event handlers, active embeds, navigation metadata and preload scripts are removed. Screenshot generation additionally disables browser JavaScript and applies a no-script CSP. Demo charts drawn on canvas, toggles, menus, sliders and other script-generated content are not live features of this reference-only bundle; screenshots are not promised pixel-identical to runnable originals. Existing external CSS/fonts/images still need internet; broken upstream/local links are recorded rather than silently claimed repaired.

The application displays optional PNG screenshots, not live vendor pages. Generated `previews/` remains excluded from publication. See [gallery guide](../docs/32_UI_TEMPLATE_GALLERY.md) for analysis/adaptation and preview commands.

## Sources and licenses

Preserved source roots: AdminLTE, CoreUI, Sneat, Materio, KWD Dashboard, CoolAdmin, StarAdmin, StartBootstrap, BulmaTemplates, Tailwind Toolbox, Landwind, Material Kit, TailGrids Play, tailwind-landing-page and tailwindcss-templates. Original top-level/nested license texts and all central `LICENSES/` texts remain unchanged, including historical evidence for excluded sources. **Preline, Tabler and TailAdmin remain excluded**; their central license evidence does not include their assets or authorize redistribution.

Most template-level texts are MIT, but this is not blanket MIT licensing: Font Awesome Free uses MIT/CC BY 4.0/SIL OFL, Roboto has Apache-2.0, and other fonts/icons/images may have separate obligations. Differing Sneat notices are preserved. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for upstream attribution and remaining version, nested-license, image, trademark and CDN review gaps. Security curation does not confer asset clearance or fix every historical advisory.
