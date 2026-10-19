// Surround's protocol SDK (offchain/sdk, plain JavaScript, a file dependency):
// Go on arbiter, the keeper client and the session store. Untyped here;
// src/rated wraps what the app uses in typed calls.
declare module "@surround/offchain" {
  const sdk: any;
  export = sdk;
}
declare module "@surround/offchain/client" {
  const client: any;
  export = client;
}
// Player handles' rule and the message a wallet signs to claim one
// (offchain/sdk/src/handle.mjs), small enough to load with the page.
declare module "@surround/offchain/handle" {
  export const HANDLE_PATTERN: RegExp;
  export const HANDLE_VERSION: string;
  export function handleKey(handle: string): string;
  export function handleError(handle: unknown): string | null;
  export function handleTypedData(fields: {
    chainId: string | bigint;
    player: string | bigint;
    handle: string;
    at: number;
  }): unknown;
}
