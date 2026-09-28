# Fuji morning — animated pine terrace

Source: `../../concept-art/mount-fuji-terrace-v2.png`, the approved Mount Fuji scene with Japanese black pines (not the earlier cherry-blossom version).

## Saved assets

Images are loaded by `src/scene/FujiScene.tsx`. All are 1672×941 except the far cloud cutout, which is 1671×941 and registered at runtime.

| Workspace path | Purpose |
| --- | --- |
| [original.png](public/assets/fuji/original.png) | Approved concept, unchanged; also the loading/error fallback |
| [clean-plate.png](public/assets/fuji/clean-plate.png) | Built-in imagegen backing with foreground pines and three high cloud wisps removed |
| [pines.png](public/assets/fuji/pines.png) | Built-in imagegen foreground pine cutouts with native RGBA transparency preserved |
| [cloud-free-plate.png](public/assets/fuji/cloud-free-plate.png) | Built-in imagegen clear sky and reconstructed cloud-covered lower mountain slopes |
| [clouds-far.png](public/assets/fuji/clouds-far.png) | Native-alpha distant banks, composited behind the fixed skyline |
| [clouds-near.png](public/assets/fuji/clouds-near.png) | Native-alpha broken cloud bank crossing the lower slopes |

Generated cutouts are reconstructed versions of the painted trees and clouds, not exact recovered pixels. The generated originals are preserved; crops, registration and masks are applied only by the runtime canvas. No CLI/API fallback, image post-processing script, or new dependency was used. The distant white birds are code-drawn pixel silhouettes and need no additional bitmap assets.

## Composition

- Start with the approved original. Reveal the tree-free backing in feathered tree-removal patches; retain the shore and reflection. Replace the sky and mountain with the registered cloud-free plate, blending into the unchanged valley between y380 and y410. Formerly cloud-covered slopes are reconstructed; the mountain itself never moves.
- Crop the rear cutout at (0,100,1671,390), then register it at (-60,60,1792,310), with overscan at both sides. A skyline mask derived once from the cloud-free plate restores Fuji and the foothills in front of this bank. Its slow continuous drift is bounded to ±36 pixels horizontally and ±1.1 vertically.
- Crop the front cutout at (300,282,1235,137), then register it at (376,276,1050,103). This thin bank passes across the lower slopes with ±52-pixel horizontal and ±1.8-pixel vertical drift. It never reaches the snow cap. Both cloud banks have different speeds and no wrapping seam.
- Also retain the three original pale high-sky wisps with a runtime color/position mask. Their horizontal travel is bounded to ±18/22/26 source pixels, on different roughly three-to-four-minute cycles, with less than 1.5 pixels of vertical drift. They are behind the same stationary mountain mask.
- Small white birds fly individually, in front of the distant mountain and behind the foreground pines. Two independent flight paths have different heights, opposite directions and staggered starts, so at most two birds are present, and most occupied-sky time shows just one. In a 142-second cycle, the first crossing lasts 64 seconds; the second starts 45 seconds later and lasts 56 seconds, leaving a quiet gap after both leave. Independently phased wingbeats alternate with gliding. Entry, exit and loop resets are offscreen and fade to zero. The first bird starts partway through its crossing so it is visible soon after selecting the scene.
- Split the RGBA tree sheet into four registered branch regions: upper-left (0,0,715,322), lower-left (0,322,350,438), upper-right (1260,0,412,370), lower-right (1530,562,142,198). Bend 8-pixel strips with two overlapping breeze frequencies and independent phases. The displacement grows quadratically from each fixed outer-edge attachment to the tips, with maximum amplitudes of 5.2/3.4/4.2/2.2 pixels.
- Animate the existing lake pixels only between y476 and y629. Two-pixel horizontal strips shift by less than 2.25 pixels with smooth fade-out at both edges, keeping shore geometry and railing posts stationary. Warm painted reflection pixels shimmer with the same strip displacement; no broad white light overlay is added.
- Restore the original railing, posts and deck in front of the moving pine cutouts. The floor, mountain and camera never pan, tilt or pulse.
- Thirty-two small warm pixel motes drift near the pines. They fade to zero before their loops reset; there are no blossoms or falling pink petals.

Shared `SceneCanvas` caps painting at 24 fps, pauses for hidden tabs, honors reduced-motion preference and freezes without resetting scene time. All effects use that shared time. Masks and image data are prepared once; per-frame painting uses canvas draw calls without pixel readback. The 52%-centered cover crop keeps Fuji's summit in view on narrow screens.

## Integration and checks

Choose **The gardens → Fuji morning** on the landing page, or select it in the footer. The scene is added alongside all seven earlier environments without changing the default pavilion. The separately developed `StudyPage` lesson layout and routing are left untouched.

Eight deterministic tests cover anchored/bounded pine motion, continuous cloud travel at both depths, independent bird crossings and wing poses, single-bird/occasional-two timing, quiet gaps and invisible flight resets, lake-edge confinement and glint levels, reproducible motes, and frozen shared scene time. The complete frontend suite passes 62 tests. Production build passes with the existing large-chunk warning. Browser checks include scene loading, transparent cutout composition, bird visibility, motion/pause/resume and console errors.

## Exact built-in imagegen prompts

The first two calls used `concept-art/mount-fuji-terrace-v2.png` as the edit target. The three cloud calls used `public/assets/fuji/clean-plate.png`. Generated PNGs were copied into the workspace, preserving their originals under the imagegen output directory.

### Clean plate

Use case: precise-object-edit
Asset type: registered clean backing plate for a layered pixel-art game scene.
Input image 1: edit target, the 1672x941 Mount Fuji terrace.
Remove ONLY the foreground pine trees framing the far left side and upper-left corner, upper-right corner and far right side. Fill behind them with matching uninterrupted blue sky, clouds, foothills or lake as appropriate. Also remove ONLY the three detached thin pale cloud wisps in the otherwise blue upper sky: around x355..500,y168..196; x954..1380,y110..166; x1280..1520,y167..213. Fill those three small regions with matching blue sky. Keep all other clouds, including the cloud banks around Fuji and the mist in the hills.
Preserve the snow-covered Mount Fuji exactly, its silhouette and position, the lake and reflections, distant shore trees and houses, and ALL foreground railing, posts, level wooden floor, floor shadows and perspective. Do not remove distant shoreline pines. Preserve original colors, lighting, pixel texture and composition everywhere outside the removal areas. Full-frame opaque 1672x941 image, no crop or zoom, no new objects, no text.

### Pine cutouts

Use case: background-extraction
Asset type: full-frame transparent pine foreground layer for pixel-art animation.
Input image 1: extraction target, the 1672x941 Mount Fuji terrace.
Extract ONLY the foreground Japanese black pine trees framing the left edge and upper-left corner, upper-right corner and far right edge. Include the rugged trunk, branches and every green needle cluster. Preserve their exact original positions, scale, colors, pixel-art texture and lighting on a full 1672x941 canvas. The left pine occupies roughly x0..695,y0..710; the right pine occupies x1290..1672,y0..335 and x1555..1672,y580..710. Reconstruct the small parts of these foreground pine branches concealed by the terrace railing so that trees form a continuous cutout behind the railing.
Everything else must be genuinely transparent alpha: no sky, no clouds, no Fuji, no lake, no distant shore trees or houses, no railing or posts, no wooden deck. No blue fringes, no opaque backdrop, no checkerboard pixels. Do not reposition, center, enlarge or crop the trees. Output one full-frame RGBA transparent image, not a sprite sheet of separately centered trees.

### Cloud clear

Use case: precise-object-edit
Asset type: cloud-free registered backing plate for a layered pixel-art scene.
Input image 1: edit target, the 1672x941 Mount Fuji lake terrace, already without foreground pines.
Remove ALL clouds in the sky and ALL pale cloud puffs crossing Mount Fuji's lower slopes, from y0 to approximately y375. Reveal matching clear blue sky where clouds were in the sky. Where clouds cover the mountain, reconstruct its natural blue lower slopes and ravines, continuous with the visible mountain above. Keep Fuji's exact snow cap, outline, scale, position and color; do not add a new mountain. Remove the large side cloud banks on both sides of Fuji, and the smaller broken cloud band across its base.
Keep the distant forested foothills, valley haze below y375, shoreline houses, entire lake and painted reflections, all railing and the entire flat wooden deck EXACTLY unchanged. Preserve the original crisp pixel clusters and warm morning light. Full-frame opaque 1672x941, same camera and crop. No foreground pines, no new objects, no text. The result is a clean sky-and-mountain plate, not a finished replacement scene.

### Cloud far

Use case: background-extraction
Asset type: registered transparent BACK cloud layer for Mount Fuji pixel-art parallax.
Input image 1: extraction target, the 1672x941 Fuji scene.
Extract the large distant pale peach/lavender cumulus cloud banks visible in the SKY to the LEFT and RIGHT of Mount Fuji, plus the small high sky wisps. These are the clouds BEHIND the mountain. Retain their current original canvas positions: left bank broadly x0..670,y85..325; right bank x1110..1672,y225..350. Continue a sparse cloud bank naturally behind the mountain's occluded region, approximately x600..1180,y235..330, since the mountain will be drawn on top later.
Do NOT include the separate low front-facing cloud puffs that cross Fuji's blue face around y290..370. Everything except these back sky clouds must be genuinely transparent alpha: no blue sky, mountain, snow cap, foothills, lake, trees, houses, railing or floor. Preserve the original pixel-art cloud edges, peach highlights and blue-lavender shadows. Keep full 1672x941 registration, no recentering or resizing. Empty transparent space above and below the clouds, no opaque background, no checkerboard pixels, no text.

### Cloud near

Use case: background-extraction
Asset type: registered transparent FRONT cloud layer for Mount Fuji pixel-art parallax.
Input image 1: extraction target, the 1672x941 Fuji scene.
Extract ONLY the small broken band of low pale peach-white clouds crossing IN FRONT OF the blue lower slopes of Mount Fuji, roughly x400..1420,y270..372. Include the little puffs, tendrils, translucent lavender lower edges and narrow gaps through which mountain shows. Preserve their original location and scale in a full 1672x941 canvas. This is a thin low band, NOT a giant storm cloud, and the upper snowy mountain must remain completely unobstructed when this layer is composited.
Everything else genuinely transparent alpha. Exclude ALL rear sky clouds at the left/right edges, the blue sky, all mountain and snow pixels, forested foothills, valley mist below y375, lake, buildings, trees, rail and floor. No solid backing, no blue rectangular halo, no checkerboard pixels, no extra clouds. Keep crisp handcrafted 16-bit pixel texture and original soft warm light. No recentering, no enlargement, no cropping, no text.
