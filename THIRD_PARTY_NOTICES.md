# Third-party notices

These notices identify bundled third-party material and adaptations. They do not
relicense vendor material (original project code is Apache-2.0 under [LICENSE](LICENSE)),
or establish legal clearance for every dependency, image, font, icon or trademark.
Keep original author names, copyright notices, license text and asset notices
with any redistributed material. The publication scope and remaining reviews are
listed below; attribution alone does not resolve them.

## Retained license texts and provenance

The following files contain unmodified upstream LICENSE bytes, fetched from public
upstream repositories on 2026-10-03. Retrieval was for attribution evidence, not
publication. Revisions are pinned so the source text can be checked independently.

| Material | Retained text | Public source revision / LICENSE |
|---|---|---|
| OpenDesign | [Apache License 2.0](third-party-licenses/OpenDesign-Apache-2.0.txt), including `Copyright 2026 Open Design contributors` | [nexu-io/open-design, 53231d40b778d88eba23f35547bf99485d3ae9fc](https://github.com/nexu-io/open-design/blob/53231d40b778d88eba23f35547bf99485d3ae9fc/LICENSE) |
| refero_skill | [MIT](third-party-licenses/Refero-MIT.txt), `Copyright (c) 2026 Refero` | [referodesign/refero_skill, a9b54a3e62a6391f5f5ab7a20e4ddb32fb79a27d](https://github.com/referodesign/refero_skill/blob/a9b54a3e62a6391f5f5ab7a20e4ddb32fb79a27d/LICENSE) |
| daisyUI skill documentation | [MIT](third-party-licenses/daisyUI-MIT.txt), `Copyright (c) 2020 Pouya Saadeghi` | [saadeghi/daisyui, 9adbeaa259816be46b98bf497a09cd2ab127e3cf](https://github.com/saadeghi/daisyui/blob/9adbeaa259816be46b98bf497a09cd2ab127e3cf/LICENSE) |

OpenDesign's public recursive tree at the pinned craft revision contains no file
named NOTICE. This is a scoped observation, not a claim about all versions or
nested third-party licenses. Preserve relevant source notices and include any
applicable upstream NOTICE discovered when the shipped scope is finalized.
The Refero and daisyUI revisions identify the license copies retrieved here;
they are not asserted to be the original import revisions.

## Design-system presets

The style families of the design-system presets in
`apps/api/src/modules/design-system/presets.ts` (Minimal, Editorial, Brutalist,
Material-style, Enterprise and the others) are adapted from the generic
packages of **OpenDesign** — <https://github.com/nexu-io/open-design>
(`design-systems/`), licensed under the Apache License 2.0. The token values
were rewritten to meet WCAG AA contrast and a dark mode was added to each; no
brand-named packages are included.

## Design-system package, directions and craft (open-design)

The design-system package format — the 56-token contract and its layers
(`apps/api/src/modules/design-system/od-tokens.ts`), the DESIGN.md / USAGE.md
structure (`od-package.ts`), the importer's token-confidence grading
(`od-confidence.ts`) and the five visual directions with their palettes, fonts
and posture rules (`directions.ts`) — is adopted from **OpenDesign**
(<https://github.com/nexu-io/open-design>, `packages/contracts/src/design-systems/`,
`packages/contracts/src/prompts/directions.ts`, `apps/daemon/src/design-systems/`),
licensed under the Apache License 2.0. Palettes were converted from OKLch to hex,
completed to our 13 colour roles and given a dark mode that meets WCAG AA.

The craft references bundled in `apps/api/src/modules/design-system/craft-texts.ts`
(typography, color, anti-ai-slop, accessibility-baseline, state-coverage,
form-validation, laws-of-ux, animation-discipline, typography-hierarchy) are
copied verbatim from OpenDesign's `craft/` directory at commit
`53231d40b778d88eba23f35547bf99485d3ae9fc` (Apache License 2.0). All nine
bundled text values were compared with the public source files and match exactly.
OpenDesign is the primary upstream for these copies; they are not direct verbatim
copies of Refero. The typography, color and anti-ai-slop files in turn adapt
**refero_skill** (<https://github.com/referodesign/refero_skill>, MIT), as their
retained inline attribution states. That MIT source layer does not replace the
Apache license on OpenDesign's craft adaptations. Both license texts are retained
above. The package, preset and UI-reference adaptations described here are local
changes, distinct from the verbatim craft text; source headers remain in place.

## UI-reference seed templates and lint rules (open-design)

The UI-reference generator in open-design style adapts **OpenDesign**
(<https://github.com/nexu-io/open-design>, Apache License 2.0):

- the seed templates in `apps/api/src/modules/ux/ux-od-seeds.ts` (web-app,
  dashboard, android-app, wireframe) — the class system and the "do not invent
  new global classes" contract of `design-templates/web-prototype`, the layout
  primitives of `task-profiles/prototype/layout.css`, the mobile and Android
  handheld shells, and the dashboard and wireframe-greybox skills — rewritten
  for product UI and bound to the 56-token contract;
- the screen charter in `packages/ai/src/prompts/ux-od.ts` (after
  `apps/daemon/src/prompts/core-slim.ts`) and its prompt layer order;
- the lint rules in `apps/api/src/modules/ux/ux-od-lint.ts` (after its
  lint-artifact and anti-ai-slop checks: purple and trust gradients, the
  AI-default indigo, emoji icons, left-accent cards, sans display type,
  invented metrics, filler copy, untracked capitals, external images, raw hex
  count, accent overuse, missing section anchors).

## Component-library theme formats

The theme files generated for shadcn/ui, daisyUI, Bootstrap, MUI / Material 3,
Ant Design, Flowbite and Pico CSS follow each project's public theming
documentation. This theme-export mechanism does not itself bundle those
libraries; generated files are for projects that install them under the licenses
of their chosen versions. This is not a blanket license statement about the
separately bundled UI-reference assets or documentation. "Material" is a Google
trademark; the Material-style preset is not an official Google theme.

## Bundled daisyUI skill documentation

`.agents/skills/daisyui/` and `.claude/skills/daisyui/` contain daisyUI skill
instructions and component documentation. Their main SKILL.md metadata identifies
<https://daisyui.com/SKILL.md>; `skills-lock.json` identifies `saadeghi/daisyui`,
`skills/daisyui/SKILL.md`, and a computed content hash (not a Git revision).
The upstream MIT license and original copyright holder are retained above.
These are bundled documentation copies, not merely an external dependency.
The exact imported revision and any local differences remain to be recorded;
this notice does not claim the copies are verified verbatim.

## Bundled UI-reference templates and vendor assets

The source-by-source inventory is in [Referensi UI/README.md](Referensi%20UI/README.md)
and existing license texts are in [Referensi UI/LICENSES/](Referensi%20UI/LICENSES/)
and the vendor folders. Most top-level template licenses in that archive are MIT;
that does not make every bundled asset MIT. For example:

- **Preline UI**, by **Preline Labs Ltd.**, from
  <https://github.com/htmlstreamofficial/preline>: both
  `Referensi UI/preline/LICENSE` and `Referensi UI/LICENSES/Preline-MIT.txt`
  retain the MIT text **and the additional Preline UI Fair Use License**.
  The legacy archive filename is not a statement that only MIT applies. Section
  3 expressly adds redistribution conditions: retain both licenses, do not remove
  or alter licensing information, and give clear attribution with the original
  repository link. Sections 1–2 also address competing products, misuse and
  commercial derivative works, including distinguishing original from derivative
  work. Preline is the original vendor; this repository's collection and layout
  processing are not an official Preline product. Do not describe these terms
  as a confirmed choice to ignore Fair Use and use MIT alone.
- **Font Awesome Free** has code MIT, icons CC BY 4.0, and fonts SIL OFL 1.1,
  as retained in
  `Referensi UI/startbootstrap/sb-admin-2/vendor/fontawesome-free/LICENSE.txt`.
  Preserve embedded attribution and the vendor's trademark notice.
- **Roboto** has an Apache License 2.0 text already retained in
  `Referensi UI/staradmin/src/assets/fonts/Roboto/LICENSE.txt`.
- Preserve differing original notices rather than normalizing them: for example,
  Sneat's `LICENSE.md` names ThemeSelection with 2021, whereas `LICENSE` and the
  central archive name ThemeSelection with 2022. Resolve version provenance
  before distribution, without deleting either notice.

### Asset-only publication separation (2026-10-04)

The full publication collection at `cb049a4` (6,099 files, 205,454,391 bytes) was copied into the owner-local sibling `../SPECLINE VENDOR ARCHIVE cb049a4/` and every SHA256 verified before removing public build sources. Archive inventory SHA256: `ab729accd50c3690322838435161da49bc5036311625866c40b4ca1b9f17f0f9`. The independent `NEW SPEC KIT/Referensi UI` original was never changed. This publication no longer contains vendor package manifests, lockfiles, source build graphs or executable JavaScript. The tracked bundle retains 1,506 original files (all 393 HTML pages, linked visual assets and original notices); 4,593 archived files are omitted. Public curation removes scripts/handlers/active embeds, and six Tailwind CDN pages receive statically compiled Tailwind 3.4.19 CSS with attribution comments, not evaluated vendor configuration. These are modified reference copies, not verbatim runnable upstream applications.

`Referensi UI/asset-inventory.json` records distributed/source SHA256 hashes, archive digest and unresolved/external references. Original license/NOTICE files remain byte-identical. Central texts for excluded sources are historical licensing evidence only, not redistributed source assets. Upstream version/build provenance remains incomplete; byte hashes establish local preservation, not exact upstream identity. Font/image/icon/trademark/CDN clearance gaps below remain. No blanket MIT claim or claim that all 415 historical dependency alerts were individually remediated/dismissed is made. Full sources can be restored from the verified archive into a new owner-local directory outside the publication; see the collection README. Vendor demo interactions/charts are not shipped as live functionality.

### Local vendor publication-hygiene modifications (2026-10-03)

- In 25 HTML files under `Referensi UI/material-kit/`, the bundled Google Maps
  API-key literal was replaced with `YOUR_GOOGLE_MAPS_API_KEY`. The original
  Google Maps script URLs and template structure are otherwise unchanged. Supply
  an appropriately restricted key before enabling these demo integrations.
- In the StarAdmin iconfont package metadata for `flag-icon-css`, `font-awesome`,
  `ionicons`, `mdi` and `puse-icons-feather`, only the npm-generated `_args` and
  `_where` fields containing an upstream machine-local installation path were
  removed. Package dependencies, versions, integrity values, author attribution
  and license metadata are unchanged.

These are local modifications, not verbatim upstream copies. Original vendor
copyright headers and license files remain unchanged; no relicensing is implied.

## Publication decisions and remaining evidence gaps

The owner approved Apache-2.0 for original project code and exclusion of Preline
from the first public package on 2026-10-03. The conservative package scope also
excludes **Tabler and TailAdmin** pending nested-vendor review, and **all generated previews**.
In the original NEW SPEC KIT source, local originals remain in the original reference paths; this publication's complete collection is preserved in the external sibling archive described above. Git/Docker exclusions keep
routine publication/build contexts scoped; catalog discovery, curated entries,
file reads, CSS evidence and preview serving exclude these vendor paths.
This is a reversible packaging decision, not a finding that redistribution is
forbidden, that GPL software cannot be used, or that Tabler's own MIT license is invalid.

### Collection review evidence (2026-10-03)

All 19 central license files and the collection's named nested LICENSE/license
files were read locally. Each of the 18 documented template sources has a retained
top-level license: 17 MIT texts and Preline's MIT plus Fair Use text. Flowbite has
an additional MIT notice in the central archive. These are license-text observations,
not exact-version or exhaustive asset clearance. Retain the original files unchanged.

| Scope | Evidence and first-package treatment |
|---|---|
| Preline | Excluded: MIT plus additional Fair Use terms; later inclusion needs product/redistribution review. |
| Tabler | Excluded: `tabler/dist/libs/apexcharts/LICENSE` has revenue, competition and OEM redistribution conditions; `tabler/dist/libs/typed.js/LICENSE.txt` identifies GPL-3.0-or-later. Required permissions/compliance and exact bundle provenance have not been established. |
| AdminLTE, CoreUI, KWD Dashboard | Central MIT texts retained; built assets have incomplete nested-license/build provenance. Candidate review still required. |
| BulmaTemplates, CoolAdmin, Landwind, Material Kit, Materio, Sneat, StarAdmin, TailGrids Play, tailwind-landing-page, tailwindcss-templates | MIT source texts retained centrally and in source folders. Nested/demo/image/font rights not exhaustively verified. Sneat's differing notice years remain preserved. |
| StartBootstrap | Central MIT and SB Admin 2 source notice retained; other template versions and per-template provenance remain to be verified. Font Awesome Free has separate code/icon/font terms. |
| Tailwind Toolbox | Central MIT and all four local subtemplate MIT notices retained, including differing 2018/2019 years. |
| TailAdmin | Excluded: `tailadmin/bundle.js` identifies ApexCharts v7.3.0, copyright 2018–2026; matching full vendor license/redistribution evidence is not retained. Its top-level MIT text does not clear that embedded library. |
| Previews | Entire generated preview directory excluded; no screenshot/depicted-asset clearance claim. |

Nested retained notices also include StarAdmin's Roboto (Apache-2.0), flag-icon-css
and Ionicons (MIT), and Material Design Icons (SIL OFL 1.1 with reserved font name
and Google attribution). Tabler's other named vendor licenses include MIT texts
and Tom Select Apache-2.0; they remain with the excluded local copy. In other
sources, Sneat/Materio ApexCharts banners identify v4.2.0 MIT, KWD v4.3.0 MIT,
and Material Kit Typed.js identifies v2.0.17 MIT. Do not apply Tabler's different
vendor-license files to those versions; equally, a short banner is not a complete
nested-license audit. TailAdmin's v7.3.0 chart terms/provenance remain unverified, so its local source is excluded rather than assumed cleared.

No non-excluded source was observed linking to local Preline or Tabler assets in
the scoped reference scan. Dynamic additions and cross-source references still
require review before redistribution. An archive of the entire local working tree
would bypass these exclusions and is not an approved public package.

Before any later Preline inclusion, evaluate its competing-product and
commercial-derivative conditions against product packaging/marketing and obtain
vendor clarification or legal review where needed. Attribution alone is not clearance.

Before publishing the chosen scope, record source versions/build provenance
(including each StartBootstrap template, Tabler npm assets versus scraped preview
HTML/static images, and dynamic additions), check applicable nested licenses and
NOTICE obligations, and review images, fonts, icons, demo content, brand marks,
CDN resources and previews separately. Browser-render verification and stripping
HTML into a layout brief are technical behavior, not evidence of asset clearance.
Carry the retained license texts, relevant notices and modification indications
with redistributed Apache material and preserve MIT notices for copied portions.
The craft revision is verified above; other OpenDesign adaptation revisions,
the historical Refero revision, and the imported skill revision remain unpinned.
These notices are a scoped attribution cleanup, not an exhaustive dependency or
asset-license audit. The original-code root license is now owner-approved Apache-2.0; upstream obligations and remaining clearance gaps are unchanged.
