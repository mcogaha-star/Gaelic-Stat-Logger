import React, { useMemo } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import PlayersAnalyticsTab from '@/features/report/tabs/PlayersAnalyticsTab';
import { buildDefensiveActions, buildTouchEvents, safeParseJSON } from '@/features/report/shared';
import {
  normalizeDefenceSetRows,
  normalizeStatModelRows,
  rebuildPossessionRows,
  shouldExcludeFromTotals,
  shotPointsForOutcome,
} from '@/lib/reportAnalytics';

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
  let totalShotDistance = 0;
  let measuredShots = 0;
  for (const stat of stats) {
    if (stat?.stat_type !== 'shot' || shouldExcludeFromTotals(stat)) continue;
    const shot = safeParseJSON(stat.extra_data || '{}', {})?.shot || {};
    if (!matchesSelection(shot?.player, player)) continue;
    shots += 1;
    points += shotPointsForOutcome(String(shot?.outcome || ''));
    const x = Number(stat?.x_position);
    const y = Number(stat?.y_position);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const dx = 145 - x;
      const dy = 42.5 - y;
      totalShotDistance += Math.sqrt((dx * dx) + (dy * dy));
      measuredShots += 1;
    }
  }
  const touches = buildTouchEvents(stats, [player]).filter((touch) => matchesSelection(touch?.player, player)).length;
  const defActions = buildDefensiveActions(stats).playerActions.filter((action) => matchesSelection(action?.player, player)).length;
  return {
    shots,
    points,
    touches,
    defActions,
    avgShotDistance: measuredShots ? totalShotDistance / measuredShots : null,
  };
}

export default function PlayerProfilePanel({
  match = null,
  homeTeam = null,
  awayTeam = null,
  homePlayers = [],
  awayPlayers = [],
  rawStats = [],
  selectedPlayer = null,
  readOnly = false,
}) {
  const stats = useMemo(
    () => rebuildPossessionRows(normalizeStatModelRows(normalizeDefenceSetRows((rawStats || []).filter((row) => row?.stat_type !== 'defensive_contact')))),
    [rawStats],
  );

  const summary = useMemo(() => (selectedPlayer ? buildSummary(stats, selectedPlayer) : null), [stats, selectedPlayer]);

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
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-slate-500">Shots</div><div className="text-2xl font-semibold text-slate-900">{summary?.shots ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-slate-500">Points</div><div className="text-2xl font-semibold text-slate-900">{summary?.points ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-slate-500">Touches</div><div className="text-2xl font-semibold text-slate-900">{summary?.touches ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-slate-500">Def. Actions</div><div className="text-2xl font-semibold text-slate-900">{summary?.defActions ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-slate-500">Avg Shot Dist</div><div className="text-2xl font-semibold text-slate-900">{Number.isFinite(summary?.avgShotDistance) ? summary.avgShotDistance.toFixed(1) : 'NA'}</div></CardContent></Card>
      </div>

      <PlayersAnalyticsTab
        stats={stats}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        playerOptions={[selectedPlayer]}
        reportFilters={{ team: 'both', halves: [], playerIds: [], actionTypes: [], outcomes: [] }}
        lockPlayerValue={lockPlayerValue}
      />
    </div>
  );
}
