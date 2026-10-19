// Player handles: the name a wallet goes by in Surround, kept offchain by the
// matchmaker (offchain/db). One rule for what a handle may be, and the
// message a wallet signs to claim one, shared by the server and the browser.
// No dependencies, so the web can load it with the page.

/**
 * 3–20 ASCII letters, digits, `_` or `-`, starting with a letter. The hyphen
 * is escaped so `.source` also compiles as an HTML `pattern` (the `v` flag).
 */
export const HANDLE_PATTERN = /^[A-Za-z][A-Za-z0-9_\-]{2,19}$/;
/** The SNIP-12 domain version of `handleTypedData`; an export names it beside each signature. */
export const HANDLE_VERSION = '1';

/**
 * What makes two handles the same: case and separators aside, so `Broody`,
 * `bro_ody` and `bro-ody` are one handle, and so is a reserved name.
 */
export const handleKey = handle => String(handle).toLowerCase().replace(/[-_]/g, '');

/** Why `handle` can't be one, in words for the player; null if it can. */
export function handleError(handle) {
  if (typeof handle !== 'string' || !HANDLE_PATTERN.test(handle))
    return 'Use 3–20 letters, digits, _ or -, starting with a letter.';
  if (handleKey(handle).length < 3) return 'Use at least 3 letters or digits.';
  return null;
}

const hexOf = value => `0x${BigInt(value).toString(16)}`;
// A chain id felt as the short string it encodes ('SN_SEPOLIA'), as wallets show it.
const shortString = value => {
  const digits = BigInt(value).toString(16);
  return (digits.length % 2 ? `0${digits}` : digits).match(/../g).map(b => String.fromCharCode(parseInt(b, 16))).join('');
};

/**
 * What a player's wallet signs to go by `handle` (SNIP-12, revision 1), at
 * `at` (Unix seconds). The matchmaker takes it only fresh and newer than the
 * player's last claim, so a published claim can't be sent again.
 */
export function handleTypedData({ chainId, player, handle, at }) {
  return {
    types: {
      StarknetDomain: [{ name: 'name', type: 'shortstring' }, { name: 'version', type: 'shortstring' },
        { name: 'chainId', type: 'shortstring' }, { name: 'revision', type: 'shortstring' }],
      Handle: [{ name: 'player', type: 'ContractAddress' }, { name: 'handle', type: 'shortstring' },
        { name: 'at', type: 'timestamp' }],
    },
    primaryType: 'Handle',
    domain: { name: 'Surround Handles', version: HANDLE_VERSION, chainId: shortString(chainId), revision: '1' },
    message: { player: hexOf(player), handle, at: String(at) },
  };
}
