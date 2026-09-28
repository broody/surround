# Eventide — celestial platform animation layers

Source: `../../concept-art/black-hole-platform-v1.png`, the approved full-frame black-hole terrace concept. Two layer assets were derived with the imagegen skill and built-in image-generation tool (no CLI/API fallback).

## Saved assets

Paths relative to `apps/web/`:

| Asset | Purpose |
| --- | --- |
| `public/assets/eventide/original.png` | Approved 1672×941 scene, unchanged, including loading/error fallback |
| `public/assets/eventide/clean-plate.png` | 1672×941 opaque backing with four detached floating islands removed |
| `public/assets/eventide/islands.png` | 1672×941 RGBA sheet of the four floating islands; native alpha retained |

Generated cutouts are reconstructed versions of the painted islands, not exact recovered pixels. Their source bounds differ from the original, so `EventideScene.tsx` explicitly registers each sprite back to its approved approximate location and size. Source rectangles are (198,412,189,168), (86,500,125,130), (1335,335,260,251), (1321,539,59,78); destination rectangles are (215,453,142,126), (130,507,83,88), (1405,384,188,184), (1375,531,47,65). Only feather-edged patches surrounding those four original silhouettes use the backing plate. Everything else retains the original artwork.

## Composition and motion

- Four actual alpha cutouts drift independently, ±1.5–2.4 pixels horizontally and ±3.5–5.3 pixels vertically, with at most 0.23 degrees of rotation. The larger ledge attached to the left column stays fixed.
- A localized lensing ripple flexes the black-hole edge and bends its nearby light. Two broad travelling waves (roughly 22- and 15-second cycles) combine radial distortion with a small tangential twist, moving texture by less than 8.5 source pixels. The displacement fades smoothly to zero inside a 92-pixel radius and outside 285 pixels around (892,249): the central shadow, distant galaxies, terrace and camera stay anchored. This is stylized lensing, not a physical spacetime simulation.
- A source-color mask isolates amber accretion pixels; travelling illumination bands follow circular lensing arcs and the oblique disk. Their 5–20.5% shadow field is sampled through the same warp as the artwork, so it never adds a broad bright flare or slides independently from the distorted ring.
- Twenty-two short amber filaments orbit along the ring and disk. Their individual pixels are admitted only over the source's existing warm light, keeping them out of the black silhouette and off the architecture. An inverse-map solve registers their displayed positions to the warped artwork.
- Up to 95 existing background stars twinkle on independent 5.5–12.5-second cycles. The disk and lensed ring are excluded from star selection.
- A foreground matte restores the original parapet, posts, floor and framing columns over the drifting scenery. Floor geometry stays completely level and still.
- Five cyan lamps breathe in a slow travelling phase, with small matching broken-pixel floor reflections. A source-derived gold-inlay mask gently varies reflections without repainting floor seams or introducing water ripples.
- Forty-eight small amber/cyan motes rise in gentle curved paths, fading out before wrapping. No new sound, camera shake, zoom, hard flashes or large bloom is added.

The existing shared `SceneCanvas` caps painting at 24 fps, freezes all effects on pause/reduced motion, and stops work in hidden tabs. Star/flow masks and packed lensing coefficients are prepared once; animation shares trigonometric terms across pixels. `eventideLensing.ts` nearest-neighbor resamples only a 571×535 local patch from the cached source pixels, with no per-frame canvas readback and no new assets or dependencies. Transparent areas preserve the fixed center and outside sky. The selected scene is **Eventide platform**; all earlier scenes and the default pavilion remain available, and switching retains the Go position. A 54%-centered cover crop keeps the black hole in view on narrow screens.

## Verification

Ten deterministic tests cover bounded/independent island motion, smooth and bounded illumination, equivalence of the optimized flow equation, sky-only orbital path bounds, star/fixture/reflection brightness, mote determinism/fade, and frozen scene time. Lensing checks additionally verify fixed inner/outer regions, bounded smooth distortion without texture folds, filament registration, actual pixel/illumination resampling, and byte-identical paused raster output. The complete frontend suite has 47 passing tests. The production build passes with the pre-existing bundle-size warning. Browser checks cover asset loading, the full garden and board views at two landscape sizes, pause/resume, and console errors; the new lensing pass is rechecked in the garden view. Final tests use an isolated background preview to avoid changing the user's selected scene.

## Built-in image-generation prompts

Both calls reference `concept-art/black-hole-platform-v1.png`.

### Backing plate

Use case: precise-object-edit
Asset type: registered backing plate for a layered pixel-art game scene.
Input image 1: edit target, a 1672x941 celestial terrace with a black hole.
Remove ONLY the FOUR detached floating stone islands in the space beyond the railing: the medium island at x215..356,y450..578; the tiny lower-left island x128..216,y502..597; the large right island x1400..1592,y379..568; and the tiny lower-right island x1368..1426,y519..597. Include their small towers and rocky undersides. Fill the newly exposed areas with seamless matching dark purple starfield/nebula; where an island obscures the accretion disk, reconstruct the correct uninterrupted amber disk.
Keep the large stone ledge attached to the FAR LEFT framing column at x55..222,y261..495 UNCHANGED. Keep all foreground columns, parapet, cyan lamps, gold inlaid floor and its level geometry, black hole silhouette and disk, stars and galaxies outside the four removal regions unchanged. Do not move the camera or change crop, lighting, colors or scale. Full 1672x941 image, opaque clean backing, not a cutout. No new objects, no text, no extra glare.

### Transparent islands

Use case: background-extraction
Asset type: registered transparent floating-island layer for pixel-art scene animation.
Input image 1: extraction target, the approved 1672x941 celestial terrace.
Extract ONLY the FOUR detached floating stone islands beyond the railing: medium island x215..356,y450..578; tiny lower-left island x128..216,y502..597; large right island x1400..1592,y379..568; tiny lower-right island x1368..1426,y519..597. Include each island's stone platform, little tower, gold trim and dangling rocky underside. Retain their original size, exact position and orientation on a full 1672x941 transparent canvas. Everything except these four islands must have genuinely transparent alpha, including all stars, sky, black hole, accretion light, foreground terrace, railing, columns and the big attached left ledge.
Preserve original crisp pixel texture, amber rim light and dark stone shading. No centering or enlargement, no new details, no glows or background colors stuck around edges, no checkerboard pixels or opaque matte. Output ONE full-frame RGBA layer containing the four original islands at their original locations.
