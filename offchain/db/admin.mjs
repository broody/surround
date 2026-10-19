// Moderating and backing up the Surround database, safe to run while the
// matchmaker serves it.
//
//   node offchain/db/admin.mjs DB show PLAYER
//   node offchain/db/admin.mjs DB clear PLAYER [REASON]    take a handle away and reserve it
//   node offchain/db/admin.mjs DB reserve NAME [REASON]    no one may claim NAME
//   node offchain/db/admin.mjs DB unreserve NAME
//   node offchain/db/admin.mjs DB backup FILE              a consistent copy, e.g. nightly
import { pathToFileURL } from 'node:url';
import { backup, openDatabase } from './db.mjs';
import { Profiles } from './profiles.mjs';

const USAGE = 'usage: node admin.mjs DB (show PLAYER | clear PLAYER [REASON] | reserve NAME [REASON] | unreserve NAME | backup FILE)';

/** Run one admin command against the database at `file`; what to print. */
export function run(file, [command, arg, ...rest]) {
  if (!arg) throw Error(USAGE);
  const db = openDatabase(file);
  try {
    // Moderation checks no signatures: no chain needed.
    const profiles = new Profiles(db, { chain: null, chain_id: 0 });
    const reason = rest.join(' ');
    switch (command) {
      case 'show': return JSON.stringify(profiles.get(arg));
      case 'clear': {
        const cleared = profiles.clear(arg, { reason });
        return cleared ? `cleared ${cleared.handle} from ${cleared.player}, reserved` : `${arg} has no handle`;
      }
      case 'reserve': profiles.reserve(arg, reason); return `reserved ${arg}`;
      case 'unreserve': return profiles.unreserve(arg) ? `unreserved ${arg}` : `${arg} was not reserved here`;
      case 'backup': backup(db, arg); return `backed up to ${arg}`;
      default: throw Error(USAGE);
    }
  } finally {
    db.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [file, ...args] = process.argv.slice(2);
  try {
    if (!file) throw Error(USAGE);
    console.log(run(file, args));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
