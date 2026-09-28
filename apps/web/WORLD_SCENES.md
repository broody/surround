# World scenes — artwork and animation

Goal: add five finished, selectable, animated iconic locations in Surround's existing pixel-art style. Preserve the nine existing scenes and the default pavilion. Use registered transparent moving layers, keep foreground floors and landmarks fixed, honor pause/reduced motion/hidden tabs, and verify all five in the browser plus tests and production build.

Locations: Venice, Italy; Taj Mahal, India; Santorini, Greece; Petra, Jordan; Torres del Paine, Chile.

## Original assets

All five originals generated with built-in imagegen, without a CLI/API fallback. Full-frame PNGs live in `public/assets/world/{venice,taj,santorini,petra,patagonia}/original.png`. Each is 1672×941. None of the existing assets are replaced. Prompts below are exact.

## Saved artwork and composition

Each folder contains `original.png`, `clean-plate.png`, `foliage.png` and `clouds.png`, all 1672×941. The ten cutouts have genuine transparent alpha; delicate dawn clouds intentionally remain translucent.

| Scene / original | Motion |
| --- | --- |
| [Venice blue hour](public/assets/world/venice/original.png) | Ivy and potted foliage rustle; sky wisps drift; amber canal reflections glimmer; selected windows and the wall lantern breathe. The tied gondola stays still. |
| [Taj Mahal dawn](public/assets/world/taj/original.png) | Hanging neem boughs sway, peach cloud wisps drift, pollen rises and the reflecting pool ripples very gently. The fountain line and architecture remain fixed. |
| [Santorini afternoon](public/assets/world/santorini/original.png) | Olive foliage sways, clouds drift, sea highlights shimmer and the separately extracted little sailboat glides and bobs. |
| [Petra afterglow](public/assets/world/petra/original.png) | Fine desert shrubs stir, violet clouds move through the sky opening, lanterns breathe, a few stars brighten and sparse canyon dust rises. |
| [Patagonia morning](public/assets/world/patagonia/original.png) | Beech branches and grasses rustle, small leaves drift, thin clouds move behind the massif and the glacial lake ripples with silver glints. |

`src/scene/WorldScene.tsx` shares the compositor; `worldSceneConfig.ts` registers each skyline, backing patch, foliage crop, water mask and light region. Only the sky and plant-removal patches use generated clean backing. Original architecture, foreground floors and selected occluding rails/parapets are retained. Eight-pixel connected strips bend foliage from anchored roots. Water uses two-pixel source-image strips with masked highlights rather than a broad glow overlay. Source masks are prepared once, not read back every frame.

All five use the existing 24fps `SceneCanvas` clock, pause/resume, hidden-tab suspension and reduced-motion handling. Sky clouds drift continuously in one direction with three parallax depths: near clouds at 0.75–1.5 source pixels per second (scene-dependent), middle clouds at 65% of that speed, and far clouds at 32%. `worldCloudLayers.ts` assigns whole connected cloud silhouettes to a depth using their opacity-weighted height in the painting; lower horizon wisps are farther away. Faint fringes follow their neighboring silhouette. This preserves each cloud shape, without shearing it into moving horizontal slices or adding new artwork. Splitting happens once on load; the three planes render far-to-near, each repeating with feathered side edges and neighboring copies, clipped behind the fixed skyline. The clear-sky plate removes the original static sky clouds. Particle resets are faded out. Portrait layouts favor the landmark, including tablets; Santorini favors the right side to retain the blue domes. All nine earlier scenes remain selectable, with Cloud-sea pavilion still the default. Select the new locations through **The gardens → Scene** or the landing footer.

## Verification

- All five full desktop compositions inspected in the running app at 1440×810; all five canvases loaded successfully and reported playing.
- World-scene tests cover 20 distinct PNGs, real cutout alpha, bounded layer registrations, anchored branches, continuous cloud motion at all three depths (including wrap), slower far-cloud speeds, intact silhouettes across depth boundaries, three populated planes in every real cloud asset, exact pixel conservation, water limits, boat/light limits and particle reset behavior.
- TypeScript and the Vite production build pass. The existing >500kB JavaScript chunk warning remains.
- All five portrait compositions inspected at 390×844. Santorini's crop was corrected to retain both blue domes; portrait-tablet framing uses the same landmark-aware positions. The temporary viewport override was reset afterward.
- Actual rendered screenshots change with motion enabled in every scene. With Venice paused, settled consecutive screenshots are byte-identical and the canvas reports `data-motion="paused"`; the motion control was re-enabled after verification. The shared painter clock drives every layer (none reads wall time). Reduced-motion and hidden-tab guards are retained in `SceneCanvas`.
- No browser console errors in the final preview. All fourteen selector entries remain present; a fresh page still defaults to Cloud-sea pavilion.

## Layer generation prompts

Each call used the corresponding `public/assets/world/<location>/original.png` as its sole edit/extraction target. Clean plates are RGB; foliage and cloud PNGs preserve native alpha. These are reconstructed cutouts, not exact recovery of hidden pixels. All layers are saved alongside their scene original.

### venice — plate

Use case: precise-object-edit
Asset type: clean registered backing for a layered pixel-art environment.
Input image 1: edit target, the full 1672x941 venice scene.
Remove ONLY the near ivy on the left loggia column/upper-left corner and the leaves of the right potted plant. Leave the terracotta pot, lantern, gondola and mooring poles intact. Also remove ALL clouds from the SKY, filling with matching continuous clear sky; keep low valley/garden mist that lies in front of land.
Preserve absolutely everything else: landmark shape, location and scale; architecture, mountains, ground, water color, reflected lights, rail/parapet, original empty FLAT floor, shadows, pixel texture, lighting and framing. Do not redraw the composition. No added objects, no visible sun, no text, no flag, no people. Full opaque 1672x941 frame, no zoom or crop.

### venice — foliage

Use case: background-extraction
Asset type: transparent registered animated-object layer for the venice pixel-art scene.
Input image 1: extraction target, original full 1672x941 scene.
Extract the close ivy vine on the LEFT loggia column and upper-left corner, roughly x40..340,y0..710, and ONLY the green foliage in the terracotta pot at the far RIGHT edge, x1500..1672,y535..785. Keep the pot and stone columns out of the cutout.
Retain EXACT original canvas positions, proportions, scale, colors, lighting and crisp pixel clusters. Everything else genuinely transparent alpha, including gaps between leaves and twigs. Full 1672x941 RGBA canvas; no recentering, enlargement or crop. No sky or water rectangles, no buildings, no floor, no rail, no props beyond the specifically requested objects. No opaque backdrop or checkerboard pixels. No extra objects or text. Keep the fine silhouette; do not turn delicate leaves into dense oversized trees.

### venice — clouds

Use case: background-extraction
Asset type: transparent registered sky-cloud layer for the venice pixel-art scene.
Input image 1: extraction target, original full 1672x941 scene.
Extract upper sky wisps, mauve and dusky pink on indigo; exclude every building/dome and distant city light. Preserve original positions, shapes, small scale and delicate broken gaps. Clouds only on genuine alpha transparency. This is a sparse high-sky cloud layer, not a new sky painting.
Keep exact 1672x941 registration and original colors and pixel texture; no recentering or enlargement. All non-cloud pixels transparent including sky between wisps. No colored backing, opaque rectangles, stars, trees, buildings, terrain, water, floor, checkerboard pixels, or text. Do not add new clouds.

### taj — plate

Use case: precise-object-edit
Asset type: clean registered backing for a layered pixel-art environment.
Input image 1: edit target, the full 1672x941 taj scene.
Remove ONLY the hanging neem bough at upper left and the small bough at the far right around y221..359. Keep the other garden trees and low ground shrubs intact. Also remove ALL clouds from the SKY, filling with matching continuous clear sky; keep low valley/garden mist that lies in front of land.
Preserve absolutely everything else: landmark shape, location and scale; architecture, mountains, ground, water color, reflected lights, rail/parapet, original empty FLAT floor, shadows, pixel texture, lighting and framing. Do not redraw the composition. No added objects, no visible sun, no text, no flag, no people. Full opaque 1672x941 frame, no zoom or crop.

### taj — foliage

Use case: background-extraction
Asset type: transparent registered animated-object layer for the taj pixel-art scene.
Input image 1: extraction target, original full 1672x941 scene.
Extract ONLY the hanging neem bough in the UPPER LEFT at x105..723,y0..300 and the small bough entering the RIGHT edge at x1535..1672,y221..359. Do not include any garden trees, foreground ground shrubs, or carved pillars.
Retain EXACT original canvas positions, proportions, scale, colors, lighting and crisp pixel clusters. Everything else genuinely transparent alpha, including gaps between leaves and twigs. Full 1672x941 RGBA canvas; no recentering, enlargement or crop. No sky or water rectangles, no buildings, no floor, no rail, no props beyond the specifically requested objects. No opaque backdrop or checkerboard pixels. No extra objects or text. Keep the fine silhouette; do not turn delicate leaves into dense oversized trees.

### taj — clouds

Use case: background-extraction
Asset type: transparent registered sky-cloud layer for the taj pixel-art scene.
Input image 1: extraction target, original full 1672x941 scene.
Extract all thin peach/lavender dawn wisps in the upper sky above the garden. Exclude marble dome, minarets, red pavilion, trees, and low ground mist. Preserve original positions, shapes, small scale and delicate broken gaps. Clouds only on genuine alpha transparency. This is a sparse high-sky cloud layer, not a new sky painting.
Keep exact 1672x941 registration and original colors and pixel texture; no recentering or enlargement. All non-cloud pixels transparent including sky between wisps. No colored backing, opaque rectangles, stars, trees, buildings, terrain, water, floor, checkerboard pixels, or text. Do not add new clouds.

### santorini — plate

Use case: precise-object-edit
Asset type: clean registered backing for a layered pixel-art environment.
Input image 1: edit target, the full 1672x941 santorini scene.
Remove ONLY the nearby left olive branches (upper-left and lower-left), the green foliage of the far-right potted olive (keep the terracotta pot), and the ONE tiny white sailboat around x397..425,y398..435 including its little reflection/wake. Reconstruct matching clear sea behind the removed sailboat. Also remove ALL clouds from the SKY, filling with matching continuous clear sky; keep low valley/garden mist that lies in front of land.
Preserve absolutely everything else: landmark shape, location and scale; architecture, mountains, ground, water color, reflected lights, rail/parapet, original empty FLAT floor, shadows, pixel texture, lighting and framing. Do not redraw the composition. No added objects, no visible sun, no text, no flag, no people. Full opaque 1672x941 frame, no zoom or crop.

### santorini — foliage

Use case: background-extraction
Asset type: transparent registered animated-object layer for the santorini pixel-art scene.
Input image 1: extraction target, original full 1672x941 scene.
Extract the full near olive tree framing the LEFT edge: upper-left bough roughly x0..670,y0..338 and lower-left foliage x0..312,y349..615; also the green foliage of the RIGHT potted olive tree roughly x1520..1672,y431..619, but NOT its pot. Also extract the tiny white sailboat at x397..425,y398..435 in its exact original position as a separate isolated object on this same otherwise transparent canvas. Do not merge the boat with any foliage.
Retain EXACT original canvas positions, proportions, scale, colors, lighting and crisp pixel clusters. Everything else genuinely transparent alpha, including gaps between leaves and twigs. Full 1672x941 RGBA canvas; no recentering, enlargement or crop. No sky or water rectangles, no buildings, no floor, no rail, no props beyond the specifically requested objects. No opaque backdrop or checkerboard pixels. No extra objects or text. Keep the fine silhouette; do not turn delicate leaves into dense oversized trees.

### santorini — clouds

Use case: background-extraction
Asset type: transparent registered sky-cloud layer for the santorini pixel-art scene.
Input image 1: extraction target, original full 1672x941 scene.
Extract the thin high wisps and compact white cumulus in the upper sky. Exclude blue sky, sea, islands, domes, buildings and olive branches. Preserve original positions, shapes, small scale and delicate broken gaps. Clouds only on genuine alpha transparency. This is a sparse high-sky cloud layer, not a new sky painting.
Keep exact 1672x941 registration and original colors and pixel texture; no recentering or enlargement. All non-cloud pixels transparent including sky between wisps. No colored backing, opaque rectangles, stars, trees, buildings, terrain, water, floor, checkerboard pixels, or text. Do not add new clouds.

### petra — plate

Use case: precise-object-edit
Asset type: clean registered backing for a layered pixel-art environment.
Input image 1: edit target, the full 1672x941 petra scene.
Remove ONLY the sparse close shrub at the lower-left edge and the fine grass/shrub tuft at the lower-right edge. Reconstruct the original canyon rock or sandstone behind them. Keep every lantern, carved facade detail and foreground paving stone. Also remove ALL clouds from the SKY, filling with matching continuous clear sky; keep low valley/garden mist that lies in front of land.
Preserve absolutely everything else: landmark shape, location and scale; architecture, mountains, ground, water color, reflected lights, rail/parapet, original empty FLAT floor, shadows, pixel texture, lighting and framing. Do not redraw the composition. No added objects, no visible sun, no text, no flag, no people. Full opaque 1672x941 frame, no zoom or crop.

### petra — foliage

Use case: background-extraction
Asset type: transparent registered animated-object layer for the petra pixel-art scene.
Input image 1: extraction target, original full 1672x941 scene.
Extract ONLY the sparse wiry desert shrub at the LEFT lower edge, roughly x0..241,y525..735, and the small grass/shrub tuft at the RIGHT lower edge x1500..1672,y617..774. Preserve the fine branches.
Retain EXACT original canvas positions, proportions, scale, colors, lighting and crisp pixel clusters. Everything else genuinely transparent alpha, including gaps between leaves and twigs. Full 1672x941 RGBA canvas; no recentering, enlargement or crop. No sky or water rectangles, no buildings, no floor, no rail, no props beyond the specifically requested objects. No opaque backdrop or checkerboard pixels. No extra objects or text. Keep the fine silhouette; do not turn delicate leaves into dense oversized trees.

### petra — clouds

Use case: background-extraction
Asset type: transparent registered sky-cloud layer for the petra pixel-art scene.
Input image 1: extraction target, original full 1672x941 scene.
Extract only the thin violet twilight cloud wisps in the narrow sky opening at x220..895,y0..290. Exclude stars, cliff rock, architecture and dust. Preserve original positions, shapes, small scale and delicate broken gaps. Clouds only on genuine alpha transparency. This is a sparse high-sky cloud layer, not a new sky painting.
Keep exact 1672x941 registration and original colors and pixel texture; no recentering or enlargement. All non-cloud pixels transparent including sky between wisps. No colored backing, opaque rectangles, stars, trees, buildings, terrain, water, floor, checkerboard pixels, or text. Do not add new clouds.

### patagonia — plate

Use case: precise-object-edit
Asset type: clean registered backing for a layered pixel-art environment.
Input image 1: edit target, the full 1672x941 patagonia scene.
Remove ONLY the close beech tree and branches framing the upper-left and left edge, the low nearby leafy shrubs outside the lower-left rail, and the close grass/shrub at the lower-right edge. Reveal matching sky, mountain, lake or shore behind them; leave every timber rail, post and deck plank intact. Also remove ALL clouds from the SKY, filling with matching continuous clear sky; keep low valley/garden mist that lies in front of land.
Preserve absolutely everything else: landmark shape, location and scale; architecture, mountains, ground, water color, reflected lights, rail/parapet, original empty FLAT floor, shadows, pixel texture, lighting and framing. Do not redraw the composition. No added objects, no visible sun, no text, no flag, no people. Full opaque 1672x941 frame, no zoom or crop.

### patagonia — foliage

Use case: background-extraction
Asset type: transparent registered animated-object layer for the patagonia pixel-art scene.
Input image 1: extraction target, original full 1672x941 scene.
Extract ONLY the nearby southern beech tree framing the UPPER LEFT and LEFT edge, x0..732,y0..665, including its trunk and branches, plus the nearby low leafy shrubs outside the rail at x0..395,y560..748 and tussock grass/shrub at the LOWER RIGHT edge x1280..1672,y580..787. Reconstruct small portions hidden by the rail so foliage is continuous behind it. Exclude all distant shoreline vegetation.
Retain EXACT original canvas positions, proportions, scale, colors, lighting and crisp pixel clusters. Everything else genuinely transparent alpha, including gaps between leaves and twigs. Full 1672x941 RGBA canvas; no recentering, enlargement or crop. No sky or water rectangles, no buildings, no floor, no rail, no props beyond the specifically requested objects. No opaque backdrop or checkerboard pixels. No extra objects or text. Keep the fine silhouette; do not turn delicate leaves into dense oversized trees.

### patagonia — clouds

Use case: background-extraction
Asset type: transparent registered sky-cloud layer for the patagonia pixel-art scene.
Input image 1: extraction target, original full 1672x941 scene.
Extract the long thin white wind-stretched high sky clouds above the rugged mountains. Exclude snowy mountain pixels, blue sky and low mist crossing the foothills. Preserve original positions, shapes, small scale and delicate broken gaps. Clouds only on genuine alpha transparency. This is a sparse high-sky cloud layer, not a new sky painting.
Keep exact 1672x941 registration and original colors and pixel texture; no recentering or enlargement. All non-cloud pixels transparent including sky between wisps. No colored backing, opaque rectangles, stars, trees, buildings, terrain, water, floor, checkerboard pixels, or text. Do not add new clouds.


## Original generation prompts

### venice

Use case: stylized-concept
Asset type: full-frame environment artwork for Surround, a contemplative pixel-art Go game.
Style: exquisite handcrafted 16-bit pixel-art landscape, crisp small square pixel clusters, controlled dithering, rich restrained colors, atmospheric depth and readable architectural silhouettes. Match the visual feel of a detailed retro adventure-game background; not photorealistic, not smooth painterly concept art, not low-detail voxel art.
Composition: exactly 1672x941 landscape, level eye-height camera, no Dutch angle. An inviting empty perfectly LEVEL terrace occupies the lower 25-28% of the image, suitable for a game table added later. Clear quiet center, landmarks and atmosphere behind it. Floor paving/planks have coherent even geometry, straight level rear edge, no sloping floor. Layerable composition with a little separated foreground foliage at the outer edges and cloud wisps well clear of the foreground.
Constraints: full scene only, no Go board or game stones, no furniture, no people, no animals, no flags, no text, no signs, no logos, no watermarks, no UI. Sun must stay OUTSIDE THE FRAME, gentle light with no glaring disk or lens flare. Tasteful, tranquil, not a crowded tourist postcard.
Location: Venice, Italy, from a quiet stone loggia on the Grand Canal at blue hour. The unmistakable domes of Santa Maria della Salute stand across the water slightly right of center; antique ochre and terracotta palazzi recede along the left canal. Twilight indigo sky with thin mauve clouds. Broad calm dark-teal water in the middle third catches broken amber window reflections. One SMALL empty black gondola is tied beside two mooring poles near the lower-left water edge, not centered; no gondolier. A low weathered stone balustrade borders the empty pale limestone terrace at y680, leaving water visible above it. A small climbing vine hangs from the upper-left outside corner, and a compact terracotta pot of simple green foliage at the far-right edge; no flowers. A few warm lit windows and one modest wall lantern along the outer left loggia, copper highlights on the stone, deep blue shadows. Architecture is characteristic Venetian masonry, not Japanese, no giant central arch obscuring the scene. The basilica, canal and stone terrace are the main impression.

### taj

Use case: stylized-concept
Asset type: full-frame environment artwork for Surround, a contemplative pixel-art Go game.
Style: exquisite handcrafted 16-bit pixel-art landscape, crisp small square pixel clusters, controlled dithering, rich restrained colors, atmospheric depth and readable architectural silhouettes. Match the visual feel of a detailed retro adventure-game background; not photorealistic, not smooth painterly concept art, not low-detail voxel art.
Composition: exactly 1672x941 landscape, level eye-height camera, no Dutch angle. An inviting empty perfectly LEVEL terrace occupies the lower 25-28% of the image, suitable for a game table added later. Clear quiet center, landmarks and atmosphere behind it. Floor paving/planks have coherent even geometry, straight level rear edge, no sloping floor. Layerable composition with a little separated foreground foliage at the outer edges and cloud wisps well clear of the foreground.
Constraints: full scene only, no Go board or game stones, no furniture, no people, no animals, no flags, no text, no signs, no logos, no watermarks, no UI. Sun must stay OUTSIDE THE FRAME, gentle light with no glaring disk or lens flare. Tasteful, tranquil, not a crowded tourist postcard.
Location: Agra, India, on an empty shaded red-sandstone garden pavilion terrace at dawn, looking toward the Taj Mahal. The recognizable white marble mausoleum with its large onion dome and FOUR slender minarets sits beyond formal gardens and a long narrow reflecting pool. A slightly off-axis but calm balanced viewpoint: landmark centered toward the right, pool receding through the middle. Pearly peach-lavender sky, delicate wisps, a low morning mist ribbon along the garden, marble softly catching first light; no visible sun. Dark slender cypresses punctuate the gardens without repeated cloned spacing. A feathery neem branch enters only from the upper-left corner and another small green bough at the far-right edge. Quiet red-sandstone terrace with a low carved red parapet fills the bottom quarter; central floor empty and perfectly level. Soft pool reflections, crisp white marble architectural detail, green and muted warm sandstone palette. Respectful architectural landscape, no crowds, no modern city clutter.

### santorini

Use case: stylized-concept
Asset type: full-frame environment artwork for Surround, a contemplative pixel-art Go game.
Style: exquisite handcrafted 16-bit pixel-art landscape, crisp small square pixel clusters, controlled dithering, rich restrained colors, atmospheric depth and readable architectural silhouettes. Match the visual feel of a detailed retro adventure-game background; not photorealistic, not smooth painterly concept art, not low-detail voxel art.
Composition: exactly 1672x941 landscape, level eye-height camera, no Dutch angle. An inviting empty perfectly LEVEL terrace occupies the lower 25-28% of the image, suitable for a game table added later. Clear quiet center, landmarks and atmosphere behind it. Floor paving/planks have coherent even geometry, straight level rear edge, no sloping floor. Layerable composition with a little separated foreground foliage at the outer edges and cloud wisps well clear of the foreground.
Constraints: full scene only, no Go board or game stones, no furniture, no people, no animals, no flags, no text, no signs, no logos, no watermarks, no UI. Sun must stay OUTSIDE THE FRAME, gentle light with no glaring disk or lens flare. Tasteful, tranquil, not a crowded tourist postcard.
Location: Oia, Santorini, Greece, from a peaceful private whitewashed terrace overlooking the Aegean caldera on a clear mild afternoon. Characteristic white cubic houses and two modest blue-domed churches cascade down the RIGHT hillside at different depths, not a row of identical domes. The LEFT and center open onto a deep azure sea and hazy volcanic islands, horizon straight near y390. Soft high pale clouds above. One SMALL distant white sailboat sits on open sea left of center, with lots of empty water around it. Foreground broad warm pale-stone paving with a low rounded white parapet at y680, absolutely flat and empty, shaded at one side. A gnarled olive branch enters from the upper-left corner with sparse silver-green leaves; a little green foliage in a simple clay pot at far right. No bougainvillea or cherry blossoms. Refined warm cream, cobalt, silvery sage and turquoise, soft sun outside frame, bright but not blinding, slightly textured hand-built walls. Peaceful atmosphere, no crowds or tourist furniture.

### petra

Use case: stylized-concept
Asset type: full-frame environment artwork for Surround, a contemplative pixel-art Go game.
Style: exquisite handcrafted 16-bit pixel-art landscape, crisp small square pixel clusters, controlled dithering, rich restrained colors, atmospheric depth and readable architectural silhouettes. Match the visual feel of a detailed retro adventure-game background; not photorealistic, not smooth painterly concept art, not low-detail voxel art.
Composition: exactly 1672x941 landscape, level eye-height camera, no Dutch angle. An inviting empty perfectly LEVEL terrace occupies the lower 25-28% of the image, suitable for a game table added later. Clear quiet center, landmarks and atmosphere behind it. Floor paving/planks have coherent even geometry, straight level rear edge, no sloping floor. Layerable composition with a little separated foreground foliage at the outer edges and cloud wisps well clear of the foreground.
Constraints: full scene only, no Go board or game stones, no furniture, no people, no animals, no flags, no text, no signs, no logos, no watermarks, no UI. Sun must stay OUTSIDE THE FRAME, gentle light with no glaring disk or lens flare. Tasteful, tranquil, not a crowded tourist postcard.
Location: Petra, Jordan, a peaceful broad sandstone overlook facing the Treasury (Al-Khazneh) at late blue hour. The iconic finely carved two-story rose-red rock facade is visible across a quiet open forecourt slightly right of center, embedded in huge natural layered sandstone canyon walls. Unequal eroded cliffs frame an open indigo strip of evening sky in the upper center; authentic Nabataean rock-carved architecture, not a freestanding palace or fantasy temple. The top 25% contains a little sky with very thin violet clouds and a few emerging tiny stars. Restrained warm amber lantern light grazes parts of the rose stone from low lamps near the facade; deep cool canyon shade. Foreground broad empty flat sandstone platform fills lower quarter, subtle block paving and low rough stone edge, no steps through the central floor. A very sparse desert shrub with fine wiry twigs at the far LEFT lower edge and a small tuft of dry grass at the far RIGHT lower edge. A little fine dust close to the canyon floor, not a sandstorm. Quiet, majestic, austere, no fabric awnings, no flags, no camels, no people or candles arranged into symbols.

### patagonia

Use case: stylized-concept
Asset type: full-frame environment artwork for Surround, a contemplative pixel-art Go game.
Style: exquisite handcrafted 16-bit pixel-art landscape, crisp small square pixel clusters, controlled dithering, rich restrained colors, atmospheric depth and readable architectural silhouettes. Match the visual feel of a detailed retro adventure-game background; not photorealistic, not smooth painterly concept art, not low-detail voxel art.
Composition: exactly 1672x941 landscape, level eye-height camera, no Dutch angle. An inviting empty perfectly LEVEL terrace occupies the lower 25-28% of the image, suitable for a game table added later. Clear quiet center, landmarks and atmosphere behind it. Floor paving/planks have coherent even geometry, straight level rear edge, no sloping floor. Layerable composition with a little separated foreground foliage at the outer edges and cloud wisps well clear of the foreground.
Constraints: full scene only, no Go board or game stones, no furniture, no people, no animals, no flags, no text, no signs, no logos, no watermarks, no UI. Sun must stay OUTSIDE THE FRAME, gentle light with no glaring disk or lens flare. Tasteful, tranquil, not a crowded tourist postcard.
Location: Torres del Paine, Chilean Patagonia, from a sheltered lakeside lodge deck overlooking a turquoise glacial lake toward the recognizable rugged Cuernos del Paine massif. Irregular dark rock horns with pale granite bands, patches of snow, and receding jagged ridges, dramatically varied heights and distances; no repeating three identical cone mountains. A crisp cool morning, pale blue sky with long thin wind-stretched white clouds crossing high above the mountains and a few low mist streamers near the far shore. Lake fills the middle band around y440..650, subtle silver wind ripples, no large foreground boat. A nearby wind-shaped southern beech bough with small amber/olive leaves frames the UPPER LEFT edge; tussock grasses frame only the LOWER RIGHT edge beyond the deck. Foreground wide empty level weathered timber deck in bottom quarter, horizontal low simple timber rail at y690; warm wood against teal lake and slate mountain palette. Soft sunlight outside frame makes the granite luminous without glare. Magnificent landscape but contemplative, no lodge buildings blocking the view, no people or animals.
