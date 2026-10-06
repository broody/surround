import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  GetStarknetProvider,
  useStarknetProvider,
} from "@starknet-io/get-starknet-modal";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  StarknetWalletApi,
  type WalletWithStarknetFeatures,
} from "@starknet-io/get-starknet-wallet-standard/features";

/** Surround's games are on Sepolia for now: `SN_SEPOLIA`. */
export const SEPOLIA = "0x534e5f5345504f4c4941";
// get-starknet's own key for the last wallet a user connected, so its wallet
// list and our silent reconnect agree.
const LAST_WALLET = "get-starknet.last-connected-wallet";

type WalletState = {
  /** The connected wallet, if any. */
  wallet?: WalletWithStarknetFeatures;
  /** The connected account's address. */
  address?: string;
  /** The chain the wallet is on, as a hex chain id (`SEPOLIA`). */
  chainId?: string;
  connecting: boolean;
  error?: string;
  /** Connect `wallet` (asking the user), then switch it to Sepolia. */
  connect(wallet: WalletWithStarknetFeatures): Promise<void>;
  disconnect(): Promise<void>;
  /** Ask the wallet to switch to Sepolia. */
  switchToSepolia(): Promise<void>;
  /** The account's SNIP-12 signature over `typedData`, as its account checks it. */
  signTypedData(typedData: unknown): Promise<string[]>;
  /** Send a transaction from the account; resolves to its hash. */
  invoke(calls: { contract_address: string; entry_point: string; calldata?: string[] }[]): Promise<string>;
};

const WalletContext = createContext<WalletState | null>(null);

const read = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* Storage may be unavailable; reconnecting is a convenience. */
  }
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error ?? "Unknown error");
/** A wallet's API: `request({ type, params })`, as Starknet's wallet API defines it. */
const api = (wallet: WalletWithStarknetFeatures) =>
  wallet.features[StarknetWalletApi];

/** The connected account's address and chain, as the wallet reports them. */
function accountOf(wallet: WalletWithStarknetFeatures) {
  const account = wallet.accounts[0];
  const chain = account?.chains.find((c) => c.startsWith("starknet:"));
  return { address: account?.address, chainId: chain?.slice("starknet:".length) };
}

function WalletState({ children }: { children: ReactNode }) {
  const { injectedWallets } = useStarknetProvider();
  const [wallet, setWallet] = useState<WalletWithStarknetFeatures>();
  const [account, setAccount] = useState<{ address?: string; chainId?: string }>({});
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();
  const stopListening = useRef<() => void>(undefined);
  const triedSilent = useRef(false);

  const attach = useCallback((next: WalletWithStarknetFeatures | undefined) => {
    stopListening.current?.();
    stopListening.current = next?.features[StandardEvents].on("change", () =>
      setAccount(accountOf(next)),
    );
    setWallet(next);
    setAccount(next ? accountOf(next) : {});
  }, []);

  const open = useCallback(
    async (next: WalletWithStarknetFeatures, silent: boolean) => {
      const { accounts } = await next.features[StandardConnect].connect({ silent });
      if (!accounts.length) return false;
      attach(next);
      write(LAST_WALLET, api(next).id);
      return true;
    },
    [attach],
  );

  const switchToSepolia = useCallback(async () => {
    if (!wallet) return;
    try {
      await api(wallet).request({
        type: "wallet_switchStarknetChain",
        params: { chainId: SEPOLIA },
      });
      setAccount(accountOf(wallet));
    } catch (e) {
      setError(`Switch your wallet to Sepolia (${message(e)})`);
    }
  }, [wallet]);

  const connect = useCallback(
    async (next: WalletWithStarknetFeatures) => {
      setError(undefined);
      setConnecting(true);
      try {
        if (!(await open(next, false))) throw Error("The wallet shared no account");
        const { chainId } = accountOf(next);
        if (chainId && BigInt(chainId) !== BigInt(SEPOLIA))
          await api(next)
            .request({ type: "wallet_switchStarknetChain", params: { chainId: SEPOLIA } })
            .then(() => setAccount(accountOf(next)))
            .catch(() => {});
      } catch (e) {
        setError(message(e));
      } finally {
        setConnecting(false);
      }
    },
    [open],
  );

  const disconnect = useCallback(async () => {
    const current = wallet;
    attach(undefined);
    write(LAST_WALLET, null);
    await current?.features[StandardDisconnect].disconnect().catch(() => {});
  }, [wallet, attach]);

  const signTypedData = useCallback(
    async (typedData: unknown) => {
      if (!wallet) throw Error("Connect a wallet first");
      const signature = await api(wallet).request({
        type: "wallet_signTypedData",
        params: typedData as never,
      });
      return signature.map((felt) => `0x${BigInt(felt).toString(16)}`);
    },
    [wallet],
  );

  const invoke = useCallback(
    async (calls: { contract_address: string; entry_point: string; calldata?: string[] }[]) => {
      if (!wallet) throw Error("Connect a wallet first");
      const { transaction_hash } = await api(wallet).request({
        type: "wallet_addInvokeTransaction",
        params: { calls },
      });
      return transaction_hash;
    },
    [wallet],
  );

  // Reconnect, without asking, to the wallet connected last time, once it
  // announces itself.
  useEffect(() => {
    if (wallet || triedSilent.current) return;
    const last = read(LAST_WALLET);
    const found = last && injectedWallets.find((w) => api(w).id === last);
    if (!found) return;
    triedSilent.current = true;
    open(found, true).catch(() => {});
  }, [injectedWallets, wallet, open]);

  useEffect(() => () => stopListening.current?.(), []);

  const value = useMemo<WalletState>(
    () => ({ wallet, ...account, connecting, error, connect, disconnect, switchToSepolia, signTypedData, invoke }),
    [wallet, account, connecting, error, connect, disconnect, switchToSepolia, signTypedData, invoke],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/** Starknet wallets through get-starknet v5 (wallet standard): discovery and the connected account. */
export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <GetStarknetProvider>
      <WalletState>{children}</WalletState>
    </GetStarknetProvider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used within a WalletProvider");
  return context;
}
