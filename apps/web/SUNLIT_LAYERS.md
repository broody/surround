# Sunlit training dojo layers

Source: the approved [sunlit dojo concept](../../concept-art/sunlit-training-dojo-v1.png), copied unchanged to `public/assets/sunlit/original.png`. Its original generation prompt is retained [with the concept](../../concept-art/sunlit-training-dojo-v1.md).

## Assets

All assets are 1672 × 941 PNGs. These project-bound derivatives were generated with the built-in image-generation tool, not the CLI fallback. This is an AI-assisted decomposition, not a pixel-perfect recovery of an unavailable layered source.

- `public/assets/sunlit/original.png` — unmodified approved artwork; static interior and load/error fallback.
- `public/assets/sunlit/clean-plate.png` — inpainted distant garden revealed behind the moving trees. Only the two outdoor openings use this derivative; generated changes elsewhere in this plate never replace the original interior.
- `public/assets/sunlit/outdoor-trees.png` — genuine RGBA tree cutouts, retaining full-scene registration. The left and rear-right clusters are cropped into separate runtime textures with transparent padding.

Source files are retained as generated. Cropping, clipping, light masks and compositing happen only in the renderer.

## Composition and animation

`src/scene/SunlitScene.tsx` draws the original image, then clips the inpainted garden and tree sprites to the open left and rear-right doorways. The original timber, paper screens, wall, furnishings and level tatami remain stationary. No rectangular patches of sky or architecture sway with the foliage.

Connected eight-pixel strips bend each canopy independently, with up to 4.6 pixels of flex on the larger tree and 3.2 pixels on the distant one. Displacement tapers to exactly zero at each tree's base. Slow shared breeze and finer tip motion avoid a rigid pendulum effect.

Warm source-luminance masks modulate the existing wall and floor light without translating any floor texture or shoji-lattice lines. A moving highlight band passes through these masks for a visible glistening effect. Low-opacity canopy silhouettes add slight leaf-shadow movement driven by the same breeze. Soft pixel-scale light shafts breathe gently; 112 deterministic two-to-four-pixel dust motes with warm halos rise at roughly five to eight source pixels per second and fade at loop boundaries. A second band near the left window keeps dust visible beside the board and in portrait crops. Their visibility falls off outside the sunbeams. The existing painted-in light and shadows remain the visual baseline; the interior is not relit from a recovered 3D model.

The shared `SceneCanvas` renders at up to 24 fps, freezes the common clock when paused, and stops animation for reduced-motion preference and hidden tabs. It displays the approved original while derivatives load or if any fail. In portrait layouts, canvas and fallback both use an 18% horizontal cover alignment so the left doorway remains visible.

Select **Sunlit training dojo** in the landing footer, scenery view or study scene selector. Cloud-sea pavilion remains the initial default. All previous environments and the current board state are preserved when switching.

## Validation

- Production build and all 23 frontend tests pass, including five deterministic motion tests covering light bounds, seamless dust loops and visible dust coverage near the window.
- Motion tests cover stationary roots, bounded canopy flex, smooth/bounded daylight, particle bounds and loop fades, sunbeam visibility and fixed-time determinism.
- Browser checks cover scene loading, visible animated frames, pixel-identical paused frames, scene switching and responsive framing.

## Exact built-in image-generation prompts

Both requests used `concept-art/sunlit-training-dojo-v1.png` as the edit target.

### clean-plate

Use case: precise-object-edit
Input image 1 is the edit target: the approved pixel-art sunlit indoor dojo.
Asset: registered backing plate for animation, same full-frame 1672x941 composition.
Change ONLY the garden seen through the open doors/windows: remove the nearby yellow-green leafy trees, their trunks and shrubs in the left open doorway and the narrow back-right doorway. Fill their former areas with plausible quiet distant garden background: softly lit pale garden wall, cool distant greenery well behind the removed trees, and open light sky. Remove all near branches/leaves that would duplicate separately animated foliage.
Keep ALL indoor architecture, shoji frames, vases, indoor plants, benches, bowls, cushions, wall sunlight, tatami flooring, every edge and position unchanged. Do not alter lighting or perspective. Keep level horizontal floor, exact crop, crisp pixel-art texture. No new objects, no text. This is an inpainting cleanup, not a scene redesign.

### outdoor-trees

Use case: background-extraction
Input image 1 is the edit target: the approved pixel-art sunlit indoor dojo.
Asset: transparent RGBA outdoor-tree cutout sheet, in the SAME full wide 1672x941 registration as input.
Extract ONLY the yellow-green outdoor tree foliage and visible slender branches/trunks seen through the left open doorway (near x210–320, y120–600) and the narrow rear-right open doorway (near x1325–1407, y254–579). Keep the two clusters in their exact original locations, scale, colors and shape; do not center, enlarge, rearrange or merge them. Preserve delicate green and golden leaf pixel clusters and transparent gaps between leaves. The rest of the entire image must be truly transparent, including all interior architecture, walls, shoji, garden walls, sky, stone lantern, floor, vases and indoor plants. Do not draw a checkerboard. No opaque backing, no glow, no extra objects. Keep canvas registration and square pixel texture. These cutouts will sway over a separate garden backing plate behind the original immobile door frames.
