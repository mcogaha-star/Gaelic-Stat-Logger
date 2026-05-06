const db = globalThis.__B44_DB__ || {
  auth: { isAuthenticated: async () => false, me: async () => null },
  entities: new Proxy({}, { get: () => ({ filter: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
  integrations: { Core: { UploadFile: async () => ({ file_url: '' }) } }
};

import React, { useEffect, useState } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Calendar, MapPin, Trophy, ChevronRight, Activity, Users, Settings, Trash2, Info, BarChart3, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
    ensureServerMatch,
    fetchPrivatePlayers,
    fetchPrivateTeams,
    fetchServerMatches,
    fetchServerStatsForMatch,
    generatePublicMatchId,
    restoreExtraDataFromPrivateRefs,
    softDeleteServerMatch,
    upsertPrivatePlayerFromLocal,
    upsertPrivateTeamFromLocal,
} from '@/lib/serverSync';
import { fetchSharedMatchSnapshotByCode, importSharedMatchSnapshot } from '@/lib/sharedMatchCopies';
import { deriveMatchLengthMinutes, isBroughtBackAdvantageStat } from '@/lib/reportAnalytics';
import { useAuth } from '@/lib/AuthContext';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import halfPitchImg from '@/assets/halfpitch.png';

const WIND_DIRECTION_OPTIONS = Array.from({ length: 24 }, (_, index) => {
    const degrees = index * 15;
    return { value: String(degrees), label: `${degrees}°` };
});

function stringifyServerExtra(extraData) {
    if (!extraData) return '{}';
    if (typeof extraData === 'string') {
        try {
            const parsed = JSON.parse(extraData);
            return JSON.stringify(parsed || {});
        } catch {
            return '{}';
        }
    }
    if (typeof extraData === 'object') return JSON.stringify(extraData);
    return '{}';
}

function localStatFromServer(row, localMatchId, playerByServerId = new Map()) {
    const setDefence = typeof row?.set_defence === 'boolean' ? row.set_defence : !!row?.counter_attack;
    const player = row?.player_ref ? playerByServerId.get(row.player_ref) : null;
    const recipient = row?.recipient_ref ? playerByServerId.get(row.recipient_ref) : null;
    const restoredExtra = restoreExtraDataFromPrivateRefs(row?.extra_data, playerByServerId);
    return {
        match_id: localMatchId,
        server_stat_id: row?.id || null,
        stat_type: row?.stat_type || 'unknown',
        is_pass: !!row?.is_pass,
        half: row?.half || 'first',
        timestamp: row?.timestamp || new Date().toISOString(),
        play_id: row?.play_id ?? null,
        possession_id: row?.possession_id ?? null,
        possession_team_side: row?.possession_team_side ?? null,
        team_side: row?.team_side || 'unknown',
        counter_attack: setDefence,
        set_defence: setDefence,
        defence_set_migration_version: row?.defence_set_migration_version ?? null,
        stat_model_migration_version: row?.stat_model_migration_version ?? null,
        time_s: row?.time_s ?? null,
        normalized_time_s: row?.normalized_time_s ?? null,
        x_position: row?.x_position ?? null,
        y_position: row?.y_position ?? null,
        end_x_position: row?.end_x_position ?? null,
        end_y_position: row?.end_y_position ?? null,
        raw_x_position: row?.raw_x_position ?? null,
        raw_y_position: row?.raw_y_position ?? null,
        raw_end_x_position: row?.raw_end_x_position ?? null,
        raw_end_y_position: row?.raw_end_y_position ?? null,
        player_number: player?.number ?? row?.player_number ?? null,
        recipient_number: recipient?.number ?? row?.recipient_number ?? null,
        player_name: player?.name || null,
        recipient_name: recipient?.name || null,
        server_player_id: row?.player_ref || null,
        server_recipient_id: row?.recipient_ref || null,
        extra_data: stringifyServerExtra(restoredExtra),
    };
}

async function createImportedTeam(side, serverMatch) {
    const publicId = serverMatch?.public_match_id || String(serverMatch?.id || '').slice(0, 8) || 'match';
    const label = side === 'home' ? 'Home' : 'Away';
    return db.entities.Team.create({
        name: `Synced ${label} (${publicId})`,
        color: side === 'home' ? '#fb4b14' : '#5b1f2f',
        starters: '[]',
        subs: '[]',
        is_synced_placeholder: true,
    });
}

function sameText(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function buildImportedMatchSheet(players = []) {
    const ordered = (Array.isArray(players) ? players : [])
        .filter((player) => player?.id)
        .slice()
        .sort((a, b) => Number(a?.number || 0) - Number(b?.number || 0));
    const starters = ordered.slice(0, 15).map((player) => player.id);
    const starterSet = new Set(starters);
    const subs = ordered.filter((player) => !starterSet.has(player.id)).map((player) => player.id);
    return { starters, subs, on_field: starters.slice() };
}

function parseIdList(value) {
    if (!value || typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
        return [];
    }
}

async function hydratePrivateTeamsAndPlayers({ localTeams, localPlayers }) {
    const teamByServerId = new Map((localTeams || []).filter((t) => t?.server_team_id).map((t) => [t.server_team_id, t]));
    const playerByServerId = new Map((localPlayers || []).filter((p) => p?.server_player_id).map((p) => [p.server_player_id, p]));
    let importedTeams = 0;
    let importedPlayers = 0;

    const privateTeams = await fetchPrivateTeams({ limit: 1000 });
    if (privateTeams.ok) {
        for (const serverTeam of (privateTeams.teams || [])) {
            let local = serverTeam?.id ? teamByServerId.get(serverTeam.id) : null;
            if (!local) {
                local = (localTeams || []).find((team) => !team?.server_team_id && sameText(team?.name, serverTeam?.name));
            }
            const patch = {
                name: serverTeam?.name || local?.name || 'Synced Team',
                color: serverTeam?.color || local?.color || '#22c55e',
                starters: serverTeam?.starters || local?.starters || '[]',
                subs: serverTeam?.subs || local?.subs || '[]',
                server_team_id: serverTeam?.id || null,
                is_synced_placeholder: false,
            };
            if (local?.id) {
                await db.entities.Team.update(local.id, patch);
                local = { ...local, ...patch };
            } else {
                local = await db.entities.Team.create(patch);
                importedTeams += 1;
            }
            if (serverTeam?.id && local?.id) teamByServerId.set(serverTeam.id, local);
        }
    }

    const privatePlayers = await fetchPrivatePlayers({ limit: 5000 });
    if (privatePlayers.ok) {
        for (const serverPlayer of (privatePlayers.players || [])) {
            const localTeam = serverPlayer?.team_ref ? teamByServerId.get(serverPlayer.team_ref) : null;
            let local = serverPlayer?.id ? playerByServerId.get(serverPlayer.id) : null;
            if (!local && localTeam?.id) {
                local = (localPlayers || []).find((player) =>
                    !player?.server_player_id
                    && player.team_id === localTeam.id
                    && Number(player.number) === Number(serverPlayer.number)
                );
            }
            const patch = {
                name: serverPlayer?.name || local?.name || String(serverPlayer?.number || ''),
                number: Number.isFinite(Number(serverPlayer?.number)) ? Number(serverPlayer.number) : local?.number,
                position: serverPlayer?.position || local?.position || '',
                team_id: localTeam?.id || local?.team_id || null,
                server_player_id: serverPlayer?.id || null,
                server_team_id: serverPlayer?.team_ref || null,
            };
            if (local?.id) {
                await db.entities.Player.update(local.id, patch);
                local = { ...local, ...patch };
            } else {
                local = await db.entities.Player.create(patch);
                importedPlayers += 1;
            }
            if (serverPlayer?.id && local?.id) playerByServerId.set(serverPlayer.id, local);
        }
    }

    return { teamByServerId, playerByServerId, importedTeams, importedPlayers };
}

async function syncPrivateIdentityForTeams({ homeTeam, awayTeam, players }) {
    const teamServerIds = {};
    const playerRefByLocalId = {};
    const teamEntries = [
        ['home', homeTeam],
        ['away', awayTeam],
    ];

    for (const [side, team] of teamEntries) {
        if (!team?.id) continue;
        let serverTeamId = team.server_team_id || null;
        const teamRes = await upsertPrivateTeamFromLocal(team);
        if (teamRes.ok && teamRes.id) {
            serverTeamId = teamRes.id;
            teamServerIds[side] = serverTeamId;
            if (team.server_team_id !== serverTeamId) {
                await db.entities.Team.update(team.id, { server_team_id: serverTeamId });
            }
        }
        for (const player of (players || []).filter((p) => p.team_id === team.id)) {
            const playerRes = await upsertPrivatePlayerFromLocal(player, { teamServerId: serverTeamId });
            if (playerRes.ok && playerRes.id) {
                playerRefByLocalId[player.id] = playerRes.id;
                if (player.server_player_id !== playerRes.id || player.server_team_id !== serverTeamId) {
                    await db.entities.Player.update(player.id, { server_player_id: playerRes.id, server_team_id: serverTeamId || null });
                }
            } else if (player.server_player_id) {
                playerRefByLocalId[player.id] = player.server_player_id;
            }
        }
    }

    return { teamServerIds, playerRefByLocalId };
}

async function hydrateServerAccountData({ localMatches, localStats, localTeams, localPlayers }) {
    const identity = await hydratePrivateTeamsAndPlayers({ localTeams, localPlayers });
    const serverMatchesResult = await fetchServerMatches({ limit: 150 });
    if (!serverMatchesResult.ok) {
        if (serverMatchesResult.reason === 'not_authenticated') return { importedMatches: 0, importedStats: 0, skipped: true };
        throw new Error(serverMatchesResult.reason || 'Failed to fetch server matches');
    }

    const localByPublicId = new Map((localMatches || []).filter((m) => m?.public_match_id).map((m) => [m.public_match_id, m]));
    const localByServerId = new Map((localMatches || []).filter((m) => m?.server_match_id).map((m) => [m.server_match_id, m]));
    const localServerStatIds = new Set((localStats || []).map((s) => s?.server_stat_id).filter(Boolean));
    let importedMatches = 0;
    let importedStats = 0;

    for (const serverMatch of (serverMatchesResult.matches || [])) {
        const publicMatchId = serverMatch?.public_match_id || '';
        let localMatch =
            (serverMatch?.id ? localByServerId.get(serverMatch.id) : null)
            || (publicMatchId ? localByPublicId.get(publicMatchId) : null);

        if (!localMatch) {
            const homeTeam = serverMatch?.home_team_ref ? identity.teamByServerId.get(serverMatch.home_team_ref) : null;
            const awayTeam = serverMatch?.away_team_ref ? identity.teamByServerId.get(serverMatch.away_team_ref) : null;
            const fallbackHomeTeam = homeTeam || await createImportedTeam('home', serverMatch);
            const fallbackAwayTeam = awayTeam || await createImportedTeam('away', serverMatch);
            const homeSheet = buildImportedMatchSheet(
                Array.from(identity.playerByServerId.values()).filter((player) => player?.team_id === fallbackHomeTeam.id)
            );
            const awaySheet = buildImportedMatchSheet(
                Array.from(identity.playerByServerId.values()).filter((player) => player?.team_id === fallbackAwayTeam.id)
            );
            localMatch = await db.entities.Match.create({
                home_team_id: fallbackHomeTeam.id,
                away_team_id: fallbackAwayTeam.id,
                date: serverMatch?.match_date || new Date().toISOString().slice(0, 10),
                venue: '',
                competition: 'Synced from account',
                level: serverMatch?.level || 'Other',
                code: serverMatch?.code || 'GAA',
                mode: serverMatch?.mode || 'analysis',
                match_length_minutes: Number.isFinite(Number(serverMatch?.match_length_minutes)) ? Number(serverMatch.match_length_minutes) : deriveMatchLengthMinutes(serverMatch || {}),
                wind_speed: serverMatch?.wind_speed ?? '',
                wind_direction: serverMatch?.wind_direction ?? '',
                public_match_id: publicMatchId || generatePublicMatchId(),
                server_match_id: serverMatch?.id || null,
                is_synced_import: true,
                home_starters: JSON.stringify(homeSheet.starters),
                away_starters: JSON.stringify(awaySheet.starters),
                home_subs: JSON.stringify(homeSheet.subs),
                away_subs: JSON.stringify(awaySheet.subs),
                home_on_field: JSON.stringify(homeSheet.on_field),
                away_on_field: JSON.stringify(awaySheet.on_field),
            });
            importedMatches += 1;
            if (publicMatchId) localByPublicId.set(publicMatchId, localMatch);
            if (serverMatch?.id) localByServerId.set(serverMatch.id, localMatch);
        } else if (serverMatch?.id && !localMatch.server_match_id) {
            await db.entities.Match.update(localMatch.id, { server_match_id: serverMatch.id });
            localMatch = { ...localMatch, server_match_id: serverMatch.id };
            localByServerId.set(serverMatch.id, localMatch);
        }

        if (localMatch) {
            const localHomeTeam = serverMatch?.home_team_ref ? identity.teamByServerId.get(serverMatch.home_team_ref) : null;
            const localAwayTeam = serverMatch?.away_team_ref ? identity.teamByServerId.get(serverMatch.away_team_ref) : null;
            if (localHomeTeam?.id && localAwayTeam?.id) {
                const homeSheet = buildImportedMatchSheet(
                    Array.from(identity.playerByServerId.values()).filter((player) => player?.team_id === localHomeTeam.id)
                );
                const awaySheet = buildImportedMatchSheet(
                    Array.from(identity.playerByServerId.values()).filter((player) => player?.team_id === localAwayTeam.id)
                );
                const needsRosterBackfill =
                    parseIdList(localMatch.home_starters).length === 0
                    && parseIdList(localMatch.away_starters).length === 0
                    && (homeSheet.starters.length > 0 || awaySheet.starters.length > 0);
                if (needsRosterBackfill) {
                    const rosterPatch = {
                        home_team_id: localHomeTeam.id,
                        away_team_id: localAwayTeam.id,
                        home_starters: JSON.stringify(homeSheet.starters),
                        away_starters: JSON.stringify(awaySheet.starters),
                        home_subs: JSON.stringify(homeSheet.subs),
                        away_subs: JSON.stringify(awaySheet.subs),
                        home_on_field: JSON.stringify(homeSheet.on_field),
                        away_on_field: JSON.stringify(awaySheet.on_field),
                    };
                    await db.entities.Match.update(localMatch.id, rosterPatch);
                    localMatch = { ...localMatch, ...rosterPatch };
                }
            }
        }

        const serverStatsResult = await fetchServerStatsForMatch({
            serverMatchId: serverMatch?.id,
            publicMatchId,
            limit: 10000,
        });
        if (!serverStatsResult.ok) continue;

        for (const serverStat of (serverStatsResult.stats || [])) {
            if (serverStat?.id && localServerStatIds.has(serverStat.id)) continue;
            const created = await db.entities.StatEntry.create(localStatFromServer(serverStat, localMatch.id, identity.playerByServerId));
            if (serverStat?.id) localServerStatIds.add(serverStat.id);
            if (created?.id) importedStats += 1;
        }
    }

    return {
        importedMatches,
        importedStats,
        importedTeams: identity.importedTeams || 0,
        importedPlayers: identity.importedPlayers || 0,
        skipped: false,
    };
}

export default function Home() {
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [importShareOpen, setImportShareOpen] = useState(false);
    const [importShareCode, setImportShareCode] = useState('');
    const [deleteDialog, setDeleteDialog] = useState({ open: false, match: null });
    const [newMatch, setNewMatch] = useState({
        home_team_id: '',
        away_team_id: '',
        date: '',
        venue: '',
        competition: '',
        level: 'Senior',
        code: 'GAA',
        mode: 'analysis',
        wind_speed: '',
        wind_direction: '',
    });
    const queryClient = useQueryClient();
    const windDegrees = Number(newMatch.wind_direction);
    const windPreviewRotation = Number.isFinite(windDegrees) ? windDegrees : 0;
    const matchLengthMinutes = deriveMatchLengthMinutes(newMatch);

    const { data: matches = [], isLoading } = useQuery({
        queryKey: ['matches'],
        queryFn: () => db.entities.Match.list('-created_date')
    });

    const { data: teams = [] } = useQuery({
        queryKey: ['teams'],
        queryFn: () => db.entities.Team.list('name')
    });

    const { data: players = [] } = useQuery({
        queryKey: ['players'],
        queryFn: () => db.entities.Player.list('number')
    });

    const { data: allStats = [], isLoading: isLoadingStats } = useQuery({
        queryKey: ['all-stats'],
        queryFn: () => db.entities.StatEntry.list('-timestamp')
    });

    const serverHydrationMutation = useMutation({
        mutationFn: () => hydrateServerAccountData({ localMatches: matches, localStats: allStats, localTeams: teams, localPlayers: players }),
        onSuccess: ({ importedMatches, importedStats, importedTeams, importedPlayers, skipped }) => {
            if (skipped || (!importedMatches && !importedStats && !importedTeams && !importedPlayers)) return;
            queryClient.invalidateQueries({ queryKey: ['matches'] });
            queryClient.invalidateQueries({ queryKey: ['teams'] });
            queryClient.invalidateQueries({ queryKey: ['players'] });
            queryClient.invalidateQueries({ queryKey: ['all-stats'] });
            toast.success(`Synced ${importedMatches} match${importedMatches === 1 ? '' : 'es'}, ${importedStats} stat row${importedStats === 1 ? '' : 's'}, ${importedTeams || 0} team${importedTeams === 1 ? '' : 's'}, and ${importedPlayers || 0} player${importedPlayers === 1 ? '' : 's'}`);
        },
        onError: (error) => {
            toast.error(error?.message || 'Failed to sync account matches');
        },
    });

    useEffect(() => {
        if (!isAuthenticated || isLoading || isLoadingStats || serverHydrationMutation.isPending || serverHydrationMutation.isSuccess) return;
        serverHydrationMutation.mutate();
    }, [isAuthenticated, isLoading, isLoadingStats, serverHydrationMutation.isPending, serverHydrationMutation.isSuccess]);

    const selectableTeams = React.useMemo(() => (teams || []).filter((team) => !team?.is_demo && !team?.is_synced_placeholder), [teams]);

    const scoreByMatch = React.useMemo(() => {
        const map = {};

        // Ensure every match shows a score line (defaults to 0:0 - 0:0).
        for (const m of (matches || [])) {
            if (!m?.id) continue;
            map[m.id] = { home: { goals: 0, points: 0 }, away: { goals: 0, points: 0 } };
        }

        const add = (matchId, side, kind, amt) => {
            if (!matchId || !side) return;
            map[matchId] = map[matchId] || { home: { goals: 0, points: 0 }, away: { goals: 0, points: 0 } };
            map[matchId][side][kind] += amt;
        };
        for (const s of (allStats || [])) {
            const side = s?.team_side === 'home' || s?.team_side === 'away' ? s.team_side : null;
            if (!side) continue;
            if (String(s.stat_type || '').toLowerCase() !== 'shot') continue;
            if (isBroughtBackAdvantageStat(s)) continue;
            let extra = {};
            try { extra = s.extra_data ? JSON.parse(s.extra_data) : {}; } catch {}
            const o = extra?.shot?.outcome || '';
            if (o === 'goal') add(s.match_id, side, 'goals', 1);
            if (o === 'point') add(s.match_id, side, 'points', 1);
            if (o === '2_point') add(s.match_id, side, 'points', 2);
        }
        return map;
    }, [allStats, matches]);

    const createMatchMutation = useMutation({
        mutationFn: async (data) => {
            const safeParseIds = (s) => {
                if (!s || typeof s !== 'string') return [];
                try {
                    const arr = JSON.parse(s);
                    return Array.isArray(arr) ? arr.filter(Boolean) : [];
                } catch {
                    return [];
                }
            };

            const buildSheet = (teamId) => {
                const team = teams.find(t => t.id === teamId);
                const teamPlayers = (players || []).filter(p => p.team_id === teamId).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
                const startersIds = safeParseIds(team?.starters);
                const subsIds = safeParseIds(team?.subs);

                // Fallback: first 15 by number are starters.
                let starters = startersIds.length ? startersIds.filter((id) => teamPlayers.some(p => p.id === id)) : teamPlayers.slice(0, 15).map(p => p.id);
                starters = starters.slice(0, 15);
                const startersSet = new Set(starters);

                // Subs: explicit list + remaining players.
                const remaining = teamPlayers.map(p => p.id).filter((id) => !startersSet.has(id));
                const subs = (subsIds.length ? subsIds.filter((id) => teamPlayers.some(p => p.id === id) && !startersSet.has(id)) : [])
                    .concat(remaining.filter((id) => !(subsIds || []).includes(id)));

                return { starters, subs, on_field: starters };
            };

            const payload = {
                ...data,
                match_length_minutes: deriveMatchLengthMinutes(data),
                public_match_id: data.public_match_id || generatePublicMatchId(),
            };

            // Snapshot team sheets into the match record (15 starters + subs)
            const homeSheet = buildSheet(payload.home_team_id);
            const awaySheet = buildSheet(payload.away_team_id);
            payload.home_starters = JSON.stringify(homeSheet.starters);
            payload.home_subs = JSON.stringify(homeSheet.subs);
            payload.home_on_field = JSON.stringify(homeSheet.on_field);
            payload.away_starters = JSON.stringify(awaySheet.starters);
            payload.away_subs = JSON.stringify(awaySheet.subs);
            payload.away_on_field = JSON.stringify(awaySheet.on_field);

            const created = await db.entities.Match.create(payload);

            // Best-effort server upload (redacted): exclude venue/competition.
            const homeTeam = teams.find((t) => t.id === created.home_team_id);
            const awayTeam = teams.find((t) => t.id === created.away_team_id);
            const identity = await syncPrivateIdentityForTeams({ homeTeam, awayTeam, players });
            const res = await ensureServerMatch({
                publicMatchId: created.public_match_id,
                matchDate: created.date,
                code: created.code || 'GAA',
                level: created.level || 'Other',
                windSpeed: created.wind_speed === '' ? null : created.wind_speed,
                windDirection: created.wind_direction === '' ? null : created.wind_direction,
                mode: created.mode || 'analysis',
                matchLengthMinutes: created.match_length_minutes,
                homeTeamRef: identity.teamServerIds.home || homeTeam?.server_team_id || null,
                awayTeamRef: identity.teamServerIds.away || awayTeam?.server_team_id || null,
            });

            if (res.ok && res.id) {
                await db.entities.Match.update(created.id, { server_match_id: res.id });
                return { ...created, server_match_id: res.id };
            }

            return created;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['matches'] });
            setDialogOpen(false);
            setNewMatch({
                home_team_id: '',
                away_team_id: '',
                date: '',
                venue: '',
                competition: '',
                level: 'Senior',
                code: 'GAA',
                mode: 'analysis',
                wind_speed: '',
                wind_direction: '',
            });
            toast.success('Match created');
        }
    });

    const openDemoMutation = useMutation({
        mutationFn: async () => {
            const { openDemoMatch } = await import('@/lib/demoData');
            return openDemoMatch(db);
        },
        onSuccess: (match) => {
            queryClient.invalidateQueries({ queryKey: ['matches'] });
            queryClient.invalidateQueries({ queryKey: ['teams'] });
            queryClient.invalidateQueries({ queryKey: ['players'] });
            queryClient.invalidateQueries({ queryKey: ['all-stats'] });
            if (match?.id) queryClient.invalidateQueries({ queryKey: ['stats', match.id] });
            toast.success('Demo match ready');
            if (match?.id) navigate(createPageUrl(`MatchReport?id=${match.id}`));
        },
        onError: (error) => {
            toast.error(error?.message || 'Failed to load demo match');
        },
    });

    const importSharedMatchMutation = useMutation({
        mutationFn: async (shareCode) => {
            if (!isAuthenticated) throw new Error('Sign in to import a shared match');
            const fetched = await fetchSharedMatchSnapshotByCode(shareCode);
            if (!fetched?.ok || !fetched?.snapshot) throw new Error(fetched?.reason || 'Shared match not found');
            return importSharedMatchSnapshot({ db, snapshotRow: fetched.snapshot });
        },
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ['matches'] });
            queryClient.invalidateQueries({ queryKey: ['teams'] });
            queryClient.invalidateQueries({ queryKey: ['players'] });
            queryClient.invalidateQueries({ queryKey: ['all-stats'] });
            setImportShareOpen(false);
            setImportShareCode('');
            toast.success('Shared match imported as a private copy');
            if (result?.matchId) navigate(createPageUrl(`MatchReport?id=${result.matchId}`));
        },
        onError: (error) => {
            toast.error(error?.message || 'Failed to import shared match');
        },
    });

    const handleCreateMatch = () => {
        if (!newMatch.date) { toast.error('Please fill in date'); return; }
        if (!newMatch.home_team_id || !newMatch.away_team_id) { toast.error('Please select both teams'); return; }
        createMatchMutation.mutate(newMatch);
    };
    const handleImportSharedMatch = () => {
        const code = String(importShareCode || '').trim().toUpperCase();
        if (!code) {
            toast.error('Enter a share code');
            return;
        }
        importSharedMatchMutation.mutate(code);
    };

    const getMatchTitle = (match) => {
        const homeTeam = teams.find(t => t.id === match.home_team_id);
        const awayTeam = teams.find(t => t.id === match.away_team_id);
        if (homeTeam && awayTeam) return `${homeTeam.name} vs ${awayTeam.name}`;
        return match.opponent ? `vs ${match.opponent}` : 'Match';
    };

    const requestDeleteMatch = (match) => setDeleteDialog({ open: true, match });
    const closeDelete = () => setDeleteDialog({ open: false, match: null });

    const confirmDeleteMatch = async () => {
        const m = deleteDialog.match;
        if (!m?.id) return;

        try {
            // Soft delete on server if known (best-effort)
            if (m.server_match_id) {
                await softDeleteServerMatch(m.server_match_id);
            }

            // Local delete: match + all stats
            const stats = await db.entities.StatEntry.filter({ match_id: m.id });
            await Promise.all((stats || []).map(s => db.entities.StatEntry.delete(s.id)));
            await db.entities.Match.delete(m.id);
            if (m.is_demo) {
                const { deleteDemoArtifactsForMatch } = await import('@/lib/demoData');
                await deleteDemoArtifactsForMatch(db, m);
            }

            queryClient.invalidateQueries({ queryKey: ['matches'] });
            queryClient.invalidateQueries({ queryKey: ['teams'] });
            queryClient.invalidateQueries({ queryKey: ['players'] });
            queryClient.invalidateQueries({ queryKey: ['all-stats'] });
            toast.success('Match deleted');
        } catch (e) {
            toast.error(e?.message || 'Failed to delete match');
        } finally {
            closeDelete();
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
            <header className="bg-white border-b">
                <div className="max-w-7xl mx-auto px-4 py-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">
                                <span>Gael</span><span className="text-red-600">IQ</span>
                            </h1>
                            <p className="text-slate-500 mt-1">Match analysis & performance tracking</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button className="gap-2 bg-green-600 hover:bg-green-700">
                                        <Plus className="w-4 h-4" /> New Match
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="max-h-[90vh] overflow-hidden flex flex-col">
                                    <DialogHeader><DialogTitle>Create New Match</DialogTitle></DialogHeader>
                                    <div className="flex-1 overflow-y-auto pr-1 space-y-4 py-4">
                                        <div className="space-y-2">
                                            <Label>Mode</Label>
                                            <div className="grid grid-cols-2 gap-2">
                                                <Button
                                                    type="button"
                                                    variant={newMatch.mode !== 'live' ? 'default' : 'outline'}
                                                    onClick={() => setNewMatch({ ...newMatch, mode: 'analysis' })}
                                                >
                                                    Analysis
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant={newMatch.mode === 'live' ? 'default' : 'outline'}
                                                    onClick={() => setNewMatch({ ...newMatch, mode: 'live' })}
                                                >
                                                    Live
                                                </Button>
                                            </div>
                                            <p className="text-xs text-slate-500">
                                                Mode is locked once the match is created.
                                            </p>
                                        </div>

                                        <div className="space-y-2">
                                            <Label>Code</Label>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <div className="flex gap-2">
                                                    <Button
                                                        type="button"
                                                        variant={newMatch.code === 'GAA' ? 'default' : 'outline'}
                                                        onClick={() => setNewMatch({ ...newMatch, code: 'GAA' })}
                                                    >
                                                        GAA
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant={newMatch.code === 'LGFA' ? 'default' : 'outline'}
                                                        onClick={() => setNewMatch({ ...newMatch, code: 'LGFA' })}
                                                    >
                                                        LGFA
                                                    </Button>
                                                </div>
                                                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                                                    Match Length: {matchLengthMinutes} mins
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <Label>Level</Label>
                                            <Select value={newMatch.level} onValueChange={(v) => setNewMatch({ ...newMatch, level: v })}>
                                                <SelectTrigger><SelectValue placeholder="Select level..." /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Intercounty">Intercounty</SelectItem>
                                                    <SelectItem value="Senior">Senior</SelectItem>
                                                    <SelectItem value="Intermediate">Intermediate</SelectItem>
                                                    <SelectItem value="Junior">Junior</SelectItem>
                                                    <SelectItem value="Minor">Minor</SelectItem>
                                                    <SelectItem value="Other">Other</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-2">
                                            <Label>Home Team *</Label>
                                            <Select value={newMatch.home_team_id} onValueChange={(v) => setNewMatch({ ...newMatch, home_team_id: v })}>
                                                <SelectTrigger><SelectValue placeholder="Select home team..." /></SelectTrigger>
                                                <SelectContent>
                                                    {selectableTeams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                            {selectableTeams.length === 0 && (
                                                <p className="text-xs text-slate-400">
                                                    No teams yet. <Link to={createPageUrl('Teams')} className="text-green-600 underline">Add teams first.</Link>
                                                </p>
                                            )}
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Away Team *</Label>
                                            <Select value={newMatch.away_team_id} onValueChange={(v) => setNewMatch({ ...newMatch, away_team_id: v })}>
                                                <SelectTrigger><SelectValue placeholder="Select away team..." /></SelectTrigger>
                                                <SelectContent>
                                                    {selectableTeams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Date *</Label>
                                            <Input type="date" value={newMatch.date} onChange={(e) => setNewMatch({ ...newMatch, date: e.target.value })} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Venue</Label>
                                            <Input placeholder="e.g. Croke Park" value={newMatch.venue} onChange={(e) => setNewMatch({ ...newMatch, venue: e.target.value })} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Competition</Label>
                                            <Input placeholder="e.g. All-Ireland Championship" value={newMatch.competition} onChange={(e) => setNewMatch({ ...newMatch, competition: e.target.value })} />
                                        </div>
                                        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                                            <div className="space-y-4">
                                                <div className="text-sm font-semibold text-slate-900">Wind Details</div>
                                                <div className="space-y-2">
                                                    <Label>Wind Direction</Label>
                                                    <Select value={newMatch.wind_direction} onValueChange={(v) => setNewMatch({ ...newMatch, wind_direction: v })}>
                                                        <SelectTrigger><SelectValue placeholder="Select angle..." /></SelectTrigger>
                                                        <SelectContent>
                                                            {WIND_DIRECTION_OPTIONS.map((option) => (
                                                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <p className="text-xs text-slate-400">Angle for the home team playing up in the 1st half.</p>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Wind Strength (km/h)</Label>
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        step="0.1"
                                                        placeholder="e.g. 18"
                                                        value={newMatch.wind_speed}
                                                        onChange={(e) => setNewMatch({ ...newMatch, wind_speed: e.target.value })}
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                                                    <div className="relative mx-auto w-full max-w-[320px]">
                                                        <img
                                                            src={halfPitchImg}
                                                            alt="Wind preview pitch"
                                                            className="block w-full h-auto rounded-lg border border-slate-200"
                                                        />
                                                        <div className="pointer-events-none absolute inset-0">
                                                            <div
                                                                className="absolute left-1/2 top-[53%] w-1 h-[42%] -translate-x-1/2 -translate-y-1/2 origin-center rounded-full bg-red-500 shadow-sm"
                                                                style={{ transform: `translate(-50%, -50%) rotate(${windPreviewRotation}deg)` }}
                                                            >
                                                                <div className="absolute left-1/2 top-[-2px] h-0 w-0 -translate-x-1/2 border-x-[9px] border-b-[18px] border-x-transparent border-b-red-500" />
                                                            </div>
                                                            <div className="absolute left-3 top-3 text-xl font-bold text-red-500">
                                                                Wind Angle: {Number.isFinite(windDegrees) ? `${windDegrees}°` : 'NA'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="pt-3 text-center text-lg font-bold text-slate-900">
                                                        Home Team
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="pt-3 border-t">
                                        <Button onClick={handleCreateMatch} className="w-full bg-green-600 hover:bg-green-700" disabled={createMatchMutation.isPending}>
                                            Create Match
                                        </Button>
                                    </div>
                                </DialogContent>
                            </Dialog>
                            <Button
                                type="button"
                                variant="outline"
                                className="gap-2"
                                onClick={() => openDemoMutation.mutate()}
                                disabled={openDemoMutation.isPending}
                                title="Open the bundled Armagh vs Galway demo match"
                            >
                                <Sparkles className="w-4 h-4" /> Demo
                            </Button>
                            <Button type="button" variant="outline" className="gap-2" onClick={() => setImportShareOpen(true)}>
                                <Copy className="w-4 h-4" /> Import Share
                            </Button>
                            <Link to={createPageUrl('Teams')}>
                                <Button variant="outline" className="gap-2"><Users className="w-4 h-4" /> Teams</Button>
                            </Link>
                            <Link to={createPageUrl('SeasonStats')}>
                                <Button variant="outline" className="gap-2"><BarChart3 className="w-4 h-4" /> Stats</Button>
                            </Link>
                            <Link to={createPageUrl('Settings')}>
                                <Button variant="outline" size="icon"><Settings className="w-4 h-4" /></Button>
                            </Link>
                            <Link to={createPageUrl('About')}>
                                <Button variant="outline" size="icon" title="About">
                                    <Info className="w-4 h-4" />
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 py-8">
                {isLoading ? (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[1, 2, 3].map(i => <div key={i} className="h-48 bg-white rounded-xl animate-pulse" />)}
                    </div>
                ) : matches.length === 0 ? (
                    <Card className="max-w-md mx-auto text-center py-12">
                        <CardContent>
                            <Activity className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-slate-900 mb-2">No matches yet</h3>
                            <p className="text-slate-500 mb-4">Create your first match to start logging stats</p>
                            <Button onClick={() => setDialogOpen(true)} className="gap-2 bg-green-600 hover:bg-green-700">
                                <Plus className="w-4 h-4" /> Create Match
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                className="mt-3 gap-2"
                                onClick={() => openDemoMutation.mutate()}
                                disabled={openDemoMutation.isPending}
                            >
                                <Sparkles className="w-4 h-4" /> Open Demo Match
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                className="mt-3 gap-2"
                                onClick={() => setImportShareOpen(true)}
                            >
                                <Copy className="w-4 h-4" /> Import Shared Match
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {matches.map(match => (
                            <Link key={match.id} to={createPageUrl(`MatchStats?id=${match.id}`)}>
                                <Card className="h-full hover:shadow-lg transition-all duration-300 hover:border-green-200 group cursor-pointer">
                                    <CardHeader className="pb-3">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <CardTitle className="text-lg group-hover:text-green-600 transition-colors">
                                                    {getMatchTitle(match)}
                                                </CardTitle>
                                                {match.is_demo && (
                                                    <div className="mt-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                                        Demo
                                                    </div>
                                                )}
                                                {match.is_synced_import && (
                                                    <div className="mt-1 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                                                        Synced
                                                    </div>
                                                )}
                                                {match.is_shared_copy && (
                                                    <div className="mt-1 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                                                        Shared Copy
                                                    </div>
                                                )}
                                                {match.competition && (
                                                    <div className="flex items-center gap-1.5 mt-1 text-sm text-slate-500">
                                                        <Trophy className="w-3.5 h-3.5" />{match.competition}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-9 px-3 gap-2"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        navigate(createPageUrl(`MatchReport?id=${match.id}`));
                                                    }}
                                                    title="View match stats"
                                                >
                                                    <BarChart3 className="w-4 h-4" />
                                                    <span className="hidden sm:inline">Stats</span>
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestDeleteMatch(match); }}
                                                    title="Delete match"
                                                >
                                                    <Trash2 className="w-4 h-4 text-red-500" />
                                                </Button>
                                                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-green-500 group-hover:translate-x-1 transition-all" />
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                        {(() => {
                                            const sc = scoreByMatch?.[match.id];
                                            if (!sc) return null;
                                            const hg = sc.home.goals || 0;
                                            const hp = sc.home.points || 0;
                                            const ag = sc.away.goals || 0;
                                            const ap = sc.away.points || 0;
                                            return (
                                                <div className="text-sm font-semibold text-slate-800">
                                                    {hg}:{hp} - {ag}:{ap}
                                                </div>
                                            );
                                        })()}
                                        <div className="flex items-center gap-2 text-sm text-slate-600">
                                            <Calendar className="w-4 h-4 text-slate-400" />
                                            {format(new Date(match.date), 'EEEE, d MMMM yyyy')}
                                        </div>
                                        {match.venue && (
                                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                                <MapPin className="w-4 h-4 text-slate-400" />
                                                {match.venue}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </Link>
                        ))}
                    </div>
                )}
            </main>

            <AlertDialog open={deleteDialog.open} onOpenChange={(open) => !open && closeDelete()}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete match?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will delete the match and all its logged stats from this device. It will also request a server-side delete (soft delete) if the match was uploaded.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={closeDelete}>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={confirmDeleteMatch}>
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={importShareOpen} onOpenChange={setImportShareOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Import Shared Match</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <p className="text-sm text-slate-600">
                            Enter a share code from another signed-in user to import a full private copy of their match. Your imported copy is separate and can be reshared later with its own code.
                        </p>
                        <div className="space-y-2">
                            <Label htmlFor="share-code-empty">Share Code</Label>
                            <Input
                                id="share-code-empty"
                                value={importShareCode}
                                onChange={(e) => setImportShareCode(String(e.target.value || '').toUpperCase())}
                                placeholder="Enter share code"
                            />
                        </div>
                        <Button
                            type="button"
                            className="w-full bg-green-600 hover:bg-green-700"
                            disabled={importSharedMatchMutation.isPending}
                            onClick={handleImportSharedMatch}
                        >
                            {importSharedMatchMutation.isPending ? 'Importing...' : 'Import Shared Match'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}



