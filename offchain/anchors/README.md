# AI anchors

Surround's five AI opponents are anchors: fixed-strength accounts whose ratings
are pinned in `SurroundRatings` ([AI anchors](../../RANKING_PLAN.md#ai-anchors)).
A newcomer's games against them are rated like any other, but rate only the
newcomer. This daemon plays all of them.

| Anchor | Character | KataGo profile | Pinned at |
| --- | --- | --- | --- |
| `aiko` | Aiko Noma | `rank_20k` | 20k (`MU_T[10]`) |
| `malik` | Malik Diop | `rank_10k` | 10k (`MU_T[20]`) |
| `priya` | Priya Raman | `rank_5k` | 5k (`MU_T[25]`) |
| `koji` | Koji Matsuda | `rank_1d` | 1d (`MU_T[30]`) |
| `ryo` | Ryo Kanzaki | `rank_9d` | pro, shown as 9d (`MU_T[38]`) |

For each anchor, the daemon:
- **offers session keys.** It offers the matchmaker fresh session keys for the
  anchor's next games (`POST /anchors/:anchor/keys`, signed by the anchor's
  wallet), `keys` at a time. Each private key is written to the session store
  before the matchmaker sees it. A pairing needs both seats' keys when its
  ticket is signed, so an anchor without keys is busy.
- **checks and signs terms.** It checks each pairing's terms as a player's
  client does: the ticket's own terms, its key at its seat (one it offered),
  band 0, and the keeper's referee on the clock. It then signs them with the
  anchor's wallet.
- **plays each game through its keeper.** KataGo samples the human SL policy
  for the anchor's rank, at 64 visits (`offchain/lobby/engine.ts`). After a
  scoring resumption it plays at full strength, so dead stones get captured.
- **scores by agreement.** At scoring it proposes the stones KataGo's ownership
  marks dead. It accepts the other side's proposal if that gives the same
  winner as its own, and resumes play otherwise.

The anchors' accounts only sign. They never send transactions: the keeper opens
and settles games, and the matchmaker rates them.

```sh
ANCHOR_AIKO_KEY=0x… ANCHOR_MALIK_KEY=0x… ANCHOR_PRIYA_KEY=0x… ANCHOR_KOJI_KEY=0x… ANCHOR_RYO_KEY=0x… \
  node --experimental-strip-types offchain/anchors/daemon.ts config.json
node --experimental-strip-types --test offchain/anchors/*.test.ts
```

`config.example.json` holds:
- `matchmaker_url` and `rpc_url`;
- `katago`: the `KATAGO_*` settings. The human SL model is required;
- `keys` (4) and `max_games` (16): the keys each anchor keeps offered, and the
  most games it has at once, offered keys included. The keeper counts games
  nobody opened yet against each wallet (`max_open_per_player`, 4 by
  default): set it to at least `max_games`;
- `store`: the session store directory, which holds the session keys and every
  game's transcript. One process owns it at a time;
- `anchors`: each anchor's `id`, `rank` (its KataGo profile), `address` and the
  environment variable holding its wallet key.

`config.sepolia.json` and `keeper.sepolia.json` run the v7 Sepolia world: the
second is a config for arbiter's keeper (`keeper/server.mjs`), with Surround's
hooks and `max_open_per_player` raised for the anchors. `sepolia.ts` plays a
newcomer against an anchor there, end to end (see offchain/RESULTS.md).

The matchmaker's config lists the same addresses in `anchors`, and
`SurroundRatings` must pin each one (`set_anchor`). Re-pinning an anchor after
calibration is the owner's `set_anchor` again; once the contract is sealed it
waits 48 hours.

**Trust.** Whoever holds an anchor's wallet key could throw its games and
inflate a friend's rank. The operator holds them, as it holds the matchmaker
key.
