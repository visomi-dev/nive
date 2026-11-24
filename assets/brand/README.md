# Nive brand assets

Margen is the Nive symbol. The two corners and central block represent a
balance carrying into the next budget period. The color tile pairs forest
and lime, with an inverted palette for the dark favicon. The Manrope Bold
wordmark is outlined for consistent SVG and email rendering.

Astro imports the SVGs from this directory. Angular copies them to each
localized output so the favicon and shared app, auth, and shell logos resolve
under both language prefixes.

The compact isotype and horizontal app logotype use the same knockout tile.
The shared loader masks use the Margen silhouette with the static isotype
for reduced-motion preferences.

`public.json` allowlists the versioned email logo and BIMI artwork under
`/static/brand/`. The version 2 email PNG rasterizes the color logotype
and version 2 BIMI artwork is an unsigned candidate. Version 1 URLs retain
their original files for previously sent email and external references.

The locally served fonts are Manrope and JetBrains Mono. Their SIL Open Font
License notices are in [licenses](../../licenses).
