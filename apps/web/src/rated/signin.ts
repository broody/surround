// A signed-in browser's key (offchain/matchmaker/README.md, Signing in): one
// wallet signature delegates it for a week, and it signs the player's lobby
// requests and rated games' terms after. It is a Stark key, kept in IndexedDB
// encrypted (AES-GCM) under a non-extractable key, so storage holds no key in
// the clear: a dump of it, a backup or a copy from devtools shows ciphertext.
// That is no defense against code running in the page, which can decrypt it,
// nor against malware with the browser profile, which holds the wrapping
// key's bytes too. A stolen key is bounded by its expiry, by revocation and by
// what it may sign: no moves, and no funds.

/** Where keys are kept: IndexedDB in the browser (`indexedDbBox`), memory in tests (`memoryBox`). */
export type KeyBox = {
  get(name: string): Promise<any>;
  put(name: string, value: any): Promise<void>;
  delete(name: string): Promise<void>;
};

/** A box in memory, for tests and browsers without IndexedDB. */
export function memoryBox(): KeyBox {
  const values = new Map<string, any>();
  return {
    get: async (name) => values.get(name),
    put: async (name, value) => void values.set(name, value),
    delete: async (name) => void values.delete(name),
  };
}

/** A box in this origin's IndexedDB, which keeps a CryptoKey without exposing its bytes to scripts. */
export function indexedDbBox(database = "surround-signin"): KeyBox {
  const opened = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const run = async <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>) => {
    const store = (await opened).transaction("keys", mode).objectStore("keys");
    return new Promise<T>((resolve, reject) => {
      const request = act(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };
  return {
    get: (name) => run("readonly", (store) => store.get(name)),
    put: async (name, value) => void (await run("readwrite", (store) => store.put(value, name))),
    delete: async (name) => void (await run("readwrite", (store) => store.delete(name))),
  };
}

/** A player's browser key, decrypted: its private key, public key (hex) and when its sign-in expires (Unix seconds). */
export type BrowserKey = { privateKey: bigint; key: string; expires_at: number };

const WRAP = "wrap";
const recordName = (player: string) => `player:${BigInt(player).toString(16)}`;
const bytesOf = (value: bigint) => Uint8Array.from(value.toString(16).padStart(64, "0").match(/../g)!, (b) => parseInt(b, 16));
const valueOf = (bytes: ArrayBuffer) => BigInt(`0x${[...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("")}`);

/** Each player's browser key on this browser, encrypted under one non-extractable AES-GCM key. */
export class SignInStore {
  private box: KeyBox;
  private now: () => number;
  private subtle: SubtleCrypto;

  constructor(box: KeyBox, { now = Date.now, subtle = globalThis.crypto.subtle }: { now?: () => number; subtle?: SubtleCrypto } = {}) {
    this.box = box;
    this.now = now;
    this.subtle = subtle;
  }

  // The wrapping key, made once per browser. Non-extractable: no script can read its bytes.
  private async wrap(): Promise<CryptoKey> {
    const kept = await this.box.get(WRAP);
    if (kept) return kept;
    const made = await this.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await this.box.put(WRAP, made);
    return made;
  }

  /** Keep `player`'s browser key, encrypted; its record decrypts for that player only. */
  async save(player: string, key: BrowserKey) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const additionalData = new TextEncoder().encode(recordName(player));
    const data = await this.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, await this.wrap(), bytesOf(key.privateKey));
    await this.box.put(recordName(player), { key: key.key, expires_at: key.expires_at, iv, data });
  }

  /** `player`'s browser key on this browser, decrypted, while its sign-in runs; null otherwise. */
  async key(player: string): Promise<BrowserKey | null> {
    const record = await this.box.get(recordName(player));
    if (!record || record.expires_at <= this.now() / 1000) return null;
    try {
      const additionalData = new TextEncoder().encode(recordName(player));
      const plain = await this.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData }, await this.wrap(), record.data);
      return { privateKey: valueOf(plain), key: record.key, expires_at: record.expires_at };
    } catch {
      // Its wrapping key is gone (cleared storage) or another's: the player signs in again.
      return null;
    }
  }

  async forget(player: string) {
    await this.box.delete(recordName(player));
  }
}

/** This browser's sign-ins, in IndexedDB. */
export const browserSignIns = () => new SignInStore(indexedDbBox());
