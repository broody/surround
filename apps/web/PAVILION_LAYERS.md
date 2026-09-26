# Cloud-Sea Pavilion layers

Source: the approved 1672×941 image attached by the user, copied unchanged to `public/assets/pavilion/original.png`.

Five derivative images were made individually with the built-in image-generation tool. The original and generated PNGs are retained unchanged on disk. As with the other scenes, this is an AI-assisted decomposition, not a pixel-perfect recovery of an unavailable layered source. Inpainting reconstructs the sky and mountains hidden behind branches and fog; generated cutouts are cropped and registered at runtime.

## Assets

| File in `public/assets/pavilion/` | Use |
| --- | --- |
| `original.png` | Original composition, load/error fallback, source for distant silhouettes and light masks |
| `clean-plate.png` | Stationary pavilion, level floor, mountain landscape and uncovered moon |
| `blossom-left.png` | Transparent left bough, anchored sway and tip flex |
| `blossom-right.png` | Independent transparent right bough |
| `sky-clouds.png` | Transparent sky bank drifting across the moon, behind the skyline |
| `valley-mist.png` | Two separately moving depth layers in the valley |

All four cutouts have genuine RGBA transparency, including interior gaps. The cloud textures are 2172×724; the other images are 1672×941. Canvas registration uses explicit alpha-content bounds and restrained night tints to match the source. The renderer never changes the source files.

## Composition and motion

`src/scene/PavilionScene.tsx` composites the plate, sky clouds, far mist, original dark island silhouettes, near mist, solid foreground cliffs, distant blossoms, foreground blossom boughs, petals/motes, fixed timber frame, and lighting. A blue-luminance key recovers central mountain silhouettes from the original without straight polygon cuts across their fog-covered feet. Near cliffs use the clean plate so old fog is not restored. Small distant pink trees are keyed from the original. Railing gaps stay transparent to the moving scenery.

Boughs pivot at their roots by less than half a degree and flex toward their tips, using overlapping strips to avoid raster seams. Clouds have independent bounded slow drift, without a visible wrap/reset. Forty-eight petals tumble at two depths; 24 warm motes rise near the veranda. Nine lights pulse with different phases, including the two foreground lanterns, the distant pagoda and the lantern trail. Warm floor spill follows the corresponding foreground lantern. The roof, posts, railing and level floor never move.

Shared `SceneCanvas.tsx` runs at up to 24 fps, paints before revealing the canvas, stops for hidden tabs/reduced motion, and freezes its clock when paused. The original full scene remains visible while layers load or if loading fails. Scene switching keeps the Go position and clocks; garden view pauses thinking time. Cloud-Sea Pavilion is the new default, with Winter stillness and Moonlit garden preserved in the selector.

Deterministic motion and bounds tests are in `pavilionWeather.test.ts`; run `npm test` and `npm run build` from `apps/web`.

## Exact image-generation prompts

Every request used the attached original as its reference image.

### clean-plate

Use case: precise-object-edit. Input image 1 is the approved Cloud-Sea Pavilion scene, edit target. Create a clean background plate for a layered animation of this EXACT artwork. Remove the large cherry blossom branches hanging inside the pavilion opening at upper-left (x140..650,y35..285) and upper-right (x1250..1545,y40..195), and inpaint their hidden sky. Remove all loose airborne pink petals, but keep petals resting on the wooden floor. Remove sky cloud bands and the thick flowing cloud/mist banks filling the valley, reconstructing subdued distant blue mountains, forested slopes and atmospheric depth behind them; keep gentle overall distant haze, not distinct frozen clouds. These clouds and valley mist will be restored as independent moving transparent layers. Preserve all mountain silhouette positions as closely as possible, all buildings and lantern-lit paths, foreground cliffs and pines, moon at its existing position (complete its round disc where a cloud crossed it), roof, timber pillars, railing, lanterns, floor geometry, wood texture and light reflections. Keep the original 1672x941 framing and pixel-art palette. Floor and railing must remain stationary and level, no rotation or camera change. ONE opaque full-scene clean plate, no UI, text, redesign or new objects.

### blossom-left

Use case: background-extraction. Input image 1 is edit target. Extract ONLY the large arching cherry-blossom branch cluster in the UPPER LEFT of the inner pavilion opening, from approximately x=140..650,y=35..285 on the original 1672x941 image. Preserve the connected dark branches and delicate muted pink blossom clusters, including gaps. Remove all sky, clouds, roof, wooden pillars, lanterns, distant mountains, detached falling petals and all other objects. GENUINELY TRANSPARENT RGBA background, including holes between flowers; no black/white/checkerboard painted background. Keep original size, location, pixel scale and moonlit muted colors on the same 1672x941 canvas; do not center, enlarge or redesign. Branches should continue slightly beneath the left wooden post at x140 so they can pivot naturally. No text or shadows outside the actual branch silhouette.

### blossom-right

Use case: background-extraction. Input image 1 is edit target. Extract ONLY the small arching cherry-blossom branch cluster in the UPPER RIGHT of the inner pavilion opening, approximately x=1250..1545,y=40..195 in the original 1672x941 image. It extends leftward from the right wooden pillar. Preserve its connected dark wood and delicate muted pink blossoms, and all gaps. Exclude the pillar, roof, lantern, temple roof below, sky, clouds, distant cherry trees and airborne petals. GENUINELY TRANSPARENT RGBA background, including gaps, no painted black/white/checkerboard. Keep exact original position and size on a 1672x941 canvas, do not center, enlarge or redesign. No text, no extra objects. This is a registered animation layer for the original scene.

### sky-clouds

Use case: background-extraction. Input image 1 is edit target. Extract the delicate blue-gray horizontal CLOUD WISPS in the SKY ONLY (original scene approximately x180..1420,y105..300), as an isolated layered pixel-art cloud bank with genuine alpha transparency. Retain the distinctive stepped edges, thin veils, small soft billows and blue-gray moonlit highlights. Remove the moon, branches, petals, mountains, buildings, roof and all dark-blue sky between and around the cloud wisps. No opaque sky patches. Preserve translucency at cloud edges and gaps between wisps. Arrange the extracted sky clouds as ONE wide band centered in a wide transparent canvas, roughly 5:1 aspect ratio, cropped snugly with a little transparent padding. Same restrained night-time pixel palette, not white daytime clouds. No text, no background scene, no painted checkerboard, no drop shadow.

### valley-mist

Use case: background-extraction. Input image 1 is edit target. Extract ONLY the moonlit flowing SEA OF CLOUDS/MIST in the VALLEY, originally between y330 and y635. Make a single broad, low, irregular billowing mist bank as a genuine transparent RGBA layer for animation. Include rich stepped pixel shapes in slate blue and pale lavender-blue, with a few restrained warm moonlit highlights. Keep beautiful overlapping wispy lobes, thin translucent edges and many transparent gaps. EXCLUDE every solid mountain, island, pine tree, cliff, building, village light, moon, sky cloud, petal, railing or architecture. Dark gaps between cloud masses must be TRANSPARENT, not painted navy. Return one wide horizontal transparent mist bank, roughly 4:1 aspect ratio, content filling most of canvas with padding. Match original authentic fine 16-bit pixel art, muted night palette; no white fog wall, no smooth airbrush, no text, no checkerboard.

