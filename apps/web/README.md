# Surround web preview

A scrolling pixel-art landing page and local two-player, 19×19 Go prototype built with React, TypeScript, Vite and PixiJS. The landing extends the approved [visual concept](../../concept-art/surround-landing-v1.png), with the existing animated pavilion, Surround logo, a code-rendered board and three mode entry points. The hero keeps its natural size on short screens rather than shrinking to fit the viewport. Board geometry, stones, frames, icons and controls are rendered in code.

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
- **The gardens** hides the interface to enjoy the scene; Escape returns focus to the header's garden control. The footer's garden selector switches between all three environments.
- **Cloud-sea pavilion** is the default scene: separately swaying cherry-blossom boughs, drifting sky clouds and valley mist, tumbling petals, rising motes, and softly pulsing lanterns with matching floor spill. The timber pavilion and level floor stay still. Assets, prompts and composition details are in [PAVILION_LAYERS.md](PAVILION_LAYERS.md).
- The scene selector also offers **Winter stillness** and **Moonlit garden**, retaining your board position. Winter has three depths of falling snow, two individually animated snow-heavy pine cutouts and softly breathing lights; its assets and prompts are in [WINTER_LAYERS.md](WINTER_LAYERS.md).
- Continue the 32-move example opening, or choose **Start a new game → Empty board**.
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

This is a local visual and interaction prototype. The landing establishes the three-mode product structure, but story gameplay, study progression/problems, and online matchmaking/reward settlement are future work. There is no AI opponent, wallet connection, relay, onchain submission, reload persistence, final scoring or dead-group agreement. Reloading resets the example opening. The local rules implement group captures, suicide prevention and positional superko; the Cairo/channel implementation remains authoritative when online play is integrated. Komi is displayed as the intended 6.5-point match setting but no final score is computed. No funds or blockchain transactions are handled by this frontend.

React owns match state and the HTML HUD. Pixi draws a logical 600×600 board, with 19 grid lines at `(48 + column × 28, 48 + row × 28)`, using separate draw layers for the board, coordinates, stones and hover preview. Textures are generated at pixel resolution and use nearest-neighbor scaling. The board renders on interaction rather than running a continuous animation loop. A separate Canvas 2D garden renderer runs at up to 24 fps, with masks registered to the original 1672×941 artwork. It suspends work in hidden tabs and in reduced-motion mode. Small screens reflow the player cards and controls around the board.

Artwork and generation prompts are documented in [ASSETS.md](ASSETS.md). Generated PNGs are deliberately retained as source assets; production packaging can add lossless optimized derivatives later.

Landing components live in `src/landing/`; `modes.ts` keeps mode labels and route parsing explicit. `App.tsx` retains the game state above both pages. Hash routing avoids adding a router dependency and supports study deep links. The new landing reuses the existing artwork rather than flattening the generated mockup into a background image. Its hero board has no input listeners exposed to users or last-move marker; the study board remains keyboard and pointer interactive.
