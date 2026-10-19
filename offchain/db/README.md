# The Surround database

One SQLite file (`node:sqlite`, no dependencies, WAL) for what the chain
doesn't hold or can't be queried for: players' profiles now, and with the
[profiles plan](../../PROFILES_PLAN.md) their casual games and the indexer's
copy of the chain. The matchmaker serves it, and other processes (the
indexer, `admin.mjs`) open the same file while it runs.

The matchmaker's own state file is a different thing: it can be rebuilt from
the chain and is reset with each new world. This database outlives worlds.

```sh
node --experimental-strip-types --test offchain/db/test/*.test.mjs
```

## Tables and migrations

`db.mjs` lists the migrations, in order; each adds one part's tables, and a
file's `user_version` is how many it has. Whichever process opens the file
first applies what's missing, each migration in its own transaction, and code
older than the file refuses it. A new part adds a migration at the end, and
never edits one that has shipped.

| Migration | Tables | Kind |
| --- | --- | --- |
| 1 Profiles (`profiles.mjs`) | `profiles`, `released`, `reserved` | Irreplaceable |

Irreplaceable tables hold what only Surround saw: back them up (below).
Rebuildable ones, once the indexer writes them, are rebuilt by replaying the
chain.

## Handles

The name each wallet goes by in Surround. Handles are Surround's own, not
shared with other games, and kept offchain: a display name decides nothing
about a game, a rating or a payout, so the chain needn't hold it. Another game
on arbiter can keep its players' names onchain instead. The
[matchmaker](../matchmaker/README.md) serves them (`POST /handles`,
`GET /handles`, and `handle` on `GET /players/:player`).

### Claiming one

A player's wallet signs `handleTypedData({ chainId, player, handle, at })`
(SNIP-12 revision 1, [`sdk/src/handle.mjs`](../sdk/src/handle.mjs)), and the
matchmaker checks it through the account contract, as it does the wallet's
other requests. A browser key the wallet signed in can't claim one: claims are
rare, and a wallet's signature stands on its own wherever the claim goes.

- **What a handle is:** 3–20 ASCII letters, digits, `_` or `-`, starting with a
  letter (`HANDLE_PATTERN`). ASCII only, so no two handles look alike in
  different scripts.
- **One name, one player:** case and separators don't count (`handleKey`), so
  `Broody`, `bro_ody` and `BRO-ODY` are one handle.
- **Reserved:** the service's names and the AI regulars', every character in
  `shared/lobby.ts` by first and full name (`RESERVED`), plus what a config or
  a moderator adds.
- **Fresh:** a claim is signed within two minutes of arriving (the
  matchmaker's request skew), and after the player's last claim. Every claim is
  published with its signature, and this is what keeps one from being sent
  again. A claim names no nonce.
- **Deployed accounts:** an undeployed account can't sign, as for rated play.
- **Renaming:** once every `rename_seconds` (a week). Changing only case or
  separators is free.
- **Letting go:** a handle a player renames away from stays theirs to take
  back, and no one else's, for `hold_seconds` (30 days).

`GET /handles/check?player=&handle=` answers what a claim would get now, so a
client asks before the wallet signs.

### The export

`GET /handles` returns `{ chain_id, handles }`, each claim with its `at`,
`signature` and `version` (`handleTypedData`'s domain version): anyone can
check every handle against its account, and replay them all into another
store, onchain or Torii, with no player signing again. `?players=a,b` returns
only those players' claims (100 at most).

## Configuring

In the matchmaker's config, all optional:
- `db`: the database file, relative to the config file (`surround.sqlite`);
- `profiles`: `rename_seconds` (604800), `hold_seconds` (2592000) and
  `reserved`, names to reserve beyond `RESERVED`.

## Moderating and backing up

`admin.mjs` works on the database while the matchmaker serves it (WAL mode):

```sh
node offchain/db/admin.mjs surround.sqlite show 0xPLAYER
node offchain/db/admin.mjs surround.sqlite clear 0xPLAYER abuse   # take it away and reserve it
node offchain/db/admin.mjs surround.sqlite reserve NAME [REASON]
node offchain/db/admin.mjs surround.sqlite unreserve NAME
node offchain/db/admin.mjs surround.sqlite backup /backups/surround-$(date +%F).sqlite
```

A cleared handle is held for no one, its old owner included, and stays
reserved until `unreserve`; its old owner may choose another at once.

The irreplaceable tables are the only data the matchmaker keeps that nothing
else can give back. Back the database up from the first claim, e.g. a nightly
`backup` copied off the host. Losing it means every player loses their handle.
