# Rank cast v3 — shared generation prompt

All v3 portraits were generated separately with the built-in imagegen tool. The sole reference was `ayu-portrait-v2.png`, used for rendering style only. For each portrait, the exact prompt was this shared block followed immediately by the character block recorded in its matching Markdown file.

```text
Use case: stylized-concept.
Asset type: one square dialogue portrait for Surround, a pixel-art Go game.
Input image: the attached Ayu portrait is a RENDERING-STYLE reference only. Match only its coarse pixel scale, restrained colors, close dialogue framing, and premium 16-bit finish. Create a completely original adult identity. Do NOT borrow Ayu's oval face, large almond eyes, small nose, soft smile, hairstyle, pose, teal robe, or feminine facial template.
Core diversity requirement: this character must have the exact distinctive facial geometry specified below. Avoid the generic attractive anime template. Preserve asymmetry, age, bone structure, eye size and shape, nose width/profile, mouth shape, ears, skin tone, and other individual traits.
Rendering: hand-pixeled as if on a 128×128 source canvas, integer nearest-neighbor enlarged; LARGE consistent square blocks, staircase contours, simplified contiguous clusters, 24–32 colors, 3–4 shades per material. Dark navy backdrop.
Composition: square head-and-shoulders portrait, face readable at 150px, complete hair silhouette inside frame, enough upper clothing visible to make the outfit a strong identifier. Follow the requested pose.
Constraints: one adult only; no hands, props, Go equipment, rank text or symbols, UI, frame, scenery, logo, watermark, or comparison sheet.
Avoid: copied anime likeness, same-face beauty template, uniformly large eyes, uniformly tiny noses, airbrush, smooth gradients, painterly blur, fine hair strands, or high-resolution pixel-filter art.
```
