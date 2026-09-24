// Build offchain/cairo first, then pin its immutable adapter in the Dojo package.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hash } from './sdk/node_modules/starknet/dist/index.mjs';
const artifact = JSON.parse(await readFile(new URL('./cairo/target/dev/surround_offchain_ChannelProver.contract_class.json', import.meta.url), 'utf8'));
const classHash = hash.computeContractClassHash(artifact);
const target = new URL('../src/channel_prover_pin.cairo', import.meta.url);
const source = `// Generated from the immutable native ChannelProver artifact by offchain/pin.mjs.\npub const PROVER_CLASS_HASH: felt252 =\n    ${classHash};\n\n#[cfg(not(test))]\npub fn prover_class() -> starknet::ClassHash {\n    PROVER_CLASS_HASH.try_into().unwrap()\n}\n\n// Dojo unit tests use an explicit callback double; this is never a production pin.\n#[cfg(test)]\npub fn prover_class() -> starknet::ClassHash {\n    crate::tests::test_channel::proof_stub::TEST_CLASS_HASH\n}\n`;
if (process.argv.includes('--check')) {
  const withoutWhitespace = text => text.replace(/\s+/g, '');
  if (withoutWhitespace(await readFile(target, 'utf8')) !== withoutWhitespace(source)) throw Error(`Stale native prover pin: ${fileURLToPath(target)}`);
} else await writeFile(target, source);
console.log(`Immutable prover class: ${classHash}`);
