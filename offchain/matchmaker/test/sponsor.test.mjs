// Deploying players' Outis accounts from the matchmaker's (sponsor.mjs): what
// it deploys, what it refuses, and that the day's limits hold whatever is
// sent and whatever is lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from '../../sdk/node_modules/starknet/dist/index.mjs';
import * as p from '../../sdk/src/index.mjs';
import { OUTIS_ACCOUNT_CLASS, Sponsor } from '../sponsor.mjs';
import { memoryStore } from '../store.mjs';
import { serve } from '../server.mjs';

const T0 = 1_700_000_000_000, DAY = 86_400_000;

/** How the Outis account owned by `owner` is deployed, as the Outis window answers `wallet_deploymentData`. */
function outisAccount(owner, { classHash = OUTIS_ACCOUNT_CLASS, salt = 0n } = {}) {
  const calldata = [0n, BigInt(owner), 1n].map(p.hex);
  const player = hash.calculateContractAddressFromHash(p.hex(salt), p.hex(classHash), calldata, 0);
  return { player: p.hex(BigInt(player)), class_hash: p.hex(classHash), salt: p.hex(salt), calldata };
}

/** A chain that deploys what it is asked to, and says what it was asked. */
function fakeChain() {
  const state = { deployed: new Set(), estimates: [], deploys: [], fee: 10n, failEstimate: false, failDeploy: false, hold: null };
  return {
    state,
    deployed: async player => state.deployed.has(p.hex(BigInt(player))),
    estimateDeploy: async payload => {
      state.estimates.push(payload);
      if (state.holdEstimate) await state.holdEstimate;
      if (state.failEstimate) throw Error('estimate failed');
      return { fee: state.fee, resourceBounds: {} };
    },
    deploy: async payload => {
      state.deploys.push(payload);
      if (state.hold) await state.hold;
      if (state.failDeploy) throw Error('the node answered nothing');
      // Where the universal deployer puts it, from address 0.
      state.deployed.add(p.hex(BigInt(hash.calculateContractAddressFromHash(payload.salt, payload.classHash, payload.calldata, 0))));
      return `0xd${state.deploys.length}`;
    },
  };
}

function setup(config = { daily: 3 }, store = memoryStore()) {
  const chain = fakeChain(), clock = { ms: T0 };
  const sponsor = new Sponsor(config, chain, { now: () => clock.ms, store });
  return { chain, clock, sponsor, store };
}
const refused = (status, message) => e => e.status === status && (message === undefined || message.test(e.message));

test('an Outis account is deployed as its data says, from address 0', async () => {
  const { chain, sponsor } = setup();
  const account = outisAccount(0xabc);
  assert.deepEqual(await sponsor.deploy(account, '1.1.1.1'), { player: account.player, deployed: true, transaction_hash: '0xd1' });
  assert.deepEqual(chain.state.deploys, [{ classHash: account.class_hash, salt: account.salt, calldata: account.calldata }]);
  // Deployed: asked again, it costs nothing.
  assert.deepEqual(await sponsor.deploy(account, '1.1.1.1'), { player: account.player, deployed: true });
  assert.equal(chain.state.deploys.length, 1);
});

test('off unless configured', async () => {
  for (const config of [null, {}, { daily: 0 }, { daily: 'many' }]) {
    const { chain, sponsor } = setup(config);
    assert.equal(sponsor.open, false);
    await assert.rejects(sponsor.deploy(outisAccount(1), 'a'), refused(403));
    assert.equal(chain.state.estimates.length, 0);
  }
});

test('only the Outis class, and only data that is the address named', async () => {
  const { chain, sponsor } = setup();
  const good = outisAccount(0xabc);
  // Another class, though its data is its address: the matchmaker would be deploying anyone's contract.
  await assert.rejects(sponsor.deploy(outisAccount(0xabc, { classHash: 0x1234n }), 'a'), refused(403, /Only Outis/));
  // The Outis class, for another address than its data gives: another owner, salt or calldata.
  await assert.rejects(sponsor.deploy({ ...good, player: outisAccount(0xdef).player }, 'a'), refused(400));
  await assert.rejects(sponsor.deploy({ ...good, salt: '0x1' }, 'a'), refused(400));
  await assert.rejects(sponsor.deploy({ ...good, calldata: [...good.calldata, '0x0'] }, 'a'), refused(400));
  // Not felts, not a list, too long.
  await assert.rejects(sponsor.deploy({ ...good, calldata: 'x' }, 'a'), refused(400));
  await assert.rejects(sponsor.deploy({ ...good, calldata: [1, 2, 3] }, 'a'), refused(400));
  await assert.rejects(sponsor.deploy({ ...good, calldata: Array(65).fill('0x1') }, 'a'), refused(400));
  await assert.rejects(sponsor.deploy({ ...good, class_hash: undefined }, 'a'), refused(400));
  await assert.rejects(sponsor.deploy(null, 'a'), refused(400));
  assert.equal(chain.state.estimates.length, 0);
  assert.equal(chain.state.deploys.length, 0);
});

test('so many a day in all, and so many from one address', async () => {
  const { chain, clock, sponsor } = setup({ daily: 3, per_address_daily: 2 });
  await sponsor.deploy(outisAccount(1), 'a');
  await sponsor.deploy(outisAccount(2), 'a');
  await assert.rejects(sponsor.deploy(outisAccount(3), 'a'), refused(429, /from here/));
  await sponsor.deploy(outisAccount(3), 'b');
  await assert.rejects(sponsor.deploy(outisAccount(4), 'c'), refused(429, /today/));
  assert.equal(chain.state.deploys.length, 3);
  // The next day (UTC) starts again.
  clock.ms += DAY;
  await sponsor.deploy(outisAccount(4), 'a');
  assert.equal(chain.state.deploys.length, 4);
});

test('a burst at once stays within the day\'s limits, in all and from one address', async () => {
  for (const [config, senders, most] of [[{ daily: 3, per_address_daily: 100 }, n => `s${n}`, 3], [{ daily: 100, per_address_daily: 2 }, () => 'a', 2]]) {
    const { chain, sponsor, store } = setup(config);
    let release;
    chain.state.holdEstimate = new Promise(resolve => { release = resolve; });
    // Any number of Outis accounts can be made up: none is deployed, each is its own.
    const burst = Promise.allSettled(Array.from({ length: 8 }, (_, n) => sponsor.deploy(outisAccount(100 + n), senders(n))));
    await new Promise(resolve => setTimeout(resolve, 20));
    release();
    const results = await burst;
    assert.equal(chain.state.deploys.length, most);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, most);
    assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.status === 429));
    assert.equal((await store.load()).counts.sent, most);
  }
});

test('the day\'s count outlasts a restart', async () => {
  const store = memoryStore();
  const first = setup({ daily: 1 }, store);
  await first.sponsor.deploy(outisAccount(1), 'a');
  const second = setup({ daily: 1 }, store);
  await assert.rejects(second.sponsor.deploy(outisAccount(2), 'b'), refused(429));
  assert.equal(second.chain.state.deploys.length, 0);
});

test('a deploy whose answer was lost still counts; one never sent does not', async () => {
  const { chain, sponsor } = setup({ daily: 2 });
  // Not sent: the fee couldn't be read, or was over the limit.
  chain.state.failEstimate = true;
  await assert.rejects(sponsor.deploy(outisAccount(1), 'a'), refused(503));
  chain.state.failEstimate = false;
  const capped = new Sponsor({ daily: 2, max_fee_fri: '5' }, chain, { now: () => T0 });
  await assert.rejects(capped.deploy(outisAccount(1), 'a'), refused(503));
  assert.equal(chain.state.deploys.length, 0);
  // Sent, and nothing came back: it may have been deployed.
  chain.state.failDeploy = true;
  await assert.rejects(sponsor.deploy(outisAccount(1), 'a'), refused(502));
  await assert.rejects(sponsor.deploy(outisAccount(2), 'a'), refused(502));
  chain.state.failDeploy = false;
  await assert.rejects(sponsor.deploy(outisAccount(3), 'a'), refused(429));
  assert.equal(chain.state.deploys.length, 2);
});

test('two requests for one account at once are one deploy', async () => {
  const { chain, sponsor } = setup({ daily: 5 });
  let release;
  chain.state.hold = new Promise(resolve => { release = resolve; });
  const account = outisAccount(7);
  const both = [sponsor.deploy(account, 'a'), sponsor.deploy(account, 'b')];
  await new Promise(resolve => setTimeout(resolve, 10));
  release();
  const [one, two] = await Promise.all(both);
  assert.equal(one.transaction_hash, two.transaction_hash);
  assert.equal(chain.state.deploys.length, 1);
});

test('POST /accounts: served where there is a sponsor, counted by the proxy\'s own entry', async () => {
  const { chain, sponsor } = setup({ daily: 5, per_address_daily: 1 });
  const matchmaker = { info: async () => ({ chain_id: '0x1' }), health: () => ({}), census: () => ({}), tick: async () => {} };
  const post = (url, body, headers = {}) => fetch(`${url}/accounts`, { method: 'POST', headers, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json() }));
  const off = await serve(matchmaker, { poll_ms: 0 });
  const on = await serve(matchmaker, { poll_ms: 0, sponsor, from_header: 'X-Forwarded-For' });
  try {
    assert.equal((await post(off.url, outisAccount(1))).status, 403);
    assert.equal((await (await fetch(`${off.url}/info`)).json()).sponsored, false);
    assert.equal((await (await fetch(`${on.url}/info`)).json()).sponsored, true);
    // The client may write what it likes first: the proxy's entry is the last.
    const a = await post(on.url, outisAccount(1), { 'X-Forwarded-For': '9.9.9.9, 1.1.1.1' });
    assert.deepEqual(a, { status: 200, body: { player: outisAccount(1).player, deployed: true, transaction_hash: '0xd1' } });
    assert.equal((await post(on.url, outisAccount(2), { 'X-Forwarded-For': '8.8.8.8, 1.1.1.1' })).status, 429);
    assert.equal((await post(on.url, outisAccount(2), { 'X-Forwarded-For': '1.1.1.1, 2.2.2.2' })).status, 200);
    assert.equal((await post(on.url, { ...outisAccount(3), class_hash: '0x5' }, { 'X-Forwarded-For': '3.3.3.3' })).status, 403);
    assert.equal(chain.state.deploys.length, 2);
  } finally {
    await off.close();
    await on.close();
  }
});
