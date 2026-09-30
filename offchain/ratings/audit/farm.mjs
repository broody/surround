// Rank farming: how far free accounts lift a main account, by the starting
// band they may claim. The attacker's accounts play each other through the
// queue, in games of 20 or more steps, so none is void; the matchmaker's
// pairing rules are not modelled. HARDENING_PLAN.md T5 and T6 publish the table.
//
//   - fresh: the main account beats N new accounts, one game each.
//   - pyramid: F feeders each beat k new accounts, then lose to the main one.
//   - peak: the main account and F feeders settle by playing each other with
//     alternating results, then the main account beats each feeder once. Only
//     games between settled players move a peak.
//
//   node offchain/ratings/audit/farm.mjs
import { pathToFileURL } from 'node:url';
import * as r from '../../sdk/src/rating.mjs';

const T0 = 1_800_000_000n, GAP = 600n;

/** The main account's rating after beating `n` new accounts, all at `band`. */
export function fresh(band, n) {
  let main = r.start(band), t = T0;
  for (let i = 0; i < n; i++) main = r.update(main, r.start(band), 2, (t += GAP)).black;
  return { accounts: n + 1, games: n, rating: main };
}

/** The main account's rating after `f` feeders each beat `k` new accounts and lose to it. */
export function pyramid(band, f, k) {
  let main = r.start(band), t = T0;
  const feeders = [];
  for (let i = 0; i < f; i++) {
    let x = r.start(band);
    for (let j = 0; j < k; j++) x = r.update(x, r.start(band), 2, (t += GAP)).black;
    feeders.push(x);
  }
  for (const x of feeders) main = r.update(main, x, 2, (t += GAP)).black;
  return { accounts: f * (k + 1) + 1, games: f * k + f, rating: main };
}

/**
 * The main account's peak (μ − 2φ, as the contract keeps it) after it and `f`
 * feeders settle in a round robin and it beats each feeder once.
 */
export function peak(band, f) {
  const n = f + 1, idx = [...Array(n).keys()];
  const acc = Array.from({ length: n }, () => ({ rating: r.start(band), games: 0 }));
  let t = T0, games = 0;
  const allSettled = () => acc.every(a => r.settled(a.rating, a.games, t));
  for (let round = 0; round < r.SETTLED_GAMES || !allSettled(); round++) {
    for (let i = 0; i < n / 2; i++) {
      const a = acc[idx[i]], b = acc[idx[n - 1 - i]];
      const out = r.update(a.rating, b.rating, (round + i) % 2 ? 2 : 0, (t += GAP));
      [a.rating, b.rating] = [out.black, out.white];
      a.games++, b.games++, games++;
    }
    idx.splice(1, 0, idx.pop());
  }
  const main = acc[0];
  let best = null;
  for (const x of acc.slice(1)) {
    main.rating = r.update(main.rating, x.rating, 2, (t += GAP)).black;
    games++;
    const low = main.rating.mu - 2n * main.rating.phi;
    if (best === null || low > best) best = low;
  }
  return { accounts: n, games, rating: main.rating, peak: best };
}

export const label = mu => r.rankLabel(r.rankTenths(mu));

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const bands = { 2: '17k', 3: '6k', 4: '1k' };
  console.log('| Highest band | Attack | Accounts | Games | Main account reaches |');
  console.log('| --- | --- | --: | --: | --- |');
  for (const [band, name] of Object.entries(bands).map(([b, n]) => [Number(b), n])) {
    for (const n of [10, 40, 80]) {
      const x = fresh(band, n);
      console.log(`| ${name} | fresh | ${x.accounts} | ${x.games} | ${label(x.rating.mu)} |`);
    }
    for (const [f, k] of [[10, 5], [20, 10]]) {
      const x = pyramid(band, f, k);
      console.log(`| ${name} | pyramid ${f}×${k} | ${x.accounts} | ${x.games} | ${label(x.rating.mu)} |`);
    }
    for (const f of [9, 39]) {
      const x = peak(band, f);
      console.log(`| ${name} | peak | ${x.accounts} | ${x.games} | peak ${label(x.peak)} |`);
    }
  }
}
