# Profiles plan: one way in, casual games, and player history

Created 2026-10-19. Status: steps 1–7 done; the profile page itself comes
later, on the read API. It took one generic change in arbiter: a keeper's unanchored entry may
honour a real channel's sign-ins (`delegation_channel`, arbiter `9c0f0b2`).

Today there are two ways to play. The guest lobby (`offchain/lobby`) needs no
wallet: a browser token, a guest name, server-applied moves, its own rank from
five AI games, and its own starting levels. Rated play needs a wallet: the
matchmaker, the keeper, an onchain rank. This plan makes one: a wallet and a
profile for everything, rated and casual games on the same signed moves, and a
database that remembers every game for the player's history and, later, a
profile page.

## Decisions already made (2026-10-19)

1. **No play without a wallet and a profile.** A profile is a handle and a
   starting level. The guest lobby goes; nobody uses it yet (play is coming
   soon on the live site), so there is nothing to migrate.
2. **Casual games:** human against human, unrated, and unrated games against
   the AI. Rated games stay as they are.
3. **Casual games never settle onchain.** They are arbiter's unanchored games:
   signed moves through the keeper, which never sends them to a channel.
   Surround keeps them for history.
4. **Casual games are untimed or on a rated preset,** as the players choose
   when they set one up.
5. **Every account must be deployed before it signs anything.** The
   matchmaker refuses an undeployed account with a clear error, and the lobby
   offers **Activate account** (the player's own zero-STRK transaction), as
   today. Every signature check stays as it is.
6. **The `#play` sandbox goes** with the guest lobby: it plays KataGo directly,
   with no wallet.
7. **arbiter gets nothing of Surround's:** handles, profiles, history and
   matchmaking stay in Surround. Its one change is generic: an unanchored
   keeper entry may honour sign-ins for a real channel (`delegation_channel`),
   so one weekly sign-in covers rated and casual games.
8. **Sepolia for development and staging, mainnet for players.** There is no
   local chain.

Later: sponsored deployment for Outis accounts, story battles, and the
mainnet budget (see the end).

## Design

### The Surround database

`offchain/db/` (step 1, done): one SQLite file (`node:sqlite`, WAL), shared
by the matchmaker and the indexer, with numbered migrations (`user_version`):
each step below adds its tables as the next migration. Its tables are of two
kinds:

| Kind | Tables | If lost |
| --- | --- | --- |
| Irreplaceable | `profiles` (handle, starting level, the signed claim), `released`, `reserved`, `games` for casual games (players, board, komi, clock, result and how it ended, times, keeper, final signed transcript) | Gone: back them up from day one |
| Rebuildable | rated games, rank history, kifu, the indexer's cursor | Rebuilt by replaying the chain from the world's deploy block |

The matchmaker writes profiles and casual games; the indexer writes the
rebuildable tables; the matchmaker's HTTP serves reads. A profile page reads
one database.

### Profiles

- **One claim, one signature.** `Profile { player, handle, band, at }`
  (`profileTypedData`) replaced the handle-only claim, so the handle and the
  starting level are signed together. The handle rules (format, reserved names, uniqueness, renames,
  holds, moderation) are as `offchain/db/profiles.mjs` has them now.
- **Starting level.** The contract's bands (23k, 17k, 6k), not the guest
  lobby's 20k to 1d. It's kept with the profile, so it follows the wallet to
  another browser. It can change until the first rated game; from then on the
  contract's record is the band.
- **Deployed accounts only.** The claim is checked through the account, as
  every wallet signature is. An undeployed account gets "Activate your account
  first" from every matchmaker request, not "Bad signature".

### Signing in

What it is: one wallet signature (arbiter's `delegationTypedData`) lets a
fresh key kept in this browser act for the wallet for up to a week. That key
then signs the player's lobby requests (queue, leave, tables) and agrees to
games' terms in the wallet's place, which the channel accepts onchain for rated
games (`open_rated_game_delegable`). It can't play moves (each game's session
key does), can't move funds, expires, and is revoked by signing out
(`offchain/matchmaker/README.md`, Signing in; `apps/web/src/rated/signin.ts`).
Without it, every lobby request and every game asks the wallet to sign.

The matchmaker and `RatedFlow.signIn` have it; the UI doesn't yet, and the
stack's matchmaker has it off (`delegation_seconds` unset). This plan turns it
on (a week) and asks for it during onboarding, right after the profile: two
signatures, once. A week later, the next action asks again.

### One way in

The lobby's two panels (the screenshot of 2026-10-19) become one:
1. **Connect wallet;** the wallet is asked to switch to Sepolia, as now. An
   undeployed account is asked to **Activate account**.
2. **Your profile:** handle and starting level, one signature, with
   `/handles/check` before the wallet opens.
3. **Sign in** for the week.

A returning player reconnects silently and lands in the lobby. **The gate is
the matchmaker's:** it refuses to queue, host, join, offer an AI game or pair
a casual one for a player without a profile. Anchors are exempt.

### Casual play in the matchmaker

- **Pairing:** invite codes, open tables (without `min_table_games`), an
  unrated quick match by rank, and unrated games against an AI anchor. Who's
  here (the counts the lobby shows) comes from the matchmaker.
- **Clocks:** the host chooses untimed or one of the matchmaker's `clocks`
  presets; a quick match pairs players who chose the same. A timed casual game
  names a keeper's referee, which stamps its moves, as in a rated game; an
  untimed one names none.
- **Games:** the terms name the keeper's unanchored entry (its channel value is
  no real channel, configured in the keeper), the game id is the seats'
  (`gameIdOf`), and the matchmaker registers each game with both seats'
  signed-in approvals, or their wallets' signatures.
- **The AI:** the anchor daemon plays unanchored games too, from the same
  capacity as rated ones.
- **The game page:** `RatedMatchPage` becomes one match page for rated and
  casual games.

### History

- **Casual games:** the matchmaker follows each one through its keeper (as
  `#watch` does rated pairings) and, when it ends, writes its row with the
  final transcript. The keeper keeps closed games on disk and serves them
  (`GET /games/:channel/:game`), but can't list a player's games, finished
  games or results, and each keeper has its own; its copy stays the signed
  original.
- **Rated games:** the indexer, from the chain.
- **Reads:** `GET /profiles/:handle-or-address` (profile, onchain rank, rank
  history) and a paged game list, for the profile page that comes later.

### The indexer

A Node process in Surround (`offchain/indexer/`) that writes the Surround
database:
- It follows Surround's world and `SurroundRatings` through our own Pathfinder
  node (`getEvents` with continuation tokens), from a cursor kept in the
  database: `TicketUsed`, `GameVoided`, settlements, `PlayerRank` and kifu.
  The SDK already decodes the rating events (`sdk/src/replay.mjs`) and kifu.
- It reads a few blocks behind the tip, and on a block hash that no longer
  matches it rewinds the cursor and rewrites from there.
- Rows carry the world and channel, so a new world's history sits beside the
  old one.
- Rebuilding is dropping the rebuildable tables and replaying from the deploy
  block.
- It runs apart from the matchmaker: its batch writes would block the
  matchmaker's requests, and it restarts or rebuilds without touching pairing.

**Why not Torii.** `PlayerRank` was designed for Torii (`src/models.cairo`),
which would give the rank history and kifu with no code. But Torii can't hold
handles or casual games, so the profile page would join two sources for good.
It is also a Rust service pinned to the Dojo version, with one database per
world. Surround's events are few, the matchmaker already follows the chain
the same way (`ratingEvents` and a cursor), and we run our own node. Torii is
worth it if something needs its live subscriptions, or third parties read
Surround's state through it. Neither is planned.

### The guest lobby and `#play` go

- `offchain/lobby`'s service, server and tests, the web's guest form, the
  `#match/<id>` page and the dev server's `/api/lobby` mount are removed.
- `#play` goes too: its board and KataGo opponent in `App.tsx`,
  `src/game/katago.ts`, the dev server's KataGo bridge (`katago/bridge.ts`,
  `/api/katago`), and its entry points (`src/landing/modes.ts` and its test,
  `src/launch.ts`).
- `engine.ts` (KataGo) and `scoring.ts` (dead stones) move to `offchain/katago/`:
  the anchors use them.
- The characters stay in `shared/lobby.ts`, perhaps renamed
  `shared/characters.ts`.

## Work plan

| Step | Depends on | What |
| --- | --- | --- |
| 1 Database | — | Done: `offchain/db/`, migrations, profiles (from `offchain/handles`), backups. Casual games and the rebuildable tables come as migrations with steps 4–6 |
| 2 Profiles | 1 | Done: `profileTypedData` (handle and band, migration 2), `POST`/`GET /profiles`, `profile` on `/players/:player`, the matchmaker's `admit` gate with the profile's band as the default, "Activate your account first" for undeployed accounts, the web's profile form (band from the profile, not browser storage), the smoke scripts' test player's profile |
| 3 One way in | 2 | Done: the lobby rebuilt on the matchmaker (welcome, activation, profile, sign-in); sign-in on (`delegation_seconds`) |
| 4 Casual play | 2 | Done: casual quick match, tables and private invites, untimed or preset clocks, the keeper's unanchored entry, the anchors playing casual games, one game page; `GET /census` |
| 5 History | 1, 4 | Done: casual games kept as they end (migration 3); `GET /profiles/:id`, `/games`, `/ranks` |
| 6 Indexer | 1 | Done: `offchain/indexer/`, SurroundRatings' events into `rated_games` and `rank_history` (migration 4), confirmations and rewind, `--rebuild`; in the stack |
| 7 Guest lobby and `#play` out | 3, 4 | Done: `offchain/lobby`, the guest pages, `#play` and the dev server's KataGo bridge removed; `engine.ts` and `scoring.ts` in `offchain/katago` |
| 8 Docs | each step | RUN_LOCALLY.md, READMEs, the docs site |

## Acceptance

- A fresh wallet on Sepolia is refused until it activates, then makes a
  profile and signs in (two signatures), and plays a casual game against
  another wallet, an unrated game against an AI and a rated game, with no
  further wallet prompt that week.
- All three games show in its history.
- Every existing test passes; the guest lobby's and `#play`'s tests are gone
  with them.

## Later

- **Sponsored deployment for Outis.** Surround's matchmaker deploys an Outis
  account itself, from a sponsor account, so an Outis player never needs STRK
  to start: the web asks Outis for `wallet_deploymentData` (Outis answers with
  salt 0 and no `sigdata` until it is deployed), and the matchmaker checks the
  class (Outis's `0x00eb49f5…2b42` only) and that the data derives the
  player's address, then deploys through the UDC from zero. Checked on Sepolia
  on 2026-10-19 by simulation: the deployment lands on the account's address
  and the account validates its owner's signature. It needs limits (per IP, a
  daily budget, a balance alert) and a mainnet budget.
  - **Built 2026-11-13, off unless configured** (`offchain/matchmaker/sponsor.mjs`,
    `POST /accounts`; the web's `src/wallet/outis.ts`), for players who sign in
    with an email through the Outis window, which sends no transaction. Limits:
    `sponsor.daily` deploys a day in all, `sponsor.per_address_daily` (2) from one
    address, each under `max_fee_fri`; counted before sending, kept across a
    restart. Nothing proves who asks (there is no account yet to sign), so
    anyone can use up a day's deploys: `daily` × the fee is what a day can cost.
    Still to do: a balance alert, the mainnet budget, and extension users (the
    extension answers `wallet_deploymentData` too; the web doesn't ask it yet).
- **Story battles:** rated, casual, or something else.
- **The mainnet budget:** the keeper and matchmaker pay for each rated game's
  settlement and rating.

## Considered and set aside (2026-10-19)

Letting accounts play before they're deployed: the matchmaker and keeper
checking an undeployed account's signature by simulating its deployment, the
keeper deploying seats in the settlement that opens their game, or a
registrar key letting the matchmaker vouch for casual games' seats. Each needs
arbiter changes, and every party that checks a wallet's signature would have
to learn it. Requiring a deployed account keeps every check as it is. (The
simulation does work: one INVOKE with `SKIP_VALIDATE` deploying the account
through the UDC and calling `is_valid_signature` returns `VALID` in its trace,
about 0.7–0.8 s on our node, and a bad signature reverts.)
