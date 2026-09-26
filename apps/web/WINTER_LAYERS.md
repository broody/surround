# Winter Stillness — layered animation

Based on the approved level-floor concept, `concept-art/winter-stillness-v2.png`. The clean plate and both pine cutouts were generated individually using the built-in image-generation tool. No CLI/API fallback was used. An intermittent service authentication error required retries; the three assets below are the successful outputs.

## Files

All artwork is retained at full source resolution in `public/assets/winter/`:

| File | Purpose |
| --- | --- |
| `original.png` | Approved full image, static fallback, and exact foreground roof/posts/level-floor matte |
| `clean-plate.png` | Inpainted background without the two moving pine groups and airborne snow dots |
| `left-pine.png` | Genuine RGBA cutout of the left snow-heavy boughs |
| `courtyard-pine.png` | Genuine RGBA cutout of the smaller courtyard pine |

These are AI-assisted extraction/reconstruction assets, not pixel-identical segmentation. The generator enlarged the isolated cutouts, so source bounds and placement are explicitly registered in `src/scene/WinterScene.tsx`. Their snow is night-graded at render time; source PNGs are not modified. Fine alpha gaps reveal the cleaned background as branches move. Some reconstructed foliage and hidden garden details differ slightly from the original.

## Animation

- Two independent anchored pine layers: a fractional rotation and a subtle connected strip bend, with overlaps to avoid raster seams on the snow.
- 174 deterministic snowflakes across three depth/speed layers, plus occasional drifting powder below the boughs. All falling snow is clipped to the outdoor opening.
- Amber-pixel masks independently dim and brighten the lanterns and temple windows, with soft matching halos.
- Gentle warm spill on the veranda follows the foreground lantern.
- The original roof, posts and horizontal veranda are restored in front of the weather; snow does not fall inside the sheltered room.
- One Canvas 2D clock runs at up to 24 fps and stops on pause, in hidden tabs, and with reduced motion. Pausing retains scene time; resuming does not reload textures.
- Failed layer loads show the approved static original. React owns the scene selector and game UI; changing scenes preserves the board position.

Select **Winter stillness** or **Moonlit garden** from the scene menu. Winter is the default. The original moonlit renderer and its 32 motes remain unchanged.

## Verification

`npm run build` and `npm test`. Tests cover the existing Go rules plus deterministic depth distributions, falling/wrapping bounds, frozen-time determinism and gentle light intensity changes.

## Exact generation prompts

### clean-plate.png

Use case: precise-object-edit. Input image: edit target, the approved Winter Stillness scene. Create a CLEAN BACKGROUND PLATE for animation. Remove only (1) the prominent snow-covered pine boughs emerging from behind the LEFT foreground wooden post into the upper-left courtyard, approximately x=115..445,y=105..445 on the original 1672x941 canvas; (2) the small sculptural snow-covered pine tree above the boulders near the MIDDLE-RIGHT, approximately x=875..1165,y=315..535; (3) the sparse airborne snowflake dots, which will be animated separately. Inpaint the forest, courtyard wall and snow that were hidden behind these two pine groups. Preserve the snow resting on all static surfaces. Preserve the foreground post, roof, icicles, all lanterns, nearby ground shrubs, boulders, temple hall, path and faraway forest. Crucial: keep the veranda floor and threshold PERFECTLY LEVEL and HORIZONTAL, same as reference. Preserve exact framing, positions, dimensions, 16-bit pixel clusters, night-blue lighting and amber windows. No camera movement, no redesign, no new objects. Return one opaque 1672x941 full-scene image, no labels, no UI.

### left-pine.png

Use case: background-extraction. Input image: edit target. Extract ONLY the snow-covered pine bough cluster that extends from behind the LEFT foreground wooden post into the upper-left courtyard, at approximately x=115..445,y=105..445 in the 1672x941 reference. Include its connected dark branching wood, pine needles and piled snow. Preserve original blue-hour pixel colors and the exact irregular fine silhouette. REMOVE everything else: sky, forest, architecture, post, lantern, ground, rocks, shrubs, any detached airborne snowflakes. Genuinely transparent alpha background, including gaps between branches; no white, black or checkerboard painted behind it. Keep the selected cluster at precisely its ORIGINAL SIZE AND POSITION on the SAME 1672x941 transparent canvas. Do NOT enlarge, center or recompose. This is a registered animation layer, not a new tree illustration. No text, no shadows outside the tree, no other objects.

### courtyard-pine.png

Use case: background-extraction. Input image: edit target. Extract ONLY the small sculptural snow-covered pine tree that leans over the boulders in the MIDDLE-RIGHT of the courtyard, approximately x=875..1165,y=315..535 in the 1672x941 reference. Include its curved dark branching trunk, pine needle clusters and piled snow; complete a small amount of the trunk hidden behind its own foliage if needed. EXCLUDE the snowy boulders beneath it, the temple roof behind it, the nearby stone lantern to its right, snow on the ground, and all other scene elements. Preserve the original muted blue-hour palette, pixel-art detail and exact branch silhouette. Genuinely transparent alpha background including all gaps. Keep this tree at precisely its ORIGINAL SIZE AND POSITION on the SAME 1672x941 transparent canvas. Do NOT center, enlarge or redesign the tree. No painted checkerboard, no lettering, no drop shadow, no disconnected floating snow particles.
