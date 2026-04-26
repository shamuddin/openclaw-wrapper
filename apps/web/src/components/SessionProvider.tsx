'use client';

import { type ReactNode, createContext, useContext, useMemo, useState } from 'react';

const SESSION_STORAGE_KEY = 'openclaw-wrapper:session-token';

interface SessionContextValue {
  sessionToken: string;
  setSessionToken: (token: string) => void;
  clearSessionToken: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function getSafeStorage(kind: 'session' | 'local'): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function readInitialSessionToken(): string {
  const sessionStorage = getSafeStorage('session');
  const sessionToken = sessionStorage?.getItem(SESSION_STORAGE_KEY)?.trim() ?? '';
  if (sessionToken) {
    return sessionToken;
  }

  // Keep auth tokens session-scoped and scrub any earlier persisted token on first load.
  const legacyToken = getSafeStorage('local')?.getItem(SESSION_STORAGE_KEY)?.trim() ?? '';
  if (!legacyToken) {
    return '';
  }

  try {
    sessionStorage?.setItem(SESSION_STORAGE_KEY, legacyToken);
  } catch {
    // best-effort
  }

  try {
    getSafeStorage('local')?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // best-effort
  }

  return legacyToken;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessionToken, setSessionTokenState] = useState(readInitialSessionToken);

  const value = useMemo<SessionContextValue>(
    () => ({
      sessionToken,
      setSessionToken(token) {
        const nextToken = token.trim();
        const sessionStorage = getSafeStorage('session');
        const legacyStorage = getSafeStorage('local');
        try {
          if (nextToken) {
            sessionStorage?.setItem(SESSION_STORAGE_KEY, nextToken);
          } else {
            sessionStorage?.removeItem(SESSION_STORAGE_KEY);
          }
        } catch {
          // best-effort
        }
        try {
          legacyStorage?.removeItem(SESSION_STORAGE_KEY);
        } catch {
          // best-effort
        }
        setSessionTokenState(nextToken);
      },
      clearSessionToken() {
        getSafeStorage('session')?.removeItem(SESSION_STORAGE_KEY);
        getSafeStorage('local')?.removeItem(SESSION_STORAGE_KEY);
        setSessionTokenState('');
      },
    }),
    [sessionToken],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useSession must be used inside SessionProvider');
  }
  return value;
}

export { SESSION_STORAGE_KEY };
