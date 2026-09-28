# Surround character portraits

Use this guide when generating new characters or expressions for study, story, and P2P dialogue. Ayu v2 is the approved reference for the portrait style. Keep the style block below fixed; change the character description and expression.

## Reference images

Paths are relative to this directory.

- Primary style reference: `public/assets/characters/ayu-portrait-v2.png` — approved pixel scale, face framing, and shading.
- Supporting style references: `public/assets/player-black.png` and `public/assets/player-white.png`.
- Ayu's exact successful generation prompt: [ayu-portrait-v2.md](public/assets/characters/ayu-portrait-v2.md).
- `public/assets/characters/ayu-v1.png` is the earlier identity reference, **not** the approved rendering style: it has too much fine detail and too much body for a dialogue portrait.

Attach the actual reference images to imagegen, not just their filenames. Clearly distinguish an identity reference from style references. For a new character, use the approved portraits for rendering only; do not reproduce their faces.

## Reusable new-character prompt

Replace the bracketed character fields before generation.

```text
Use case: stylized-concept.
Asset: one square dialogue portrait for Surround, a pixel-art Go game.

References: the attached Ayu and player portraits are STYLE references only.
Match their pixel scale, face framing, palette restraint, and rendering.
Create a distinct original person, not a copy of any reference character.

Character: [NAME], [AGE / ADULT AGE RANGE], [GENDER AND BACKGROUND IF SPECIFIED].
Role and personality: [TEACHER / RIVAL / STORY CHARACTER; 2–3 PERSONALITY TRAITS].
Appearance: [FACE, EYES, HAIR, DISTINCTIVE FEATURES].
Clothes: [OUTFIT, COLLAR, ONE OR TWO MUTED ACCENT COLORS].
Expression: [SPECIFIC EXPRESSION].
Gaze: [TOWARD VIEWER / SLIGHTLY LEFT / SLIGHTLY RIGHT].

HEAD AND SHOULDERS ONLY. Face fills most of the square like the attached
player portraits. Keep the top of the hair inside the frame with a small
margin. Show the collar and upper shoulders. No hands or held objects.

Render as if hand-pixeled on a 128×128 source canvas, displayed by integer
nearest-neighbor enlargement: visibly LARGE consistent square pixel blocks,
staircase contours, simplified clean contiguous pixel clusters, a restrained
24–32 color palette, 3–4 shades per material, and blocky expressive eyes.
No individual hairline strands, fine dithering, tiny high-resolution detail,
smooth gradients, airbrushed shading, or painterly blur. It must read as a
classic 16-bit RPG dialogue portrait at 150px wide, not a detailed anime
painting with a pixel filter.

Use dark navy and blue-gray shadows, warm ivory highlights, natural skin
tones, and muted clothing accents. Simple dark navy backdrop. Preserve charm
and readability through strong shapes and clear facial features.

One square portrait only. No full body, waist-up composition, scenery,
dialogue box, frame, lettering, UI, logo, watermark, or comparison sheet.
Original character; no existing anime likeness.
```

## Existing character / expression variant

Attach the approved portrait of that character as reference 1. Use the other portraits as style references if needed. Replace the new-character reference and identity paragraphs above with:

```text
Reference 1 is the approved identity and rendering to preserve. Keep the
same face, age, hairstyle, hair accessory, clothing, palette, head scale,
crop, gaze direction, lighting, and background. Change only the expression
to [EXPRESSION]. Keep the same coarse pixel clusters and simplified shading.
Do not add props or change the character's identity.
```

For Ayu: adult Japanese woman, warm brown eyes, dark low bun with a wooden hairpin, welcoming expression, muted teal robe and ivory collar. Suitable variants include patient explanation, gentle encouragement, thoughtful hint, and pleased approval.

## Check and save

1. Use the built-in imagegen tool and inspect the output beside the approved portraits.
2. Check at actual UI size: about 150px on desktop and 88px on mobile. The face should fill the portrait and the pixel clusters should remain visible.
3. Distinguish image dimensions from visual pixel scale. The approved player portraits and Ayu v2 are 1254×1254 PNGs, but depict much coarser artwork. A large exported PNG is acceptable when the underlying visual detail matches; merely setting `image-rendering: pixelated` does not simplify detailed artwork.
4. Save a new version in `public/assets/characters/<name>-portrait-v<N>.png`. Preserve approved previous versions.
5. Save the exact final prompt, reference paths, and generation method alongside it in a matching Markdown file.
6. Display with `image-rendering: pixelated`, preserve aspect ratio, and verify the crop in the dialogue component before replacing the current asset.
