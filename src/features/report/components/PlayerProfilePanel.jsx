import React, { useMemo } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import PlayersAnalyticsTab from '@/features/report/tabs/PlayersAnalyticsTab';
import {
  normalizeDefenceSetRows,
  normalizeStatModelRows,
  rebuildPossessionRows,
} from '@/lib/reportAnalytics';

export default function PlayerProfilePanel({
  match = null,
  homeTeam = null,
  awayTeam = null,
  rawStats = [],
  selectedPlayer = null,
  readOnly = false,
}) {
  const stats = useMemo(
    () => rebuildPossessionRows(
      normalizeStatModelRows(
        normalizeDefenceSetRows((rawStats || []).filter((row) => row?.stat_type !== 'defensive_contact')),
      ),
    ),
    [rawStats],
  );

  if (!match || !selectedPlayer) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-slate-600">
          This player could not be resolved for the selected match.
        </CardContent>
      </Card>
    );
  }

  const teamName = selectedPlayer.team_side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
  const lockPlayerValue = `${selectedPlayer.team_side}|${selectedPlayer.id}`;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-xl font-semibold text-slate-900">{selectedPlayer.label}</div>
        <div className="text-sm text-slate-500">
          {teamName} · {homeTeam?.name || 'Home'} vs {awayTeam?.name || 'Away'} · {match?.date || ''}
          {readOnly ? ' · Read-only shared stats' : ''}
        </div>
        <div className="text-xs text-slate-500">
          This profile is match-scoped and uses the same player-stat calculations as the main Players section.
        </div>
      </div>

      <PlayersAnalyticsTab
        stats={stats}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        playerOptions={[selectedPlayer]}
        reportFilters={{ team: 'both', halves: [], playerIds: [], actionTypes: [], outcomes: [] }}
        lockPlayerValue={lockPlayerValue}
        singlePlayerOnly
      />
    </div>
  );
}
