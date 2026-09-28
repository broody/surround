# Surround web preview

A scrolling pixel-art landing page and local two-player, 19×19 Go prototype built with React, TypeScript, Vite, Tailwind CSS and PixiJS. The landing extends the approved [visual concept](../../concept-art/surround-landing-v1.png), with the existing animated pavilion, Surround logo, a code-rendered board and three mode entry points. The hero keeps its natural size on short screens rather than shrinking to fit the viewport. Board geometry, stones, frames, icons and controls are rendered in code.

Reusable interface primitives live in `src/components/ui`. Use Tailwind utilities and the shared theme tokens for new layout, spacing, typography and interaction states. Keep feature-specific components beside their feature, and keep bespoke CSS for canvas presentation, complex pixel-art effects and scene animation.

## Run

```sh
cd apps/web
npm ci
npm run dev
```

Open http://localhost:5183. Node.js 22.12 or newer is supported by this frontend; the separate offchain SDK requires Node.js 24.

```sh
npm run build
npm test
```

## Play KataGo (local only)

The two-player board at http://localhost:5183/#play can seat [KataGo](https://github.com/lightvector/KataGo) as your opponent. The dev server runs KataGo as a GTP engine (`katago/bridge.ts`), so this needs `npm run dev` on a machine with a KataGo binary and network. Put their paths in `apps/web/.env.local`, which is gitignored:

```sh
KATAGO_BIN=/path/to/katago
KATAGO_MODEL=/path/to/kata1-b18c384nbt.bin.gz
# Optional: play like a human of a chosen rank rather than at full strength.
KATAGO_HUMAN_MODEL=/path/to/b18c384nbt-humanv0.bin.gz
# Optional; defaults to katago/human.cfg with a human model, else katago/gtp.cfg.
KATAGO_CONFIG=/path/to/gtp.cfg
```

Restart the dev server if it was already running. KataGo takes White when the page opens; **Start a new game** offers either color or a two-player game, and **Take back** returns to your previous move. KataGo plays Surround's rules (area scoring, positional superko, no suicide, 6.5 komi), may resign, and counts the board after two passes, removing the stones it judges dead.

At full strength, `katago/gtp.cfg` searches 500 visits per move, far beyond professional level; even one visit is far beyond kyu players. For a human-level opponent, download KataGo's human SL network, [`b18c384nbt-humanv0.bin.gz`](https://github.com/lightvector/KataGo/releases/tag/v1.15.0), and set `KATAGO_HUMAN_MODEL`. KataGo then imitates a player of the rank chosen beside the board, from 20 kyu to 5 dan (1 kyu by default), and takes a few seconds per move. The rank applies from KataGo's next move. Past a few dan it plays below the rank it imitates, since the human network doesn't read ahead. The first start with a new network spends about a minute tuning OpenCL.

Builds, and dev servers without KataGo, keep the page as a two-player board.

## OGS lesson library (local only)

```sh
git clone --depth 1 https://github.com/online-go/online-go.com.git /tmp/ogs
npm run lessons:ogs -- /tmp/ogs
```

Imports every page of the [Online-Go.com Learning Hub](https://online-go.com/learn-to-play-go) (AGPL-3.0-or-later, like Surround) so we can choose which lessons the Study Room teaches. The script parses the seven live sections, from Fundamentals through Beginner Level 4, into move puzzles, multiple-choice questions and the dead-stone removal and Pass/Finish pages. It then replays every puzzle line under Surround's rules. Pages that don't hold up keep an `issues` list: lines that break positional superko, and multiple-choice questions about points or the winner, which OGS counts Japanese-style rather than by area. Each page has a stable id, `<section>/<lesson>/<page class>`.

The output in `public/lessons/ogs/` is gitignored; the lessons will move to the database. When it is present, the Study Room shows a Library tab for playing any imported lesson, with each page's id and issues. If the dev server was running before the first import, restart it so it serves the new folder.

## Go problems (local only)

```sh
npm run problems:goproblems
```

Downloads a graded sample of unflagged life-and-death and tesuji problems from [GoProblems.com](https://www.goproblems.com), preferring problems whose SGF comments explain wrong and right moves. Beginners get the most problems for repetition; higher bands get fewer, better-rated ones (at least 3 votes each):

| Band | Ranks | Problems | Minimum stars |
| --- | --- | --- | --- |
| Beginner | 30k–21k | 300 | 4.0 |
| Novice | 20k–13k | 150 | 4.1 |
| Intermediate | 12k–6k | 100 | 4.2 |
| Advanced | 5k–1k | 70 | 4.3 |
| Dan | 1d–3d | 50 | 4.4 |
| Expert | 4d+ | 30 | 4.5 |

The catalogue is listed further whenever a band runs short of explained problems. Problems attributed to books, magazines, broadcasts, software or other websites are skipped; public-domain classics such as Xuanxuan Qijing and Guanzi Pu are kept. SGFs and `index.json` are written to `public/problems/goproblems/`. Band sizes and star minimums live in `BANDS` in the script; command-line options are `--genres`, `--min-votes`, `--max-pages` and `--delay-ms`.

GoProblems has not granted redistribution rights, so the output and the request cache in `.cache/` are gitignored. Do not commit or deploy them. Requests are sequential and spaced 1.5 seconds apart, as GoProblems asks API users not to call it excessively; re-runs only fetch what is not cached.

## Try it

- The app opens on the landing page. **Play Go** and **Enter the dojo** lead to three paths: **Story mode**, **Study mode**, and **Online P2P**.
- **Study mode → Board preview** opens the existing local board sandbox at `#study`; it is not yet a complete study curriculum or problem solver. **Back to the dojo**, browser Back/Forward and returning through Study retain the current position, captures and thinking times within this page session. Clocks stop on the landing page. The hero uses a separate non-interactive opening, with 19 grid lines in each direction and stones precisely on intersections.
- **Story mode** and **Online P2P** open accessible coming-soon dialogs, not simulated gameplay. Story describes the planned single-player journey. Online describes planned real-stakes peer-to-peer matches with signed offchain moves and Starknet settlement. This frontend does not connect wallets, accept deposits, start network matches, or pay rewards.
- Scroll through dedicated sections for **Starknet reward settlement**, **single-player story**, **AI opponents and kyu/dan progression**, and **learning from zero**. Header anchors jump to Story, Rewards and Learn. The reward flow and character portraits are explicitly labeled as design concepts; they do not imply working money matches or story chapters.
- **Start learning** jumps to a beginner section with a playable first-capture lesson. Place White at the highlighted intersection (pointer or keyboard), or select **Show me the capture**. It uses the same capture rules as the study board, announces success and can be reset. The lesson is independent of the study position. **Read the simple rules** opens the rules and keyboard controls, with a route to the board preview. The full course and AI opponents remain planned, not playable.
- The rank illustration uses traditional **kyu/dan** grades (see the [British Go Association explanation](https://www.britgo.org/about/rating)), not a claim of federation accreditation or a live rating service. The displayed 30k → 10k → 1k → 1d progression is illustrative, not a universal official starting grade. A particular organization's official rating integration has not been selected.
- **The gardens** hides the interface to enjoy the scene; Escape returns focus to the header's garden control. The footer's garden selector switches between all fourteen environments.
- Five **world scenes** add Venice blue hour (canal reflections and warm windows), Taj Mahal dawn (neem boughs and a quiet reflecting pool), Santorini afternoon (olive leaves and a distant drifting sailboat), Petra afterglow (lanterns, tiny stars and fine canyon dust), and Patagonia morning (beech leaves, wind-stretched clouds and glacial-lake ripples). Each uses independent transparent cloud and foliage layers, fixed landmarks and level floors, shared pause/reduced-motion support, and landmark-aware portrait framing. Choose one in **The gardens** or the landing footer. See [WORLD_SCENES.md](WORLD_SCENES.md) for all saved assets and exact built-in imagegen prompts.
- **Great Wall autumn** uses the open-valley terrace with widely separated towers. Transparent sky clouds drift behind the mountain skyline, nearby autumn trees rustle from fixed attachments, and copper/gold leaves fall and tumble at two depths. The masonry and terrace remain still, with no flag or pole on the tower. Choose it in **The gardens** or the footer; see [GREAT_WALL_LAYERS.md](GREAT_WALL_LAYERS.md) for saved assets and exact built-in imagegen prompts.
- **Fuji morning** frames Mount Fuji with Japanese black pines. Four transparent branch regions sway from fixed attachments, separate cloud banks drift behind Fuji and across its lower slopes, and tiny white birds cross the distant sky individually, occasionally overlapping as two independent flights. The painted lake reflection ripples and glistens, and a few crisp warm motes float near the trees. The mountain, railing and level deck stay still. Choose it in **The gardens** or the landing footer; the separate study lesson layout is unchanged. Saved assets and exact built-in imagegen prompts are in [FUJI_LAYERS.md](FUJI_LAYERS.md).
- **Eventide platform** is a celestial terrace near a black hole. Four separately extracted stone islands drift independently, amber light flows along the accretion disk and lensed arcs, existing stars twinkle, and cyan lamps breathe with faint floor reflections. A slow localized lensing ripple bends the horizon's edge and nearby light while its dark center, terrace and camera stay anchored. Gold inlays shimmer and a few tiny amber/cyan motes drift upward. Select it above the board or in the footer; your game is retained. Assets, built-in imagegen prompts and the reconstruction caveat are in [EVENTIDE_LAYERS.md](EVENTIDE_LAYERS.md).
- **Lunar quiet** adds the approved lunar terrace with Earth and the SpaceX outpost, with the Sun kept outside the frame. Existing stars twinkle on independent 4.5–9-second cycles, a rare shooting star crosses the sky, the separately extracted dish slowly scans, four station lights breathe, and 96 crisp pixel dust motes drift through low-gravity arcs. Earth stays fixed with slow cloud-highlight drift and a blue-rim shimmer. Portrait framing favors Earth. Select it above the study board or in the footer; your game is retained. Assets and built-in imagegen prompts are in [LUNAR_LAYERS.md](LUNAR_LAYERS.md).
- **Tatami study room** is a modern indoor room with the approved uniform tatami floor. The wall clock shows your device's local system time, ticking visually once per second and resyncing after pause or a hidden tab. Outdoor tree cutouts rustle gently behind the window frames, and clouds drift behind the buildings. The room, lighting and floor remain still. Select it in the footer or above the study board; the current position is retained. Assets, generation prompts and motion details are in [MODERN_LAYERS.md](MODERN_LAYERS.md).
- **Sunlit training dojo** adds a daytime indoor setting: two separately animated outdoor tree cutouts, glistening sunlight on the wall and tatami, leaf-shadow movement linked to the breeze, and 112 softly glowing dust motes drifting through the light shafts. A second dust band near the window keeps the effect visible beside the board and on narrow screens. The original architecture and level floor stay still. On narrow screens the crop keeps the left window in view. Select it in the footer or above the study board; scene changes retain the current game. Assets, prompts and composition notes are in [SUNLIT_LAYERS.md](SUNLIT_LAYERS.md).
- **Cloud-sea pavilion** is the default scene: separately swaying cherry-blossom boughs, drifting sky clouds and valley mist, tumbling petals, rising motes, and softly pulsing lanterns with matching floor spill. The timber pavilion and level floor stay still. Assets, prompts and composition details are in [PAVILION_LAYERS.md](PAVILION_LAYERS.md).
- The scene selector also offers **Winter stillness** and **Moonlit garden**, retaining your board position. Winter has three depths of falling snow, two individually animated snow-heavy pine cutouts and softly breathing lights; its assets and prompts are in [WINTER_LAYERS.md](WINTER_LAYERS.md).
- The board starts empty. Choose **Start a new game → Study the opening** to explore the 32-move example opening.
- Click an intersection to place a stone. Black and white alternate on the same device.
- Focus the board and use arrow keys plus Enter/Space for keyboard play.
- **Take back** restores the complete previous position, including captures and superko history.
- Two passes pause the game. **Resume play** lets players continue.
- Toggle coordinates and optional synthesized placement sounds.
- The garden has separate transparent cloud and foliage layers over an inpainted clean background. Clouds drift behind the landscape; maple branches gently bend from their attachment points. The moon halo, glimmering water and independently fading pagoda windows remain. Use **View garden** in the header to enjoy the scenery; return with the button or Escape. Your board position is retained and thinking time pauses while viewing the garden.
- Use the header's pause/play control to freeze or resume the scenery. Motion also stops in hidden tabs and respects the system's reduced-motion preference.
- The waterfall flows into tiny splashes and ripples, with extra softly rising pixel motes. The right-hand lanterns breathe gently through a slow light-and-glow cycle.
- Player clocks count time spent thinking; they are informational, with no deadline.

## Scope

This is a local visual and interaction prototype. The landing establishes the three-mode product structure, but story gameplay, study progression/problems, and online matchmaking/reward settlement are future work. There is no AI opponent, wallet connection, relay, onchain submission, reload persistence, final scoring or dead-group agreement. Reloading clears the board. The local rules implement group captures, suicide prevention and positional superko; the Cairo/channel implementation remains authoritative when online play is integrated. Komi is displayed as the intended 6.5-point match setting but no final score is computed. No funds or blockchain transactions are handled by this frontend.

React owns match state and the HTML HUD. Pixi draws a logical 600×600 board, with 19 grid lines at `(48 + column × 28, 48 + row × 28)`, using separate draw layers for the board, coordinates, stones and hover preview. Textures are generated at pixel resolution and use nearest-neighbor scaling. The board renders on interaction rather than running a continuous animation loop. A separate Canvas 2D garden renderer runs at up to 24 fps, with masks registered to the original 1672×941 artwork. It suspends work in hidden tabs and in reduced-motion mode. Small screens reflow the player cards and controls around the board.

Artwork and generation prompts are documented in [ASSETS.md](ASSETS.md). Generated PNGs are deliberately retained as source assets; production packaging can add lossless optimized derivatives later.

Landing components live in `src/landing/`; `modes.ts` keeps mode labels and route parsing explicit. `App.tsx` retains the game state above both pages. Hash routing avoids adding a router dependency and supports study deep links. The new landing reuses the existing artwork rather than flattening the generated mockup into a background image. Its hero board has no input listeners exposed to users or last-move marker; the study board remains keyboard and pointer interactive.
