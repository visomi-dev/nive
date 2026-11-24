# Public website

The Astro website introduces Nive's personal-finance product and provides
getting-started help. Its architecture and component pages document the
underlying Visomi Stack workspace.

## Pages and ownership

The root redirects to `/es/`. The historical `/docs/` URL serves the English
getting-started guide, also available at `/en/help/`. Localized routes include:

| Route after `/en/` or `/es/` | Purpose                                                                   |
| ---------------------------- | ------------------------------------------------------------------------- |
| `/`                          | Product introduction, illustrative budget, privacy, family spaces and FAQ |
| `help/`                      | Getting-started guide and current feature availability                    |
| `architecture/`              | Current runtime boundaries and the intended platform direction            |
| `docs/`                      | Pinned prerequisites, local commands, workspace map and next steps        |
| `foundations/`               | The original typography, color and surface samples                        |
| `ui/`                        | The complete component catalog and framework usage                        |
| `ui/shell/`                  | A standalone application-shell example                                    |

`src/layouts/site.astro` owns navigation and the footer for the developer pages.
`src/layouts/marketing.astro` supplies social metadata and the browser privacy
controls for the product and help pages. Both use the shared base document.

`src/content/site.ts` owns localized route paths. Landing-page navigation links
to sections on the page, and FAQs use native `details`. The homepage shows
`EN` and `ES` with full accessible names. The alternate language uses a native
link, with query and fragment preservation when available. Registration and
sign-in links open the mounted application in the same language.

## Visual and content direction

The product pages use the original Nive layout with shared Manrope, color and
focus styles. The budget preview uses sample amounts in MXN. Both languages
identify budgeting, imports and family spaces as features still in development.

As agreed, the website also illustrates the broader direction: worker execution,
realtime delivery and client-protected content. The architecture page identifies
these as future capabilities and distinguishes them from the current gateway,
Astro site, gateway-mounted Angular SSR application and identity backend.

The product, architecture and getting-started pages load the shared theme and
browser privacy scripts. The component catalog also loads its native demo script.
Scripts remain external for Express CSP compatibility.
Both theme-switcher adapters share CSS keyframes: the incoming icon enters from
below and the outgoing icon leaves above in either direction. Initial theme
restoration does not animate, and reduced-motion preferences disable the cycle.
The product and help pages use the configured public origin for canonical URLs
and localized social preview images.

## Development and checks

```sh
pnpm nx serve web-site
pnpm nx run-many -t build lint typecheck e2e -p web-site
```

The website dev server listens on `127.0.0.1:4200`; production browser checks use
the compiled Astro middleware through Express. The setup guide's Spanish Angular
command selects the existing `development-es` configuration explicitly.

Browser coverage checks SSR HTML, locale navigation, no-JavaScript menu/FAQ
interaction, working internal destinations, theme persistence, native samples,
contrast in the colored panel, reduced motion and layouts from 320px to 1440px.
Screenshots use synthetic content and stay in local Playwright output. These
checks are not a complete screen-reader or WCAG certification.

Framework references: [Astro layouts](https://docs.astro.build/en/basics/layouts/)
and [localized routing](https://docs.astro.build/en/guides/internationalization/).

Shared visual primitives also cover public typography, content containers,
card surfaces, terminal code, native theme selects, labels, avatars, badges and
informational alerts. The same typed options are exposed by the Angular and
Astro adapters. Site compositions own page spacing, responsive grids, branding
and illustration details. Native mobile details/summary and linked cards apply
shared recipes directly to their semantic hosts. See the UI library README for
options and composition examples. This introduces no client-side UI runtime.
