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
// Players' profiles: the handle rule and the message a wallet signs to claim
// a profile (offchain/sdk/src/profile.mjs), small enough to load with the page.
// Each board's byo-yomi and the preset a timed game on it names
// (offchain/sdk/src/clocks.mjs), small enough to load with the page.
declare module "@surround/offchain/clocks" {
  export type Byoyomi = { main_ms: number; periods: number; period_ms: number };
  export const BYOYOMI: Record<number, Byoyomi>;
  export function byoyomiPreset(size: number | string): string;
  export function presetSize(clock: string | null | undefined): number | null;
  export function byoyomiLabel(byoyomi: Byoyomi): string;
}
declare module "@surround/offchain/profile" {
  export const HANDLE_PATTERN: RegExp;
  export const BANDS: Record<string, string>;
  export const PROFILE_VERSION: string;
  export function handleKey(handle: string): string;
  export function handleError(handle: unknown): string | null;
  export function profileTypedData(fields: {
    chainId: string | bigint;
    player: string | bigint;
    handle: string;
    band: number;
    at: number;
  }): unknown;
}
