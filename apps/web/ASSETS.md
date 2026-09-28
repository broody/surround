# Artwork

For new characters and expression variants, use the [character portrait guide and reusable prompt](CHARACTER_ART_GUIDE.md). Ayu v2 and the existing player portraits define the approved pixel-art style.

The original environment and two portraits were generated individually with the built-in image-generation tool, followed by five separate layered garden assets. No CLI/API fallback was used. The existing logo was copied from `concept-art/surround-pixel-logo-v3.png`. Each asset is saved inside this app and consumed directly by the UI.

| File in `public/assets/` | Purpose |
| --- | --- |
| `moonlit-dojo.png` | Full-screen background, without a baked-in board or interface |
| `player-black.png` | First player's original character portrait |
| `player-white.png` | Second player's original character portrait |
| `surround-logo.png` | Existing two-stone logo iteration |

The grid, wood surface, stones, shadows, hover preview and last-move marker are deterministic Pixi graphics and generated pixel textures. HUD frames and controls are HTML/CSS. Fonts are bundled locally through Fontsource.

## Living garden

Five **world scenes** add Venice at blue hour, the Taj Mahal at dawn, Santorini in the afternoon, Petra afterglow and Torres del Paine in Patagonia. Each has its own full-size original, clean backing, transparent foliage and cloud PNGs generated with built-in imagegen. Registered canvas layers animate clouds, branches and restrained particles; water, lamps, stars and a distant sailboat move where appropriate. Landmarks and level floors remain fixed. See [WORLD_SCENES.md](WORLD_SCENES.md) for all 20 saved assets, exact prompts, composition details and verification.

The **Great Wall autumn** scene uses the approved open-valley terrace with built-in-imagegen clean backing, transparent sky wisps and nearby autumn tree cutouts. Clouds drift behind the fixed skyline, tree crowns rustle behind the stone parapet, and amber leaves tumble at two depths. The flag and pole were removed at the user's request. See [GREAT_WALL_LAYERS.md](GREAT_WALL_LAYERS.md) for saved assets, exact prompts and layer registrations.

The **Fuji morning** scene uses the approved pine-framed Mount Fuji concept, built-in-imagegen clean backings and registered transparent pine/cloud layers. Four tree regions bend independently, separate cloud banks drift behind the mountain and across its lower slopes, and code-drawn white pixel birds fly individually behind the pines, with at most two overlapping. The lake reflection ripples and glistens, and sparse warm pixel motes drift near the trees. The railing, level deck and central mountain stay fixed. See [FUJI_LAYERS.md](FUJI_LAYERS.md) for workspace asset paths, exact generation prompts and composition details.

The **Eventide platform** uses the approved black-hole concept, a built-in-imagegen backing plate and four registered transparent floating-island cutouts. A runtime pixel warp slowly bends the horizon's edge and nearby accretion light, leaving its dark center and the terrace fixed; no extra raster assets are needed for the distortion. Islands drift, stars twinkle, cyan lamps breathe and gold floor reflections shimmer. See [EVENTIDE_LAYERS.md](EVENTIDE_LAYERS.md) for saved assets, exact prompts, registration details and animation notes.

The **Lunar quiet** scene uses the approved no-Sun lunar terrace with the supplied SpaceX logo. Built-in imagegen provides a dish-free backing patch and a transparent dish cutout; the rest of the approved scene stays fixed. Existing stars softly pulse, rare shooting stars cross the sky, the dish scans slowly, small station lights breathe, and sparse dust follows low-gravity arcs. Earth has only a faint source-masked atmospheric/cloud shimmer. See [LUNAR_LAYERS.md](LUNAR_LAYERS.md) for asset paths, prompts and registrations.

The **Tatami study room** uses the approved modern empty-room concept with uniform mat columns. Three imagegen-derived assets provide a clean outdoor/clock backing, transparent outdoor tree canopies and transparent clouds. Only window apertures and the inner clock face are replaced; the room and floor stay fixed. See [MODERN_LAYERS.md](MODERN_LAYERS.md) for saved paths, exact built-in prompts and animation details.

The indoor **Sunlit training dojo** uses the approved daytime concept, an imagegen-inpainted outdoor backing plate, and a transparent tree sheet split into two independently moving cutouts at runtime. The original indoor architecture is retained exactly; source-derived masks and code-rendered light shafts/motes animate the sunlight. See [SUNLIT_LAYERS.md](SUNLIT_LAYERS.md) for the exact built-in image-generation prompts, saved assets and animation details. All earlier environments remain available.

The cloud-sea pavilion adds a clean plate, two transparent cherry-blossom boughs, a transparent sky bank and valley mist bank derived individually from the user's approved image. It is the new default; both earlier scenes remain selectable. See [PAVILION_LAYERS.md](PAVILION_LAYERS.md) for the exact prompts, registrations, reconstruction caveat and compositing order.

The winter scene adds a clean plate and two transparent pine cutouts derived from the approved level-floor concept. See [WINTER_LAYERS.md](WINTER_LAYERS.md) for source paths, exact built-in image-generation prompts, composition and animation details. The original concept remains available as a fallback and as a foreground matte.

`src/scene/GardenScene.tsx` now composes an inpainted clean plate with real transparent foliage and cloud PNGs. `src/scene/layers.ts` registers the cutouts, bends branches around fixed attachment points, and creates a landscape/architecture matte so clouds drift behind the scenery. The original lake scanline shimmer, reflection glints, moon halo and independent pagoda window dimming are retained. The canvas shares the artwork's responsive 1672×941 cover transform and runs at up to 24 fps only while motion is enabled and the page is visible. See [GARDEN_LAYERS.md](GARDEN_LAYERS.md) for the layer inventory, reconstruction caveat and exact generation prompts.

## Background prompt

Use case: stylized-concept. Asset type: standalone background artwork for the Surround pixel-art Go game, to place behind a functional React game UI. Create an exquisite widescreen 16:9 Japanese Go dojo at blue hour in authentic detailed 16-bit pixel art. View from inside a traditional dark timber room through wide open shoji panels onto a tranquil moonlit garden, reflective pond, maple branches, a distant pagoda and misty indigo mountain silhouettes. Large warm amber paper lantern in the far left foreground and a smaller lantern at the far right, tatami floor and dark wood veranda at bottom. Composition: visual interest at left and right outer edges, center softly detailed and low contrast because a real Go board interface will overlay the middle 60%. Rich dark navy, desaturated forest teal, blue-gray moonlight, restrained golden amber lighting. Crisp square pixel clusters, carefully crafted retro adventure-game environment, contemplative atmosphere. Full bleed artwork only. Absolutely NO board, NO stones, NO people, NO game UI, NO text, NO typography, NO logo, NO watermark. Landscape 16:9.

## Black-player portrait prompt

Use case: stylized-concept. Asset type: independent player avatar portrait for Surround, a pixel-art Go game. Square crop, close-up bust portrait of an original thoughtful young adult Japanese man with tousled dark hair, amber eyes, dark indigo casual kimono with cream collar. Looking slightly right with calm determination, fingers resting thoughtfully near chin. Authentic crisp 16-bit pixel art portrait, deliberately visible medium-sized square pixels, limited navy, warm ivory and muted gold palette, warm lantern rim light on face. Simple dark navy background with subtle shoji silhouette. Attractive composition designed to be readable at 160px square in a game HUD. No frame, no text, no logo, no watermark. Original character, no existing anime likeness.

## White-player portrait prompt

Use case: stylized-concept. Asset type: independent second player avatar portrait for Surround, a pixel-art Go game. Square crop, close-up bust portrait of an original serene young adult Japanese woman with long dark teal-black hair tied back, pale gray-blue eyes, ivory kimono with muted sage collar. Looking slightly left with composed confidence. Authentic crisp 16-bit pixel art portrait, deliberately visible medium-sized square pixels, limited dark navy, warm ivory and sage palette, cool moonlight with a tiny warm lantern rim light. Simple dark navy background with a subtle garden silhouette. Attractive composition designed to be readable at 160px square in a game HUD. No frame, no text, no logo, no watermark. Original character, no existing anime likeness.
