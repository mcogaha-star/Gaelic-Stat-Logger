const db = globalThis.__B44_DB__ || {
  entities: new Proxy({}, { get: () => ({ filter: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
};

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, BarChart3, Calendar, Filter } from 'lucide-react';

import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function formatMatchTitle(match, teams) {
  const home = teams.find((t) => t.id === match?.home_team_id);
  const away = teams.find((t) => t.id === match?.away_team_id);
  if (home && away) return `${home.name} vs ${away.name}`;
  return 'Match';
}

export default function SeasonStats() {
  const location = useLocation();
  const params = new URLSearchParams(location.search || '');
  const matchId = params.get('matchId') || '';

  const [seasonFilter, setSeasonFilter] = useState('all');
  const [codeFilter, setCodeFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');

  const { data: matches = [] } = useQuery({
    queryKey: ['matches'],
    queryFn: () => db.entities.Match.list('-date'),
  });

  const { data: teams = [] } = useQuery({
    queryKey: ['teams'],
    queryFn: () => db.entities.Team.list('name'),
  });

  const selectedMatch = useMemo(() => matches.find((m) => m.id === matchId) || null, [matches, matchId]);

  const seasonOptions = useMemo(() => {
    return Array.from(new Set(matches.map((m) => String(m.competition || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [matches]);

  const filteredMatches = useMemo(() => {
    return matches.filter((match) => {
      if (seasonFilter !== 'all' && String(match.competition || '') !== seasonFilter) return false;
      if (codeFilter !== 'all' && String(match.code || '') !== codeFilter) return false;
      if (teamFilter !== 'all' && ![match.home_team_id, match.away_team_id].includes(teamFilter)) return false;
      return true;
    });
  }, [matches, seasonFilter, codeFilter, teamFilter]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to={matchId ? createPageUrl(`MatchStats?id=${matchId}`) : createPageUrl('Home')}>
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
            </Link>
            <div>
              <div className="text-sm text-slate-500">Season Stats</div>
              <div className="text-xl font-semibold text-slate-900">
                {selectedMatch ? `${formatMatchTitle(selectedMatch, teams)} - Season View` : 'Season Stats Workspace'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-slate-900 font-semibold">
              <Filter className="w-4 h-4" />
              Filters
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Competition</Label>
                <Select value={seasonFilter} onValueChange={setSeasonFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {seasonOptions.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Code</Label>
                <Select value={codeFilter} onValueChange={setCodeFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="GAA">GAA</SelectItem>
                    <SelectItem value="LGFA">LGFA</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Team</Label>
                <Select value={teamFilter} onValueChange={setTeamFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Teams</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-[1.3fr_0.9fr] gap-6">
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-slate-900 font-semibold">
                <BarChart3 className="w-4 h-4" />
                Coming Next
              </div>
              <div className="text-sm text-slate-600 space-y-2">
                <p>This page is now scaffolded and ready for season-level reporting.</p>
                <p>Planned additions here include cumulative team stats, seasonal leaderboards, trend lines, and cross-match filtering.</p>
              </div>
              <div className="grid sm:grid-cols-3 gap-3 pt-2">
                <div className="rounded-xl border bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Matches In Scope</div>
                  <div className="text-2xl font-semibold text-slate-900 mt-1">{filteredMatches.length}</div>
                </div>
                <div className="rounded-xl border bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Selected Competition</div>
                  <div className="text-lg font-semibold text-slate-900 mt-1">{seasonFilter === 'all' ? 'All' : seasonFilter}</div>
                </div>
                <div className="rounded-xl border bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Selected Team</div>
                  <div className="text-lg font-semibold text-slate-900 mt-1">{teamFilter === 'all' ? 'All' : (teams.find((t) => t.id === teamFilter)?.name || 'Team')}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-slate-900 font-semibold">
                <Calendar className="w-4 h-4" />
                Matches
              </div>
              {filteredMatches.length === 0 ? (
                <div className="text-sm text-slate-500">No matches match the current filters.</div>
              ) : (
                <div className="space-y-2 max-h-[420px] overflow-y-auto">
                  {filteredMatches.map((match) => (
                    <Link key={match.id} to={createPageUrl(`MatchReport?id=${match.id}`)} className="block rounded-xl border p-3 hover:bg-slate-50">
                      <div className="font-medium text-slate-900">{formatMatchTitle(match, teams)}</div>
                      <div className="text-xs text-slate-500 mt-1">{match.date || 'No date'}{match.competition ? ` • ${match.competition}` : ''}</div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
