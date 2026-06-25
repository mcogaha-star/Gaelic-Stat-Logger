import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { createPageUrl } from '@/utils';
import { Activity, ChevronRight, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { setPostLoginRedirect, consumePostLoginRedirect } from '@/lib/postLoginRedirect';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signInWithMagicLink, signInWithGoogle, isAuthenticated, isLoadingAuth, isSupabaseConfigured } = useAuth();
  const [email, setEmail] = useState('');
  const [statShareCode, setStatShareCode] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSendingGoogle, setIsSendingGoogle] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const nextTarget = useMemo(() => {
    const params = new URLSearchParams(location?.search || '');
    const value = String(params.get('next') || '').trim();
    return value || '';
  }, [location?.search]);

  useEffect(() => {
    if (isLoadingAuth || !isAuthenticated) return;
    const redirectTarget = consumePostLoginRedirect() || nextTarget || createPageUrl('Home');
    navigate(redirectTarget, { replace: true });
  }, [isAuthenticated, isLoadingAuth, navigate, nextTarget]);

  const sendLink = async () => {
    if (!isSupabaseConfigured) {
      toast.error('Supabase is not configured for this deployment.');
      return;
    }
    if (!email || !email.includes('@')) {
      toast.error('Enter a valid email');
      return;
    }
    setIsSending(true);
    try {
      if (nextTarget) setPostLoginRedirect(nextTarget);
      await signInWithMagicLink(email.trim());
      toast.success('Check your email for a sign-in link.');
    } catch (e) {
      toast.error(e?.message || 'Failed to send link');
    } finally {
      setIsSending(false);
    }
  };

  const continueWithGoogle = async () => {
    if (!isSupabaseConfigured) {
      toast.error('Supabase is not configured for this deployment.');
      return;
    }
    setIsSendingGoogle(true);
    try {
      if (nextTarget) setPostLoginRedirect(nextTarget);
      await signInWithGoogle();
      // Supabase will redirect away; if it doesn't, show a gentle hint.
      toast.message('Opening Google sign-in...');
    } catch (e) {
      toast.error(e?.message || 'Failed to start Google sign-in');
      setIsSendingGoogle(false);
    }
  };

  const openSharedStats = () => {
    const code = String(statShareCode || '').trim().toUpperCase();
    if (!code) {
      toast.error('Enter a stat share code');
      return;
    }
    navigate(createPageUrl(`StatShare?code=${encodeURIComponent(code)}`));
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(239,68,68,0.12),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(30,41,59,0.14),_transparent_30%),linear-gradient(180deg,_#f8fafc_0%,_#eef2f7_100%)]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-10">
        <div className="w-full space-y-8">
          <div className="max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              <Activity className="h-3.5 w-3.5" />
              Welcome to GaeliQ
            </div>
            <div className="space-y-2">
              <h1 className="text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
                Access your workspace or open a shared report
              </h1>
              <p className="max-w-2xl text-base text-slate-600 sm:text-lg">
                Sign in to log matches, review reports, sync private data, and manage video workflows. Or open a shared
                stats report instantly in read-only mode.
              </p>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
            <Card className="border-slate-200 bg-white/95 shadow-sm backdrop-blur">
              <CardHeader className="space-y-3 pb-3">
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
                  <LockKeyhole className="h-3.5 w-3.5" />
                  Private Workspace
                </div>
                <div className="space-y-2">
                  <CardTitle className="text-2xl text-slate-950">Sign in to GaeliQ</CardTitle>
                  <p className="max-w-xl text-sm leading-6 text-slate-600">
                    Unlock logging, reports, season views, syncing, imports, video review, and account settings.
                  </p>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <Button
                  className="h-11 w-full bg-slate-950 text-base hover:bg-slate-800"
                  onClick={continueWithGoogle}
                  disabled={isSendingGoogle || isSending}
                >
                  Continue with Google
                </Button>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Use email instead</div>
                      <div className="text-sm text-slate-600">Send yourself a one-time magic link.</div>
                    </div>
                    <Button
                      type="button"
                      variant={showEmail ? 'secondary' : 'outline'}
                      className="gap-2"
                      onClick={() => setShowEmail((prev) => !prev)}
                    >
                      <Mail className="h-4 w-4" />
                      {showEmail ? 'Hide email sign-in' : 'Use email instead'}
                    </Button>
                  </div>

                  {showEmail ? (
                    <div className="mt-4 space-y-3">
                      <Input
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') sendLink();
                        }}
                      />
                      <Button className="w-full bg-green-600 hover:bg-green-700" onClick={sendLink} disabled={isSending}>
                        Send sign-in link
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 sm:grid-cols-3">
                  <div>
                    <div className="font-semibold text-slate-900">Logging</div>
                    <div>Live workflows, stat entry, and match setup.</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">Reports</div>
                    <div>Tabs, players, comparison, and season review.</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">Sync & Share</div>
                    <div>Private sync, game copy import, and shared reports.</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white/92 shadow-sm backdrop-blur">
              <CardHeader className="space-y-3 pb-3">
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Read-Only Access
                </div>
                <div className="space-y-2">
                  <CardTitle className="text-2xl text-slate-950">View Shared Stats</CardTitle>
                  <p className="text-sm leading-6 text-slate-600">
                    Open a shared report without signing in. Shared stats are read-only and do not give access to the
                    Home screen, logging, sync, or settings.
                  </p>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Enter shared stats code"
                  value={statShareCode}
                  onChange={(e) => setStatShareCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') openSharedStats();
                  }}
                />
                <Button className="h-11 w-full bg-slate-900 text-base hover:bg-slate-800" onClick={openSharedStats}>
                  Open Shared Stats
                </Button>

                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
                  Use this path when someone shares a report code with you and you only need to review the stats.
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
            <div>Privacy agreement is only required when using the private GaeliQ workspace.</div>
            <div className="flex items-center gap-4">
              <Link to={createPageUrl('Privacy')} className="inline-flex items-center gap-1 underline underline-offset-4">
                Privacy details
              </Link>
              <span className="inline-flex items-center gap-1">
                Shared reports stay read-only
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
