# Nive brand assets

The artwork in this directory was drawn for Nive using the ascending N and
mineral, forest, and mint palette of its visual identity. The horizontal
logotype and compact isotype remain readable with the shared theme treatment.

Astro imports the SVGs from this directory. Angular copies them to each
localized output so the favicon and shared app, auth, and shell logos resolve
under both language prefixes.

The loader has static and animated SVG sources. The existing shared CSS utility
uses the animated asset as a mask and selects the static isotype for
reduced-motion preferences.

`public.json` allowlists the versioned email logo and BIMI artwork under
`/static/brand/`. The email PNG rasterizes the logotype. The BIMI SVG preserves
the existing validation contract for its format and contains no certificate.

The locally served fonts are Manrope and JetBrains Mono. Their SIL Open Font
License notices are in [licenses](../../licenses).
