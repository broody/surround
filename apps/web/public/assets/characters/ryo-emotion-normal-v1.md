# Ryo Kanzaki — normal emotion v1

Method: built-in `image_gen.imagegen`, one identity-preserving edit per state.
Reference: [approved portrait](rank-professional-ryo-portrait-v3.png). Opaque background preserved.

## Exact prompt

```text
Use case: identity-preserve.
Asset type: one square chest-up emotion portrait for Surround, a pixel-art Go game.
Input image 1: approved portrait of Ryo Kanzaki; identity, wardrobe, pixel scale, palette, lighting and backdrop reference. It is the edit target, not a style-only example.
Character:Ryo Kanzaki, a striking Japanese man aged 40, professional Go player. Facial geometry: extremely LONG NARROW face with high temples, blade-like cheekbones and a long squared chin; narrow widely spaced fox-like eyes; one eyebrow naturally higher; thin high-bridged nose with a sharp tip; wide straight mouth with thin lips; subtle vertical scar beside the left eye. Hair: jet-black undercut with a long sculpted top swept backward and one narrow silver streak above the right temple. Clean-shaven. Clothing: structured midnight-violet kimono-suit hybrid with a broad black asymmetric lapel, crisp ivory inner collar, deep emerald seam accent, and matte silver collar clasp.
LOCK: exactly preserve this person's facial geometry, age, skin tone, features and asymmetry, hairstyle and accessories. Preserve the same outfit design, colors, jewelry, lighting and flat navy background. No beautifying, de-aging, mirroring or generic replacement face.
Style: preserve the reference's visibly coarse premium 16-bit pixel art, large square pixels, staircase edges and clean contiguous clusters, restrained 24–32 colors, 3–4 shades per material. No painterly blur, smooth gradients, fine strands or high-resolution anime detail.
INTENTIONAL CHANGES: expression AND upper-body pose. Square close portrait, head through mid-chest or upper waist only as needed for the gesture. Face and identity remain large and legible at 150px. Entire hairstyle inside frame. Same original character acting the emotion; naturally drawn hands allowed where the state requires.
One character, one portrait. No props, board, game pieces, scenery, lettering, text, badges, frame, UI, logos, watermark or comparison sheet.
State: NORMAL / neutral attentive.
Expression: relaxed brows, calmly focused eyes, relaxed cheeks and closed neutral mouth, no pronounced smile or frown.
Body: balanced upright posture, level relaxed shoulders, arms resting naturally. Calm readiness.
```

