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
  classifyKickoutLength,
  extractFoulFromStat,
  findScorableFreeConcededRows,
  getAttackEntryChannelForPossession,
  getFieldTiltContribution,
  getNextBallActionStat,
  getMatchTimeS,
  getProgressiveMeters,
  getScoringZoneEntry,
  inferRestartWinnerSide,
  isAttackPossession,
  isBroughtBackAdvantageStat,
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
  groupByPossession,
  derivePossessionOutcome,
  deriveCounterAttackState,
  getCompletedReceiptSelection,
  getPrimaryActorSelection,
  getKeeperCandidate,
  isGoalkeeperPlayer,
  buildShotAssistCredits,
  buildDefensiveActions,
  buildTouchEvents,
  buildPassSonarData,
  getPossessionStartZone,
  selectionKey,
  normalizePlayerRef,
  teamRowTint,
  PitchViz,
  TouchMap,
  AttackChannelPitch,
  PassNetwork,
  PassSonar,
  ShotMap,
  shotSideFromY,
  shotZoneFromDistance,
  applyNonTeamReportFilters,
} from '../shared';

function normalizePlayerShotType(value) {
  const v = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (v === '1_point' || v === 'one_point') return 'point';
  if (v === '2_point' || v === 'two_point') return '2_point';
  if (v === 'goal') return 'goal';
  return v;
}

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

function PlayersAnalyticsTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['shot', 'pass', 'carry', 'turnover', 'foul', 'kickout', 'throw_in'] }), [reportFilters]);
  const [playerBucket, setPlayerBucket] = useState('scoring');
  const [chartPlayerId, setChartPlayerId] = useState('all');
  const [lbSort, setLbSort] = useState({ key: 'points', dir: 'desc' }); // key + dir
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
  const calcBase = useMemo(() => base.filter((s) => !isBroughtBackAdvantageStat(s)), [base]);
  const teamMode = String(reportFilters?.team || 'both');
  const nextStatById = useMemo(() => {
    const ordered = (Array.isArray(stats) ? stats : []).slice().sort((a, b) => {
      const pa = Number(a?.play_id);
      const pb = Number(b?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = Number(a?.normalized_time_s);
      const tb = Number(b?.normalized_time_s);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    const map = new Map();
    for (let i = 0; i < ordered.length; i += 1) map.set(ordered[i]?.id, getNextBallActionStat(ordered, i));
    return map;
  }, [stats]);

  const playerMetaByKey = useMemo(() => {
    const map = new Map();
    for (const p of playerOptions || []) {
      if (p?.id && (p.team_side === 'home' || p.team_side === 'away')) {
        map.set(`${p.team_side}|${p.id}`, p);
      }
    }
    return map;
  }, [playerOptions]);
  const playerMetaByTeamNumber = useMemo(() => {
    const map = new Map();
    for (const p of playerOptions || []) {
      if ((p?.team_side === 'home' || p?.team_side === 'away') && p?.number != null) {
        map.set(`${p.team_side}|${p.number}`, p);
      }
    }
    return map;
  }, [playerOptions]);
  const playerMetaByTeamName = useMemo(() => {
    const map = new Map();
    for (const p of playerOptions || []) {
      const name = String(p?.name || '').trim().toLowerCase();
      if ((p?.team_side === 'home' || p?.team_side === 'away') && name) {
        map.set(`${p.team_side}|${name}`, p);
      }
    }
    return map;
  }, [playerOptions]);
  const resolveLeaderboardPlayer = (sel) => {
    const player = normalizePlayerRef(sel);
    if (!player) return null;
    const direct = playerMetaByKey.get(`${player.team_side}|${player.id}`);
    if (direct) return { ...player, ...direct, id: direct.id, team_side: direct.team_side };
    if (player.number != null) {
      const byNumber = playerMetaByTeamNumber.get(`${player.team_side}|${player.number}`);
      if (byNumber) return { ...player, ...byNumber, id: byNumber.id, team_side: byNumber.team_side };
    }
    const lowered = String(player.name || '').trim().toLowerCase();
    if (lowered) {
      const byName = playerMetaByTeamName.get(`${player.team_side}|${lowered}`);
      if (byName) return { ...player, ...byName, id: byName.id, team_side: byName.team_side };
    }
    return player;
  };
  const resolveLeaderboardKey = (sel) => {
    const player = resolveLeaderboardPlayer(sel);
    return player?.id && (player.team_side === 'home' || player.team_side === 'away')
      ? `${player.team_side}|${player.id}`
      : null;
  };

  const shotAssistCredits = useMemo(() => buildShotAssistCredits(calcBase), [calcBase]);
  const touchEvents = useMemo(() => buildTouchEvents(calcBase, playerOptions), [calcBase, playerOptions]);
  const defensiveActions = useMemo(() => buildDefensiveActions(calcBase), [calcBase]);

  const leaderboard = useMemo(() => {
    const rows = new Map();
    const ensure = (sel) => {
        const player = resolveLeaderboardPlayer(sel);
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
        turnoversForced: 0,
        turnoversRecovered: 0,
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
        blocks: 0,
        progPassAtt: 0,
        progPassComp: 0,
        progPassRecv: 0,
        progCarryAtt: 0,
        progCarryComp: 0,
        progMeters: 0,
        scoringZoneEntriesCreated: 0,
        passesIntoScoringZone: 0,
        shotAssists: 0,
        shotsCreated: 0,
        attacksInvolved: 0,
        possessionsInvolved: 0,
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
    for (const touch of touchEvents) ensure(touch?.player);
    for (const action of defensiveActions.playerActions) ensure(action?.player);
    const touchPossessionsByPlayer = new Map();
    for (const touch of touchEvents) {
      const row = ensure(touch?.player);
      const playerKey = row?.key || null;
      const teamSide = touch?.stat?.possession_team_side;
      const possessionId = Number(touch?.stat?.possession_id);
      if (!playerKey || (teamSide !== 'home' && teamSide !== 'away') || !Number.isFinite(possessionId)) continue;
      const possessionKey = `${teamSide}-${possessionId}`;
      const set = touchPossessionsByPlayer.get(playerKey) || new Set();
      set.add(possessionKey);
      touchPossessionsByPlayer.set(playerKey, set);
      row.touches += 1;
    }

    for (const s of calcBase) {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      if (s.stat_type === 'shot' && !isBroughtBackAdvantageStat(s)) {
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
          const shotType = normalizePlayerShotType(ex?.shot?.shot_type || ex?.shot?.type || '');
          if (shotType === 'point') {
            r.pointAtt += 1;
          }
          if (shotType === '2_point') {
            r.twoAtt += 1;
          }
          if (shotType === 'goal') {
            r.goalAtt += 1;
          }
          if (o === 'point') r.pointMade += 1;
          if (o === '2_point') r.twoMade += 1;
          if (o === 'goal') r.goalMade += 1;
          const dist = calcDistanceToGoal(Number(s.x_position), Number(s.y_position));
          if (Number.isFinite(dist)) {
            r.avgShotDistTotal += dist;
            r.avgShotDistCount += 1;
          }
        }
        const blocker = ensure(ex?.shot?.blocked_by);
        if (blocker && String(ex?.shot?.outcome || '') === 'blocked') blocker.blocks += 1;
        const goalShotType = normalizePlayerShotType(ex?.shot?.shot_type || ex?.shot?.type || '') === 'goal';
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
        const isCompleted = deriveOutcome(s, ex) === 'completed';
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
        const isProg = isProgressiveShared(s);
        const isCompleted = deriveOutcome(s, ex) === 'completed';
        if (r) {
          r.carries += 1;
          if (isCompleted) r.carryComp += 1;
          if (isProg) {
            r.progCarryAtt += 1;
            if (isCompleted) r.progCarryComp += 1;
            r.progMeters += getProgressiveMeters(s);
          }
          if (getScoringZoneEntry(s)) r.scoringZoneEntriesCreated += 1;
        }
      }
      if (!isBroughtBackAdvantageStat(s) && (s.stat_type === 'turnover' || ex?.turnover)) {
        const t = ex?.turnover || {};
        const turnoverType = normalizeFoulType(t?.turnover_type || t?.type || '');
        const foul = turnoverType === 'foul' ? extractFoulFromStat(s) : null;
        const rec = turnoverType === 'foul'
          ? ensure(foul?.foul_on || foul?.foul_on_or_forced_by || t?.forced_by)
          : ensure(t?.recovered_by);
        const forced = ensure(t?.forced_by);
        const lost = ensure(t?.lost_by);
        const defensivePlayers = new Set();
        if (rec) {
          rec.turnoversRecovered += 1;
          defensivePlayers.add(rec.key);
        }
        if (forced) {
          forced.turnoversForced += 1;
          defensivePlayers.add(forced.key);
        }
        for (const playerKey of defensivePlayers) {
          const row = rows.get(playerKey);
          if (row) row.defActions += 1;
        }
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
          const won = inferRestartWinnerSide(s, nextStatById.get(s.id)) === koTeam;
          const cleanWon = kick?.outcome === 'clean' && kick?.won_by?.team_side === koTeam;
          if (won) keeper.ownKickoutsWon += 1;
          if (cleanWon) keeper.cleanKickoutsWon += 1;
          const isLong = classifyKickoutLength(s) === 'long';
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

    const possessionGroups = groupByPossession(calcBase);
    for (const [key, evs] of possessionGroups.entries()) {
      const [teamSide] = String(key).split('-');
      if (teamSide !== 'home' && teamSide !== 'away') continue;
      const acting = evs.filter((e) => e && e.team_side === teamSide);
      if (!acting.length) continue;
      const carriedEarlier = new Set();
      for (const e of acting) {
        const extra = safeParseJSON(e.extra_data || '{}', {});
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
      for (const [playerKey, possessionKeys] of touchPossessionsByPlayer.entries()) {
        if (!possessionKeys.has(key)) continue;
        const row = rows.get(playerKey);
        if (!row) continue;
        row.possessionsInvolved += 1;
        if (isAttack) row.attacksInvolved += 1;
        if (outcome === 'Score') row.scoringPossessionsInvolved += 1;
      }
    }

    for (const action of defensiveActions.playerActions) {
      if (String(action?.reason || '') === 'Turnover Recovered' || String(action?.reason || '') === 'Turnover Forced') continue;
      const row = ensure(action.player);
      if (row) row.defActions += 1;
    }

    return Array.from(rows.values()).map((row) => {
      const passPct = row.passes ? (row.passComp / row.passes) * 100 : NaN;
      const carryPct = row.carries ? (row.carryComp / row.carries) * 100 : NaN;
      const progPassPct = row.progPassAtt ? (row.progPassComp / row.progPassAtt) * 100 : NaN;
      const turnoversLostPer10Poss = row.possessionsInvolved ? (row.turnoversLost / row.possessionsInvolved) * 10 : NaN;
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
        turnoversLostPer10Poss,
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
  }, [calcBase, nextStatById, playerMetaByKey, playerMetaByTeamName, playerMetaByTeamNumber, playerOptions, shotAssistCredits, touchEvents, defensiveActions]);

  const toggleSort = (key) => {
    setLbSort((cur) => {
      if (cur?.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'desc' };
    });
  };

  const renderScoringFraction = (made, attempts) => {
    const madeN = Number(made) || 0;
    const attemptsN = Number(attempts) || 0;
    if (!Number.isFinite(attemptsN) || attemptsN <= 0) return `${madeN}/0 (NA)`;
    return `${madeN}/${attemptsN} (${formatPct((madeN / attemptsN) * 100)})`;
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
      { key: 'progCarryFraction', label: 'Prog Carries', numeric: true, sortValue: (r) => r.progCarryComp, render: (r) => renderScoringFraction(r.progCarryComp, r.progCarryAtt) },
      { key: 'progMeters', label: 'Prog Meters', numeric: true, render: (r) => Number.isFinite(r.progMeters) ? r.progMeters.toFixed(1) : '0.0' },
      { key: 'scoringZoneEntriesCreated', label: 'Scoring Zone Entries', numeric: true },
      { key: 'passesIntoScoringZone', label: 'Passes Into Scoring Zone', numeric: true },
      { key: 'shotAssists', label: 'Shot Assists', numeric: true },
    ],
    retention: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'passFraction', label: 'Passes', numeric: true, sortValue: (r) => r.passComp, render: (r) => renderScoringFraction(r.passComp, r.passes) },
      { key: 'carryFraction', label: 'Carries', numeric: true, sortValue: (r) => r.carryComp, render: (r) => renderScoringFraction(r.carryComp, r.carries) },
      { key: 'turnoversLost', label: 'TO Lost', numeric: true },
      { key: 'turnoversLostPer10Poss', label: 'TO Lost / 10 Poss', numeric: true, sortValue: (r) => r.turnoversLostPer10Poss, render: (r) => Number.isFinite(r.turnoversLostPer10Poss) ? r.turnoversLostPer10Poss.toFixed(2) : 'NA' },
      { key: 'possessionsInvolved', label: 'Poss', numeric: true },
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
      { key: 'turnoversLostPer10Poss', label: 'TO Lost / 10 Poss', numeric: true, sortValue: (r) => r.turnoversLostPer10Poss, render: (r) => Number.isFinite(r.turnoversLostPer10Poss) ? r.turnoversLostPer10Poss.toFixed(2) : 'NA' },
    ],
    defense: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'turnoversForced', label: 'TO Forced', numeric: true },
      { key: 'turnoversRecovered', label: 'TO Recovered', numeric: true },
      { key: 'defActions', label: 'Def. Actions', numeric: true },
      { key: 'blocks', label: 'Blocks', numeric: true },
      { key: 'foulsConceded', label: 'Fouls Conceded', numeric: true },
    ],
    touches: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'touches', label: 'Touches', numeric: true },
      { key: 'passRate', label: 'Pass Rate', numeric: true, sortValue: (r) => r.passRate, render: (r) => formatPct(r.passRate) },
      { key: 'carryRate', label: 'Carry Rate', numeric: true, sortValue: (r) => r.carryRate, render: (r) => formatPct(r.carryRate) },
      { key: 'shootRate', label: 'Shoot Rate', numeric: true, sortValue: (r) => r.shootRate, render: (r) => formatPct(r.shootRate) },
      { key: 'turnoversLostPer10Poss', label: 'TO Lost / 10 Poss', numeric: true, sortValue: (r) => r.turnoversLostPer10Poss, render: (r) => Number.isFinite(r.turnoversLostPer10Poss) ? r.turnoversLostPer10Poss.toFixed(2) : 'NA' },
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
      defense: () => true,
      sonar: () => true,
      restarts: () => true,
      goalkeepers: (r) => isGoalkeeperPlayer(r),
    };
    const list = (Array.isArray(leaderboard) ? leaderboard : [])
      .filter((r) => teamMode === 'both' || r.team === teamMode)
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
  }, [leaderboard, lbSort, teamMode, playerBucket, bucketColumns]);

  React.useEffect(() => {
    const defaults = {
      scoring: 'points',
      progression: 'progMeters',
      retention: 'touches',
      tendencies: 'passRate',
      defense: 'defActions',
      sonar: 'passes',
      touches: 'touches',
      restarts: 'kickoutWins',
      goalkeepers: 'kickoutsTaken',
    };
    const nextKey = defaults[playerBucket] || 'points';
    const columns = bucketColumns[playerBucket] || [];
    if (!columns.some((c) => c.key === lbSort.key)) {
      setLbSort({ key: nextKey, dir: 'desc' });
    }
  }, [playerBucket, bucketColumns, lbSort.key]);

  const availableChartPlayers = useMemo(
    () => (playerOptions || [])
      .filter((p) => p?.id != null && String(p.id).trim() !== '')
      .filter((p) => teamMode === 'both' || p.team_side === teamMode),
    [playerOptions, teamMode],
  );
  const chartPlayerOptions = useMemo(
    () => availableChartPlayers.map((p) => ({
      ...p,
      value: `${String(p.team_side || '')}|${String(p.id)}`,
    })),
    [availableChartPlayers],
  );
  React.useEffect(() => {
    if (chartPlayerId === 'all') return;
    if (!chartPlayerOptions.some((p) => p.value === chartPlayerId)) setChartPlayerId('all');
  }, [chartPlayerOptions, chartPlayerId]);

  const activeChartPlayerId = chartPlayerId;
  const activeChartPlayer = useMemo(
    () => chartPlayerOptions.find((p) => p.value === activeChartPlayerId) || null,
    [chartPlayerOptions, activeChartPlayerId],
  );
  const activeChartPlayerKey = activeChartPlayer ? `${activeChartPlayer.team_side}|${activeChartPlayer.id}` : null;

  const focusStats = useMemo(() => {
    if (activeChartPlayerId === 'all') return [];
    return base.filter((s) => {
      if (teamMode !== 'both' && s?.team_side !== teamMode) return false;
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const candidates = [
        extra?.pass?.passer,
        extra?.pass?.intended_recipient,
        extra?.pass?.won_by,
        extra?.pass?.recovered_by,
        extra?.carry?.carrier,
        extra?.carry?.defender,
        extra?.carry?.recovered_by,
        extra?.shot?.player,
        extra?.shot?.blocked_by,
        extra?.shot?.saved_by,
        extra?.shot?.recovered_by,
        extra?.turnover?.lost_by,
        extra?.turnover?.forced_by,
        extra?.turnover?.recovered_by,
        extra?.kickout?.intended_recipient,
        extra?.kickout?.won_by,
        extra?.throw_in?.won_by,
        extra?.throw_in?.lost_by,
        extra?.throw_in?.broken_by,
      ];
      return candidates.some((candidate) => activeChartPlayerKey && resolveLeaderboardKey(candidate) === activeChartPlayerKey);
    });
  }, [activeChartPlayerId, activeChartPlayerKey, base, teamMode]);

  const focusPlayerPasses = useMemo(() => {
    if (activeChartPlayerId === 'all') return [];
    return calcBase.filter((stat) => {
      if (stat?.stat_type !== 'pass') return false;
      const extra = safeParseJSON(stat.extra_data || '{}', {});
      return activeChartPlayerKey && resolveLeaderboardKey(extra?.pass?.passer) === activeChartPlayerKey;
    });
  }, [activeChartPlayerId, activeChartPlayerKey, calcBase]);

  const focusPlayerSonar = useMemo(() => {
    if (activeChartPlayerId === 'all') return [];
    return buildPassSonarData(focusPlayerPasses);
  }, [focusPlayerPasses, activeChartPlayerId]);

  const focusPlayerDefensiveActionStats = useMemo(() => {
    if (activeChartPlayerId === 'all') return [];
    return defensiveActions.playerActions
      .filter((action) => activeChartPlayerKey && resolveLeaderboardKey(action?.player) === activeChartPlayerKey)
      .map((action) => ({
        id: `player-da-${action.key}`,
        stat_type: 'defensive_action',
        team_side: action?.teamSide,
        x_position: action?.x,
        y_position: action?.y,
        time_s: action?.stat?.time_s,
        normalized_time_s: action?.stat?.normalized_time_s,
        play_id: action?.stat?.play_id,
        possession_id: action?.stat?.possession_id,
        extra_data: JSON.stringify({
          defensive_action: {
            player: { kind: 'player', ...action.player },
            reason: action.reason,
          },
        }),
      }));
  }, [activeChartPlayerId, activeChartPlayerKey, defensiveActions.playerActions]);
  const focusTouchEvents = useMemo(() => {
    if (activeChartPlayerId === 'all') return [];
    return touchEvents.filter((event) => activeChartPlayerKey && resolveLeaderboardKey(event?.player) === activeChartPlayerKey);
  }, [activeChartPlayerId, activeChartPlayerKey, touchEvents]);

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
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {[
                ['scoring', 'Scoring'],
                ['progression', 'Progression'],
                ['retention', 'Retention'],
                ['tendencies', 'Tendencies'],
                ['defense', 'Defense'],
                ['sonar', 'Charts'],
                ['touches', 'Touches'],
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
            {playerBucket === 'sonar' ? (
              <div className="space-y-4">
                <div className="max-w-sm space-y-1">
                  <Label className="text-xs text-slate-600">Player</Label>
                  <Select value={String(activeChartPlayerId || 'all')} onValueChange={setChartPlayerId}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Select Player</SelectItem>
                      {chartPlayerOptions
                        .map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {(p.team_side === 'away' ? 'Away: ' : 'Home: ') + p.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              {activeChartPlayerId !== 'all' ? (
                <div className="space-y-4">
                  <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr] items-start">
                    <div className="space-y-4">
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="font-semibold text-slate-900">Player Events</div>
                          {focusStats.length ? (
                            <PitchViz
                              stats={focusStats}
                              homeColor={homeTeam?.color}
                              awayColor={awayTeam?.color}
                              colorBy="action"
                              showColorControls={false}
                              mirrorAwayWhenBoth={false}
                              fullscreenEnabled={false}
                            />
                          ) : (
                            <div className="text-sm text-slate-500">No player events under the current filters.</div>
                          )}
                        </CardContent>
                      </Card>
                      <TouchMap
                        touchEvents={focusTouchEvents}
                        playerId={null}
                        title="Touch Map"
                        homeColor={homeTeam?.color}
                        awayColor={awayTeam?.color}
                        mirrorAwayWhenBoth={false}
                        fullscreenEnabled={false}
                      />
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <div className="font-semibold text-slate-900">Defensive Action Map</div>
                          {focusPlayerDefensiveActionStats.length ? (
                            <PitchViz
                              stats={focusPlayerDefensiveActionStats}
                              homeColor={homeTeam?.color}
                              awayColor={awayTeam?.color}
                              colorBy="team"
                              showColorControls={false}
                              mirrorAwayWhenBoth={false}
                              fullscreenEnabled={false}
                            />
                          ) : (
                            <div className="text-sm text-slate-500">No defensive actions under the current filters.</div>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                    <PassSonar
                      passes={focusPlayerPasses}
                      title="Player Pass Sonar"
                      subtitle={focusPlayerSonar.some((zone) => zone.total > 0) ? 'Direction and pass-method mix by start zone' : 'No passes available for the selected player under current filters'}
                      fullscreenEnabled={false}
                      zoneOrder={['Attacking Third', 'Middle Third', 'Defensive Third']}
                      stacked
                    />
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-600">Select a player here to show their charts and maps.</div>
              )}
              </div>
            ) : (
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
            )}
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

