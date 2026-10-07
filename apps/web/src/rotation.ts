type Store = Pick<Storage, "getItem" | "setItem">;

const storage = (): Store | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * The next of `count` choices for this page load: one past the last load's,
 * remembered in this browser, so every choice comes round in turn. Without
 * storage (a private window, blocked site data), a random one.
 */
export function nextInRotation(
  key: string,
  count: number,
  store: Store | null = storage(),
): number {
  try {
    const last = Number.parseInt(store?.getItem(key) ?? "", 10);
    const next =
      Number.isInteger(last) && last >= 0
        ? (last + 1) % count
        : Math.floor(Math.random() * count);
    store?.setItem(key, String(next));
    return next;
  } catch {
    return Math.floor(Math.random() * count);
  }
}
