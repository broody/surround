import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";

/** Cartridge Controller's wallet id (its `starknet:walletApi` id). */
export const CONTROLLER_ID = "controller";

const SEPOLIA_RPC = "https://api.cartridge.gg/x/starknet/sepolia";
let loading: Promise<WalletWithStarknetFeatures> | undefined;

/**
 * Cartridge Controller as a wallet-standard wallet, on Sepolia. It has no
 * extension (its keychain is Cartridge's, in an iframe), so it's loaded only
 * when someone picks it, or reconnects to it, and once. Loading it also
 * registers it with the wallet standard, as injected wallets are.
 */
export function controllerWallet() {
  loading ??= import("@cartridge/controller").then(
    ({ default: Controller }) =>
      new Controller({
        chains: [{ rpcUrl: SEPOLIA_RPC }],
        defaultChainId: "0x534e5f5345504f4c4941",
        lazyload: true,
      }).asWalletStandard() as unknown as WalletWithStarknetFeatures,
  );
  return loading;
}
