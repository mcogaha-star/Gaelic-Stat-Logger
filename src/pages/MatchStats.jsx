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
import { buildLegacyPossessionRepairs, buildLegacyDefenceSetRepairs, buildLegacyDefensiveContactDeletes, buildStatModelRepairs, normalizeDefenceSetRows, normalizeStatModelRows, rebuildPossessionRows, sequencePossessionRows, deriveMatchLengthMinutes, isBroughtBackAdvantageStat, POSSESSION_REBUILD_VERSION, DEFENCE_SET_MIGRATION_VERSION, STAT_MODEL_MIGRATION_VERSION } from '@/lib/reportAnalytics';
import { parseLiveModeSettings } from '@/lib/liveModeSettings';
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

function formatLiveClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
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

    useEffect(() => {
        if (!match?.id) return;
        const expected = deriveMatchLengthMinutes(match);
        if (Number(match.match_length_minutes) === expected) return;
        db.entities.Match.update(match.id, { match_length_minutes: expected })
            .then(() => queryClient.invalidateQueries({ queryKey: ['match', matchId] }))
            .catch(() => {});
    }, [match?.id, match?.code, match?.level, match?.match_length_minutes, matchId, queryClient]);

    const { data: teams = [] } = useQuery({
        queryKey: ['teams'],
        queryFn: () => db.entities.Team.list('name')
    });

    const { data: allPlayers = [] } = useQuery({
        queryKey: ['players'],
        queryFn: () => db.entities.Player.list('number')
    });

    const { data: rawStats = [] } = useQuery({
        queryKey: ['stats', matchId],
        queryFn: () => db.entities.StatEntry.filter({ match_id: matchId }),
        enabled: !!matchId
    });

    const defenceSetMigrationKey = matchId ? `gstl-defence-set:${DEFENCE_SET_MIGRATION_VERSION}:${matchId}` : null;
    const readDefenceSetMigrationDone = (key) => {
        try {
            return !!key && localStorage.getItem(key) === 'done';
        } catch {
            return false;
        }
    };
    const [defenceSetMigrationDone, setDefenceSetMigrationDone] = useState(() => readDefenceSetMigrationDone(defenceSetMigrationKey));
    useEffect(() => {
        setDefenceSetMigrationDone(readDefenceSetMigrationDone(defenceSetMigrationKey));
    }, [defenceSetMigrationKey]);
    const statModelMigrationKey = matchId ? `gstl-stat-model:${STAT_MODEL_MIGRATION_VERSION}:${matchId}` : null;
    const readStatModelMigrationDone = (key) => {
        try {
            return !!key && localStorage.getItem(key) === 'done';
        } catch {
            return false;
        }
    };
    const [statModelMigrationDone, setStatModelMigrationDone] = useState(() => readStatModelMigrationDone(statModelMigrationKey));
    useEffect(() => {
        setStatModelMigrationDone(readStatModelMigrationDone(statModelMigrationKey));
    }, [statModelMigrationKey]);
    const stats = useMemo(
        () => rebuildPossessionRows(normalizeStatModelRows(normalizeDefenceSetRows((rawStats || []).filter((s) => s?.stat_type !== 'defensive_contact'), defenceSetMigrationDone), statModelMigrationDone)),
        [rawStats, defenceSetMigrationDone, statModelMigrationDone]
    );

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
    const liveModeSettings = useMemo(() => parseLiveModeSettings(settingsRecord?.live_mode_settings_config), [settingsRecord?.live_mode_settings_config]);
    const isLiveMode = String(match?.mode || 'analysis') === 'live';

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
    const [subTemporary, setSubTemporary] = useState(false);
    const [lastDefenceSetByPossession, setLastDefenceSetByPossession] = useState(null);
    const [liveClockSecondsByHalf, setLiveClockSecondsByHalf] = useState({});
    const [liveClockRunning, setLiveClockRunning] = useState(false);

    // Match teams + players
    const homeTeam = teams.find(t => t.id === match?.home_team_id);
    const awayTeam = teams.find(t => t.id === match?.away_team_id);
    const parseIds = (s) => {
        if (!s || typeof s !== 'string') return [];
        try { const arr = JSON.parse(s); return Array.isArray(arr) ? arr.filter(Boolean) : []; } catch { return []; }
    };
    const orderByTeamSheet = (players, startersIds, subsIds, onFieldIds) => {
        const onFieldSet = new Set(onFieldIds || []);
        const byId = new Map((players || []).map((p) => [p.id, p]));

        const ordered = [];
        const seen = new Set();
        const pushId = (id) => {
            const player = byId.get(id);
            if (!player || seen.has(id)) return;
            ordered.push(player);
            seen.add(id);
        };

        (onFieldIds || []).forEach(pushId);
        (startersIds || []).forEach(pushId);
        (subsIds || []).forEach(pushId);

        const remaining = (players || [])
            .filter((p) => !seen.has(p.id))
            .sort((a, b) => {
                const aOn = onFieldSet.has(a.id) ? 0 : 1;
                const bOn = onFieldSet.has(b.id) ? 0 : 1;
                if (aOn !== bOn) return aOn - bOn;
                return Number(a.number || 0) - Number(b.number || 0);
            });

        return ordered.concat(remaining);
    };
    const parseTeamSheetIds = (s) => {
        if (!s || typeof s !== 'string') return [];
        try {
            const arr = JSON.parse(s);
            return Array.isArray(arr) ? arr.filter(Boolean) : [];
        } catch {
            return [];
        }
    };
    const homeStarters = parseTeamSheetIds(homeTeam?.starters);
    const homeSubs = parseTeamSheetIds(homeTeam?.subs);
    const awayStarters = parseTeamSheetIds(awayTeam?.starters);
    const awaySubs = parseTeamSheetIds(awayTeam?.subs);
    const substitutionStats = (stats || []).filter((s) => s?.stat_type === 'substitution');
    const hasMatchSubs = substitutionStats.length > 0;
    const homeOnField = hasMatchSubs
        ? (parseIds(match?.home_on_field).length ? parseIds(match?.home_on_field) : homeStarters.slice(0, 15))
        : homeStarters.slice(0, 15);
    const awayOnField = hasMatchSubs
        ? (parseIds(match?.away_on_field).length ? parseIds(match?.away_on_field) : awayStarters.slice(0, 15))
        : awayStarters.slice(0, 15);
    const homePlayers = homeTeam ? orderByTeamSheet(allPlayers.filter(p => p.team_id === homeTeam.id), homeStarters, homeSubs, homeOnField) : [];
    const awayPlayers = awayTeam ? orderByTeamSheet(allPlayers.filter(p => p.team_id === awayTeam.id), awayStarters, awaySubs, awayOnField) : [];
    const previousStat = useMemo(() => {
        const ordered = [...(stats || [])]
            .filter((s) => s?.stat_type !== 'substitution' && s?.stat_type !== 'period_end')
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

    const liveClockStorageKey = matchId ? `gstl-live-clock:${matchId}` : null;
    useEffect(() => {
        if (!liveClockStorageKey) return;
        try {
            const saved = JSON.parse(localStorage.getItem(liveClockStorageKey) || '{}');
            if (saved && typeof saved === 'object') setLiveClockSecondsByHalf(saved);
        } catch {
            setLiveClockSecondsByHalf({});
        }
    }, [liveClockStorageKey]);

    useEffect(() => {
        if (!liveClockStorageKey) return;
        try {
            localStorage.setItem(liveClockStorageKey, JSON.stringify(liveClockSecondsByHalf || {}));
        } catch {
            // ignore
        }
    }, [liveClockStorageKey, liveClockSecondsByHalf]);

    const liveClockSeconds = Number(liveClockSecondsByHalf?.[half] || 0);
    useEffect(() => {
        if (!liveClockRunning) return undefined;
        const id = window.setInterval(() => {
            setLiveClockSecondsByHalf((prev) => {
                const base = Number(prev?.[half] || 0);
                return { ...(prev || {}), [half]: base + 1 };
            });
        }, 1000);
        return () => window.clearInterval(id);
    }, [liveClockRunning, half]);

    const {
        currentVideoTimeS,
        videoReady,
        videoPlaying,
        halfStartTimeS,
        openVideoPopout,
        sendVideoCommand,
        setHalfStartFromVideo,
        setHalfStartFromVideoFor,
    } = useMatchVideoControls({ db, matchId, match, half, halfStartByHalf, stats, queryClient });

    const {
        modalOpen,
        setModalOpen,
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
        if (!match.public_match_id) return null;

        const res = await ensureServerMatch({
            publicMatchId: match.public_match_id,
            matchDate: match.date,
            code: match.code || 'GAA',
            level: match.level || 'Other',
            mode: match.mode || 'analysis',
            matchLengthMinutes: match.match_length_minutes,
        });
        if (match.server_match_id) return match.server_match_id;
        if (res.ok && res.id) {
            await db.entities.Match.update(match.id, { server_match_id: res.id });
            return res.id;
        }
        return null;
    };

    const createStatMutation = useMutation({
        mutationFn: async (data) => {
            const created = await db.entities.StatEntry.create(data);

            try {
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
            } catch (error) {
                console.warn('Server stat sync failed after local create', error);
            }

            return created;
        },
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['stats', matchId] }); toast.success('Stat logged'); }
    });

    const updateStatMutation = useMutation({
        mutationFn: async ({ id, data }) => {
            const updated = await db.entities.StatEntry.update(id, data);
            if (updated?.server_stat_id) {
                try {
                    await updateServerStat(updated.server_stat_id, {
                        stat_type: updated.stat_type,
                        is_pass: !!updated.is_pass,
                        team_side: updated.team_side || 'unknown',
                        counter_attack: !!updated.counter_attack,
                        set_defence: !!updated.counter_attack,
                        defence_set_migration_version: DEFENCE_SET_MIGRATION_VERSION,
                        time_s: updated.time_s ?? null,
                        normalized_time_s: updated.normalized_time_s ?? null,
                        player_number: updated.player_number ?? null,
                        recipient_number: updated.recipient_number ?? null,
                        extra_data: updated.extra_data ?? null,
                    });
                } catch (error) {
                    console.warn('Server stat sync failed after local update', error);
                }
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

    const [repairingLegacyPossessions, setRepairingLegacyPossessions] = useState(false);
    const [migratingDefenceSet, setMigratingDefenceSet] = useState(false);
    const [migratingStatModel, setMigratingStatModel] = useState(false);
    const [deletingLegacyDefContact, setDeletingLegacyDefContact] = useState(false);

    useEffect(() => {
        if (!matchId || !Array.isArray(rawStats) || !rawStats.length || deletingLegacyDefContact) return;
        const deletes = buildLegacyDefensiveContactDeletes(rawStats).filter((row) => row?.id);
        if (!deletes.length) return;
        let cancelled = false;
        (async () => {
            try {
                setDeletingLegacyDefContact(true);
                for (const row of deletes) {
                    if (cancelled) return;
                    await db.entities.StatEntry.delete(row.id);
                    if (row.server_stat_id) {
                        try { await softDeleteServerStat(row.server_stat_id); } catch {}
                    }
                }
                if (!cancelled) {
                    await queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
                    await queryClient.refetchQueries({ queryKey: ['stats', matchId], type: 'active' });
                    toast.success(`Deleted ${deletes.length} legacy defensive-contact row${deletes.length === 1 ? '' : 's'}`);
                }
            } catch (error) {
                if (!cancelled) toast.error(error?.message || 'Failed to delete defensive-contact rows');
            } finally {
                if (!cancelled) setDeletingLegacyDefContact(false);
            }
        })();
        return () => { cancelled = true; };
    }, [matchId, rawStats, deletingLegacyDefContact, queryClient]);

    useEffect(() => {
        if (!matchId || !Array.isArray(rawStats) || !rawStats.length || migratingStatModel) return;
        if (!statModelMigrationKey) return;
        const repairs = buildStatModelRepairs(rawStats);
        if (!repairs.length) {
            try { localStorage.setItem(statModelMigrationKey, 'done'); } catch {}
            setStatModelMigrationDone(true);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                setMigratingStatModel(true);
                for (const repair of repairs) {
                    if (cancelled) return;
                    const current = rawStats.find((s) => s.id === repair.id);
                    await db.entities.StatEntry.update(repair.id, repair.data);
                    if (current?.server_stat_id) {
                        await updateServerStat(current.server_stat_id, repair.data);
                    }
                }
                if (!cancelled) {
                    await queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
                    await queryClient.refetchQueries({ queryKey: ['stats', matchId], type: 'active' });
                    try { localStorage.setItem(statModelMigrationKey, 'done'); } catch {}
                    setStatModelMigrationDone(true);
                    toast.success(`Updated ${repairs.length} stat model row${repairs.length === 1 ? '' : 's'}`);
                }
            } catch (error) {
                if (!cancelled) toast.error(error?.message || 'Failed to update stat model rows');
            } finally {
                if (!cancelled) setMigratingStatModel(false);
            }
        })();
        return () => { cancelled = true; };
    }, [matchId, rawStats, migratingStatModel, queryClient, statModelMigrationKey]);

    useEffect(() => {
        if (!matchId || !Array.isArray(rawStats) || !rawStats.length || migratingDefenceSet) return;
        if (!defenceSetMigrationKey) return;
        const repairs = buildLegacyDefenceSetRepairs(rawStats);
        if (!repairs.length) {
            try { localStorage.setItem(defenceSetMigrationKey, 'done'); } catch {}
            setDefenceSetMigrationDone(true);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                setMigratingDefenceSet(true);
                for (const repair of repairs) {
                    if (cancelled) return;
                    const current = rawStats.find((s) => s.id === repair.id);
                    await db.entities.StatEntry.update(repair.id, repair.data);
                    if (current?.server_stat_id) {
                        await updateServerStat(current.server_stat_id, repair.data);
                    }
                }
                if (!cancelled) {
                    await queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
                    await queryClient.refetchQueries({ queryKey: ['stats', matchId], type: 'active' });
                    try { localStorage.setItem(defenceSetMigrationKey, 'done'); } catch {}
                    setDefenceSetMigrationDone(true);
                    toast.success(`Updated ${repairs.length} legacy defence-set row${repairs.length === 1 ? '' : 's'}`);
                }
            } catch (error) {
                if (!cancelled) toast.error(error?.message || 'Failed to migrate defence set rows');
            } finally {
                if (!cancelled) setMigratingDefenceSet(false);
            }
        })();
        return () => { cancelled = true; };
    }, [matchId, rawStats, migratingDefenceSet, queryClient, defenceSetMigrationKey]);

    useEffect(() => {
        if (!matchId || !Array.isArray(rawStats) || !rawStats.length || repairingLegacyPossessions) return;
        const rebuildKey = `gstl-possession-rebuild:${POSSESSION_REBUILD_VERSION}:${matchId}`;
        const repairs = buildLegacyPossessionRepairs(rawStats);
        if (!repairs.length) {
            try { localStorage.setItem(rebuildKey, 'done'); } catch {}
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                setRepairingLegacyPossessions(true);
                for (const repair of repairs) {
                    if (cancelled) return;
                    const current = rawStats.find((s) => s.id === repair.id);
                    await db.entities.StatEntry.update(repair.id, repair.data);
                    if (current?.server_stat_id) {
                        await updateServerStat(current.server_stat_id, repair.data);
                    }
                }
                if (!cancelled) {
                    await queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
                    await queryClient.refetchQueries({ queryKey: ['stats', matchId], type: 'active' });
                    try { localStorage.setItem(rebuildKey, 'done'); } catch {}
                    toast.success(`Repaired ${repairs.length} legacy possession row${repairs.length === 1 ? '' : 's'}`);
                }
            } catch (error) {
                if (!cancelled) {
                    toast.error(error?.message || 'Failed to repair legacy possession rows');
                }
            } finally {
                if (!cancelled) setRepairingLegacyPossessions(false);
            }
        })();

        return () => { cancelled = true; };
    }, [matchId, rawStats, repairingLegacyPossessions, queryClient]);

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

            if (!isLiveMode) {
                for (const [command, shortcut] of Object.entries(shortcutConfig?.video || {})) {
                    if (!eventMatchesShortcut(e, shortcut)) continue;
                    e.preventDefault();
                    sendVideoCommand(command);
                    return;
                }
            }
        };

        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [stats, shortcutConfig, matchId, isLiveMode]);

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

    const updateLastReceiverFrom = ({ stat_type, extra }) => {
        if (stat_type === 'pass') {
            if (extra?.pass?.outcome === 'turnover' && extra?.turnover?.recovered_by?.kind === 'player') return extra.turnover.recovered_by;
            if (extra?.pass?.won_by?.kind === 'player') return extra.pass.won_by;
            if (extra?.pass?.outcome === 'completed' && extra?.pass?.intended_recipient?.kind === 'player') return extra.pass.intended_recipient;
        }
        if (stat_type === 'carry') {
            if (extra?.carry?.outcome === 'turnover' && extra?.turnover?.recovered_by?.kind === 'player') return extra.turnover.recovered_by;
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
        if (stat_type === 'shot') {
            const outcome = String(extra?.shot?.outcome || '');
            const result = String(extra?.shot?.result || '');
            if (['short', 'post', 'saved', 'blocked'].includes(outcome)
                && ['retained', 'opposition'].includes(result)
                && extra?.shot?.recovered_by?.kind === 'player') {
                return extra.shot.recovered_by;
            }
        }
        return null;
    };

    const defaultCounterAttack = useMemo(() => {
        const targetPossessionId = pendingNextPossessionTeamSide
            ? Number(currentPossessionId || 0) + 1
            : Number(currentPossessionId || 0);
        const targetPossessionTeamSide = pendingNextPossessionTeamSide || currentPossessionTeamSide;

        if (!targetPossessionId || !['home', 'away'].includes(targetPossessionTeamSide)) return true;

        if (
            Number(lastDefenceSetByPossession?.possessionId) === targetPossessionId
            && lastDefenceSetByPossession?.teamSide === targetPossessionTeamSide
            && typeof lastDefenceSetByPossession?.value === 'boolean'
        ) {
            return lastDefenceSetByPossession.value;
        }

        const targetPossessionStats = (stats || [])
            .filter((s) =>
                Number(s?.possession_id) === targetPossessionId
                && s?.possession_team_side === targetPossessionTeamSide
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

        if (!targetPossessionStats.length) return true;
        return !!targetPossessionStats[0].counter_attack;
    }, [stats, currentPossessionId, currentPossessionTeamSide, pendingNextPossessionTeamSide, lastDefenceSetByPossession]);

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
                    set_defence: !!payload.counter_attack,
                    defence_set_migration_version: DEFENCE_SET_MIGRATION_VERSION,
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

        const nextPlayId = playCounter + 1;

        const extra = { ...(payload.extra || {}), pitch: { w: PITCH_W, h: PITCH_H } };

        const primary = payload.primary_player;
        const recipientSel =
            payload.stat_type === 'pass' ? payload.extra?.pass?.intended_recipient
                : (payload.stat_type === 'kickout' ? payload.extra?.kickout?.intended_recipient : null);

        const draftId = `draft:${nextPlayId}:${Date.now()}`;
        const draftStat = {
            id: draftId,
            match_id: matchId,
            stat_type: payload.stat_type,
            is_pass: !!payload.is_pass,
            half,
            timestamp: new Date().toISOString(),

            play_id: nextPlayId,
            possession_id: currentPossessionId || 0,
            possession_team_side: currentPossessionTeamSide || 'unknown',
            team_side: teamSide,
            counter_attack: !!payload.counter_attack,
            set_defence: !!payload.counter_attack,
            defence_set_migration_version: DEFENCE_SET_MIGRATION_VERSION,

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

        const sequenced = sequencePossessionRows([...(stats || []), draftStat]);
        const sequencedDraft = sequenced.find((row) => row?.id === draftId) || draftStat;
        const nextPossessionCounter = sequenced.reduce((max, row) => {
            const pid = Number(row?.possession_id);
            return Number.isFinite(pid) ? Math.max(max, pid) : max;
        }, 0);

        const statData = {
            ...draftStat,
            team_side: sequencedDraft.team_side || draftStat.team_side,
            possession_id: Number.isFinite(Number(sequencedDraft.possession_id)) ? Number(sequencedDraft.possession_id) : draftStat.possession_id,
            possession_team_side: sequencedDraft.possession_team_side || draftStat.possession_team_side,
            extra_data: sequencedDraft.extra_data || draftStat.extra_data,
        };
        delete statData.id;

        setModalOpen(false);
        setClickCoords(null);
        setPassEndCoords(null);
        setEditingStat(null);

        createStatMutation.mutate(statData);

        setPlayCounter(nextPlayId);
        setPossessionCounter(nextPossessionCounter);
        setCurrentPossessionId(statData.possession_id);
        setCurrentPossessionTeamSide(statData.possession_team_side);
        setLastDefenceSetByPossession({
            possessionId: Number(statData.possession_id || 0),
            teamSide: statData.possession_team_side || 'unknown',
            value: !!payload.counter_attack,
        });
        const statForProbe = { ...statData, id: draftId };
        const nextProbe = {
            id: `probe:${nextPlayId + 1}:${Date.now()}`,
            match_id: matchId,
            stat_type: 'probe',
            is_pass: false,
            half,
            timestamp: new Date().toISOString(),
            play_id: nextPlayId + 1,
            possession_id: statData.possession_id,
            possession_team_side: statData.possession_team_side,
            team_side: 'unknown',
            counter_attack: true,
            set_defence: true,
            defence_set_migration_version: DEFENCE_SET_MIGRATION_VERSION,
            raw_x_position: null,
            raw_y_position: null,
            raw_end_x_position: null,
            raw_end_y_position: null,
            x_position: null,
            y_position: null,
            end_x_position: null,
            end_y_position: null,
            time_s: null,
            normalized_time_s: null,
            player_name: null,
            player_number: null,
            recipient_name: null,
            recipient_number: null,
            extra_data: '{}',
        };
        const probeSequenced = sequencePossessionRows([...(stats || []), statForProbe, nextProbe]);
        const sequencedProbe = probeSequenced.find((row) => row?.id === nextProbe.id);
        const pendingTeam = (sequencedProbe?.possession_team_side === 'home' || sequencedProbe?.possession_team_side === 'away')
            && (
                Number(sequencedProbe?.possession_id) !== Number(statData.possession_id)
                || sequencedProbe?.possession_team_side !== statData.possession_team_side
            )
            ? sequencedProbe.possession_team_side
            : null;
        setPendingNextPossessionTeamSide(pendingTeam);

        const lr = updateLastReceiverFrom({ stat_type: payload.stat_type, extra });
        setLastReceiver(lr || null);

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
            'Play ID','Possession ID','Possession Team','Acting Team','Set Defence',
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
            if (isBroughtBackAdvantageStat(s)) continue;
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
        const nextPlayId = playCounter + 1;
        const extra = {
            sub_out_id: subOut,
            sub_in_id: subIn,
            temporary: liveModeSettings?.showTemporarySub === false ? false : !!subTemporary,
        };
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
            possession_id: 0,
            possession_team_side: 'unknown',
            team_side: outSide,
            counter_attack: false,
            set_defence: false,
            defence_set_migration_version: DEFENCE_SET_MIGRATION_VERSION,
            time_s: null,
            normalized_time_s: isLiveMode ? liveClockSeconds : null,
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
        setSubTemporary(false);
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
            set_defence: false,
            defence_set_migration_version: DEFENCE_SET_MIGRATION_VERSION,
            time_s: null,
            normalized_time_s: isLiveMode ? liveClockSeconds : null,
            extra_data: JSON.stringify({ period: half }),
        });
        setPlayCounter(nextPlayId);
        const prevDir = getDirForHalf(half);
        const nextDir = shouldFlipDirection ? (prevDir === 'left' ? 'right' : 'left') : prevDir;
        await persistDirectionByPeriod({ ...(directionByPeriod || {}), [nextHalf]: nextDir });
        setHalf(nextHalf);
        setLiveClockRunning(false);
        if (!isLiveMode) remindNextHalfStart(nextHalf);
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
                            isLiveMode={isLiveMode}
                        />
                        <div className="bg-slate-900 rounded-2xl p-1 shadow-xl relative overflow-hidden ml-2 mt-0.5">
                            <GAAPitch
                                onPointClick={handlePointClick}
                                onPassDraw={isLiveMode ? undefined : handlePassDraw}
                                disableDrag={isLiveMode}
                                debug={debugPitch}
                            />
                            <StatMarkers stats={stats} clickStats={clickStats} />
                        </div>
                        <p className="text-center text-sm text-slate-500 mt-2">
                            {isLiveMode ? 'Click the pitch location to open the normal stat modal. Dragging is disabled in live mode.' : 'Click to log a stat. Click and drag to log a pass / carry.'}
                        </p>
                    </div>

                    <div className="space-y-6">
                        {isLiveMode && (
                            <div className="rounded-xl border bg-white p-4 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="font-semibold text-slate-900">Live Clock</div>
                                        <div className="text-xs text-slate-500">
                                            Click the pitch to open the logger.
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-mono text-2xl font-bold">{formatLiveClock(liveClockSeconds)}</div>
                                        <div className="text-xs text-slate-500">{half.replace('_', ' ')}</div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <Button type="button" onClick={() => setLiveClockRunning((v) => !v)}>{liveClockRunning ? 'Pause' : 'Start'}</Button>
                                    <Button type="button" variant="outline" onClick={() => setLiveClockSecondsByHalf((prev) => ({ ...(prev || {}), [half]: 0 }))}>Reset</Button>
                                </div>
                            </div>
                        )}
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
                    homeAttacksRight: getDirForHalf(half) !== 'left',
                    liveMode: isLiveMode,
                    liveClockSeconds,
                    liveModeSettings,
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
                    subTemporary,
                    setSubTemporary,
                    liveModeSettings,
                    allPlayers,
                    homePlayers,
                    awayPlayers,
                    homeTeamName: homeTeam?.name || 'Home',
                    awayTeamName: awayTeam?.name || 'Away',
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
