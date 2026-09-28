# Modern tatami study room — animation layers

The source is the approved uniform-floor concept, `../../concept-art/modern-tatami-study-room-v2.png`. Assets were generated using the imagegen skill and the built-in image-generation tool (no CLI fallback).

## Assets

All paths below are relative to `apps/web/`.

| Asset | Purpose |
| --- | --- |
| `public/assets/modern/original.png` | Approved room, retained unchanged as the indoor base and loading/error fallback |
| `public/assets/modern/clean-plate.png` | Inpainted trees/clouds backing plus handless clock; used only inside window panes and the clock face |
| `public/assets/modern/outdoor-trees.png` | Transparent outdoor canopy sheet, 1672×941 |
| `public/assets/modern/clouds.png` | Transparent cloud sheet, 1671×941; sampled at native scale without stretching |

The inpainted building details behind the trees are reconstructed artwork, not recovered original pixels. Generated outdoor cutouts approximate the painted source; the interior and uniform tatami remain the original image.

## Composition and motion

`src/scene/ModernScene.tsx` draws the original room, replaces only the four window apertures and inner clock face, then adds the animated layers. Window mullions, blinds, sill, all indoor plants, furnishings and tatami are stationary. A hand-traced skyline clips the cloud layer behind buildings. Clouds drift at 0.85 source pixels per second on a 420-pixel repeating strip. Connected six-pixel foliage strips bend by at most 2.8 source pixels, anchored behind the sill. The original clock rim is retained; code-drawn hour, minute and second hands show the device's local system time on a 12-hour face, ticking once per second. Each paint reads a fresh local `Date`, so timezone changes, clock corrections and tab suspension do not accumulate drift. This is a visual tick only, with no new sound.

The shared `SceneCanvas` animation clock drives weather at up to 24 fps. Pause, hidden tabs, and reduced-motion preference freeze the scene. Weather resumes from its frozen position; the wall clock immediately resyncs to local time on the next paint. Small-screen crops favor the windows. Scene selection preserves the current Go position; the default remains Cloud-sea pavilion.

## Checks

- Production build and all 30 frontend tests pass.
- Seven deterministic motion tests cover local-time conversion, noon/midnight, resync, ticking cadence, relative hand rates, anchored foliage, cloud wrap continuity and frozen weather. The room tests also run under UTC, Asia/Shanghai and America/New_York to check local rather than UTC clock hands.
- Browser preview checks cover successful asset loading, garden/board views and pause/resume.
- Board teardown now removes only its own canvas/resources, without clearing Pixi's global pools used by other live boards or React StrictMode's replacement renderer. This fixes a blank-board transition uncovered during the scenery checks.

## Built-in image-generation prompts

Reference for all three calls: `concept-art/modern-tatami-study-room-v2.png`.

### Clean plate

Use case: precise-object-edit
Input image 1 is the edit target, a 1672 by 941 pixel-art room. Produce a perfectly registered full-frame animation clean plate at the same dimensions and crop.
Change ONLY these three things: (1) remove the green outdoor tree foliage visible through the right-hand windows, inpainting the hidden lower urban building facades/ground beyond; do not remove either indoor potted plant. (2) remove all white clouds visible through those same windows, continuing the pale blue sky behind them. Keep all urban buildings exactly stationary and unchanged wherever already visible. (3) remove the hands and central spindle of the small analog clock on the back wall, filling with its off-white clock face; retain clock rim, hour marks and numbers.
Preserve every other pixel as closely as possible, especially the uniform straight tatami columns, room geometry, window frames and blinds, lighting, plants and furniture. Same original crisp pixel-art style, no change of camera, no new elements, no text added. The room and windows are NOT transparent. Output one clean backing image, not a collage.

### Outdoor trees

Use case: background-extraction
Input image 1 is the extraction target. Extract ONLY the outdoor green tree canopies visible through the windows on the far right, roughly x1290..1672, y220..390 in the 1672x941 original. They must be isolated on a GENUINELY TRANSPARENT RGBA background. Retain all existing green leafy pixel clusters and their original colors, fine silhouettes and small gaps. Do not include indoor plants, building pixels, sky, window frames, blinds, window sill, room, shadows or any other object.
Keep EXACTLY the full original 1672x941 frame, same registration, scale and position: sparse tree foliage remains at the far right in its original location, with the entire rest of the image transparent. Do not center, enlarge, rearrange or redraw the trees. No borders, no checkerboard pattern baked in, no text. This full-frame transparent cutout will be flexed gently behind the stationary window mullions.

### Clouds

Use case: background-extraction
Input image 1 is the extraction target. Extract ONLY the pale white clouds visible in the blue sky through the right-hand windows, roughly x1290..1672, y65..230 in this 1672x941 source. Genuinely transparent RGBA background, preserve their original crisp pixel-art outlines and soft pale blue shaded pixels.
Keep EXACTLY the full original 1672x941 canvas and original position, scale and registration. Everything except clouds must be transparent: remove all blue sky, buildings, foliage, room, window frames, blinds and all other objects. Preserve only the floating white pixel-art cloud forms in the far upper-right. Do not center, enlarge or rearrange. No checkerboard pattern, no border, no text. Intended as slow-drifting cloud sprites behind stationary buildings and window frames.
