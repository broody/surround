# Layered garden source assets

These five PNGs were generated individually with the built-in image-generation tool, using `public/assets/moonlit-dojo.png` as the edit reference. No CLI or API fallback was used. This is an AI-assisted extraction and reconstruction, not a pixel-identical segmentation: the background was inpainted and the isolated foliage/clouds were registered and night-graded in the renderer. All original generated PNGs remain unmodified.

| Asset in `public/assets/garden/` | Role |
| --- | --- |
| `clean-plate.png` | Opaque scene with the maple foliage, right shrub and painted clouds removed; hidden background reconstructed |
| `maple-canopy.png` | Transparent overhanging maple branch; bends from the left edge of the garden opening |
| `maple-foreground.png` | Transparent left foreground maple; attached to its trunk |
| `right-shrub.png` | Transparent right-side foliage; bends from its right-side root |
| `cloud-bank.png` | Transparent pixel cloud bank, reused at three independent depths and speeds |

## Composition

`src/scene/layers.ts` contains explicit source crops, scene registration, color grading, branch attachment points and a foreground matte. The alpha textures have transparent gaps around individual leaves and branches: no sky or wall pixels move with the foliage. A continuous strip deformation adds a delayed bend toward branch tips. The canopy clips behind the opening's frame.

Back to front: clean plate and moon halo → drifting alpha cloud banks → landscape/architecture matte → original lake scanline shimmer and pagoda window dimming → separately articulated foliage → warm lantern glow. The landscape matte prevents cloud pixels from crossing mountains, trees, the pagoda spire or the room. The approved water shimmer still samples the original `moonlit-dojo.png`.

All layers share the 1672×941 scene and responsive cover transform. Motion runs at up to 24 fps, pauses in hidden tabs, and respects both the scenery toggle and reduced-motion preference. Failed layer loads fall back to the original static artwork.

## Waterfall, motes and lanterns

`src/scene/waterfall.ts` animates a tightly masked falling-water curtain from the clean plate: downward-travelling texture displacement, narrow flowing highlights, small impact droplets and low spreading ripples. The surrounding rocks and the waterfall lip remain stationary. It uses the same scene clock, pause control and reduced-motion behavior as the other garden layers. No additional bitmap generation was needed.

The ambient rising pixels now use 32 staggered CSS motes (increased from 18), with 2–3px squares, varied 9–13.4-second lifetimes and a soft 54px upward drift. They remain behind the UI and follow the scenery pause/reduced-motion controls. Density is controlled by `MOTE_COUNT` in `src/App.tsx`.

The right-side stone garden lantern and paper room lantern each have an amber-pane mask and synchronized warm light spill. Their illuminated pixels gently dim and brighten over a roughly ten-second cycle; dark frames and roofs remain unchanged.

## Exact generation prompts

### clean-plate.png

Use case: precise-object-edit. Input image 1 is the edit target, an existing 1672x941 pixel-art game environment. Produce a CLEAN BACKGROUND PLATE for layered animation, keeping the EXACT canvas dimensions, camera, room framing, perspective, pixel detail, lighting and locations of every retained element. Remove ONLY: (1) all red/orange maple leaves and their small branches in the foreground at the far left in front of the left lantern and wall, and the red overhanging maple branches in the upper-left garden opening, (2) the small dark leafy foreground shrub silhouetted in front of the far-right shoji and lantern at the right edge, (3) ALL CLOUDS in the visible sky. Inpaint the revealed areas convincingly: continuous shoji paper and wooden pillars behind removed foreground maple, unobstructed lantern where needed, dark blue sky and garden behind the removed overhanging branches, shoji at the far right. Sky must be clear and cloudless with the existing moon retained at EXACTLY the same position. Preserve the distant mountains, waterfall, pagoda, all lanterns, the pond AND its reflections, distant green garden trees, the bridge, veranda and tatami pixel-for-pixel as much as possible. Do not remove distant garden foliage. No new foliage, no new clouds, no new props. Full frame opaque background plate, no transparency. This will sit behind cutout layers from the same source; registration is crucial. Do not recrop or recompose.

### maple-canopy.png

Use case: background-extraction. Input image 1 is the edit target. Isolate ONLY the red/russet overhanging maple branches INSIDE the upper-left open garden window, approximately source coordinates x=353..750, y=110..397. Include the fine brown branch structure and maple leaves reaching from the left window edge across the sky; also include the small red leaf cluster descending down the left edge of that opening. Remove EVERYTHING ELSE to actual alpha transparency: sky, blue haze, mountains, room frame, all green trees, pond, lanterns, left foreground maple and right foreground shrub. Keep leaf and twig shapes, existing warm/cool lighting, original crisp pixel-art colors and EXACT original placement. Output on the SAME 1672x941 canvas, with the branch in its original upper-left location and all remaining canvas transparent. Do not center, enlarge, move, redesign, redraw as smooth art, add a backdrop, or add a shadow. This is a registered sprite layer for animation. Genuinely transparent PNG, NOT a checkerboard pattern or black background.

### maple-foreground.png

Use case: background-extraction. Input image 1 is the edit target. Isolate ONLY the far-left FOREGROUND red maple leaves and fine dark branches which sit in front of the left wall and large glowing lantern, approximately x=0..270, y=205..790. Include all the maple foliage silhouettes at the far left, especially the branches crossing the lantern; exclude the pot and exclude all lantern pixels and room pixels. Remove EVERYTHING ELSE to actual alpha transparency. Do not include the separate maple canopy inside the open garden window (at x=355..750). Preserve exact branch/leaf geometry, original colors, crisp pixel-art style and exact location. Output SAME 1672x941 full canvas, leaves still attached to its left edge at their ORIGINAL positions, all remaining canvas transparent. Do not center, enlarge, move, redesign or add shadows. Intended as a precisely registered cutout layer for animation, with transparent negative spaces between the leaves and twigs. Genuinely transparent PNG, NOT a checkerboard pattern or black background.

### cloud-bank.png

Use case: background-extraction. Input image 1 supplies the exact pixel-art style and muted moonlit blue-gray colors. Extract/reconstruct ONE long, thin wispy bank of the existing night-sky clouds as a standalone transparent sprite for this game's layered background. A gently irregular horizontal strip of crisp pixel-art cloud wisps, with visible negative spaces and lower-opacity edges, dark desaturated slate-blue shadow pixels and restrained pale blue-gray highlights, no bright daylight whites. Broad flat shape about 5:1 aspect ratio, roughly 75% of canvas width and 18% of canvas height, centered, ample transparent margin around every side, no cropping. EXACTLY ONE connected cloud bank, not a sheet or rows of clouds. Remove everything other than this isolated cloud bank to genuine alpha transparency: no sky, no moon, no stars, no mountains, no leaves, no room. Match original handcrafted 16-bit art and small square pixel clusters, not blurry airbrushed clouds. No text, no watermark. Transparent PNG.

### right-shrub.png

Use case: background-extraction. Input image 1 is the edit target. Extract ONLY the small dark leafy foreground shrub at the far right of the artwork, approximately source coordinates x=1505..1672, y=480..691, that overlaps the shoji panel above and beside the small right lantern. Preserve the shrub's organic branching silhouette, tiny pixel leaves, dark teal-black moonlit foliage and sparse warm amber lantern highlights. Remove ALL background pixels to actual alpha transparency, including all shoji, room, lantern, floor, sky, and every other plant. Keep cutout on the same 1672x941 canvas at its original far-right position and size. Do not enlarge or center it. Sharp transparent spaces between leaves and branches. No opaque rectangular patch, no background shading or halo. Pixel-art transparent PNG.
