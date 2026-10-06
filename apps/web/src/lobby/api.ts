import { useEffect, useState } from "react";
import type { Lobby, Match, Player } from "../../../../shared/lobby.ts";

const SESSION_KEY = "surround-player-v1";
type Session = { token: string; player: Player };
export function readSession(): Session | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    return value?.token && value?.player?.id ? value : null;
  } catch {
    return null;
  }
}
export function saveSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
export class APIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export async function request<T>(
  path: string,
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const session = readSession();
  const response = await fetch(`/api/lobby${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(session ? { authorization: `Bearer ${session.token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: signal ?? AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    if (response.status === 401) localStorage.removeItem(SESSION_KEY);
    throw new APIError(
      response.status,
      result?.error ?? "The lobby could not be reached. Please try again.",
    );
  }
  return result as T;
}
export async function enterLobby(name: string, rank: string) {
  const session = await request<Session>("/session", { name, rank });
  saveSession(session);
  return session;
}
export const openMatch = (match: Match) => {
  window.location.hash = `match/${match.id}`;
};
export function useResource<T>(
  path: string,
  enabled: boolean,
  interval: number,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const result = await request<T>(
          path,
          undefined,
          AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        );
        if (!stopped) {
          setData((previous) => {
            // A response started before a mutation must not replace newer state.
            const oldVersion = (previous as Match | null)?.version;
            const newVersion = (result as Match)?.version;
            return oldVersion && newVersion && newVersion < oldVersion
              ? previous
              : result;
          });
          setError("");
          setConnected(true);
        }
      } catch (error) {
        if (!stopped) {
          setError((error as Error).message);
          setConnected(false);
        }
      }
      if (!stopped)
        timer = setTimeout(
          poll,
          document.hidden ? Math.max(interval, 10_000) : interval,
        );
    }
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, enabled, interval, revision]);
  return {
    data,
    setData,
    error,
    connected,
    refresh: () => setRevision((value) => value + 1),
  };
}
export const useLobby = (enabled: boolean) =>
  useResource<Lobby>("", enabled, 4000);
