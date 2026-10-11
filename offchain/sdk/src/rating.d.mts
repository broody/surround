export type Rating = { mu: bigint; phi: bigint; last: bigint };
export const ONE: bigint;
export const MU_T: bigint[];
export const GO: string;
/** Go's rules for `@arbiter/sdk/ratings` (`GoRatingRules`). */
export const GO_RULES: {
  tag: string;
  version: number;
  refereeRng: boolean;
  pool(id: bigint): Record<string, bigint | number> | null;
  start(id: bigint, band: number): bigint | null;
  drift(id: bigint, mu: bigint): bigint;
  shown(id: bigint, mu: bigint, offset: number): number;
};
export function update(
  black: Rating,
  white: Rating,
  result: number,
  t: bigint,
): { black: Rating; white: Rating; p: bigint };
export function rankTenths(mu: bigint): number;
export function rankLabel(tenths: number): string;
export const ANCHOR_PHI: bigint;
export function anchorRating(mu: bigint, t: bigint | number): Rating;
