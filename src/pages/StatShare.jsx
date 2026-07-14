import React, { Component, useEffect, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import MatchReport from '@/pages/MatchReport';
import { fetchSharedMatchSnapshotByCode, importSharedMatchSnapshot } from '@/lib/sharedMatchCopies';
import { createPageUrl } from '@/utils';
import { useAuth } from '@/lib/AuthContext';
import demoBundle from '@/data/demoMatch.json';

const db = globalThis.__B44_DB__ || {
  entities: new Proxy({}, {
    get: () => ({
      filter: async () => [],
      get: async () => null,
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
    }),
  }),
};

function parsePayload(snapshot) {
  const raw = snapshot?.payload;
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function snapshotMatchesCode(snapshot, code) {
  if (!snapshot || !code) return false;
  return String(snapshot.share_code || '').trim().toUpperCase() === String(code || '').trim().toUpperCase()
    && String(snapshot.share_type || '').trim() === 'stat_view';
}

class StatShareReportBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('Stat share report crashed', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <Card className="w-full max-w-lg">
            <CardContent className="p-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-xl bg-slate-900 mx-auto flex items-center justify-center">
                <Activity className="w-6 h-6 text-white" />
              </div>
              <div className="text-slate-900 font-semibold">This shared report could not be rendered</div>
              <div className="text-sm text-slate-600">
                A saved browser snapshot may be stale. Reload the link or open it from the shared code again.
              </div>
              <Button type="button" onClick={() => window.location.reload()}>
                Reload report
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function StatShare() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const savedSnapshotRef = useRef('');
  const params = new URLSearchParams(location?.search || '');
  const code = String(params.get('code') || '').trim().toUpperCase();
  const initialSnapshot = snapshotMatchesCode(location?.state?.sharedSnapshot, code)
    ? location.state.sharedSnapshot
    : null;
  const demoMode = params.get('demo') === '1';
  const backUrl = isAuthenticated ? createPageUrl('Home') : createPageUrl('Login');

  const { data, isLoading, error } = useQuery({
    queryKey: ['stat-share', code],
    queryFn: () => fetchSharedMatchSnapshotByCode(code, { requireAuth: false, allowedTypes: ['stat_view'] }),
    enabled: !!code && !demoMode,
  });

  const snapshot = data?.ok ? data.snapshot : initialSnapshot;
  const payload = useMemo(() => (demoMode ? demoBundle : parsePayload(snapshot)), [demoMode, snapshot]);
  const saveStatViewMutation = useMutation({
    mutationFn: (snapshotRow) => importSharedMatchSnapshot({ db, snapshotRow, importMode: 'stat_view' }),
    onSuccess: (result) => {
      if (!result?.ok) return;
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['players'] });
      queryClient.invalidateQueries({ queryKey: ['all-stats'] });
      if (!result.alreadyImported) toast.success('Shared stats saved to your account');
    },
  });

  useEffect(() => {
    if (!isAuthenticated || demoMode || !snapshot?.id || !payload) return;
    if (String(snapshot?.share_type || '') !== 'stat_view') return;
    if (savedSnapshotRef.current === String(snapshot.id)) return;
    savedSnapshotRef.current = String(snapshot.id);
    saveStatViewMutation.mutate(snapshot);
  }, [demoMode, isAuthenticated, payload, saveStatViewMutation, snapshot]);

  if (!code && !demoMode) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-slate-900 mx-auto flex items-center justify-center">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div className="text-slate-900 font-semibold">No stat share code provided</div>
            <Link to={backUrl}>
              <Button>{isAuthenticated ? 'Back to Home' : 'Back to Login'}</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!demoMode && isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!demoMode && !snapshot && (error || !data?.ok || !payload)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-slate-900 mx-auto flex items-center justify-center">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div className="text-slate-900 font-semibold">This stat share is unavailable</div>
            <div className="text-sm text-slate-600">
              The code may be invalid, expired, or not yet published.
            </div>
            <Link to={backUrl}>
              <Button className="gap-2"><ArrowLeft className="w-4 h-4" /> {isAuthenticated ? 'Back to Home' : 'Back to Login'}</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!demoMode && snapshot && !payload) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-slate-900 mx-auto flex items-center justify-center">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div className="text-slate-900 font-semibold">This stat share is unavailable</div>
            <div className="text-sm text-slate-600">
              The shared report could not be loaded from the saved snapshot.
            </div>
            <Link to={backUrl}>
              <Button className="gap-2"><ArrowLeft className="w-4 h-4" /> {isAuthenticated ? 'Back to Home' : 'Back to Login'}</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <StatShareReportBoundary key={demoMode ? 'DEMO' : code}>
      <MatchReport sharedPayload={payload} statShareCode={demoMode ? 'DEMO' : code} readOnly />
    </StatShareReportBoundary>
  );
}
