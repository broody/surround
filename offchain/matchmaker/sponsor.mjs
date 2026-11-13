// Deploying a player's account for them (PROFILES_PLAN.md, "Sponsored
// deployment for Outis"). A player who signs in with an email through the
// Outis window (account.outis.xyz, @outis/sessions) has an account that
// signs and never sends a transaction, so it can't deploy itself; undeployed,
// its signatures can't be checked and it can't play. The web asks the window
// how the account is deployed (`wallet_deploymentData`) and sends that here;
// the matchmaker deploys it from its own account, through the universal
// deployer.
//
// What is untrusted: everything in the request. Anyone may send it, for any
// address. So:
// - Only Outis's account class, and only where class, salt and calldata are
//   the address named: nothing else can be deployed with the matchmaker's
//   fees, and whoever sends the data can only bring that account, with that
//   owner, to that address.
// - It asks nothing of the player (there is no account yet to sign), so what
//   bounds the spending is the limits alone: so many a day in all, so many a
//   day for one address the request came from, and a fee each may not pass.
//   A deploy is counted as its request is taken, before anything is awaited
//   (a burst of requests can't each pass the limit), and stays counted
//   whatever happens to it once sent: a lost answer may have been a deploy.
// - Off unless configured (`sponsor.daily`).
import { hash } from '../sdk/node_modules/starknet/dist/index.mjs';
import * as p from '../sdk/src/index.mjs';
import { LobbyError } from './pairing.mjs';
import { memoryStore } from './store.mjs';

/** The class of every Outis account (@outis/sessions `OUTIS_ACCOUNT_CLASS_HASH`). */
export const OUTIS_ACCOUNT_CLASS = 0xeb49f5299d144f0b2e434e483758fb6d7d8241632534d86b098047fe4e2b42n;
/** The most felts a constructor's calldata may have (@outis/sessions `MAX_CALLDATA_FELTS`). */
const MAX_CALLDATA = 64;
const DAY = 86_400_000;

const felt = (value, what) => {
  try {
    if (typeof value !== 'string' || !/^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(value)) throw Error();
    return p.felt(value);
  } catch { throw new LobbyError(400, `Invalid ${what}`); }
};

/**
 * `config`: `{ daily, per_address_daily = 2, max_fee_fri }` (`sponsor` in the
 * matchmaker's config; `max_fee_fri` defaults to the matchmaker's own). `chain`
 * needs `deployed`, `estimateDeploy` and `deploy` (chain.mjs). `store` keeps
 * the day's counts across a restart.
 */
export class Sponsor {
  constructor(config, chain, { now = Date.now, log = () => {}, store = memoryStore() } = {}) {
    this.daily = Number(config?.daily) || 0;
    this.perAddress = Number(config?.per_address_daily ?? 2) || 0;
    this.maxFee = config?.max_fee_fri == null ? null : BigInt(config.max_fee_fri);
    this.chain = chain;
    this.now = now;
    this.log = log;
    this.store = store;
    /** The day counted (days since 1970, UTC), deploys sent in it, and how many by each sender. */
    this.counts = { day: 0, sent: 0, by: {} };
    /** Deploys on their way, by account: a second request for one waits for the first. */
    this.sending = new Map();
    this.loaded = null;
    this.saving = Promise.resolve();
  }

  /** Whether accounts are deployed here at all. */
  get open() { return this.daily > 0; }

  async #today() {
    this.loaded ??= this.store.load().then(saved => { if (saved?.counts) this.counts = saved.counts; });
    await this.loaded;
    const day = Math.floor(this.now() / DAY);
    if (this.counts.day !== day) this.counts = { day, sent: 0, by: {} };
    return this.counts;
  }

  /**
   * Deploy the Outis account `{ player, class_hash, salt, calldata }` names,
   * for the request from `from` (its address, as the server saw it):
   * `{ player, deployed: true, transaction_hash? }` once it is deployed (no
   * hash where it already was).
   */
  async deploy(body, from) {
    if (!this.open) throw new LobbyError(403, 'Accounts are not set up here');
    const player = felt(body?.player, 'player'), classHash = felt(body?.class_hash, 'class'), salt = felt(body?.salt, 'salt');
    if (!Array.isArray(body.calldata) || body.calldata.length > MAX_CALLDATA) throw new LobbyError(400, 'Invalid calldata');
    const calldata = body.calldata.map(value => felt(value, 'calldata'));
    if (classHash !== OUTIS_ACCOUNT_CLASS) throw new LobbyError(403, 'Only Outis accounts are set up here');
    // Deployed through the universal deployer from address 0 (`unique` false), the account lands here.
    const address = BigInt(hash.calculateContractAddressFromHash(p.hex(salt), p.hex(classHash), calldata.map(p.hex), 0));
    if (address !== player) throw new LobbyError(400, 'That is not how this account is deployed');
    const id = p.hex(player);
    if (await this.chain.deployed(id)) return { player: id, deployed: true };
    if (!this.sending.has(id)) {
      const sent = this.#send(id, { classHash: p.hex(classHash), salt: p.hex(salt), calldata: calldata.map(p.hex) }, String(from ?? ''))
        .finally(() => this.sending.delete(id));
      this.sending.set(id, sent);
    }
    return { player: id, deployed: true, transaction_hash: await this.sending.get(id) };
  }

  /** Keeps the counts, one save after another: two at once would write the same file. */
  #save() {
    const saved = this.saving.then(() => this.store.save({ counts: this.counts }));
    this.saving = saved.catch(() => {});
    return saved;
  }

  async #send(id, payload, from) {
    const counts = await this.#today();
    // Checked and counted in one step, with nothing awaited between: requests that arrive together
    // (any number of accounts can be made up) each see the ones before them.
    if (counts.sent >= this.daily) throw new LobbyError(429, 'No more accounts can be set up today; try again tomorrow');
    if ((counts.by[from] ?? 0) >= this.perAddress) throw new LobbyError(429, 'Too many accounts set up from here today');
    counts.sent += 1;
    counts.by[from] = (counts.by[from] ?? 0) + 1;
    // Given back only where nothing was sent: a fee that can't be read, or is too high.
    const unsent = async () => {
      if (this.counts === counts) {
        counts.sent -= 1;
        counts.by[from] -= 1;
      }
      await this.#save().catch(() => {});
      return new LobbyError(503, "The account can't be set up right now; try again shortly");
    };
    let estimate;
    try { estimate = await this.chain.estimateDeploy(payload); } catch (e) {
      this.log(`sponsor: estimating ${id} failed: ${e.message}`);
      throw await unsent();
    }
    if (this.maxFee !== null && estimate.fee > this.maxFee) {
      this.log(`sponsor: deploying ${id} would cost ${estimate.fee} FRI, over the limit`);
      throw await unsent();
    }
    // Kept before it is sent: from here on it may have been, and stays counted whatever comes back.
    await this.#save();
    try {
      const transaction = await this.chain.deploy(payload, estimate);
      this.log(`sponsor: deployed ${id} in ${transaction} (${counts.sent} of ${this.daily} today)`);
      return transaction;
    } catch (e) {
      this.log(`sponsor: deploying ${id} failed: ${e.message}`);
      throw new LobbyError(502, "The account may not be set up yet; look again in a moment");
    }
  }
}
