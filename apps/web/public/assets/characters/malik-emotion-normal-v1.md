# Malik Diop — normal emotion v1

Method: built-in `image_gen.imagegen`, one identity-preserving edit per state.
Reference: [approved portrait](rank-10kyu-malik-portrait-v3.png). Existing alpha transparency preserved; `transparent_background: true`.

## Exact prompt

```text
Use case: identity-preserve.
Asset type: one square chest-up emotion portrait for Surround, a pixel-art Go game.
Input image 1: approved portrait of Malik Diop; identity, wardrobe, pixel scale, palette, lighting reference (existing background is transparent). It is the edit target, not a style-only example.
Character:Malik Diop, a handsome French-Senegalese man aged 29 living in Japan, 10-kyu player and one of only two foreign characters. Facial geometry: deep brown skin; long INVERTED-TRIANGLE face with very high cheekbones and narrow jaw; small close-set almond eyes; thick horizontal brows; broad flat nose with wide nostrils; full lips; distinct shallow cleft in chin. Hair: shaved head with a razor-clean hairline; neat narrow mustache and tiny pointed goatee. Clothing: cream bomber jacket with bold indigo geometric woven panels on collar and shoulders, saffron crew-neck shirt, small silver hoop in one ear.
LOCK: exactly preserve this person's facial geometry, age, skin tone, features and asymmetry, hairstyle and accessories. Preserve the same outfit design, colors, jewelry, lighting and existing transparent background with genuine alpha; no painted background. No beautifying, de-aging, mirroring or generic replacement face.
Style: preserve the reference's visibly coarse premium 16-bit pixel art, large square pixels, staircase edges and clean contiguous clusters, restrained 24–32 colors, 3–4 shades per material. No painterly blur, smooth gradients, fine strands or high-resolution anime detail.
INTENTIONAL CHANGES: expression AND upper-body pose. Square close portrait, head through mid-chest or upper waist only as needed for the gesture. Face and identity remain large and legible at 150px. Entire hairstyle inside frame. Same original character acting the emotion; naturally drawn hands allowed where the state requires.
One character, one portrait on a truly transparent background, preserve clean pixel edges. No props, board, game pieces, scenery, lettering, text, badges, frame, UI, logos, watermark or comparison sheet.
State: NORMAL / neutral attentive.
Expression: relaxed brows, calmly focused eyes, relaxed cheeks and closed neutral mouth, no pronounced smile or frown.
Body: balanced upright posture, level relaxed shoulders, arms resting naturally. Calm readiness.
```
