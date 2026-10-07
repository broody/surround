# Nanami — excited emotion v1

Method: built-in `image_gen.imagegen`, one identity-preserving edit per state.
Reference: [approved portrait](rank-10kyu-nanami-portrait-v2.png). Opaque background preserved.

## Exact prompt

```text
Use case: identity-preserve.
Asset type: one square chest-up emotion portrait for Surround, a pixel-art Go game.
Input image 1: approved portrait of Nanami; identity, wardrobe, pixel scale, palette, lighting and backdrop reference. It is the edit target, not a style-only example.
Character:Nanami, an attractive Japanese woman aged 25, representing rank 10-kyu. Sociable, clever, growing bolder. Heart-shaped face, warm amber-brown eyes, glossy chin-length black bob with blunt micro-bangs, small beauty mark beneath her left eye. Clothing signature: muted emerald satin sukajan-inspired jacket with a broad cream ribbed collar and one simple coral-and-ivory wave motif visible on the near shoulder, black inner top.
LOCK: exactly preserve this person's facial geometry, age, skin tone, features and asymmetry, hairstyle and accessories. Preserve the same outfit design, colors, jewelry, lighting and flat navy background. No beautifying, de-aging, mirroring or generic replacement face.
Style: preserve the reference's visibly coarse premium 16-bit pixel art, large square pixels, staircase edges and clean contiguous clusters, restrained 24–32 colors, 3–4 shades per material. No painterly blur, smooth gradients, fine strands or high-resolution anime detail.
INTENTIONAL CHANGES: expression AND upper-body pose. Square close portrait, head through mid-chest or upper waist only as needed for the gesture. Face and identity remain large and legible at 150px. Entire hairstyle inside frame. Same original character acting the emotion; naturally drawn hands allowed where the state requires.
One character, one portrait. No props, board, game pieces, scenery, lettering, text, badges, frame, UI, logos, watermark or comparison sheet.
State: EXCITED.
Expression: raised eyebrows, bright widened eyes, lifted cheeks and broad joyful smile; visible upper teeth permitted when natural for this character.
Body: torso leaning forward, head slightly ahead of shoulders, shoulders lifted, one compact celebratory fist raised near the chest. Energetic joy after a good Go move, no aggression or shock.
```

