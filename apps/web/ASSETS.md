# Artwork

The original environment and two portraits were generated individually with the built-in image-generation tool, followed by five separate layered garden assets. No CLI/API fallback was used. The existing logo was copied from `concept-art/surround-pixel-logo-v3.png`. Each asset is saved inside this app and consumed directly by the UI.

| File in `public/assets/` | Purpose |
| --- | --- |
| `moonlit-dojo.png` | Full-screen background, without a baked-in board or interface |
| `player-black.png` | First player's original character portrait |
| `player-white.png` | Second player's original character portrait |
| `surround-logo.png` | Existing two-stone logo iteration |

The grid, wood surface, stones, shadows, hover preview and last-move marker are deterministic Pixi graphics and generated pixel textures. HUD frames and controls are HTML/CSS. Fonts are bundled locally through Fontsource.

## Living garden

The cloud-sea pavilion adds a clean plate, two transparent cherry-blossom boughs, a transparent sky bank and valley mist bank derived individually from the user's approved image. It is the new default; both earlier scenes remain selectable. See [PAVILION_LAYERS.md](PAVILION_LAYERS.md) for the exact prompts, registrations, reconstruction caveat and compositing order.

The winter scene adds a clean plate and two transparent pine cutouts derived from the approved level-floor concept. See [WINTER_LAYERS.md](WINTER_LAYERS.md) for source paths, exact built-in image-generation prompts, composition and animation details. The original concept remains available as a fallback and as a foreground matte.

`src/scene/GardenScene.tsx` now composes an inpainted clean plate with real transparent foliage and cloud PNGs. `src/scene/layers.ts` registers the cutouts, bends branches around fixed attachment points, and creates a landscape/architecture matte so clouds drift behind the scenery. The original lake scanline shimmer, reflection glints, moon halo and independent pagoda window dimming are retained. The canvas shares the artwork's responsive 1672×941 cover transform and runs at up to 24 fps only while motion is enabled and the page is visible. See [GARDEN_LAYERS.md](GARDEN_LAYERS.md) for the layer inventory, reconstruction caveat and exact generation prompts.

## Background prompt

Use case: stylized-concept. Asset type: standalone background artwork for the Surround pixel-art Go game, to place behind a functional React game UI. Create an exquisite widescreen 16:9 Japanese Go dojo at blue hour in authentic detailed 16-bit pixel art. View from inside a traditional dark timber room through wide open shoji panels onto a tranquil moonlit garden, reflective pond, maple branches, a distant pagoda and misty indigo mountain silhouettes. Large warm amber paper lantern in the far left foreground and a smaller lantern at the far right, tatami floor and dark wood veranda at bottom. Composition: visual interest at left and right outer edges, center softly detailed and low contrast because a real Go board interface will overlay the middle 60%. Rich dark navy, desaturated forest teal, blue-gray moonlight, restrained golden amber lighting. Crisp square pixel clusters, carefully crafted retro adventure-game environment, contemplative atmosphere. Full bleed artwork only. Absolutely NO board, NO stones, NO people, NO game UI, NO text, NO typography, NO logo, NO watermark. Landscape 16:9.

## Black-player portrait prompt

Use case: stylized-concept. Asset type: independent player avatar portrait for Surround, a pixel-art Go game. Square crop, close-up bust portrait of an original thoughtful young adult Japanese man with tousled dark hair, amber eyes, dark indigo casual kimono with cream collar. Looking slightly right with calm determination, fingers resting thoughtfully near chin. Authentic crisp 16-bit pixel art portrait, deliberately visible medium-sized square pixels, limited navy, warm ivory and muted gold palette, warm lantern rim light on face. Simple dark navy background with subtle shoji silhouette. Attractive composition designed to be readable at 160px square in a game HUD. No frame, no text, no logo, no watermark. Original character, no existing anime likeness.

## White-player portrait prompt

Use case: stylized-concept. Asset type: independent second player avatar portrait for Surround, a pixel-art Go game. Square crop, close-up bust portrait of an original serene young adult Japanese woman with long dark teal-black hair tied back, pale gray-blue eyes, ivory kimono with muted sage collar. Looking slightly left with composed confidence. Authentic crisp 16-bit pixel art portrait, deliberately visible medium-sized square pixels, limited dark navy, warm ivory and sage palette, cool moonlight with a tiny warm lantern rim light. Simple dark navy background with a subtle garden silhouette. Attractive composition designed to be readable at 160px square in a game HUD. No frame, no text, no logo, no watermark. Original character, no existing anime likeness.
