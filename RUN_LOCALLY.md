# Running Surround locally

Everything runs on your machine except the chain. Games settle on Starknet
Sepolia, in the v8 world ([`offchain/results/sepolia-arbiter-v8.json`](offchain/results/sepolia-arbiter-v8.json)).
There is no local chain setup (Katana or Devnet behind the website), on
purpose: local play always uses Sepolia.

| Process | Port | What it does | Started by |
| --- | --- | --- | --- |
| Website | 5183 | The app; it reaches the matchmaker at `/api/matchmaker` | `npm run dev` in `apps/web` |
| Arbiter's prover gateway | 3100 | Proves a finished rated game, whatever its length, in one PROOF2 proof (its worker listens on 3400) | `stack.ts` |
| Arbiter's keeper | 3200 | Referees rated games, stamps moves, opens and settles them on Sepolia, each with one proof from the gateway | `stack.ts` |
| Matchmaker | 3300 | Pairs players for rated and casual games, signs rated tickets, rates settled games, serves profiles | `stack.ts` |
| AI anchors | | The five AI regulars: sign and play their rated and casual games with KataGo | `stack.ts` |
| Indexer | | Reads rated games and ranks from Sepolia into the Surround database | `stack.ts` |
| Docs site (optional) | 5190 | docs.surround.gg | `npm run dev` in `apps/docs` |

## What you need, once

1. **Node.js 22.12 or newer.**
2. **Dependencies:**
   ```bash
   npm ci --prefix offchain/sdk
   ```
   ```bash
   npm ci --prefix apps/web
   ```
3. **An arbiter checkout** for the keeper, at `~/development/referee` (or set
   `SURROUND_ARBITER`), at `9c0f0b2` or a later main (its keeper's casual
   entry needs `delegation_channel`), with its own dependencies:
   ```bash
   git clone https://github.com/broody/arbiter.git ~/development/referee
   ```
   ```bash
   npm ci --prefix ~/development/referee
   ```
4. **A Sepolia RPC.** The stack's defaults are an SSH tunnel to our Pathfinder
   node: `http://127.0.0.1:9545/rpc/v0_9` for the matchmaker and anchors
   (`SURROUND_SEPOLIA_RPC`) and `http://127.0.0.1:9545/rpc/v0_10` for the keeper
   (`SURROUND_KEEPER_RPC`). Open the tunnel first, or point both variables at
   another Sepolia RPC that serves those versions.
5. **The v8 test keys** in `offchain/results/raw/sepolia-arbiter-v8/keys.json`.
   The v8 deploy wrote them (`node offchain/sepolia.mjs deploy`): the
   matchmaker's key, the keeper's referee key, the anchors' wallet keys and a
   test player's. `offchain/results/raw/` is gitignored; get a copy from
   whoever deployed v8 and never commit it. These keys only work in the
   Sepolia world.
6. **A funded Sepolia account** in
   `~/.starknet_accounts/starknet_open_zeppelin_accounts.json`, under
   `alpha-sepolia` → `account-1` (or set `SURROUND_SEPOLIA_ACCOUNT`); the stack
   reads its `address` and `private_key`. It pays for the keeper's and the
   matchmaker's transactions (settling and rating games), so keep some Sepolia
   STRK in it.
7. **Arbiter's prover, built for PROOF2** (`prover/build.sh` in the arbiter
   checkout; `ARBITER_PROVER_BUILD` names the build if it isn't in
   `~/.cache/arbiter-prover`), and `systemd-run`, which gives the gateway the
   cgroups its workers run in. A 19×19 game takes up to about 7 GiB to prove. Or set
   `SURROUND_PROVER=off` to settle by onchain replay instead.
8. **KataGo 1.15 or newer**, with the main and the human SL models. Copy
   `apps/web/.env.example` to `apps/web/.env.local` and set `KATAGO_BIN`,
   `KATAGO_MODEL` and `KATAGO_HUMAN_MODEL`. The stack won't start without the
   human model.
9. **A browser wallet on Sepolia** (Outis, Argent or Braavos) with
   a little Sepolia STRK from a faucet, for your own account's first
   transaction.

## Start it

Two terminals, stack first. In the Claude desktop app, the `stack` and `web`
entries in `.claude/launch.json` run the same two commands.

```bash
node --experimental-strip-types --env-file=apps/web/.env.local offchain/anchors/stack.ts
```

```bash
npm run dev --prefix apps/web
```

The stack is ready when it logs `prover http://127.0.0.1:3100, keeper
http://127.0.0.1:3200, matchmaker
http://127.0.0.1:3300, anchors yuna, malik, nanami, luc, ryo on Sepolia v8`.
Its lines are tagged `[prover]`, `[keeper]`, `[matchmaker]` and `[anchors]`.
Stop it with Ctrl-C, which stops them all.

Then open http://localhost:5183/#lobby.

## Play a rated game

1. **Connect wallet** in the header. The wallet is asked to switch to Sepolia.
2. In **Your rank on Starknet**, a new account shows **Activate account**: one
   zero-STRK approval to yourself, which deploys it. An undeployed account
   can't sign anything, so the matchmaker tells it to activate first.
3. **Make your profile**: a handle and a starting level, one wallet signature,
   kept by the matchmaker, nothing onchain
   ([profiles](offchain/db/README.md#profiles)). No game without one.
4. **Play** on an AI card, then a board size and **Rated** or **Casual**.
   Your first game signs this browser in for the week: one wallet signature,
   after which no game asks the wallet again until it ends, or until you
   disconnect the wallet, which signs the browser out.
   (Games between people, by **Find a game**, a table or an invite, are
   hidden for now: `PVP` in `apps/web/src/lobby/LobbyPage.tsx`.) The game's
   terms are agreed by the signed-in browser key; each move is signed with a session key and stamped by the keeper.
5. When a rated game ends, the keeper settles it on Sepolia and the matchmaker
   rates it. The new rank shows within a few minutes. A casual game is just
   over: nothing goes onchain.

## Check it without a wallet

A test player plays a whole rated game against an AI through the running
stack: KataGo plays its moves, and the keeper settles the game on Sepolia and
the matchmaker rates it, at the funded account's expense.

```bash
SURROUND_STACK=1 node --experimental-strip-types --env-file=apps/web/.env.local offchain/anchors/sepolia.ts yuna
```

The first run creates the test player: it deploys a fresh account from the
funded one and adds it as `newcomer` to `keys.json` and to the v8 record
(`offchain/results/sepolia-arbiter-v8.json`, which git tracks), then makes its
profile (handle `newcomer`) with the stack's matchmaker. After that,
`browser-sepolia.ts` plays the same test player through the website's own
rated-game modules (`apps/web/src/rated`):

```bash
node --experimental-strip-types --env-file=apps/web/.env.local offchain/anchors/browser-sepolia.ts yuna
```

## Where the state lives

The stack keeps everything in `offchain/results/raw/sepolia-arbiter-v8/`
(gitignored):

| Path | Holds | If deleted |
| --- | --- | --- |
| `surround.sqlite` (and `-wal`, `-shm`) | The Surround database: players' profiles and casual games (gone for good if lost), and the indexer's rated games and ranks (read again from the chain) | Profiles and casual games are **gone for good** |
| `matchmaker-state.json` | Pairings in play, games to rate, cooldowns | The stack writes `{}`, and the matchmaker reads the chain again from the v8 deploy, so games already open onchain are still rated; pairings not yet onchain are lost |
| `anchors-store/` | The AI's session keys and game transcripts | The AI loses its games in progress |
| `keeper-data/` | The keeper's game transcripts | The keeper loses the transcripts of games in progress, so it can't settle or defend them |
| `keeper-local.json` | The keeper's config | Rewritten on every start |

Stop the stack before touching any of them.

## Settings

| Variable | Default | Where |
| --- | --- | --- |
| `SURROUND_SEPOLIA_RPC` | `http://127.0.0.1:9545/rpc/v0_9` | Shell, for the stack |
| `SURROUND_KEEPER_RPC` | `http://127.0.0.1:9545/rpc/v0_10` | Shell, for the stack |
| `SURROUND_ARBITER` | `~/development/referee` | Shell, for the stack |
| `SURROUND_PROVER` | `http://127.0.0.1:3100` | Shell, for the stack: the prover gateway. One answering there is used; else the stack starts arbiter's. `off`: no prover, and the keeper replays each game onchain in 64-step segments |
| `ARBITER_PROVER_BUILD` | `~/.cache/arbiter-prover` | `apps/web/.env.local` or shell: the gateway's backend build, which must be PROOF2's |
| `SURROUND_SEPOLIA_ACCOUNT` | `account-1` | Shell, for the stack |
| `KATAGO_*` | none | `apps/web/.env.local`, read by the stack (`--env-file`) |
| `MATCHMAKER_URL` | `http://127.0.0.1:3300` | `apps/web/.env.local`: the matchmaker the website proxies to |
| `VITE_RATINGS_ADDRESS` | the matchmaker's | `apps/web/.env.local`: the ratings contract the website trusts |

## When something's wrong

- **"Rated play is offline: the matchmaker can't be reached."** The stack isn't
  running, or `MATCHMAKER_URL` points somewhere else.
- **The stack exits with "The keeper did not start".** The arbiter checkout is
  missing, its dependencies aren't installed, or port 3200 is taken. The
  `[keeper]` lines above it say which.
- **"The prover gateway did not start".** The `[prover]` lines above it say
  why: no PROOF2 build where `ARBITER_PROVER_BUILD` points, no `systemd-run`,
  or port 3100 or 3400 taken.
- **"Set KATAGO_HUMAN_MODEL".** `apps/web/.env.local` lacks it, or the stack
  was started without `--env-file=apps/web/.env.local`.
- **The stack fails at startup with fetch or RPC errors.** The tunnel to the
  Sepolia node is down, or the RPC variables point at the wrong place.
- **"Activate your account first".** Your account isn't deployed yet: use
  **Activate account** in the lobby.
- **"That took too long to sign, or this computer's clock is off."** Signed
  requests must arrive within two minutes of being signed. Try again, and check
  your system clock.
