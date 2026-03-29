import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createPageUrl } from '@/utils';
import { getMatchTimeS } from '@/lib/reportAnalytics';
import {
  safeParseJSON,
  toTitleCase,
  formatMMSS,
  formatMatchClock,
  formatExtraValue,
  flattenExtra,
  humanizeKey,
  presentablePathLabel,
  collectPlayerIds,
  groupByPossession,
  derivePossessionOutcome,
  deriveCounterAttackState,
  getPossessionStartZone,
  PitchViz,
  ReportFiltersCard,
} from '../shared';

function DataTab({ matchId, match, stats, homeTeam, awayTeam, homePlayers, awayPlayers }) {
  const [team, setTeam] = useState('both');
  const [actions, setActions] = useState([]); // [] means all
  const [halves, setHalves] = useState([]); // [] means all
  const [playerIds, setPlayerIds] = useState([]); // [] means any
  const [timeMin, setTimeMin] = useState(''); // minutes (string)
  const [timeMax, setTimeMax] = useState(''); // minutes (string)
  const [groupBy, setGroupBy] = useState('none'); // none|team|player|action|half|outcome|possession
  const [vizOpen, setVizOpen] = useState(false);
  const [vizTitle, setVizTitle] = useState('');
  const [vizStats, setVizStats] = useState([]);
  const [expandedRowId, setExpandedRowId] = useState(null);

  const VIDEO_PRE_ROLL_S = 7;

  const openVideoAt = (timeS) => {
    const t = Number(timeS);
    if (!matchId || !Number.isFinite(t)) return;
    const seekTo = Math.max(0, Math.floor(t - VIDEO_PRE_ROLL_S));

    // Reuse the existing video popout window (recommended) so users don't end up with multiple players.
    const url = `${window.location.origin}${window.location.pathname}#${createPageUrl(`Video?matchId=${matchId}`)}`;
    window.open(url, 'gstl_video', 'popup=yes,width=1100,height=650');

    // Ask the video popout to seek. Send a few times in case the window is still initializing.
    try {
      const ch = new BroadcastChannel('gstl_video');
      const msg = { matchId, type: 'SEEK_TO', time_s: seekTo };
      ch.postMessage(msg);
      setTimeout(() => ch.postMessage(msg), 350);
      setTimeout(() => { ch.postMessage(msg); ch.close(); }, 900);
    } catch {
      // ignore (browser/channel not available)
    }
  };

  const playerOptions = useMemo(() => {
    const all = [
      ...(homePlayers || []).map((p) => ({ ...p, team_side: 'home' })),
      ...(awayPlayers || []).map((p) => ({ ...p, team_side: 'away' })),
    ];
    const label = (p) => `#${p.number || ''} ${p.name || ''}`.trim();
    return all
      .slice()
      .sort((a, b) => (a.team_side === b.team_side ? (a.number || 0) - (b.number || 0) : (a.team_side === 'home' ? -1 : 1)))
      .map((p) => ({ id: p.id, team_side: p.team_side, label: label(p) || p.id }));
  }, [homePlayers, awayPlayers]);

  const imputedTimeById = useMemo(() => computeImputedNormalizedTimes(stats), [stats]);

  const filtered = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    const minM = Number(timeMin);
    const maxM = Number(timeMax);
    const minS = Number.isFinite(minM) && timeMin !== '' ? minM * 60 : null;
    const maxS = Number.isFinite(maxM) && timeMax !== '' ? maxM * 60 : null;
    return list.filter((s) => {
      if (!s) return false;
      if (team !== 'both' && s.team_side !== team) return false;
      if (actions.length && !actions.includes(s.stat_type)) return false;
      if (halves.length && !halves.includes(s.half)) return false;
      if (playerIds.length) {
        const extra = safeParseJSON(s.extra_data || '{}', {});
        const ids = collectPlayerIds(extra);
        const any = playerIds.some((id) => ids.has(id));
        if (!any) return false;
      }
      if (minS != null || maxS != null) {
        let t = getMatchTimeS(s, match, imputedTimeById);
        if (!Number.isFinite(t)) return false;
        if (minS != null && t < minS) return false;
        if (maxS != null && t > maxS) return false;
      }
      return true;
    });
  }, [stats, team, actions, halves, playerIds, timeMin, timeMax, imputedTimeById, match]);

  const filteredSorted = useMemo(() => {
    const list = Array.isArray(filtered) ? [...filtered] : [];
    const timeKey = (s) => {
      const mt = getMatchTimeS(s, match, imputedTimeById);
      if (Number.isFinite(mt)) return { kind: 0, v: mt };
      const t = Number(s?.time_s);
      if (Number.isFinite(t)) return { kind: 0, v: t };
      const pid = Number(s?.play_id);
      if (Number.isFinite(pid)) return { kind: 1, v: pid };
      const ts = Date.parse(String(s?.timestamp || ''));
      if (Number.isFinite(ts)) return { kind: 2, v: ts };
      return { kind: 9, v: 0 };
    };
    list.sort((a, b) => {
      const ka = timeKey(a);
      const kb = timeKey(b);
      if (ka.kind !== kb.kind) return ka.kind - kb.kind;
      if (ka.v !== kb.v) return ka.v - kb.v;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    return list;
  }, [filtered, imputedTimeById, match]);

  const keyForGroup = (s) => {
    const extra = safeParseJSON(s?.extra_data || '{}', {});
    if (groupBy === 'team') return s?.team_side || 'unknown';
    if (groupBy === 'action') return s?.stat_type || 'unknown';
    if (groupBy === 'half') return s?.half || 'unknown';
    if (groupBy === 'outcome') return deriveOutcome(s, extra) || 'unknown';
    if (groupBy === 'possession') {
      const pid = Number(s?.possession_id);
      const pside = s?.possession_team_side;
      if (Number.isFinite(pid) && (pside === 'home' || pside === 'away')) return `${pside}-${pid}`;
      return 'unknown';
    }
    if (groupBy === 'player') {
      if (s?.player_number) return `#${s.player_number}`;
      return 'None';
    }
    return 'unknown';
  };

  const pivot = useMemo(() => {
    if (groupBy === 'none') return null;
    const rows = new Map();

    for (const s of filtered) {
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const key = keyForGroup(s);
      const cur = rows.get(key) || {
        key,
        count: 0,
        shotPoints: 0,
        // possession summary fields (only used when grouping by possession)
        start_time_s: null,
        end_time_s: null,
        start_time_norm_s: null,
        end_time_norm_s: null,
        start_action: '',
        end_action: '',
        start_half: '',
        end_half: '',
        start_source: '',
        end_outcome: '',
        attack: false,
        attack_entry_channel: '',
      };
      cur.count += 1;
      if (s.stat_type === 'shot') {
        const o = extra?.shot?.outcome;
        if (o === 'goal') cur.shotPoints += 3;
        if (o === 'point') cur.shotPoints += 1;
        if (o === '2_point') cur.shotPoints += 2;
      }

      if (groupBy === 'possession') {
        const t = Number(s?.time_s);
        if (Number.isFinite(t)) {
          cur.start_time_s = cur.start_time_s == null ? t : Math.min(cur.start_time_s, t);
          cur.end_time_s = cur.end_time_s == null ? t : Math.max(cur.end_time_s, t);
        }
        const tn = getMatchTimeS(s, match, imputedTimeById);
        if (Number.isFinite(tn)) {
          cur.start_time_norm_s = cur.start_time_norm_s == null ? tn : Math.min(cur.start_time_norm_s, tn);
          cur.end_time_norm_s = cur.end_time_norm_s == null ? tn : Math.max(cur.end_time_norm_s, tn);
        }
        const act = s?.stat_type || '';
        const out = deriveOutcome(s, extra) || '';

        // start/end action heuristics based on play order when time is missing
        const pid = Number(s?.play_id);
        if (Number.isFinite(pid)) {
          if (cur._minPlay == null || pid < cur._minPlay) {
            cur._minPlay = pid;
            cur.start_action = act;
            cur.start_half = s?.half || '';
            cur.start_source = (() => {
              if (act === 'kickout') return 'Kickout Won';
              if (act === 'turnover') return 'Turnover Won';
              if (act === 'throw_in') return 'Throw In Won';
              if (act === 'foul') return 'Foul Won';
              if (extra?.pass?.deadball) return 'Restart';
              return toTitleCase(act);
            })();
          }
          if (cur._maxPlay == null || pid > cur._maxPlay) {
            cur._maxPlay = pid;
            cur.end_action = act;
            cur.end_half = s?.half || '';
            cur.end_outcome = out;
          }
        }
      }

      rows.set(key, cur);
    }

    const arr = Array.from(rows.values());
    if (groupBy === 'possession') {

export default DataTab;

