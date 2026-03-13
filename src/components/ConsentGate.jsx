import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { useLocation } from 'react-router-dom';

const CONSENT_VERSION = '2026-03-13';
const CONSENT_KEY = 'gaelic_consent_version';
const CONSENT_SERVER_SYNC_KEY = 'gaelic_consent_server_synced_version';

export function getConsentVersion() {
  try {
    return window.localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

export function clearConsent() {
  try {
    window.localStorage.removeItem(CONSENT_KEY);
    window.localStorage.removeItem(CONSENT_SERVER_SYNC_KEY);
  } catch {}
}

async function recordConsentOnServer({ accepted }) {
  if (!isSupabaseConfigured || !supabase) return;
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return;

  const patch = accepted
    ? { user_id: user.id, consent_version: CONSENT_VERSION, accepted_at: new Date().toISOString(), revoked_at: null, updated_at: new Date().toISOString() }
    : { user_id: user.id, consent_version: CONSENT_VERSION, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() };

  // Upsert requires a unique key; we use user_id as PK.
  const { error } = await supabase.from('user_consents').upsert(patch);
  if (!error && accepted) {
    try {
      window.localStorage.setItem(CONSENT_SERVER_SYNC_KEY, CONSENT_VERSION);
    } catch {}
  }
}

export default function ConsentGate({ children }) {
  const [consentVersion, setConsentVersion] = useState(() => getConsentVersion());
  const location = useLocation();

  useEffect(() => {
    setConsentVersion(getConsentVersion());
  }, []);

  const accepted = consentVersion === CONSENT_VERSION;
  const path = location?.pathname || '/';
  const allowWithoutConsent = path === '/Privacy' || path === '/Login';

  // If the user accepted previously while logged out, sync it to the server
  // once auth becomes available.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    if (!accepted) return;

    let isMounted = true;

    const maybeSync = async () => {
      if (!isMounted) return;
      let alreadySynced = null;
      try {
        alreadySynced = window.localStorage.getItem(CONSENT_SERVER_SYNC_KEY);
      } catch {}
      if (alreadySynced === CONSENT_VERSION) return;
      await recordConsentOnServer({ accepted: true });
    };

    // Try immediately (covers "accepted then login in same tab" cases).
    maybeSync().catch(() => {});

    // Also retry when auth state changes (covers "accepted, later clicked magic link").
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      maybeSync().catch(() => {});
    });

    return () => {
      isMounted = false;
      try {
        sub?.subscription?.unsubscribe?.();
      } catch {}
    };
  }, [accepted]);

  if (accepted || allowWithoutConsent) return children;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>User Agreement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-slate-700">
            Gaelic stats tracker has the ability to view and use statistical data that is logged in research and model tuning.
            Identifable data such as team and player names can not be seen. Please click accept to proceed.
          </p>
          <div className="flex items-center justify-between gap-3">
            <Link to={createPageUrl('Privacy')} className="text-sm text-slate-600 underline">
              Privacy details
            </Link>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={async () => {
                try {
                  window.localStorage.setItem(CONSENT_KEY, CONSENT_VERSION);
                  setConsentVersion(CONSENT_VERSION);
                } catch {}
                // Best-effort server record (if logged in now or later).
                recordConsentOnServer({ accepted: true }).catch(() => {});
              }}
            >
              Accept
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
