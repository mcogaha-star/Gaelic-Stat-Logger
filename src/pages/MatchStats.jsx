const db = globalThis.__B44_DB__ || {
  auth: { isAuthenticated: async () => false, me: async () => null },
  entities: new Proxy({}, { get: () => ({ filter: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
  integrations: { Core: { UploadFile: async () => ({ file_url: '' }) } }
};

import React, { useEffect, useMemo, useState } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Repeat2, Undo2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import GAAPitch from '@/components/pitch/GAAPitch';
import StatModalV4 from '@/components/pitch/StatModalV4';
import StatMarkers from '@/components/pitch/StatMarkers';
import MatchHeader from '@/components/match/MatchHeader';
import RecentStats from '@/components/match/RecentStats';
import { DEFAULT_CLICK_STATS, DEFAULT_DRAG_STATS, DEFAULT_DEFAULTS, DEFAULT_CUSTOM_FIELDS } from '@/components/statDefaults';
import { ensureServerMatch, insertServerStat, softDeleteServerStat, updateServerStat } from '@/lib/serverSync';

export default function MatchStats() {
    // With HashRouter, query params live in the hash segment, so use react-router's location.
    const location = useLocation();
    const urlParams = new URLSearchParams(location.search);
    const matchId = urlParams.get('id');
    const debugPitch = urlParams.get('debug') === '1';

    const [modalOpen, setModalOpen] = useState(false);
    const [isPassModal, setIsPassModal] = useState(false);
    const [clickCoords, setClickCoords] = useState(null);
    const [passEndCoords, setPassEndCoords] = useState(null);
    const [editingStat, setEditingStat] = useState(null);

    const queryClient = useQueryClient();

    const { data: match } = useQuery({
        queryKey: ['match', matchId],
        queryFn: () => db.entities.Match.filter({ id: matchId }),
        enabled: !!matchId,
        select: (data) => data[0]
    });

    const { data: teams = [] } = useQuery({
        queryKey: ['teams'],
        queryFn: () => db.entities.Team.list('name')
    });

    const { data: allPlayers = [] } = useQuery({
        queryKey: ['players'],
        queryFn: () => db.entities.Player.list('number')
    });

    const { data: stats = [] } = useQuery({
        queryKey: ['stats', matchId],
        queryFn: () => db.entities.StatEntry.filter({ match_id: matchId }),
        enabled: !!matchId
    });

    const { data: settingsRecords = [] } = useQuery({
        queryKey: ['app-settings'],
        queryFn: () => db.entities.AppSettings.list()
    });

    const settingsRecord = settingsRecords[0];
    const clickStats = DEFAULT_CLICK_STATS;
    const dragStats = DEFAULT_DRAG_STATS;
    const appDefaultsRaw = settingsRecord?.defaults_config ? (() => { try { return JSON.parse(settingsRecord.defaults_config); } catch { return DEFAULT_DEFAULTS; } })() : DEFAULT_DEFAULTS;
    const customFieldsRaw = settingsRecord?.custom_fields_config ? (() => { try { return JSON.parse(settingsRecord.custom_fields_config); } catch { return DEFAULT_CUSTOM_FIELDS; } })() : DEFAULT_CUSTOM_FIELDS;

    const appDefaults = useMemo(() => {
        const d = (appDefaultsRaw && typeof appDefaultsRaw === 'object') ? appDefaultsRaw : DEFAULT_DEFAULTS;
        return {
            ...DEFAULT_DEFAULTS,
            ...d,
            // Legacy keys are ignored; keep for older saves.
        };
    }, [settingsRecord?.defaults_config]);

    const customFields = useMemo(() => {
        const base = (customFieldsRaw && typeof customFieldsRaw === 'object') ? customFieldsRaw : DEFAULT_CUSTOM_FIELDS;
        return {
            ...DEFAULT_CUSTOM_FIELDS,
            ...base,
            custom_1: { ...DEFAULT_CUSTOM_FIELDS.custom_1, ...(base.custom_1 || {}) },
            custom_2: { ...DEFAULT_CUSTOM_FIELDS.custom_2, ...(base.custom_2 || {}) },
            custom_3: { ...DEFAULT_CUSTOM_FIELDS.custom_3, ...(base.custom_3 || {}) },
        };
    }, [settingsRecord?.custom_fields_config]);

    const [half, setHalf] = useState(appDefaults.half || 'first');

    // v0.4: defaults engine for player role pickers.
    // We track the last receiver (team-aware) and use it as the default "player"
    // for shot/passer/carrier/foul-on/lost-by, etc.
    const [lastReceiver, setLastReceiver] = useState({ kind: 'none' });

    // v0.4: play/possession counters (per match).
    const [playCounter, setPlayCounter] = useState(0);
    const [possessionCounter, setPossessionCounter] = useState(0);
    const [currentPossessionId, setCurrentPossessionId] = useState(0);
    const [currentPossessionTeamSide, setCurrentPossessionTeamSide] = useState('unknown');
    const [pendingNextPossessionTeamSide, setPendingNextPossessionTeamSide] = useState(null);

    const [directionByPeriod, setDirectionByPeriod] = useState(null);
    const [halfPrompt, setHalfPrompt] = useState({ open: false, nextHalf: null });
    const [subDialogOpen, setSubDialogOpen] = useState(false);
    const [subOut, setSubOut] = useState('');
    const [subIn, setSubIn] = useState('');
    const [endPeriodPrompt, setEndPeriodPrompt] = useState({ open: false, nextHalf: null });

    // Match teams + players
    const homeTeam = teams.find(t => t.id === match?.home_team_id);
    const awayTeam = teams.find(t => t.id === match?.away_team_id);
    const parseIds = (s) => {
        if (!s || typeof s !== 'string') return [];
        try { const arr = JSON.parse(s); return Array.isArray(arr) ? arr.filter(Boolean) : []; } catch { return []; }
    };
    const orderByOnField = (players, onFieldIds) => {
        const set = new Set(onFieldIds || []);
        const on = players.filter(p => set.has(p.id));
        const off = players.filter(p => !set.has(p.id));
        return on.concat(off);
    };
    const homeOnField = parseIds(match?.home_on_field);
    const awayOnField = parseIds(match?.away_on_field);
    const homePlayers = homeTeam ? orderByOnField(allPlayers.filter(p => p.team_id === homeTeam.id), homeOnField) : [];
    const awayPlayers = awayTeam ? orderByOnField(allPlayers.filter(p => p.team_id === awayTeam.id), awayOnField) : [];

    useEffect(() => {
        if (!match?.id) return;
        const fallback = { first: 'right', second: 'left', et_first: 'right', et_second: 'left' };
        let next = null;
        const raw = match.direction_by_period;
        if (raw && typeof raw === 'string') {
            try { next = JSON.parse(raw); } catch { next = null; }
        } else if (raw && typeof raw === 'object') {
            next = raw;
        }
        const merged = { ...fallback, ...(next || {}) };
        setDirectionByPeriod(merged);
        // If it wasn't set yet, persist the defaults once.
        if (!raw) {
            db.entities.Match.update(match.id, { direction_by_period: JSON.stringify(merged) }).catch(() => {});
        }
    }, [match?.id]);

    // Initialize counters from existing rows (should usually be empty after v0.4 wipe).
    useEffect(() => {
        if (!matchId) return;
        const maxPlay = Math.max(0, ...(stats || []).map(s => Number(s?.play_id || 0)));
        const maxPoss = Math.max(0, ...(stats || []).map(s => Number(s?.possession_id || 0)));
        setPlayCounter(maxPlay);
        setPossessionCounter(maxPoss);

        const ordered = [...(stats || [])].sort((a, b) => String(a?.timestamp || '').localeCompare(String(b?.timestamp || '')));
        const last = ordered[ordered.length - 1];
        setCurrentPossessionId(Number(last?.possession_id || 0));
        setCurrentPossessionTeamSide(last?.possession_team_side || 'unknown');
        setPendingNextPossessionTeamSide(null);
    }, [matchId, stats?.length]);

    const ensureMatchServerId = async () => {
        if (!match) return null;
        if (match.server_match_id) return match.server_match_id;
        if (!match.public_match_id) return null;

        const res = await ensureServerMatch({
            publicMatchId: match.public_match_id,
            matchDate: match.date,
            code: match.code || 'GAA',
            level: match.level || 'Other',
        });
        if (res.ok && res.id) {
            await db.entities.Match.update(match.id, { server_match_id: res.id });
            return res.id;
        }
        return null;
    };

    const createStatMutation = useMutation({
        mutationFn: async (data) => {
            const created = await db.entities.StatEntry.create(data);

            // Best-effort server upload (redacted)
            const serverMatchId = await ensureMatchServerId();
            if (serverMatchId && match?.public_match_id) {
                const res = await insertServerStat({
                    matchId: serverMatchId,
                    publicMatchId: match.public_match_id,
                    stat: created,
                    teamSide: created.team_side || 'unknown',
                });
                if (res.ok && res.id) {
                    await db.entities.StatEntry.update(created.id, { server_stat_id: res.id });
                    return { ...created, server_stat_id: res.id };
                }
            }

            return created;
        },
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['stats', matchId] }); toast.success('Stat logged'); }
    });

    const updateStatMutation = useMutation({
        mutationFn: async ({ id, data }) => {
            const updated = await db.entities.StatEntry.update(id, data);
            if (updated?.server_stat_id) {
                await updateServerStat(updated.server_stat_id, {
                    stat_type: updated.stat_type,
                    is_pass: !!updated.is_pass,
                    team_side: updated.team_side || 'unknown',
                    counter_attack: !!updated.counter_attack,
                    player_number: updated.player_number ?? null,
                    recipient_number: updated.recipient_number ?? null,
                    extra_data: updated.extra_data ?? null,
                });
            }
            return updated;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
            toast.success('Stat updated');
        }
    });

    const deleteStatMutation = useMutation({
        mutationFn: async (id) => {
            const stat = await db.entities.StatEntry.get(id);
            await db.entities.StatEntry.delete(id);
            if (stat?.server_stat_id) {
                await softDeleteServerStat(stat.server_stat_id);
            }
            return { id };
        },
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['stats', matchId] }); toast.success('Stat deleted'); }
    });

    const getMostRecentStat = () => {
        if (!stats?.length) return null;
        return [...stats].sort((a, b) => {
            const at = a?.timestamp || a?.created_date || '';
            const bt = b?.timestamp || b?.created_date || '';
            return String(bt).localeCompare(String(at));
        })[0];
    };

    const handleUndoLast = () => {
        const mostRecent = getMostRecentStat();
        if (!mostRecent?.id) {
            toast.error('Nothing to undo');
            return;
        }
        deleteStatMutation.mutate(mostRecent.id);
        toast.message('Undid last stat');
    };

    const openEndHalfPrompt = () => {
        const nextMap = { first: 'second', second: 'et_first', et_first: 'et_second', et_second: null };
        const nextHalf = nextMap[half] || null;
        if (!nextHalf) {
            toast.message('No next period');
            return;
        }
        setEndPeriodPrompt({ open: true, nextHalf });
    };

    useEffect(() => {
        const onKeyDown = (e) => {
            const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z');
            if (!isUndo) return;

            const t = e.target;
            const tag = t?.tagName?.toLowerCase?.();
            const isTypingContext =
                tag === 'input' ||
                tag === 'textarea' ||
                tag === 'select' ||
                t?.isContentEditable === true;

            if (isTypingContext) return;
            e.preventDefault();
            handleUndoLast();
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [stats]);

    const snapKickoutOrigin = (coords) => {
        // Snap to nearest 20m line midpoint in the 145x85 plane: (20, 42.5) or (125, 42.5)
        const midY = 85 / 2;
        const left = { x: 20, y: midY };
        const right = { x: 145 - 20, y: midY };
        const leftDist = Math.sqrt(Math.pow(coords.x - left.x, 2) + Math.pow(coords.y - left.y, 2));
        const rightDist = Math.sqrt(Math.pow(coords.x - right.x, 2) + Math.pow(coords.y - right.y, 2));
        return leftDist < rightDist ? left : right;
    };

    const getDirForHalf = (h) => (directionByPeriod && directionByPeriod[h]) ? directionByPeriod[h] : 'right';

    const persistDirectionByPeriod = async (next) => {
        setDirectionByPeriod(next);
        if (!match?.id) return;
        try {
            await db.entities.Match.update(match.id, { direction_by_period: JSON.stringify(next) });
        } catch {}
    };

    const flipDirectionForHalf = async (h) => {
        const cur = getDirForHalf(h);
        const nextDir = cur === 'left' ? 'right' : 'left';
        const next = { ...(directionByPeriod || {}), [h]: nextDir };
        await persistDirectionByPeriod(next);
    };

    const requestHalfChange = (nextHalf) => {
        if (!nextHalf || nextHalf === half) return;
        setHalfPrompt({ open: true, nextHalf });
    };

    const handlePointClick = (coords) => {
        setClickCoords(coords);
        setIsPassModal(false);
        setPassEndCoords(null);
        setModalOpen(true);
    };

    const handlePassDraw = (start, end) => {
        setClickCoords(start);
        setPassEndCoords(end);
        setIsPassModal(true);
        setModalOpen(true);
    };

    const PITCH_W = 145;
    const PITCH_H = 85;
    const rotate180 = (p) => ({ x: PITCH_W - p.x, y: PITCH_H - p.y });
    const homeAttacksRightRaw = () => getDirForHalf(half) !== 'left';
    const teamAttacksRightRaw = (teamSide) => {
        if (teamSide === 'home') return homeAttacksRightRaw();
        if (teamSide === 'away') return !homeAttacksRightRaw();
        return true;
    };
    const normalizeForTeam = (p, teamSide) => (teamAttacksRightRaw(teamSide) ? p : rotate180(p));
    const snapKickoutOriginRaw = (teamSide) => ({ x: teamAttacksRightRaw(teamSide) ? 20 : (PITCH_W - 20), y: PITCH_H / 2 });

    const safeParse = (s) => { try { return JSON.parse(s); } catch { return {}; } };

    const inferPossessionStart = ({ stat_type, extra }) => {
        if (stat_type === 'kickout') {
            const o = extra?.kickout?.outcome;
            const won = extra?.kickout?.won_by;
            if ((o === 'clean' || o === 'break') && won?.team_side && won.team_side !== 'unknown') return won.team_side;
        }
        if (stat_type === 'turnover') {
            const t = extra?.turnover?.turnover_type;
            const rec = extra?.turnover?.recovered_by;
            if (t && t !== 'foul' && rec?.team_side && rec.team_side !== 'unknown') return rec.team_side;
        }
        if (stat_type === 'throw_in') {
            const o = extra?.throw_in?.outcome;
            const won = extra?.throw_in?.won_by;
            if ((o === 'clean' || o === 'break') && won?.team_side && won.team_side !== 'unknown') return won.team_side;
        }
        return null;
    };

    const shouldScheduleNextPossession = ({ stat_type, team_side, extra }) => {
        if (stat_type !== 'shot') return null;
        const o = extra?.shot?.outcome;
        const r = extra?.shot?.result;
        if (!['short', 'post', 'saved', 'blocked'].includes(o)) return null;
        if (r !== 'opposition') return null;
        if (team_side === 'home') return 'away';
        if (team_side === 'away') return 'home';
        return null;
    };

    const updateLastReceiverFrom = ({ stat_type, extra }) => {
        if (stat_type === 'pass') {
            if (extra?.pass?.outcome === 'completed' && extra?.pass?.intended_recipient?.kind === 'player') return extra.pass.intended_recipient;
        }
        if (stat_type === 'carry') {
            if (extra?.carry?.outcome === 'completed' && extra?.carry?.carrier?.kind === 'player') return extra.carry.carrier;
        }
        if (stat_type === 'kickout') {
            const o = extra?.kickout?.outcome;
            if ((o === 'clean' || o === 'break') && extra?.kickout?.won_by?.kind === 'player') return extra.kickout.won_by;
        }
        if (stat_type === 'throw_in') {
            const o = extra?.throw_in?.outcome;
            if ((o === 'clean' || o === 'break') && extra?.throw_in?.won_by?.kind === 'player') return extra.throw_in.won_by;
        }
        if (stat_type === 'turnover') {
            const t = extra?.turnover?.turnover_type;
            if (t && t !== 'foul' && extra?.turnover?.recovered_by?.kind === 'player') return extra.turnover.recovered_by;
        }
        return null;
    };

    const handleStatSubmit = (payload) => {
        // Edit mode: update the existing row's metadata (coords/IDs remain unchanged).
        if (editingStat?.id) {
            const primary = payload.primary_player;
            const recipientSel =
                payload.stat_type === 'pass' ? payload.extra?.pass?.intended_recipient
                    : (payload.stat_type === 'kickout' ? payload.extra?.kickout?.intended_recipient : null);

            const prevExtra = editingStat?.extra_data ? safeParse(editingStat.extra_data) : {};
            const extra = { ...prevExtra, ...(payload.extra || {}), pitch: { w: PITCH_W, h: PITCH_H } };

            updateStatMutation.mutate({
                id: editingStat.id,
                data: {
                    stat_type: payload.stat_type,
                    is_pass: !!payload.is_pass,
                    team_side: payload?.team_side || editingStat.team_side || 'unknown',
                    counter_attack: !!payload.counter_attack,
                    player_name: primary?.kind === 'player' ? (primary.name || '') : null,
                    player_number: primary?.kind === 'player' ? (primary.number ?? null) : null,
                    recipient_name: recipientSel?.kind === 'player' ? (recipientSel.name || '') : null,
                    recipient_number: recipientSel?.kind === 'player' ? (recipientSel.number ?? null) : null,
                    extra_data: JSON.stringify(extra),
                },
            });

            setModalOpen(false);
            setClickCoords(null);
            setPassEndCoords(null);
            setEditingStat(null);
            return;
        }

        const rawStartBase = clickCoords ? { x: clickCoords.x, y: clickCoords.y } : null;
        if (!rawStartBase) return;
        const rawEndBase = passEndCoords ? { x: passEndCoords.x, y: passEndCoords.y } : null;

        const teamSide = payload?.team_side || 'unknown';
        const rawStart = payload?.stat_type === 'kickout' ? snapKickoutOriginRaw(teamSide) : rawStartBase;
        const rawEnd = rawEndBase;

        const start = normalizeForTeam(rawStart, teamSide);
        const hasEnd = !!rawEnd;
        const end = hasEnd ? normalizeForTeam(rawEnd, teamSide) : null;

        // Apply pending next-possession (from prior shot) if present.
        let nextPossessionId = currentPossessionId;
        let nextPossessionTeam = currentPossessionTeamSide;
        let nextPossessionCounter = possessionCounter;
        let pending = pendingNextPossessionTeamSide;

        if (!nextPossessionId) {
            nextPossessionId = 1;
            nextPossessionCounter = Math.max(nextPossessionCounter, 1);
            nextPossessionTeam = (teamSide === 'home' || teamSide === 'away') ? teamSide : 'unknown';
        }

        if (pending) {
            nextPossessionId = nextPossessionCounter + 1;
            nextPossessionCounter = nextPossessionId;
            nextPossessionTeam = pending;
            pending = null;
        }

        // Immediate possession start rules on the same row
        const startTeam = inferPossessionStart(payload);
        if (startTeam) {
            nextPossessionId = nextPossessionCounter + 1;
            nextPossessionCounter = nextPossessionId;
            nextPossessionTeam = startTeam;
        }

        const nextPlayId = playCounter + 1;

        const extra = { ...(payload.extra || {}), pitch: { w: PITCH_W, h: PITCH_H } };

        const primary = payload.primary_player;
        const recipientSel =
            payload.stat_type === 'pass' ? payload.extra?.pass?.intended_recipient
                : (payload.stat_type === 'kickout' ? payload.extra?.kickout?.intended_recipient : null);

        const statData = {
            match_id: matchId,
            stat_type: payload.stat_type,
            is_pass: !!payload.is_pass,
            half,
            timestamp: new Date().toISOString(),

            play_id: nextPlayId,
            possession_id: nextPossessionId,
            possession_team_side: nextPossessionTeam,
            team_side: teamSide,
            counter_attack: !!payload.counter_attack,

            raw_x_position: rawStart.x,
            raw_y_position: rawStart.y,
            raw_end_x_position: hasEnd ? rawEnd.x : null,
            raw_end_y_position: hasEnd ? rawEnd.y : null,

            x_position: start.x,
            y_position: start.y,
            end_x_position: hasEnd ? end.x : null,
            end_y_position: hasEnd ? end.y : null,

            time_s: null,
            normalized_time_s: null,

            player_name: primary?.kind === 'player' ? (primary.name || '') : null,
            player_number: primary?.kind === 'player' ? (primary.number ?? null) : null,
            recipient_name: recipientSel?.kind === 'player' ? (recipientSel.name || '') : null,
            recipient_number: recipientSel?.kind === 'player' ? (recipientSel.number ?? null) : null,

            extra_data: JSON.stringify(extra),
        };

        createStatMutation.mutate(statData);

        setPlayCounter(nextPlayId);
        setPossessionCounter(nextPossessionCounter);
        setCurrentPossessionId(nextPossessionId);
        setCurrentPossessionTeamSide(nextPossessionTeam);
        setPendingNextPossessionTeamSide(shouldScheduleNextPossession({ ...payload, extra }) || pending);

        const lr = updateLastReceiverFrom({ stat_type: payload.stat_type, extra });
        if (lr) setLastReceiver(lr);

        setModalOpen(false);
        setClickCoords(null);
        setPassEndCoords(null);
    };

    const exportToCSV = () => {
        if (stats.length === 0) { toast.error('No stats to export'); return; }

        const buildCustomHeaderNames = () => {
            const base = [
                { key: 'custom_1', fallback: 'Custom 1' },
                { key: 'custom_2', fallback: 'Custom 2' },
                { key: 'custom_3', fallback: 'Custom 3' },
            ].map(({ key, fallback }) => {
                const label = String(customFields?.[key]?.label || '').trim();
                return label || fallback;
            });

            const seen = new Map();
            return base.map((name) => {
                const n = String(name);
                const count = (seen.get(n) || 0) + 1;
                seen.set(n, count);
                return count === 1 ? n : `${n} (${count})`;
            });
        };

        const customHeaders = buildCustomHeaderNames();
        const getCustomValueLabel = (extraData, key) => {
            const v = extraData?.custom_fields?.[key];
            if (!v) return '';
            if (typeof v === 'string') return v;
            return v.label || '';
        };

        const orderedStats = [...stats].sort((a, b) => {
            const at = a?.timestamp || a?.created_date || '';
            const bt = b?.timestamp || b?.created_date || '';
            return String(at).localeCompare(String(bt));
        });

        const headers = [
            'Match ID','Match Public ID','Match Date','Code','Level',
            'Play ID','Possession ID','Possession Team','Acting Team','Counter Attack',
            'Stat Type','Is Drag','Half','Timestamp',
            'Raw X','Raw Y','Raw End X','Raw End Y',
            'X','Y','End X','End Y',
            'Primary Player #','Primary Player Name',
            'Recipient #','Recipient Name',
            'Time (s)','Normalized Time (s)',
            ...customHeaders,
            'Extra JSON',
        ];

        const rows = orderedStats.map((stat) => {
            const extraData = stat.extra_data ? safeParse(stat.extra_data) : {};
            return [
                stat.match_id || '',
                match?.public_match_id || '',
                match?.date || '',
                match?.code || '',
                match?.level || '',
                stat.play_id ?? '',
                stat.possession_id ?? '',
                stat.possession_team_side || '',
                stat.team_side || '',
                stat.counter_attack ? 'Yes' : 'No',
                stat.stat_type || '',
                stat.is_pass ? 'Yes' : 'No',
                stat.half || '',
                stat.timestamp || '',
                stat.raw_x_position ?? '',
                stat.raw_y_position ?? '',
                stat.raw_end_x_position ?? '',
                stat.raw_end_y_position ?? '',
                stat.x_position ?? '',
                stat.y_position ?? '',
                stat.end_x_position ?? '',
                stat.end_y_position ?? '',
                stat.player_number ?? '',
                stat.player_name || '',
                stat.recipient_number ?? '',
                stat.recipient_name || '',
                stat.time_s ?? '',
                stat.normalized_time_s ?? '',
                getCustomValueLabel(extraData, 'custom_1'),
                getCustomValueLabel(extraData, 'custom_2'),
                getCustomValueLabel(extraData, 'custom_3'),
                JSON.stringify(extraData),
            ];
        });

        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csvContent = [headers.join(','), ...rows.map(row => row.map(esc).join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `match_stats_${match?.public_match_id || 'match'}_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        toast.success('CSV exported');
    };

    if (!matchId) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="text-center">
                    <h2 className="text-xl font-semibold text-slate-900 mb-2">No match selected</h2>
                    <Link to={createPageUrl('Home')}><Button>Go to Dashboard</Button></Link>
                </div>
            </div>
        );
    }

    const matchTitle = homeTeam && awayTeam ? `${homeTeam.name} vs ${awayTeam.name}` : match?.opponent ? `vs ${match.opponent}` : 'Match';
    const scoreLine = (() => {
        const score = { home: { goals: 0, points: 0 }, away: { goals: 0, points: 0 } };
        for (const s of (stats || [])) {
            const side = s?.team_side === 'home' || s?.team_side === 'away' ? s.team_side : null;
            if (!side) continue;
            if (String(s.stat_type || '').toLowerCase() !== 'shot') continue;
            const extra = s.extra_data ? safeParse(s.extra_data) : {};
            const o = extra?.shot?.outcome || '';
            if (o === 'goal') score[side].goals += 1;
            if (o === 'point') score[side].points += 1;
            if (o === '2_point') score[side].points += 2;
        }
        return `${score.home.goals}:${score.home.points} - ${score.away.goals}:${score.away.points}`;
    })();

    return (
        <div className="min-h-screen bg-slate-50">
            <MatchHeader
                match={match}
                matchTitle={matchTitle}
                half={half}
                onHalfChange={requestHalfChange}
                scoreLine={scoreLine}
                backUrl={createPageUrl('Home')}
                statsUrl={createPageUrl(`MatchReport?id=${matchId}`)}
                settingsUrl={createPageUrl('Settings')}
            />

            <div className="max-w-7xl mx-auto px-4 pt-1 pb-5">
                <div className="grid lg:grid-cols-3 gap-5">
                    <div className="lg:col-span-2">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-0.5">
                            <div className="flex items-center gap-3">
                                <span className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                                    Home Attacking
                                </span>
                                <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 text-white px-3 py-1 shadow-sm">
                                    {getDirForHalf(half) === 'left' ? (
                                        <ArrowLeft className="w-4 h-4" />
                                    ) : (
                                        <ArrowRight className="w-4 h-4" />
                                    )}
                                    <span className="font-mono text-sm tracking-tight">
                                        {getDirForHalf(half) === 'left' ? 'Left' : 'Right'}
                                    </span>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => flipDirectionForHalf(half)}
                                    title="Flip home attacking direction (affects new stats only)"
                                >
                                    Flip
                                </Button>

                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={openEndHalfPrompt}
                                    title="Log end of half and switch"
                                    className="gap-2"
                                >
                                    <Repeat2 className="w-4 h-4" />
                                    End Half
                                </Button>

                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSubDialogOpen(true)}
                                    title="Log a substitution"
                                    className="gap-2"
                                >
                                    <Users className="w-4 h-4" />
                                    Sub
                                </Button>

                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handleUndoLast}
                                    disabled={!stats.length}
                                    title="Undo last stat (Ctrl/Cmd+Z)"
                                    className="gap-2"
                                >
                                    <Undo2 className="w-4 h-4" />
                                    Undo
                                </Button>
                            </div>
                        </div>
                        <div className="bg-slate-900 rounded-2xl p-1 shadow-xl relative overflow-hidden ml-2 mt-0.5">
                            <GAAPitch onPointClick={handlePointClick} onPassDraw={handlePassDraw} debug={debugPitch} />
                            <StatMarkers stats={stats} clickStats={clickStats} />
                        </div>
                        <p className="text-center text-sm text-slate-500 mt-2">
                            Click to log a stat. Click and drag to log a pass / carry.
                        </p>
                    </div>

                    <div className="space-y-6">
                        <RecentStats
                            stats={stats}
                            statsCount={stats.length}
                            onEdit={(stat) => {
                                if (!stat?.id) return;
                                if (stat.stat_type === 'period_end' || stat.stat_type === 'substitution') return;
                                if (stat.raw_x_position == null || stat.raw_y_position == null) return;

                                setEditingStat(stat);
                                setIsPassModal(!!stat.is_pass);
                                setClickCoords({ x: stat.raw_x_position, y: stat.raw_y_position });
                                if (stat.raw_end_x_position != null && stat.raw_end_y_position != null) {
                                    setPassEndCoords({ x: stat.raw_end_x_position, y: stat.raw_end_y_position });
                                } else {
                                    setPassEndCoords(null);
                                }
                                setModalOpen(true);
                            }}
                            onDelete={(id) => deleteStatMutation.mutate(id)}
                            onExport={exportToCSV}
                        />
                    </div>
                </div>
            </div>

            <StatModalV4
                open={modalOpen}
                onClose={() => { setModalOpen(false); setClickCoords(null); setPassEndCoords(null); setEditingStat(null); }}
                onSubmit={handleStatSubmit}
                isDrag={isPassModal}
                startCoords={clickCoords}
                endCoords={passEndCoords}
                homePlayers={homePlayers}
                awayPlayers={awayPlayers}
                homeRoster={homePlayers}
                awayRoster={awayPlayers}
                homeOnFieldIds={homeOnField}
                awayOnFieldIds={awayOnField}
                homeTeamColor={homeTeam?.color || '#22c55e'}
                awayTeamColor={awayTeam?.color || '#ef4444'}
                defaultReceiver={lastReceiver}
                initialStat={editingStat}
                customFields={customFields}
            />

            {/* Half change prompt */}
            <AlertDialog open={halfPrompt.open} onOpenChange={(open) => !open && setHalfPrompt({ open: false, nextHalf: null })}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Switch period?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Switching to the new period. Would you like to flip the Home attacking direction too? This affects new stats only.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setHalfPrompt({ open: false, nextHalf: null })}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={async () => {
                                const nextHalf = halfPrompt.nextHalf;
                                if (!nextHalf) return;
                                const prevDir = getDirForHalf(half);
                                const nextDir = prevDir === 'left' ? 'right' : 'left';
                                await persistDirectionByPeriod({ ...(directionByPeriod || {}), [nextHalf]: nextDir });
                                setHalf(nextHalf);
                                setHalfPrompt({ open: false, nextHalf: null });
                            }}
                        >
                            Flip direction
                        </AlertDialogAction>
                        <AlertDialogAction
                            className="bg-slate-900 hover:bg-slate-800"
                            onClick={async () => {
                                const nextHalf = halfPrompt.nextHalf;
                                if (!nextHalf) return;
                                const prevDir = getDirForHalf(half);
                                await persistDirectionByPeriod({ ...(directionByPeriod || {}), [nextHalf]: prevDir });
                                setHalf(nextHalf);
                                setHalfPrompt({ open: false, nextHalf: null });
                            }}
                        >
                            Keep direction
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Substitution dialog */}
            <Dialog open={subDialogOpen} onOpenChange={setSubDialogOpen}>
                <DialogContent className="w-full sm:max-w-lg">
                    <DialogHeader><DialogTitle>Substitution</DialogTitle></DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Player subbed out</Label>
                            <Select value={subOut} onValueChange={setSubOut}>
                                <SelectTrigger><SelectValue placeholder="Select player..." /></SelectTrigger>
                                <SelectContent>
                                    {allPlayers.map(p => (
                                        <SelectItem key={p.id} value={p.id}>#{p.number} {p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Player subbed in</Label>
                            <Select value={subIn} onValueChange={setSubIn}>
                                <SelectTrigger><SelectValue placeholder="Select player..." /></SelectTrigger>
                                <SelectContent>
                                    {allPlayers.map(p => (
                                        <SelectItem key={p.id} value={p.id}>#{p.number} {p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex gap-2 pt-2">
                            <Button
                                variant="outline"
                                className="flex-1"
                                onClick={() => { setSubDialogOpen(false); setSubOut(''); setSubIn(''); }}
                            >
                                Cancel
                            </Button>
                            <Button
                                className="flex-1 bg-green-600 hover:bg-green-700"
                                disabled={!subOut || !subIn}
                                onClick={async () => {
                                    const outP = allPlayers.find(p => p.id === subOut);
                                    const inP = allPlayers.find(p => p.id === subIn);
                                    const outSide =
                                        outP?.team_id && outP.team_id === match?.home_team_id ? 'home'
                                        : outP?.team_id && outP.team_id === match?.away_team_id ? 'away'
                                        : 'unknown';
                                    const possId = currentPossessionId || 1;
                                    const possTeam = currentPossessionTeamSide || 'unknown';
                                    const nextPlayId = playCounter + 1;
                                    const extra = { sub_out_id: subOut, sub_in_id: subIn };
                                    const statData = {
                                        match_id: matchId,
                                        player_name: outP?.name,
                                        player_number: outP?.number,
                                        recipient_name: inP?.name,
                                        recipient_number: inP?.number,
                                        stat_type: 'substitution',
                                        is_pass: false,
                                        half,
                                        timestamp: new Date().toISOString(),
                                        play_id: nextPlayId,
                                        possession_id: possId,
                                        possession_team_side: possTeam,
                                        team_side: outSide,
                                        counter_attack: false,
                                        extra_data: JSON.stringify(extra),
                                    };
                                    createStatMutation.mutate(statData);
                                    setPlayCounter(nextPlayId);

                                    // Update on-field list so subsequent dropdowns reflect the sub.
                                    try {
                                        if (match?.id && (outSide === 'home' || outSide === 'away')) {
                                            const cur = outSide === 'home' ? (homeOnField || []) : (awayOnField || []);
                                            const next = cur.filter((id) => id !== subOut);
                                            if (subIn && !next.includes(subIn)) next.push(subIn);
                                            const patch = outSide === 'home'
                                                ? { home_on_field: JSON.stringify(next) }
                                                : { away_on_field: JSON.stringify(next) };
                                            await db.entities.Match.update(match.id, patch);
                                            queryClient.invalidateQueries({ queryKey: ['match', matchId] });
                                        }
                                    } catch {}

                                    setSubDialogOpen(false);
                                    setSubOut(''); setSubIn('');
                                }}
                            >
                                Log sub
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* End half prompt */}
            <AlertDialog open={endPeriodPrompt.open} onOpenChange={(open) => !open && setEndPeriodPrompt({ open: false, nextHalf: null })}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>End half?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will log an end-of-half marker, then switch to the next half. Would you like to flip the Home attacking direction too? This affects new stats only.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setEndPeriodPrompt({ open: false, nextHalf: null })}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={async () => {
                                const nextHalf = endPeriodPrompt.nextHalf;
                                if (!nextHalf) return;
                                const possId = currentPossessionId || 1;
                                const possTeam = currentPossessionTeamSide || 'unknown';
                                const nextPlayId = playCounter + 1;
                                createStatMutation.mutate({
                                    match_id: matchId,
                                    stat_type: 'period_end',
                                    is_pass: false,
                                    half,
                                    timestamp: new Date().toISOString(),
                                    play_id: nextPlayId,
                                    possession_id: possId,
                                    possession_team_side: possTeam,
                                    team_side: 'unknown',
                                    counter_attack: false,
                                    extra_data: JSON.stringify({ period: half }),
                                });
                                setPlayCounter(nextPlayId);
                                const prevDir = getDirForHalf(half);
                                const nextDir = prevDir === 'left' ? 'right' : 'left';
                                await persistDirectionByPeriod({ ...(directionByPeriod || {}), [nextHalf]: nextDir });
                                setHalf(nextHalf);
                                setEndPeriodPrompt({ open: false, nextHalf: null });
                            }}
                        >
                            Flip direction
                        </AlertDialogAction>
                        <AlertDialogAction
                            className="bg-slate-900 hover:bg-slate-800"
                            onClick={async () => {
                                const nextHalf = endPeriodPrompt.nextHalf;
                                if (!nextHalf) return;
                                const possId = currentPossessionId || 1;
                                const possTeam = currentPossessionTeamSide || 'unknown';
                                const nextPlayId = playCounter + 1;
                                createStatMutation.mutate({
                                    match_id: matchId,
                                    stat_type: 'period_end',
                                    is_pass: false,
                                    half,
                                    timestamp: new Date().toISOString(),
                                    play_id: nextPlayId,
                                    possession_id: possId,
                                    possession_team_side: possTeam,
                                    team_side: 'unknown',
                                    counter_attack: false,
                                    extra_data: JSON.stringify({ period: half }),
                                });
                                setPlayCounter(nextPlayId);
                                const prevDir = getDirForHalf(half);
                                await persistDirectionByPeriod({ ...(directionByPeriod || {}), [nextHalf]: prevDir });
                                setHalf(nextHalf);
                                setEndPeriodPrompt({ open: false, nextHalf: null });
                            }}
                        >
                            Keep direction
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
