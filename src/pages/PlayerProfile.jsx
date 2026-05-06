import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Activity } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { createPageUrl } from '@/utils';
import PlayerProfilePanel from '@/features/report/components/PlayerProfilePanel';

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

function getSharedPayloadData(sharedPayload) {
  const payload = sharedPayload || {};
  const match = payload?.match || null;
  const teams = Array.isArray(payload?.teams) ? payload.teams : [];
  const players = Array.isArray(payload?.players) ? payload.players : [];
  const rawStats = Array.isArray(payload?.stats) ? payload.stats : [];
  const homeTeam = teams.find((team) => team?.id === match?.home_team_id) || teams[0] || null;
  const awayTeam = teams.find((team) => team?.id === match?.away_team_id) || teams[1] || null;
  const homePlayers = players.filter((player) => player?.team_id === homeTeam?.id);
  const awayPlayers = players.filter((player) => player?.team_id === awayTeam?.id);
  return { match, homeTeam, awayTeam, homePlayers, awayPlayers, rawStats };
}

export default function PlayerProfile({ sharedPayload = null, statShareCode = '', readOnly = false }) {
  const location = useLocation();
  const params = new URLSearchParams(location?.search || '');
  const isSharedView = !!sharedPayload;
  const sharedData = useMemo(() => getSharedPayloadData(sharedPayload), [sharedPayload]);
  const matchId = isSharedView ? (sharedData?.match?.id || `shared:${statShareCode || 'snapshot'}`) : (params.get('matchId') || '');
  const playerId = params.get('playerId') || '';
  const teamSide = params.get('teamSide') || '';

  const { data: matchArr = [] } = useQuery({
    queryKey: ['player-profile-match', matchId],
    queryFn: () => db.entities.Match.filter({ id: matchId }),
    enabled: !!matchId && !isSharedView,
  });
  const match = isSharedView ? sharedData.match : (matchArr?.[0] || null);

  const { data: homeTeamArr = [] } = useQuery({
    queryKey: ['player-profile-home-team', match?.home_team_id],
    queryFn: () => db.entities.Team.filter({ id: match?.home_team_id }),
    enabled: !!match?.home_team_id && !isSharedView,
  });
  const { data: awayTeamArr = [] } = useQuery({
    queryKey: ['player-profile-away-team', match?.away_team_id],
    queryFn: () => db.entities.Team.filter({ id: match?.away_team_id }),
    enabled: !!match?.away_team_id && !isSharedView,
  });
  const homeTeam = isSharedView ? sharedData.homeTeam : (homeTeamArr?.[0] || null);
  const awayTeam = isSharedView ? sharedData.awayTeam : (awayTeamArr?.[0] || null);

  const { data: homePlayers = [] } = useQuery({
    queryKey: ['player-profile-home-players', match?.home_team_id],
    queryFn: () => db.entities.Player.filter({ team_id: match?.home_team_id }),
    enabled: !!match?.home_team_id && !isSharedView,
  });
  const { data: awayPlayers = [] } = useQuery({
    queryKey: ['player-profile-away-players', match?.away_team_id],
    queryFn: () => db.entities.Player.filter({ team_id: match?.away_team_id }),
    enabled: !!match?.away_team_id && !isSharedView,
  });
  const { data: rawStats = [] } = useQuery({
    queryKey: ['player-profile-stats', matchId],
    queryFn: () => db.entities.StatEntry.filter({ match_id: matchId }),
    enabled: !!matchId && !isSharedView,
  });

  const effectiveRawStats = isSharedView ? (sharedData.rawStats || []) : rawStats;
  const effectiveHomePlayers = isSharedView ? (sharedData.homePlayers || []) : homePlayers;
  const effectiveAwayPlayers = isSharedView ? (sharedData.awayPlayers || []) : awayPlayers;

  const playerOptions = useMemo(() => buildPlayerOptions(effectiveHomePlayers, effectiveAwayPlayers), [effectiveHomePlayers, effectiveAwayPlayers]);
  const selectedPlayer = useMemo(
    () => playerOptions.find((player) => String(player.id) === String(playerId) && String(player.team_side) === String(teamSide)) || null,
    [playerOptions, playerId, teamSide],
  );

  const reportBackUrl = isSharedView
    ? createPageUrl(`StatShare?code=${encodeURIComponent(statShareCode)}`)
    : createPageUrl(`MatchReport?id=${matchId}`);

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
          <Link to={reportBackUrl}>
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

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to={reportBackUrl}>
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
        <PlayerProfilePanel
          match={match}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          homePlayers={effectiveHomePlayers}
          awayPlayers={effectiveAwayPlayers}
          rawStats={effectiveRawStats}
          selectedPlayer={selectedPlayer}
          readOnly={readOnly}
        />
      </main>
    </div>
  );
}
