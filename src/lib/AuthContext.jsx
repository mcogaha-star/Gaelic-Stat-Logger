import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';

const AuthContext = createContext(null);

async function maybeExchangeCodeForSession() {
  // Supabase magic links often return with ?code=... (PKCE). With HashRouter,
  // it is easy to end up on a blank route if we don't exchange and then
  // clean the URL.
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    if (!code) return;

    await supabase.auth.exchangeCodeForSession(window.location.href);

    // Remove the code param so refreshes don't re-run the exchange.
    url.searchParams.delete('code');
    window.history.replaceState({}, '', url.pathname + (url.search ? `?${url.searchParams.toString()}` : '') + (url.hash || ''));
  } catch {
    // Best-effort; the rest of the auth flow will surface any issues.
  }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState({ id: 'local', public_settings: {} });

  useEffect(() => {
    let unsub = null;

    const init = async () => {
      setIsLoadingAuth(true);
      setAuthError(null);

      if (!isSupabaseConfigured) {
        setUser(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        return;
      }

      // Handle PKCE callback if we landed here from a magic-link.
      await maybeExchangeCodeForSession();

      const { data, error } = await supabase.auth.getSession();
      if (error) {
        setUser(null);
        setIsAuthenticated(false);
        setAuthError({ type: 'unknown', message: error.message });
        setIsLoadingAuth(false);
        return;
      }

      const sessionUser = data?.session?.user ?? null;
      setUser(sessionUser);
      setIsAuthenticated(!!sessionUser);
      if (!sessionUser) {
        setAuthError({ type: 'auth_required', message: 'Authentication required' });
      }
      setIsLoadingAuth(false);

      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        const u = session?.user ?? null;
        setUser(u);
        setIsAuthenticated(!!u);
        setAuthError(u ? null : { type: 'auth_required', message: 'Authentication required' });
      });
      unsub = sub?.subscription?.unsubscribe ?? null;
    };

    init();
    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, []);

  const signInWithMagicLink = async (email) => {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured');
    // Redirect to the app root to avoid HashRouter conflicts with auth callback params.
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  };

  const logout = async () => {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
  };

  const navigateToLogin = () => {
    // HashRouter-friendly navigation without needing router hooks.
    window.location.hash = '#/Login';
  };

  const checkAppState = async () => {
    // Kept for compatibility with older Base44 scaffolding.
    return;
  };

  const value = useMemo(
    () => ({
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState,
      signInWithMagicLink,
      isSupabaseConfigured,
    }),
    [user, isAuthenticated, isLoadingAuth, isLoadingPublicSettings, authError, appPublicSettings],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
