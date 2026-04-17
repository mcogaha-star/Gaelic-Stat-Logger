import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell, Tooltip, ReferenceLine, XAxis, YAxis } from 'recharts';
import {
  OPP_45_X,
  PITCH_W,
  PITCH_H,
  calcDistanceToGoal,
  extractFoulFromStat,
  findScorableFreeConcededRows,
  getAttackEntryChannelForPossession,
  getFieldTiltContribution,
  getMatchTimeS,
  getProgressiveMeters,
  getScoringZoneEntry,
  inferRestartWinnerSide,
  isAttackPossession,
  isProgressive as isProgressiveShared,
  shotOutcomeGroup,
  shotPointsForOutcome,
  normalizeFoulType,
} from '@/lib/reportAnalytics';
import {
  safeParseJSON,
  toTitleCase,
  deriveOutcome,
  formatExtraValue,
  formatMMSS,
  formatPct,
  sortRows,
  SortableTableHead,
  collectPlayerIds,
  collectPlayerSelectionKeys,
  groupByPossession,
  derivePossessionOutcome,
  deriveCounterAttackState,
  getCompletedReceiptSelection,
  getPrimaryActorSelection,
  getKeeperCandidate,
  isGoalkeeperPlayer,
  buildShotAssistCredits,
  buildTouchesMap,
  getPossessionStartZone,
  selectionKey,
  normalizePlayerRef,
  teamRowTint,
  PitchViz,
  AttackChannelPitch,
  PassNetwork,
  ShotMap,
  shotSideFromY,
  shotZoneFromDistance,
  applyNonTeamReportFilters,
} from '../shared';

function GoalkeeperPressTable({ card, homeTeam, awayTeam }) {
  const [sortState, setSortState] = useState({ key: 'overall', dir: 'desc' });
  const columns = useMemo(() => ([
    { key: 'press', label: 'Press', sortValue: (row) => row.press },
    { key: 'overall', label: 'Overall', sortValue: (row) => row.overall },
    { key: 'short', label: 'Short', sortValue: (row) => row.short },
    { key: 'long', label: 'Long', sortValue: (row) => row.long },
  ]), []);
  const sortedRows = useMemo(() => sortRows(card.pressRows, sortState, columns, 'key'), [card.pressRows, sortState, columns]);
  const toggleSort = (key) => setSortState((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'press' ? 'asc' : 'desc' });

  return (
    <div key={card.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-slate-900">{card.player}</div>
          <div className="text-xs text-slate-500">
            {card.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}
          </div>
        </div>
        <div className="text-right text-xs text-slate-600">
          <div className="font-medium text-slate-900">{card.kickoutsTaken ? `${card.ownKickoutsWon}/${card.kickoutsTaken}` : 'NA'}</div>
          <div>Overall Own KO Wins</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <SortableTableHead
                  key={column.key}
                  column={column}
                  sortState={sortState}
                  onToggle={toggleSort}
                  className={column.key === 'press' ? undefined : 'text-right'}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) => (
              <TableRow key={row.key} style={teamRowTint(card.team, homeTeam?.color, awayTeam?.color, 0.07)}>
                <TableCell className="font-medium">{row.press}</TableCell>
                <TableCell className="text-right tabular-nums">{row.overall}</TableCell>
                <TableCell className="text-right tabular-nums">{row.short}</TableCell>
                <TableCell className="text-right tabular-nums">{row.long}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PlayersAnalyticsTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters, focusPlayerId, setFocusPlayerId }) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['shot', 'pass', 'carry', 'turnover', 'foul', 'kickout', 'throw_in'] }), [reportFilters]);
  const [playerBucket, setPlayerBucket] = useState('scoring');
  const [lbSort, setLbSort] = useState({ key: 'points', dir: 'desc' }); // key + dir
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
  const teamMode = String(reportFilters?.team || 'both');

  const playerMetaByKey = useMemo(() => {
    const map = new Map();
    for (const p of playerOptions || []) {
      if (p?.id && (p.team_side === 'home' || p.team_side === 'away')) {
        map.set(`${p.team_side}|${p.id}`, p);
      }
    }
    return map;
  }, [playerOptions]);

  const shotAssistCredits = useMemo(() => buildShotAssistCredits(base), [base]);
  const touchMap = useMemo(() => buildTouchesMap(base), [base]);

  const leaderboard = useMemo(() => {
    const rows = new Map();
    const ensure = (sel) => {
      const player = normalizePlayerRef(sel);
      if (!player) return null;
      const key = `${player.team_side}|${player.id}`;
      const meta = playerMetaByKey.get(key) || {};
      const cur = rows.get(key) || {
        key,
        id: player.id,
        player: formatExtraValue({ kind: 'player', ...meta, ...player }),
        team: player.team_side || 'unknown',
        number: meta.number ?? player.number ?? null,
        name: meta.name || player.name || '',
        position: meta.position || player.position || '',
        shots: 0,
        scores: 0,
        points: 0,
        passes: 0,
        passComp: 0,
        carries: 0,
        carryComp: 0,
        turnoversWon: 0,
        turnoversLost: 0,
        foulsWon: 0,
        foulsConceded: 0,
        pointAtt: 0,
        pointMade: 0,
        twoAtt: 0,
        twoMade: 0,
        goalAtt: 0,
        goalMade: 0,
        defActions: 0,
        contacts: 0,
        dispossessions: 0,
        blocks: 0,
        progPassAtt: 0,
        progPassComp: 0,
        progPassRecv: 0,
        progCarries: 0,
        progMeters: 0,
        scoringZoneEntriesCreated: 0,
        passesIntoScoringZone: 0,
        shotAssists: 0,
        shotsCreated: 0,
        attacksInvolved: 0,
        scoringPossessionsInvolved: 0,
        kickoutTargets: 0,
        kickoutWins: 0,
        throwInsWon: 0,
        marks: 0,
        touches: 0,
        noCarryPasses: 0,
        avgShotDistTotal: 0,
        avgShotDistCount: 0,
        kickoutsTaken: 0,
        ownKickoutsWon: 0,
        cleanKickoutsWon: 0,
        shortKickoutsTaken: 0,
        longKickoutsTaken: 0,
        shortKickoutsWon: 0,
        longKickoutsWon: 0,
        goalShotsSaved: 0,
        goalShotsAgainst: 0,
        pressBreakdown: {
          m2m: { taken: 0, won: 0, shortTaken: 0, shortWon: 0, longTaken: 0, longWon: 0 },
          zonal: { taken: 0, won: 0, shortTaken: 0, shortWon: 0, longTaken: 0, longWon: 0 },
          conceded: { taken: 0, won: 0, shortTaken: 0, shortWon: 0, longTaken: 0, longWon: 0 },
        },
      };
      rows.set(key, cur);
      return cur;
    };

    const homeKeeper = getKeeperCandidate(playerOptions, 'home');
    const awayKeeper = getKeeperCandidate(playerOptions, 'away');
    ensure(homeKeeper);
    ensure(awayKeeper);

    for (const s of base) {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      if (s.stat_type === 'shot') {
        const p = ex?.shot?.player || getPrimaryActorSelection(s, ex) || (
          (s?.team_side === 'home' || s?.team_side === 'away') && (s?.player_number || s?.player_name)
            ? {
                kind: 'player',
                id: `legacy:${s.team_side}:${s.player_number ?? 'na'}:${String(s.player_name || '').trim() || 'unknown'}`,
                number: s.player_number ?? null,
                name: s.player_name || '',
                team_side: s.team_side,
              }
            : null
        );
        const r = ensure(p);
        if (r) {
          r.shots += 1;
          const o = ex?.shot?.outcome;
          if (shotOutcomeGroup(o) === 'score') r.scores += 1;
          r.points += shotPointsForOutcome(o);
          const shotType = String(ex?.shot?.shot_type || ex?.shot?.type || '');
          if (shotType === 'point') {
            r.pointAtt += 1;
            if (o === 'point') r.pointMade += 1;
          }
          if (shotType === '2_point') {
            r.twoAtt += 1;
            if (o === '2_point') r.twoMade += 1;
          }
          if (shotType === 'goal') {
            r.goalAtt += 1;
            if (o === 'goal') r.goalMade += 1;
          }
          const dist = calcDistanceToGoal(Number(s.x_position), Number(s.y_position));
          if (Number.isFinite(dist)) {
            r.avgShotDistTotal += dist;
            r.avgShotDistCount += 1;
          }
        }
        const goalShotType = String(ex?.shot?.shot_type || ex?.shot?.type || '') === 'goal';
        if (goalShotType && ['goal', 'saved'].includes(String(ex?.shot?.outcome || ''))) {
          const keeperSide = s.team_side === 'away' ? 'home' : 'away';
          const savedBy = normalizePlayerRef(ex?.shot?.saved_by);
          const keeperRow = ensure(savedBy?.team_side === keeperSide ? savedBy : (keeperSide === 'home' ? homeKeeper : awayKeeper));
          if (keeperRow) {
            if (ex?.shot?.outcome === 'saved') keeperRow.goalShotsSaved += 1;
            if (ex?.shot?.outcome === 'goal') keeperRow.goalShotsAgainst += 1;
          }
        }
      }
      if (s.stat_type === 'pass') {
        const pass = ex?.pass || {};
        const p = pass?.passer;
        const r = ensure(p);
        const isProg = isProgressiveShared(s);
        const isCompleted = pass?.outcome === 'completed';
        if (r) {
          r.passes += 1;
          if (isCompleted) r.passComp += 1;
          if (isProg) {
            r.progPassAtt += 1;
            if (isCompleted) r.progPassComp += 1;
            r.progMeters += getProgressiveMeters(s);
          }
          if (isCompleted && getScoringZoneEntry(s)) {
            r.passesIntoScoringZone += 1;
            r.scoringZoneEntriesCreated += 1;
          }
        }
        if (isProg && isCompleted) {
          const recv = pass?.won_by?.kind === 'player' ? pass?.won_by : pass?.intended_recipient;
          const rr = ensure(recv);
          if (rr) rr.progPassRecv += 1;
        }
      }
      if (s.stat_type === 'carry') {
        const p = ex?.carry?.carrier;
        const r = ensure(p);
        if (r) {
          r.carries += 1;
          if (deriveOutcome(s, ex) === 'completed') r.carryComp += 1;
          if (isProgressiveShared(s)) {
            r.progCarries += 1;
            r.progMeters += getProgressiveMeters(s);
          }
          if (getScoringZoneEntry(s)) r.scoringZoneEntriesCreated += 1;
        }
      }
      if (s.stat_type === 'turnover' || ex?.turnover) {
        const t = ex?.turnover || {};
        const rec = ensure(t?.recovered_by);
        const lost = ensure(t?.lost_by);
        if (rec) rec.turnoversWon += 1;
        if (lost) lost.turnoversLost += 1;
      }
      const f = extractFoulFromStat(s);
      if (f) {
        const won = ensure(f?.foul_on_or_forced_by);
        const con = ensure(f?.foul_by);
        if (won) won.foulsWon += 1;
        if (con) con.foulsConceded += 1;
      }
      if (s.stat_type === 'kickout') {
        const kick = ex?.kickout || {};
        const koTeam = kick?.team_side;
        const keeper = ensure(koTeam === 'home' ? homeKeeper : koTeam === 'away' ? awayKeeper : null);
        if (keeper) {
          keeper.kickoutsTaken += 1;
          const won = inferRestartWinnerSide(s, null) === koTeam;
          const cleanWon = kick?.outcome === 'clean' && kick?.won_by?.team_side === koTeam;
          if (won) keeper.ownKickoutsWon += 1;
          if (cleanWon) keeper.cleanKickoutsWon += 1;
          const endX = Number(s.end_x_position);
          const isLong = Number.isFinite(endX) && endX > 45;
          const pressKey = ['m2m', 'zonal', 'conceded'].includes(String(kick?.press || '').toLowerCase()) ? String(kick.press).toLowerCase() : null;
          if (isLong) {
            keeper.longKickoutsTaken += 1;
            if (won) keeper.longKickoutsWon += 1;
          } else {
            keeper.shortKickoutsTaken += 1;
            if (won) keeper.shortKickoutsWon += 1;
          }
          if (pressKey && keeper.pressBreakdown?.[pressKey]) {
            keeper.pressBreakdown[pressKey].taken += 1;
            if (won) keeper.pressBreakdown[pressKey].won += 1;
            if (isLong) {
              keeper.pressBreakdown[pressKey].longTaken += 1;
              if (won) keeper.pressBreakdown[pressKey].longWon += 1;
            } else {
              keeper.pressBreakdown[pressKey].shortTaken += 1;
              if (won) keeper.pressBreakdown[pressKey].shortWon += 1;
            }
          }
        }
        const target = ensure(kick?.intended_recipient);
        if (target) target.kickoutTargets += 1;
        const wonBy = ensure(kick?.won_by);
        if (wonBy) {
          wonBy.kickoutWins += 1;
          if (kick?.mark) wonBy.marks += 1;
        }
      }
      if (s.stat_type === 'throw_in') {
        const won = ensure(ex?.throw_in?.won_by);
        if (won) won.throwInsWon += 1;
      }
    }

    for (const row of shotAssistCredits) {
      const passer = ensure(row.passer);
      if (passer) {
        passer.shotAssists += 1;
        passer.shotsCreated += 1;
      }
    }

    const possessionGroups = groupByPossession(base);
    for (const [key, evs] of possessionGroups.entries()) {
      const [teamSide] = String(key).split('-');
      if (teamSide !== 'home' && teamSide !== 'away') continue;
      const acting = evs.filter((e) => e && e.team_side === teamSide);
      if (!acting.length) continue;
      const carriedEarlier = new Set();
      const involved = new Set();
      for (const e of acting) {
        const extra = safeParseJSON(e.extra_data || '{}', {});
        for (const playerKey of collectPlayerSelectionKeys(extra)) involved.add(playerKey);
        if (e?.stat_type === 'pass') {
          const passerKey = selectionKey(extra?.pass?.passer);
          if (passerKey && !carriedEarlier.has(passerKey)) {
            const row = rows.get(passerKey);
            if (row) row.noCarryPasses += 1;
          }
        }
        if (e?.stat_type === 'carry') {
          const carrierKey = selectionKey(extra?.carry?.carrier);
          if (carrierKey) carriedEarlier.add(carrierKey);
        }
      }
      const isAttack = isAttackPossession(evs, teamSide);
      const outcome = derivePossessionOutcome(evs, teamSide);
      for (const playerKey of involved) {
        const row = rows.get(playerKey);
        if (!row) continue;
        if (isAttack) row.attacksInvolved += 1;
        if (outcome === 'Score') row.scoringPossessionsInvolved += 1;
      }
    }

    for (const [key, count] of touchMap.entries()) {
      const row = rows.get(key);
      if (row) row.touches = count;
    }

    return Array.from(rows.values()).map((row) => {
      const passPct = row.passes ? (row.passComp / row.passes) * 100 : NaN;
      const carryPct = row.carries ? (row.carryComp / row.carries) * 100 : NaN;
      const progPassPct = row.progPassAtt ? (row.progPassComp / row.progPassAtt) * 100 : NaN;
      const turnoverRate = row.touches ? (row.turnoversLost / row.touches) * 100 : NaN;
      const passRate = row.touches ? (row.passes / row.touches) * 100 : NaN;
      const carryRate = row.touches ? (row.carries / row.touches) * 100 : NaN;
      const shootRate = row.touches ? (row.shots / row.touches) * 100 : NaN;
      const noCarryPassRate = row.touches ? (row.noCarryPasses / row.touches) * 100 : NaN;
      const avgShotDist = row.avgShotDistCount ? row.avgShotDistTotal / row.avgShotDistCount : NaN;
      const goalShotSavePct = (row.goalShotsSaved + row.goalShotsAgainst)
        ? (row.goalShotsSaved / (row.goalShotsSaved + row.goalShotsAgainst)) * 100
        : NaN;
      const ownKickoutWinPct = row.kickoutsTaken ? (row.ownKickoutsWon / row.kickoutsTaken) * 100 : NaN;
      const cleanKickoutWinPct = row.kickoutsTaken ? (row.cleanKickoutsWon / row.kickoutsTaken) * 100 : NaN;
      const shortKickoutWinPct = row.shortKickoutsTaken ? (row.shortKickoutsWon / row.shortKickoutsTaken) * 100 : NaN;
      const longKickoutWinPct = row.longKickoutsTaken ? (row.longKickoutsWon / row.longKickoutsTaken) * 100 : NaN;
      return {
        ...row,
        passPct,
        carryPct,
        progPassPct,
        turnoverRate,
        passRate,
        carryRate,
        shootRate,
        noCarryPassRate,
        avgShotDist,
        goalShotSavePct,
        ownKickoutWinPct,
        cleanKickoutWinPct,
        shortKickoutWinPct,
        longKickoutWinPct,
      };
    });
  }, [base, playerMetaByKey, playerOptions, shotAssistCredits, touchMap]);

  const toggleSort = (key) => {
    setLbSort((cur) => {
      if (cur?.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'desc' };
    });
  };

  const renderScoringFraction = (made, attempts) => {
    if (!Number.isFinite(Number(attempts)) || Number(attempts) <= 0) return '0/0 (NA)';
    return `${made}/${attempts} (${formatPct((Number(made) / Number(attempts)) * 100)})`;
  };

  const bucketColumns = useMemo(() => ({
    scoring: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'shots', label: 'Shots', numeric: true },
      { key: 'scores', label: 'Scores', numeric: true },
      { key: 'points', label: 'Points', numeric: true },
      { key: 'pointsPerShot', label: 'Pts/Shot', numeric: true, sortValue: (r) => (r.shots ? r.points / r.shots : -1), render: (r) => r.shots ? (r.points / r.shots).toFixed(2) : 'NA' },
      { key: 'avgShotDist', label: 'Avg Dist', numeric: true, sortValue: (r) => r.avgShotDist, render: (r) => Number.isFinite(r.avgShotDist) ? r.avgShotDist.toFixed(1) : 'NA' },
      { key: 'pointFraction', label: '1 Point', numeric: true, sortValue: (r) => r.pointMade, render: (r) => renderScoringFraction(r.pointMade, r.pointAtt) },
      { key: 'twoFraction', label: '2 Point', numeric: true, sortValue: (r) => r.twoMade, render: (r) => renderScoringFraction(r.twoMade, r.twoAtt) },
      { key: 'goalFraction', label: 'Goal', numeric: true, sortValue: (r) => r.goalMade, render: (r) => renderScoringFraction(r.goalMade, r.goalAtt) },
    ],
    progression: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'progPassFraction', label: 'Prog Passes', numeric: true, sortValue: (r) => r.progPassComp, render: (r) => renderScoringFraction(r.progPassComp, r.progPassAtt) },
      { key: 'progPassRecv', label: 'Prog Pass Rec', numeric: true },
      { key: 'progCarries', label: 'Prog Carries', numeric: true },
      { key: 'progMeters', label: 'Prog Meters', numeric: true, render: (r) => Number.isFinite(r.progMeters) ? r.progMeters.toFixed(1) : '0.0' },
      { key: 'scoringZoneEntriesCreated', label: 'Scoring Zone Entries', numeric: true },
      { key: 'passesIntoScoringZone', label: 'Passes Into Scoring Zone', numeric: true },
    ],
    retention: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'passFraction', label: 'Passes', numeric: true, sortValue: (r) => r.passComp, render: (r) => renderScoringFraction(r.passComp, r.passes) },
      { key: 'carryFraction', label: 'Carries', numeric: true, sortValue: (r) => r.carryComp, render: (r) => renderScoringFraction(r.carryComp, r.carries) },
      { key: 'turnoversLost', label: 'TO Lost', numeric: true },
      { key: 'turnoverRate', label: 'TO Rate', numeric: true, sortValue: (r) => r.turnoverRate, render: (r) => formatPct(r.turnoverRate) },
      { key: 'touches', label: 'Touches', numeric: true },
    ],
    tendencies: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'touches', label: 'Touches', numeric: true },
      { key: 'carryRate', label: 'Carry Rate', numeric: true, sortValue: (r) => r.carryRate, render: (r) => formatPct(r.carryRate) },
      { key: 'passRate', label: 'Pass Rate', numeric: true, sortValue: (r) => r.passRate, render: (r) => formatPct(r.passRate) },
      { key: 'shootRate', label: 'Shoot Rate', numeric: true, sortValue: (r) => r.shootRate, render: (r) => formatPct(r.shootRate) },
      { key: 'noCarryPassRate', label: 'No-Carry Pass Rate', numeric: true, sortValue: (r) => r.noCarryPassRate, render: (r) => formatPct(r.noCarryPassRate) },
      { key: 'turnoverRate', label: 'TO Rate', numeric: true, sortValue: (r) => r.turnoverRate, render: (r) => formatPct(r.turnoverRate) },
    ],
    creation: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'shotAssists', label: 'Shot Assists', numeric: true },
      { key: 'shotsCreated', label: 'Shots Created', numeric: true },
      { key: 'attacksInvolved', label: 'Attacks Involved', numeric: true },
      { key: 'scoringPossessionsInvolved', label: 'Scoring Possessions', numeric: true },
    ],
    defense: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'turnoversWon', label: 'TO Won', numeric: true },
      { key: 'defActions', label: 'Def. Actions', numeric: true },
      { key: 'contacts', label: 'Contacts', numeric: true },
      { key: 'dispossessions', label: 'Dispossessions', numeric: true },
      { key: 'blocks', label: 'Blocks', numeric: true },
      { key: 'foulsWon', label: 'Fouls Won', numeric: true },
      { key: 'foulsConceded', label: 'Fouls Conceded', numeric: true },
    ],
    restarts: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'kickoutTargets', label: 'KO Targets', numeric: true },
      { key: 'kickoutWins', label: 'KO Wins', numeric: true },
      { key: 'throwInsWon', label: 'Throw-Ins Won', numeric: true },
      { key: 'marks', label: 'Marks', numeric: true },
    ],
    goalkeepers: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'kickoutsTaken', label: 'KOs Taken', numeric: true },
      { key: 'ownKickoutWinPct', label: 'Own KO Win %', numeric: true, sortValue: (r) => r.ownKickoutWinPct, render: (r) => r.kickoutsTaken ? `${r.ownKickoutsWon}/${r.kickoutsTaken} (${formatPct(r.ownKickoutWinPct)})` : 'NA' },
      { key: 'cleanKickoutWinPct', label: 'Clean KO Win %', numeric: true, sortValue: (r) => r.cleanKickoutWinPct, render: (r) => r.kickoutsTaken ? `${r.cleanKickoutsWon}/${r.kickoutsTaken} (${formatPct(r.cleanKickoutWinPct)})` : 'NA' },
      { key: 'shortKickoutsTaken', label: 'Short KOs', numeric: true },
      { key: 'longKickoutsTaken', label: 'Long KOs', numeric: true },
      { key: 'shortKickoutWinPct', label: 'Short Win %', numeric: true, sortValue: (r) => r.shortKickoutWinPct, render: (r) => r.shortKickoutsTaken ? `${r.shortKickoutsWon}/${r.shortKickoutsTaken} (${formatPct(r.shortKickoutWinPct)})` : 'NA' },
      { key: 'longKickoutWinPct', label: 'Long Win %', numeric: true, sortValue: (r) => r.longKickoutWinPct, render: (r) => r.longKickoutsTaken ? `${r.longKickoutsWon}/${r.longKickoutsTaken} (${formatPct(r.longKickoutWinPct)})` : 'NA' },
      { key: 'goalShotSavePct', label: 'Goal Shot Saves', numeric: true, sortValue: (r) => r.goalShotSavePct, render: (r) => (r.goalShotsSaved + r.goalShotsAgainst) ? `${r.goalShotsSaved}/${r.goalShotsSaved + r.goalShotsAgainst} (${formatPct(r.goalShotSavePct)})` : 'NA' },
    ],
  }), [homeTeam, awayTeam]);

  const sortedLeaderboard = useMemo(() => {
    const bucketFilters = {
      scoring: () => true,
      progression: () => true,
      retention: () => true,
      tendencies: () => true,
      creation: () => true,
      defense: () => true,
      restarts: () => true,
      goalkeepers: (r) => isGoalkeeperPlayer(r),
    };
    const list = (Array.isArray(leaderboard) ? leaderboard : [])
      .filter((r) => teamMode === 'both' || r.team === teamMode)
      .filter((r) => (focusPlayerId === 'all' ? true : r.id === focusPlayerId))
      .filter(bucketFilters[playerBucket] || (() => true))
      .slice();
    const dir = lbSort?.dir === 'asc' ? 1 : -1;
    const key = String(lbSort?.key || 'points');
    const currentColumns = bucketColumns[playerBucket] || [];
    const sortColumn = currentColumns.find((c) => c.key === key);
    const get = (r) => {
      if (!r) return 0;
      if (typeof sortColumn?.sortValue === 'function') {
        const custom = sortColumn.sortValue(r);
        return typeof custom === 'number' && Number.isFinite(custom) ? custom : -Infinity;
      }
      const v = r[key];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      return -Infinity;
    };
    list.sort((a, b) => (get(a) - get(b)) * dir || String(a?.player || '').localeCompare(String(b?.player || '')));
    return list;
  }, [leaderboard, lbSort, teamMode, focusPlayerId, playerBucket, bucketColumns]);

  React.useEffect(() => {
    const defaults = {
      scoring: 'points',
      progression: 'progMeters',
      retention: 'touches',
      tendencies: 'passRate',
      creation: 'shotsCreated',
      defense: 'turnoversWon',
      restarts: 'kickoutWins',
      goalkeepers: 'kickoutsTaken',
    };
    const nextKey = defaults[playerBucket] || 'points';
    const columns = bucketColumns[playerBucket] || [];
    if (!columns.some((c) => c.key === lbSort.key)) {
      setLbSort({ key: nextKey, dir: 'desc' });
    }
  }, [playerBucket, bucketColumns, lbSort.key]);

  const focusStats = useMemo(() => {
    if (focusPlayerId === 'all') return [];
    return base.filter((s) => {
      if (teamMode !== 'both' && s?.team_side !== teamMode) return false;
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const ids = collectPlayerIds(extra);
      return ids.has(focusPlayerId);
    });
  }, [base, focusPlayerId, teamMode]);

  const currentColumns = bucketColumns[playerBucket] || bucketColumns.scoring;

  const formatBreakdownCell = (won, taken) => {
    if (!taken) return 'NA';
    return `${won}/${taken} (${formatPct((won / taken) * 100)})`;
  };

  const goalkeeperPressCards = useMemo(() => {
    if (playerBucket !== 'goalkeepers') return [];
    const cards = [];
    for (const row of sortedLeaderboard) {
      const pressRows = ['m2m', 'zonal', 'conceded']
        .map((press) => {
          const info = row.pressBreakdown?.[press];
          if (!info) return null;
          return {
            key: `${row.key}-${press}`,
            press: press === 'm2m' ? 'M2M' : toTitleCase(press),
            overall: formatBreakdownCell(info.won, info.taken),
            short: formatBreakdownCell(info.shortWon, info.shortTaken),
            long: formatBreakdownCell(info.longWon, info.longTaken),
          };
        })
        .filter(Boolean);
      if (!pressRows.length) continue;
      cards.push({
        key: row.key,
        player: row.player,
        team: row.team,
        ownKickoutsWon: row.ownKickoutsWon,
        kickoutsTaken: row.kickoutsTaken,
        pressRows,
      });
    }
    return cards;
  }, [playerBucket, sortedLeaderboard]);

  return (
    <div className="space-y-4">
        {focusPlayerId !== 'all' && focusStats.length > 0 && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="font-semibold text-slate-900">Player Events</div>
              <PitchViz stats={focusStats} homeColor={homeTeam?.color} awayColor={awayTeam?.color} colorBy="action" showColorControls={false} />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {[
                ['scoring', 'Scoring'],
                ['progression', 'Progression'],
                ['retention', 'Retention'],
                ['tendencies', 'Tendencies'],
                ['creation', 'Creation'],
                ['defense', 'Defense'],
                ['restarts', 'Restarts'],
                ['goalkeepers', 'Goalkeepers'],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant={playerBucket === value ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setPlayerBucket(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  {currentColumns.map((col) => (
                    <SortableTableHead
                      key={col.key}
                      column={{ key: col.key, label: col.label }}
                      sortState={lbSort}
                      onToggle={toggleSort}
                      className={col.numeric ? 'text-right' : undefined}
                    />
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedLeaderboard.slice(0, 250).map((r) => (
                  <TableRow key={r.key} style={teamRowTint(r.team, homeTeam?.color, awayTeam?.color, 0.07)}>
                    {currentColumns.map((col) => (
                      <TableCell key={col.key} className={col.numeric ? 'text-right tabular-nums' : (col.key === 'player' ? 'font-medium' : '')}>
                        {col.render ? col.render(r) : r[col.key]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {playerBucket === 'goalkeepers' && goalkeeperPressCards.length > 0 && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="font-semibold text-slate-900">Kickout Press Breakdown</div>
              <div className="grid gap-3 lg:grid-cols-2">
                {goalkeeperPressCards.map((card) => (
                  <GoalkeeperPressTable key={card.key} card={card} homeTeam={homeTeam} awayTeam={awayTeam} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
    </div>
  );
}


export default PlayersAnalyticsTab;

