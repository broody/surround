# Yuna Seki — frustrated emotion v3

Method: built-in `image_gen.imagegen`, identity-preserving facial-expression edit.
Edit target: [v2 frustrated portrait](yuna-emotion-frustrated-v2.png).
Expression reference: [original v1 frustrated portrait](yuna-emotion-frustrated-v1.png).
Existing opaque navy background preserved; `transparent_background: false`.

## Exact prompt

```text
Use case: identity-preserve.
Asset type: square pixel-art emotion portrait for Surround.
Character: Yuna Seki, a Japanese woman aged 19 and an expressive 20-kyu beginner. Preserve the same adult identity, broad round face, short lower face, full cheeks, small chin, dark eyes, freckles, button nose, characteristic front-tooth gap, black bubble ponytail, blunt bangs and side wisps. Preserve her mint zip hoodie with peach lining, plum mock-neck top and cobalt zipper pull.
STYLE AND COMPOSITION LOCK: match input image 1's visibly coarse 16-bit pixel rendering, large square pixel clusters, stepped edges, restrained palette, shading, framing, lighting and opaque navy background. Keep hands, hairstyle, face, hoodie and background in the same locations and proportions. No smooth illustration rendering, fine hair strands, blur, new props, extra fingers, text, logos or watermark. Do not de-age her or redesign her facial proportions; natural expression changes are allowed.
Input image 1: yuna-emotion-frustrated-v2.png, the edit target. Preserve its ONE PALM-UP gesture, hand anatomy, uncrossed arms, outfit, hairstyle, background and pixel style.
Input image 2: yuna-emotion-frustrated-v1.png, the reference for facial expression and emotional intensity only. Do not copy its crossed arms.
PRIMARY EDIT: replace the mild puzzled pout of input 1 with the SAME PRONOUNCED FRUSTRATION shown in input 2. Use strongly knitted and lowered brows with a clear crease between them, narrowed annoyed eyes with one more narrowed than the other, slightly scrunched nose, and a tense uneven downturned mouth, matching input 2's visibly irritated frown and small grimace. Express clear exasperation after a beginner Go mistake. Her expression should be as frustrated and readable as the original v1 portrait, with the existing palm-up gesture now reading 'come on!' rather than confusion. Do not make her sad, serene, mildly puzzled or smiling. Do not add screaming or tears. Keep the face recognizable and preserve all other parts of input 1.
```

