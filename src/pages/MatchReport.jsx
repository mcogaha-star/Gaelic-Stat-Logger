import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { createPageUrl } from '@/utils';

const db = globalThis.__B44_DB__ || {
  entities: new Proxy({}, {
    get: () => ({
      filter: async () => [],
    }),
  }),
};

export default function MatchReport() {
  const location = useLocation();
  const urlParams = new URLSearchParams(location?.search || '');
  const matchId = urlParams.get('id');

  const { data: matchArr = [] } = useQuery({
    queryKey: ['match', matchId],
    queryFn: () => db.entities.Match.filter({ id: matchId }),
    enabled: !!matchId,
  });

  const match = matchArr?.[0] || null;

  if (!matchId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center mx-auto">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div className="text-slate-900 font-semibold">No match selected</div>
            <Link to={createPageUrl('Home')}>
              <Button>Go to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <Link to={createPageUrl(`MatchStats?id=${matchId}`)}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to Logging
            </Button>
          </Link>
          <div className="text-sm text-slate-500">
            Match Stats (coming soon)
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-lg font-semibold text-slate-900">
                  {match?.home_team_id ? 'Match Report' : 'Match Report'}
                </div>
                <div className="text-sm text-slate-500">
                  This page will contain tables, visuals, and maps in a future update.
                </div>
              </div>
            </div>
            <div className="text-sm text-slate-600">
              Match ID: <span className="font-mono">{matchId}</span>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

