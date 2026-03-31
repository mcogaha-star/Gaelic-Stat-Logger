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
import { toast } from 'sonner';

import GAAPitch from '@/components/pitch/GAAPitch';
import StatMarkers from '@/components/pitch/StatMarkers';
import MatchHeader from '@/components/match/MatchHeader';
import RecentStats from '@/components/match/RecentStats';
import { DEFAULT_CLICK_STATS, DEFAULT_DRAG_STATS, DEFAULT_DEFAULTS, DEFAULT_CUSTOM_FIELDS } from '@/components/statDefaults';
import { ensureServerMatch, insertServerStat, softDeleteServerStat, updateServerStat } from '@/lib/serverSync';
import { eventMatchesShortcut, isTypingTarget, parseShortcutConfig } from '@/lib/shortcuts';
import MatchStatsToolbar from '@/features/match-stats/components/MatchStatsToolbar';
import MatchStatsDialogs from '@/features/match-stats/components/MatchStatsDialogs';
import useMatchVideoControls from '@/features/match-stats/hooks/useMatchVideoControls';
import useHalfManagement from '@/features/match-stats/hooks/useHalfManagement';
import useStatLogging from '@/features/match-stats/hooks/useStatLogging';

const VIDEO_CHANNEL = 'gstl_video';

function safeParseJSON(s, fallback) {
    try {
        const v = JSON.parse(s);
        return v && typeof v === 'object' ? v : fallback;
    } catch {
        return fallback;
    }
}

export default function MatchStats() {
    // With HashRouter, query params live in the hash segment, so use react-router's location.
    const location = useLocation();
    const urlParams = new URLSearchParams(location.search);
    const matchId = urlParams.get('id');
    const debugPitch = urlParams.get('debug') === '1';

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
    const shortcutConfig = useMemo(() => parseShortcutConfig(settingsRecord?.keyboard_shortcuts_config), [settingsRecord?.keyboard_shortcuts_config]);

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

    const [subDialogOpen, setSubDialogOpen] = useState(false);
    const [subOut, setSubOut] = useState('');
    const [subIn, setSubIn] = useState('');

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
    const previousStat = useMemo(() => {
        const ordered = [...(stats || [])]
            .filter((s) => s?.stat_type !== 'substitution')
            .sort((a, b) => String(b?.timestamp || b?.created_date || '').localeCompare(String(a?.timestamp || a?.created_date || '')));
        return ordered[0] || null;
    }, [stats]);

    const halfStartByHalf = useMemo(() => {
        return safeParseJSON(match?.video_half_start_time_s || '{}', {});
    }, [match?.video_half_start_time_s]);

    const {
        half,
        setHalf,
        directionByPeriod,
        halfPrompt,
        setHalfPrompt,
        endPeriodPrompt,
        setEndPeriodPrompt,
        nextHalfReminder,
        setNextHalfReminder,
        getDirForHalf,
        persistDirectionByPeriod,
        flipDirectionForHalf,
        requestHalfChange,
        openEndHalfPrompt,
        remindNextHalfStart,
    } = useHalfManagement({ db, match, halfStartByHalf, initialHalf: appDefaults.half || 'first' });

    const {
        currentVideoTimeS,
        videoReady,
        videoPlaying,
        halfStartTimeS,
        openVideoPopout,
        sendVideoCommand,
        setHalfStartFromVideo,
        setHalfStartFromVideoFor,
    } = useMatchVideoControls({ db, matchId, match, half, halfStartByHalf, queryClient });

    const {
        modalOpen,
        isPassModal,
        clickCoords,
        passEndCoords,
        editingStat,
        setEditingStat,
        setIsPassModal,
        setClickCoords,
        setPassEndCoords,
        lastReceiver,
        setLastReceiver,
        playCounter,
        setPlayCounter,
        possessionCounter,
        setPossessionCounter,
        currentPossessionId,
        setCurrentPossessionId,
        currentPossessionTeamSide,
        setCurrentPossessionTeamSide,
        pendingNextPossessionTeamSide,
        setPendingNextPossessionTeamSide,
        handlePointClick,
        handlePassDraw,
        openEditStat,
        closeModal,
    } = useStatLogging({ matchId, stats });

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
                    time_s: updated.time_s ?? null,
                    normalized_time_s: updated.normalized_time_s ?? null,
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

    useEffect(() => {
        const onKeyDown = (e) => {
            if (isTypingTarget(e.target)) return;

            const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z');
            if (isUndo) {
                e.preventDefault();
                handleUndoLast();
                return;
            }

            for (const [command, shortcut] of Object.entries(shortcutConfig?.video || {})) {
                if (!eventMatchesShortcut(e, shortcut)) continue;
                e.preventDefault();
                sendVideoCommand(command);
                return;
            }
        };

        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [stats, shortcutConfig, matchId]);

    const snapKickoutOrigin = (coords) => {
        // Snap to nearest 20m line midpoint in the 145x85 plane: (20, 42.5) or (125, 42.5)
        const midY = 85 / 2;
        const left = { x: 20, y: midY };
        const right = { x: 145 - 20, y: midY };
        const leftDist = Math.sqrt(Math.pow(coords.x - left.x, 2) + Math.pow(coords.y - left.y, 2));
        const rightDist = Math.sqrt(Math.pow(coords.x - right.x, 2) + Math.pow(coords.y - right.y, 2));
        return leftDist < rightDist ? left : right;
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

    const defaultCounterAttack = useMemo(() => {
        if (pendingNextPossessionTeamSide) return false;
        if (!currentPossessionId || !['home', 'away'].includes(currentPossessionTeamSide)) return false;

        const currentPossessionStats = (stats || [])
            .filter((s) =>
                Number(s?.possession_id) === Number(currentPossessionId)
                && s?.possession_team_side === currentPossessionTeamSide
                && s?.stat_type !== 'kickout'
                && s?.stat_type !== 'period_end'
                && s?.stat_type !== 'substitution'
                && typeof s?.counter_attack === 'boolean'
            )
            .sort((a, b) => {
                const playDiff = Number(b?.play_id || 0) - Number(a?.play_id || 0);
                if (playDiff) return playDiff;
                return String(b?.timestamp || '').localeCompare(String(a?.timestamp || ''));
            });

        if (!currentPossessionStats.length) return false;
        return !!currentPossessionStats[0].counter_attack;
    }, [stats, currentPossessionId, currentPossessionTeamSide, pendingNextPossessionTeamSide]);

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
            time_s: payload.time_s ?? null,
            normalized_time_s: payload.normalized_time_s ?? null,
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
        const isKickout = payload?.stat_type === 'kickout';
        const rawStart = isKickout ? snapKickoutOriginRaw(teamSide) : rawStartBase;
        // Kickout start is snapped to origin; keep the user's click as the end point.
        const rawEnd = isKickout ? rawStartBase : rawEndBase;

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

            time_s: payload.time_s ?? null,
            normalized_time_s: payload.normalized_time_s ?? null,

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

    const handleEditStat = (stat) => openEditStat(stat);

    const logSubstitution = async () => {
        const outP = allPlayers.find((p) => p.id === subOut);
        const inP = allPlayers.find((p) => p.id === subIn);
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
        } catch {
            // ignore
        }

        setSubDialogOpen(false);
        setSubOut('');
        setSubIn('');
    };

    const handleEndPeriodChoice = async (shouldFlipDirection) => {
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
        const nextDir = shouldFlipDirection ? (prevDir === 'left' ? 'right' : 'left') : prevDir;
        await persistDirectionByPeriod({ ...(directionByPeriod || {}), [nextHalf]: nextDir });
        setHalf(nextHalf);
        remindNextHalfStart(nextHalf);
        setEndPeriodPrompt({ open: false, nextHalf: null });
    };

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
                seasonStatsUrl={createPageUrl(`SeasonStats?matchId=${matchId}`)}
                settingsUrl={createPageUrl('Settings')}
            />

            <div className="max-w-7xl mx-auto px-4 pt-1 pb-5">
                <div className="grid lg:grid-cols-3 gap-5">
                    <div className="lg:col-span-2">
                        <MatchStatsToolbar
                            half={half}
                            getDirForHalf={getDirForHalf}
                            setHalfStartFromVideo={setHalfStartFromVideo}
                            videoReady={videoReady}
                            flipDirectionForHalf={flipDirectionForHalf}
                            openEndHalfPrompt={openEndHalfPrompt}
                            onOpenSubDialog={() => setSubDialogOpen(true)}
                            handleUndoLast={handleUndoLast}
                            statsCount={stats.length}
                            openVideoPopout={openVideoPopout}
                        />
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
                            onEdit={handleEditStat}
                            onDelete={(id) => deleteStatMutation.mutate(id)}
                            onExport={exportToCSV}
                        />
                    </div>
                </div>
            </div>

            <MatchStatsDialogs
                modalProps={{
                    modalOpen,
                    closeModal,
                    handleStatSubmit,
                    isPassModal,
                    clickCoords,
                    passEndCoords,
                    currentVideoTimeS,
                    halfStartTimeS,
                    homePlayers,
                    awayPlayers,
                    homeOnField,
                    awayOnField,
                    homeTeamColor: homeTeam?.color || '#22c55e',
                    awayTeamColor: awayTeam?.color || '#ef4444',
                    lastReceiver,
                    editingStat,
                    previousStat,
                    customFields,
                    shortcutConfig,
                    defaultCounterAttack,
                }}
                halfPromptProps={{
                    halfPrompt,
                    setHalfPrompt,
                    getDirForHalf,
                    half,
                    directionByPeriod,
                    persistDirectionByPeriod,
                    setHalf,
                }}
                subDialogProps={{
                    subDialogOpen,
                    setSubDialogOpen,
                    subOut,
                    setSubOut,
                    subIn,
                    setSubIn,
                    allPlayers,
                    logSubstitution,
                }}
                endPeriodPromptProps={{
                    endPeriodPrompt,
                    setEndPeriodPrompt,
                    handleEndPeriodChoice,
                }}
                nextHalfReminderProps={{
                    nextHalfReminder,
                    setNextHalfReminder,
                    setHalfStartFromVideoFor,
                }}
            />
        </div>
    );
}
