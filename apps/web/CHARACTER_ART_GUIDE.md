# Surround character portraits

Use this guide when generating new characters or emotion variants for study, story, and P2P dialogue. Ayu v2 is the approved reference for the portrait style. Keep the style block below fixed; change the character description, expression, and body-language fields.

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
Expression: normal / neutral attentive. This is the identity's baseline expression.
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

Generate and approve this neutral portrait before creating emotion variants. It becomes reference 1 for the standard emotion set below.

## Standard six-state emotion set

Every approved character should have these dialogue states:

1. `normal`
2. `excited`
3. `frustrated`
4. `serene`
5. `defeated`
6. `thinking`

Generate each state in a separate imagegen call. Attach the approved neutral portrait as reference 1. The goal is one recognizable identity acting through the whole upper body, not six similar faces pasted onto an unchanged pose.

Replace the bracketed fields in this prompt, then append one state block from the next section.

```text
Use case: identity-preserve.
Asset: one square chest-up dialogue portrait with expressive body language
for Surround, a pixel-art Go game.

Reference 1 is the approved identity and rendering to preserve: [NAME],
[ADULT AGE], [BACKGROUND].

LOCK identity: preserve the same facial geometry, age, skin tone, eyes,
eyebrows, nose, mouth, distinctive asymmetry, hairstyle, hair accessories,
facial hair, and recognizable features. Do not beautify, reshape, de-age,
mirror, or substitute a generic anime face.

LOCK wardrobe and art direction: preserve the same clothing design,
materials, colors, jewelry, background, lighting, restrained palette, and
coarse premium 16-bit pixel rendering. Keep visibly large square pixel
blocks, staircase contours, simplified contiguous clusters, 24–32 colors,
and 3–4 shades per material.

INTENTIONAL VARIABLES: change the facial expression AND upper-body language
as described in the state block. The torso angle, spine, shoulders, head
tilt, arms, and hands may change to communicate emotion. Frame from head to
mid-chest or upper waist as needed, while keeping the face readable at game
dialogue size. Hands may enter the frame when they clearly support the pose;
render them with natural anatomy.

One character only. No props, Go equipment, extra people, rank text,
dialogue box, UI, frame, logo, watermark, scenery, or comparison sheet.
Do not change the character's identity or outfit.
```

### State blocks

Append exactly one block per generation. Adapt left/right directions to the approved portrait when necessary.

Adapt emotion intensity to the character's temperament while keeping states visibly distinct at 150px and 88px. Ryo Kanzaki is a seasoned professional: his excitement is a modest closed-mouth smile, brighter eyes, and a slight forward lean with the torso turned toward the viewer; his frustration is knitted brows, a lowered focused gaze, and one relaxed hand lightly touching the temple. Keep shoulders low and professional composure intact. Avoid a broad grin, raised fist, tightly crossed arms, or dramatic scowl for Ryo. Facial changes alone were too similar to his normal and serene portraits; use restrained but distinct body language.

Luc Moreau plays at 1 dan and is patient, analytical, and good-humored. His excitement uses an easy pleased smile and a small open-palm gesture at chest level, rather than a raised fist. His frustration is mild disappointment with a thoughtful hand at his beard, a slightly lowered gaze, and relaxed shoulders. Keep both states distinct from normal and serene without tightly crossed arms or an angry scowl. Preserve his transparent background.

Nanami Ueda plays at 5 kyu. For normal and excited, use a coherent front three-quarter torso: both shoulders, jacket front panels, collar, neck, and arms share the same orientation, with the coral-and-ivory wave motif on the near upper sleeve. Avoid combining a turned-away back-view shoulder with a forward-facing chest. Keep her approved cheerful fist pump for excited. Frustrated uses a cute head-scratch beside or behind the bob with a small pout and no crossed arms. Defeated uses a sheepish pout, a gently bowed head, and loosely clasped hands below the face. Keep her whole face visible. Preserve her adult age and facial proportions; cuteness comes from acting, not de-aging.

Malik Diop plays at 10 kyu. Excited preserves his normal portrait's close crop, head size, three-quarter profile, and shoulder angle, with an amused closed-mouth smirk and one casual two-finger salute at his visible temple. Tilt his head slightly into the salute while keeping the shoulders steady. Keep the index and middle fingers together, with the elbow outside the crop. Frustrated uses both hands on his shaved head, spread fingers, raised and slightly knitted brows, widened eyes, and a slightly open mouth in disbelief. Defeated uses a rueful “ouch” reaction: tightly scrunched eyes, rounded O-shaped lips, a slightly tucked chin, and one loose fist partly shielding the side of his lower face. Keep the mouth and eyes readable, and retain the close crop. Preserve his cream-and-indigo bomber jacket, saffron shirt, silver hoop, coarse pixel clusters, and transparent background.

Yuna Seki plays at 20 kyu and reacts expressively. Match her original v1 portraits' emotion intensity. Excited uses both hands making clear peace signs beside her face, a broad open-mouth joyful grin with her characteristic front-tooth gap, lifted cheeks, raised brows, and bright eyes. Frustrated uses strongly knitted and lowered brows, narrowed annoyed eyes, and a tense uneven downturned mouth, with one palm turned upward in exasperation and the other arm resting lower. Preserve her adult age, broad round face, freckles, bubble ponytail, mint hoodie, coarse pixel clusters, and opaque navy background.

#### Normal

```text
State: NORMAL / neutral attentive.
Expression: relaxed brows, calmly focused eyes, relaxed cheeks, and a closed
mouth with no pronounced smile or frown.
Body language: balanced upright posture, level relaxed shoulders, and arms
resting naturally. Calm readiness with no tension or theatricality.
```

#### Excited

```text
State: EXCITED.
Expression: raised eyebrows, bright widened eyes, lifted cheeks, and a broad
joyful smile. An open mouth or visible upper teeth is allowed when it suits
the character.
Body language: torso leaning forward, head slightly ahead of the shoulders,
shoulders lifted, and one compact celebratory gesture such as a fist raised
near the chest. Energetic triumph, not aggression or shock.
```

#### Frustrated

```text
State: FRUSTRATED.
Expression: brows drawn inward, one eye narrowed more than the other, slight
nose tension, and lips pressed into an uneven line. Controlled irritation,
not rage or shouting.
Body language: upper spine slightly hunched, shoulders raised and rounded,
torso turned partly away, and arms crossed tightly or one hand gripping the
opposite upper arm. Bottled-up frustration after a mistake.
```

#### Serene

```text
State: SERENE.
Expression: softly lowered eyelids, smooth brow, relaxed jaw, and a very
small peaceful closed-mouth smile. Centered and alert, not sleepy or vacant.
Body language: tall effortless spine, open chest, shoulders dropped and
rolled gently back, and hands loose or softly folded in the lower frame.
No stiffness or prayer gesture.
```

#### Defeated

`Defeated` always means psychological disappointment after losing a quiet board game. The character is physically healthy and uninjured. Never use bruises, wounds, clutching the stomach or chest, a pain grimace, impact cues, kneeling, or combat imagery.

Choose the option that best suits the character and scene:

```text
State: DEFEATED — FACEPALM.
Expression and body language: shoulders sag forward. One elbow is braced
just below the frame while that palm covers the forehead and eyes, fingers
spread naturally into the hairline. The head bows into the hand and the
visible mouth forms a rueful tight line. Quiet self-reproach: “I cannot
believe I missed that.” No physical pain.
```

```text
State: DEFEATED — HEAD BURIED IN FOLDED ARMS.
Expression and body language: both forearms cross horizontally through the
lower portrait as though resting at an unseen table. The character folds
forward and rests the forehead and upper face into the sleeves. Hands remain
loose, not clenched; shoulders round in embarrassed resignation. Keep enough
of the face or distinctive hair visible to preserve identity. Do not draw a
table, board, or game pieces.
```

```text
State: DEFEATED — HEAD TILTED UP.
Expression and body language: torso leans slightly back, shoulders drop,
arms hang loose, and the head tilts far upward. Eyes close, inner brows rise,
jaw releases, and lips part in a long silent exhale: “that was the winning
move and I missed it.” Weary disbelief and acceptance, not agony or injury.
```

#### Thinking

`Thinking` means alert concentration while considering a Go move or calculating the score. Preserve the approved normal portrait's close crop, head scale, profile, and coarse pixel clusters. Fit a compact gesture around the face without zooming out, covering the eyes, or introducing props.

For the current cast: Yuna places an index finger on her cheek and looks upward inquisitively; Malik lightly pinches his goatee while looking down; Nanami rests her cheek on loose knuckles with an attentive gaze; Luc lightly steeples his fingertips below his chin; Ryo rests an index finger beside his lips in restrained professional concentration. Preserve each character's background and adult facial proportions.

```text
State: THINKING.
Expression: focused eyes, a closed thoughtful mouth, and brows attentive
rather than angry or sorrowful. Adapt intensity to the character.
Body language: one compact thinking gesture suited to the character,
relaxed shoulders, and a small head inclination. Keep the face large
and readable at 150px and 88px, with hands naturally connected.
```

## Expression-only variant

Use this smaller prompt only when the UI requires an almost motionless talking head. Attach the approved portrait as reference 1. Prefer the standard six-state prompt above when body language can fit.

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
7. Save standard emotion states as `public/assets/characters/<name>-emotion-<state>-v<N>.png`. Preserve rejected or superseded experiments until the replacement is approved.
8. Review defeated poses specifically for board-game meaning. Reject any pose that could be read as injury, illness, combat, or physical collapse.
