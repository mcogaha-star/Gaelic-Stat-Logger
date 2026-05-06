import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowLeft } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import MatchReport from '@/pages/MatchReport';
import { fetchSharedMatchSnapshotByCode } from '@/lib/sharedMatchCopies';
import { createPageUrl } from '@/utils';

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

export default function StatShare() {
  const location = useLocation();
  const params = new URLSearchParams(location?.search || '');
  const code = String(params.get('code') || '').trim().toUpperCase();

  const { data, isLoading, error } = useQuery({
    queryKey: ['stat-share', code],
    queryFn: () => fetchSharedMatchSnapshotByCode(code, { requireAuth: false, allowedTypes: ['stat_view'] }),
    enabled: !!code,
  });

  const snapshot = data?.ok ? data.snapshot : null;
  const payload = useMemo(() => parsePayload(snapshot), [snapshot]);

  if (!code) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-slate-900 mx-auto flex items-center justify-center">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div className="text-slate-900 font-semibold">No stat share code provided</div>
            <Link to={createPageUrl('Login')}>
              <Button>Back to Login</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data?.ok || !snapshot || !payload) {
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
            <Link to={createPageUrl('Login')}>
              <Button className="gap-2"><ArrowLeft className="w-4 h-4" /> Back to Login</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <MatchReport sharedPayload={payload} statShareCode={code} readOnly />;
}
