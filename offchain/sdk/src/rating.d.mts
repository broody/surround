export type Rating = { mu: bigint; phi: bigint; last: bigint };
export const ONE: bigint;
export const MU_T: bigint[];
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
