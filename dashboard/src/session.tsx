import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getMe, setApiKey, setUnauthorizedHandler, type Me } from "./api";

// The API key lives in sessionStorage: it is gone when the tab closes (localStorage would keep it for good).
// Trade-off: any script that runs on this page can read it, which is why the app never renders HTML from the
// server and has no dangerouslySetInnerHTML. A safer design is an httpOnly session cookie (see README, threat model).
const STORAGE_KEY = "mcpgw.apikey";

const readStored = (): string | null => {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage can be blocked (private window): the app still works, you just log in again
  }
};
const writeStored = (key: string | null): void => {
  try {
    if (key) sessionStorage.setItem(STORAGE_KEY, key);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

interface Session {
  user: Me | null;
  ready: boolean; // false while a stored key is being checked
  login: (key: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    setApiKey(null);
    writeStored(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    const stored = readStored();
    if (!stored) {
      setReady(true);
      return;
    }
    setApiKey(stored);
    getMe()
      .then(setUser)
      .catch(logout)
      .finally(() => setReady(true));
  }, [logout]);

  const login = useCallback(async (key: string) => {
    const clean = key.trim();
    const me = await getMe(clean); // throws ApiError(401) for a wrong or revoked key
    setApiKey(clean);
    writeStored(clean);
    setUser(me);
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
