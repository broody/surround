# Yuna Seki — excited emotion v3

Method: built-in `image_gen.imagegen`, identity-preserving facial-expression edit.
Edit target: [v2 excited portrait](yuna-emotion-excited-v2.png).
Expression reference: [original v1 excited portrait](yuna-emotion-excited-v1.png).
Existing opaque navy background preserved; `transparent_background: false`.

## Exact prompt

```text
Use case: identity-preserve.
Asset type: square pixel-art emotion portrait for Surround.
Character: Yuna Seki, a Japanese woman aged 19 and an expressive 20-kyu beginner. Preserve the same adult identity, broad round face, short lower face, full cheeks, small chin, dark eyes, freckles, button nose, characteristic front-tooth gap, black bubble ponytail, blunt bangs and side wisps. Preserve her mint zip hoodie with peach lining, plum mock-neck top and cobalt zipper pull.
STYLE AND COMPOSITION LOCK: match input image 1's visibly coarse 16-bit pixel rendering, large square pixel clusters, stepped edges, restrained palette, shading, framing, lighting and opaque navy background. Keep hands, hairstyle, face, hoodie and background in the same locations and proportions. No smooth illustration rendering, fine hair strands, blur, new props, extra fingers, text, logos or watermark. Do not de-age her or redesign her facial proportions; natural expression changes are allowed.
Input image 1: yuna-emotion-excited-v2.png, the edit target. Preserve its TWO PEACE SIGNS, hand anatomy, arm pose, outfit, hairstyle, background and pixel style.
Input image 2: yuna-emotion-excited-v1.png, the reference for facial expression and emotional intensity only. Do not copy its fist.
PRIMARY EDIT: replace the restrained smiling facial expression of input 1 with the SAME ENTHUSIASTIC EXCITEMENT shown in input 2. Use a broad OPEN-MOUTH joyful grin with visible upper teeth, her small characteristic front-tooth gap, a visible dark mouth opening and tongue, lifted cheeks, clearly raised eyebrows and brighter wider eyes. Match the original excited portrait's delight and energy closely. Her face should read as thrilled with a successful Go move, with both peace signs celebrating. The open-mouth grin must be clearly visible at 88px. Keep the face recognizable and preserve all other parts of input 1.
```

