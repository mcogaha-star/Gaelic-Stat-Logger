import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Activity, Shield, Target, Hand } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { createPageUrl } from '@/utils';
import { buildDefensiveActions, buildTouchEvents, safeParseJSON } from '@/features/report/shared';
import PlayersAnalyticsTab from '@/features/report/tabs/PlayersAnalyticsTab';
import { normalizeDefenceSetRows, normalizeStatModelRows, rebuildPossessionRows, shouldExcludeFromTotals, shotPointsForOutcome } from '@/lib/reportAnalytics';

const db = globalThis.__B44_DB__ || {
  entities: new Proxy({}, {
    get: () => ({
      filter: async () => [],
      get: async () => null,
    }),
  }),
};

function buildPlayerOptions(homePlayers = [], awayPlayers = []) {
  const all = [
    ...homePlayers.map((player) => ({ ...player, team_side: 'home' })),
    ...awayPlayers.map((player) => ({ ...player, team_side: 'away' })),
  ];
  return all
    .slice()
    .sort((a, b) => (a.team_side === b.team_side ? (a.number || 0) - (b.number || 0) : (a.team_side === 'home' ? -1 : 1)))
    .map((player) => ({
      id: player.id,
      team_side: player.team_side,
      label: `#${player.number || ''} ${player.name || ''}`.trim(),
      name: player.name || '',
      number: player.number ?? null,
      position: player.position || '',
    }));
}

function matchesSelection(selection, player) {
  if (!selection || !player || typeof selection !== 'object') return false;
  if (selection.kind !== 'player') return false;
  if (selection.team_side && player.team_side && selection.team_side !== player.team_side) return false;
  if (selection.id && player.id && String(selection.id) === String(player.id)) return true;
  if (selection.number != null && player.number != null && String(selection.number) === String(player.number)) return true;
  return String(selection.name || '').trim().toLowerCase() !== ''
    && String(selection.name || '').trim().toLowerCase() === String(player.name || '').trim().toLowerCase();
}

function buildSummary(stats, player) {
  let shots = 0;
  let points = 0;
  for (const stat of stats) {
    if (stat?.stat_type !== 'shot' || shouldExcludeFromTotals(stat)) continue;
    const shot = safeParseJSON(stat.extra_data || '{}', {})?.shot || {};
    if (!matchesSelection(shot?.player, player)) continue;
    shots += 1;
    points += shotPointsForOutcome(String(shot?.outcome || ''));
  }
  const touches = buildTouchEvents(stats, [player]).filter((touch) => matchesSelection(touch?.player, player)).length;
  const defActions = buildDefensiveActions(stats).playerActions.filter((action) => matchesSelection(action?.player, player)).length;
  return { shots, points, touches, defActions };
}

export default function PlayerProfile() {
  const location = useLocation();
  const params = new URLSearchParams(location?.search || '');
  const matchId = params.get('matchId') || '';
  const playerId = params.get('playerId') || '';
  const teamSide = params.get('teamSide') || '';

  const { data: matchArr = [] } = useQuery({
    queryKey: ['player-profile-match', matchId],
    queryFn: () => db.entities.Match.filter({ id: matchId }),
    enabled: !!matchId,
  });
  const match = matchArr?.[0] || null;

  const { data: homeTeamArr = [] } = useQuery({
    queryKey: ['player-profile-home-team', match?.home_team_id],
    queryFn: () => db.entities.Team.filter({ id: match?.home_team_id }),
    enabled: !!match?.home_team_id,
  });
  const { data: awayTeamArr = [] } = useQuery({
    queryKey: ['player-profile-away-team', match?.away_team_id],
    queryFn: () => db.entities.Team.filter({ id: match?.away_team_id }),
    enabled: !!match?.away_team_id,
  });
  const homeTeam = homeTeamArr?.[0] || null;
  const awayTeam = awayTeamArr?.[0] || null;

  const { data: homePlayers = [] } = useQuery({
    queryKey: ['player-profile-home-players', match?.home_team_id],
    queryFn: () => db.entities.Player.filter({ team_id: match?.home_team_id }),
    enabled: !!match?.home_team_id,
  });
  const { data: awayPlayers = [] } = useQuery({
    queryKey: ['player-profile-away-players', match?.away_team_id],
    queryFn: () => db.entities.Player.filter({ team_id: match?.away_team_id }),
    enabled: !!match?.away_team_id,
  });
  const { data: rawStats = [] } = useQuery({
    queryKey: ['player-profile-stats', matchId],
    queryFn: () => db.entities.StatEntry.filter({ match_id: matchId }),
    enabled: !!matchId,
  });

  const stats = useMemo(
    () => rebuildPossessionRows(normalizeStatModelRows(normalizeDefenceSetRows((rawStats || []).filter((row) => row?.stat_type !== 'defensive_contact')))),
    [rawStats],
  );
  const playerOptions = useMemo(() => buildPlayerOptions(homePlayers, awayPlayers), [homePlayers, awayPlayers]);
  const selectedPlayer = useMemo(
    () => playerOptions.find((player) => String(player.id) === String(playerId) && String(player.team_side) === String(teamSide)) || null,
    [playerOptions, playerId, teamSide],
  );
  const summary = useMemo(() => (selectedPlayer ? buildSummary(stats, selectedPlayer) : null), [stats, selectedPlayer]);

  if (!matchId || !playerId || !teamSide || !match) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center mx-auto">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div className="text-slate-900 font-semibold">No player profile selected</div>
            <Link to={createPageUrl('Home')}>
              <Button>Go to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!selectedPlayer) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          <Link to={createPageUrl(`MatchReport?id=${matchId}`)}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to Match Report
            </Button>
          </Link>
          <Card>
            <CardContent className="p-6 text-center text-slate-600">
              This player could not be resolved for the selected match.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const lockPlayerValue = `${selectedPlayer.team_side}|${selectedPlayer.id}`;
  const teamName = selectedPlayer.team_side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to={createPageUrl(`MatchReport?id=${matchId}`)}>
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
            </Link>
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 truncate">
                {selectedPlayer.label}
              </div>
              <div className="text-xs text-slate-500 truncate">
                {teamName} · {homeTeam?.name || 'Home'} vs {awayTeam?.name || 'Away'} · {match?.date || ''}
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Card><CardContent className="p-4"><div className="text-xs uppercase text-slate-500">Shots</div><div className="text-2xl font-semibold text-slate-900">{summary?.shots ?? 0}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs uppercase text-slate-500">Points</div><div className="text-2xl font-semibold text-slate-900">{summary?.points ?? 0}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs uppercase text-slate-500">Touches</div><div className="text-2xl font-semibold text-slate-900">{summary?.touches ?? 0}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs uppercase text-slate-500">Def. Actions</div><div className="text-2xl font-semibold text-slate-900">{summary?.defActions ?? 0}</div></CardContent></Card>
        </div>

        <PlayersAnalyticsTab
          stats={stats}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          playerOptions={[selectedPlayer]}
          reportFilters={{ team: 'both', halves: [], playerIds: [], actionTypes: [], outcomes: [] }}
          lockPlayerValue={lockPlayerValue}
          lockPlayerBucket="scoring"
        />
      </main>
    </div>
  );
}
