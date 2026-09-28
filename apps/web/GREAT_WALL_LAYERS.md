# Great Wall autumn — layered scene

Source: `../../concept-art/great-wall-terrace-v4.png`, the approved open-valley composition with widely separated towers.

## Saved assets and generation

All three derived assets were made with built-in imagegen, using the approved v4 as the edit/extraction target. No CLI/API fallback or image-editing script was used. PNG alpha is preserved. The foliage and cloud cutouts are reconstructed artwork, not exact recovery of hidden pixels.

- [original.png](public/assets/great-wall/original.png): unchanged approved concept and loading/error fallback, 1672×941.
- [clean-plate.png](public/assets/great-wall/clean-plate.png): clear upper sky and inpainted foreground tree backing, 1672×941.
- [foliage.png](public/assets/great-wall/foliage.png): genuine RGBA nearby tree layer, 1671×941.
- [clouds.png](public/assets/great-wall/clouds.png): genuine RGBA sky-wisp layer, 1672×941.

## Composition and motion

`src/scene/GreatWallScene.tsx` retains the approved scene as its base. It replaces the sky inside a registered skyline mask and blends clean backing patches only around the nearby trees. The skyline clips clouds behind the distant mountains and left tower. Two cloud strips at y0–123 and y123–236 drift independently (±48/62 pixels), with horizontal overscan and no loop seam.

The foliage sheet supplies a narrow left-edge bough and two nearby tree groups. Runtime crops register the lower-left sheet region (210,480,260,290) at (212,474,260,220), and lower-right (1224,410,447,370) at (1312,427,360,268). Six-pixel connected strips bend from fixed attachments with 3.1–3.8-pixel maximum reach. The approved foreground stonework is restored on top, so the floor and battlements do not sway.

Forty-four seeded autumn leaves use two depths: 26 larger nearby leaves and 18 smaller distant leaves. Amber/copper pixel silhouettes tumble and descend with independent phases, fading out before their loops reset. Distant leaves pass behind the nearby trees and parapet; close leaves pass in front.

The requested flag was removed following the user's revision; both cloth and pole are absent. No flag is baked into any asset.

Uses shared `SceneCanvas`: up to 24fps, hidden-tab suspension, reduced-motion support, and pause/resume without resetting time. No per-frame pixel readback. Desktop framing is centered; mobile favors the winding wall. All earlier scenes and the default pavilion are preserved.

Choose **The gardens → Great Wall autumn** or the landing footer selector. The separate study lesson interface is unchanged.

## Checks

Five deterministic motion tests cover anchored trees, continuous bounded clouds, seeded two-depth leaves, falling motion and invisible resets, and frozen shared time. Included in the frontend test command.

## Exact built-in imagegen prompts

### Clean backing

Use case: precise-object-edit
Asset type: registered clean backing plate for a layered pixel-art environment animation.
Input image 1: edit target, the approved 1672x941 Great Wall autumn terrace.
Remove only (1) all thin white clouds from the upper sky, filling with matching clear pale blue sky; (2) the nearby orange leafy branches along the extreme LEFT edge, from x0..145,y0..590, reconstructing the stone tower/sky behind them; (3) the nearest gold/orange trees just beyond the parapet at lower left, about x217..450,y475..665, and at lower right, about x1350..1672,y480..665, including the near dark pine at the right edge. Fill these two small areas with natural more-distant hillside foliage and ground. Keep all other valley forest and mountain trees.
Preserve EXACTLY the tower geometry and spacing, winding wall, mountain silhouettes, valley mist, morning lighting and colors, foreground battlements and flat stone terrace. Do not remove the foreground tower at left or right distant tower. No crop or zoom; full-frame opaque 1672x941 backing. No new tower, no flag, no sun, no text. Preserve crisp original pixel-art texture. This is a clean animation backing, not a new composition.

### Foreground foliage

Use case: background-extraction
Asset type: registered transparent foreground foliage layer for pixel-art animation.
Input image 1: extraction target, the approved 1672x941 Great Wall autumn terrace.
Extract ONLY the nearby autumn trees: (1) the orange leafy boughs framing the extreme LEFT edge and upper-left corner, about x0..145,y0..590, including their narrow dark branches but NO STONE TOWER; (2) the nearest orange/gold tree crowns at lower left, x217..450,y475..665, immediately outside the parapet; (3) the nearest gold/orange trees and dark green pine at lower right, x1350..1672,y430..665, immediately outside the parapet. Reconstruct the short lower portions hidden behind the stone parapet, to about y690, because the original parapet will be layered in front later.
Retain their original full-canvas positions and original scale/colors/pixel detail. Canvas exactly 1672x941; no recentering, no enlargement, no crop. Everything else genuinely transparent alpha: no sky, clouds, mountains, valley forest, tower, wall, parapet or floor. No blue/gray backdrop or matte fringe. Do not include distant hillside trees. Output a sparse full-frame RGBA image, not a sprite sheet, no checkerboard pixels.

### Sky clouds

Use case: background-extraction
Asset type: full-frame transparent sky cloud layer for pixel-art parallax.
Input image 1: extraction target, the approved 1672x941 Great Wall autumn scene.
Extract ONLY all the thin white/cream high cloud wisps in the upper sky, roughly y0..220. Preserve the full 1672x941 canvas registration, the wisps' exact positions, shapes, pale warm highlights and subtle blue edges. Include delicate broken wisps and gaps. Not the valley mist. Do not invent larger clouds.
Everything else must be genuinely transparent alpha: no blue sky, mountain, tower, tree, wall or floor. Crisp original pixel-art cloud edges, not blurry smoke, no colored rectangular backing, no opaque background, no checkerboard pixels, no text. No recentering, crop, enlargement or rearrangement.

