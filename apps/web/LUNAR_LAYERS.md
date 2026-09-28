# Lunar Quiet — animation layers

Source: `../../concept-art/lunar-terrace-v4.png`, the approved no-Sun scene with the user's supplied SpaceX wordmark. Assets were made using the imagegen skill and the built-in image-generation tool; no CLI/API fallback was used.

## Saved assets

Paths relative to `apps/web/`:

| Asset | Use |
| --- | --- |
| `public/assets/lunar/original.png` | Unchanged approved scene, also the loading/error fallback |
| `public/assets/lunar/clean-plate.png` | Full generated dish-free backing; only a feather-edged 56×55 patch at (1380, 449) is consumed |
| `public/assets/lunar/dish-v2.png` | Final 1254×1254 RGBA dish sprite, sampled at (206, 146, 850, 984) and registered as 38×44 pixels above the original mount at (1403, 501) |
| `public/assets/lunar/dish.png` | Initial full-frame RGBA extraction, retained for provenance but not loaded; superseded because of edge artifacts |

The dish and hidden crater pixels are AI reconstructions, not a mathematically exact recovery of the original. All terrain outside the tiny backing patch, the base architecture, logo, Earth and foreground retain the approved source. The final dish's mounting stem is offset within its bounds, so the pivot is explicitly registered rather than centered. Generated alpha is preserved on disk.

## Animation

`src/scene/LunarScene.tsx` composes the scene using the existing shared 24-fps Canvas renderer. Preparation reads source pixels only once to identify up to 92 existing stars and build small alpha masks; glimmers do not add arbitrary stars over Earth or terrain. Each star has a different 4.5–9-second dim-to-bright cycle, with up to 72% modulation. Selected stars gain a tiny pixel cross at their peak, since screen blending cannot brighten an already-white core. The original sky always stays beneath it. This stronger pass follows the user's request for more visible twinkles.

The dish scans ±8 degrees over 54 seconds with a small horizontal perspective change, anchored at its stem. A small red beacon sits at (1360, 469), on the top of the fixed vertical pole beside the dish—not on the dish itself. Its crisp three-pixel red core and small red halo breathe over 4.8 seconds, fading gently to 18% brightness. It is rendered outside the dish transform, so it stays attached to the stationary pole. Three other cyan/amber station indicators retain their independent slow pulses. Shooting stars are brief 1.4-second pixel trails, first appearing after 11 seconds and then approximately every 38 seconds, always in open sky clear of Earth and terrain. These glimmers and shooting stars are a stylized artistic effect, not a literal lunar atmosphere simulation.

96 crisp 2–4-pixel pale dust motes take slow 18–36-second low-gravity arcs, fading before looping. Bright cores and a small dark offset edge keep them readable against regolith, without blurred glow. There is no fog, wind effect or terrain movement. Earth stays anchored: its source-derived blue rim shimmers over 24 seconds (5–31% overlay opacity), and masked cloud highlights drift up to six source pixels over 84 seconds (26–38% overlay opacity). The actual per-pixel effect is reduced by the source alpha mask. These settings were increased after the user found the first pass too subtle. Continents and the planet silhouette do not rotate, wobble or change size. No Sun, flare or bright replacement hotspot is introduced. Shooting-star behavior is unchanged from the approved first animation pass.

The scene selector adds **Lunar quiet** without changing the default pavilion or the current board position. Portrait cover framing favors Earth; landscape reveals both Earth and the base. All effects use the same pauseable scene clock, stop in hidden tabs, and respect reduced-motion preferences. No new sound is added.

## Verification

Seven deterministic tests cover star/pulse bounds and continuity, the red antenna beacon's cycle and smooth fade, independent station lights, dish scan, Earth motion, rare sky-only shooting stars, dust bounds/fade/determinism and frozen scene time. Run `npm test` and `npm run build` from `apps/web/`. Browser checks cover successful loading, garden/board views, pause/resume and portrait framing.

## Built-in image-generation prompts

All inputs below use `concept-art/lunar-terrace-v4.png` as the edit target/reference.

### Dish-free backing plate

Use case: precise-object-edit
Asset type: clean backing plate for layered pixel-art animation.
Input image 1: edit target, approved lunar terrace and SpaceX moon base.
Remove ONLY the tiny satellite dish reflector, its feed arm and its thin support above the right-hand habitat (roughly x=1384..1434, y=451..503 on the 1672x941 image). Reconstruct the lunar crater terrain behind the removed dish seamlessly. Keep the roof underneath, other separate slim antenna, full base, SpaceX logo, solar panels, Earth, all stars, terrain, rocks and foreground absolutely unchanged. Do not remove or redraw the habitat. Maintain exact 1672x941 framing, perspective and crisp pixel textures. No Sun, no glow, no new objects. Return the full image clean plate.

### Initial registered cutout (superseded)

Use case: background-extraction
Asset type: transparent registered satellite dish animation cutout.
Input image 1: edit target/source for extraction.
Extract ONLY the small silver satellite dish reflector, feed arm, and its thin support on top of the right-hand SpaceX habitat. It occupies about x=1384..1434, y=451..503 in this 1672x941 image. Retain the original tiny dish at its exact original location, size, angle, color, lighting and pixel detail on a full-size 1672x941 canvas. Everything else must be genuinely transparent (alpha), including the lunar ground behind it, base roof, Earth, sky, stars, habitat and solar panels. Do not enlarge or center the dish; registration must align when overlaid on the original. No opaque matte, checkerboard, shadow rectangle, new objects or text. Preserve the fine feed arm and support.

### Final clean sprite

Use case: background-extraction
Asset type: clean transparent pixel-art satellite dish sprite for game animation.
Input image 1: source/reference, the approved lunar scene.
Extract the tiny silver satellite dish on the right-hand habitat roof. Produce ONE isolated silver dish, feed arm and short mounting stem on a genuinely transparent alpha background. Keep the same dish design, original tilted angle, cool silver lighting and crisp pixel-art surface. No mesh, no lattice structure, no checkerboard, no gray triangular backdrop, no speckled edge artifacts, no cast shadow outside the object, no habitat or terrain. Every gap around the dish and between its feed arms must be truly transparent. Keep a clean tight silhouette, no detached pixels.
Make the dish a centered sprite with a modest transparent margin, large enough to see its outline clearly, in a square canvas. This sprite will be scaled back down to about 36 pixels wide, so use simple crisp pixel clusters and not photorealistic fine texture. Include the short dark mounting stem at the bottom; not a long tower. Do not add anything else, no text.
