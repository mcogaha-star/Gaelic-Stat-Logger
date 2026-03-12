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
import { ArrowLeft, Settings } from 'lucide-react';
import { toast } from 'sonner';

import GAAPitch from '@/components/pitch/GAAPitch';
import StatModal from '@/components/pitch/StatModal';
import StatMarkers from '@/components/pitch/StatMarkers';
import MatchHeader from '@/components/match/MatchHeader';
import RecentStats from '@/components/match/RecentStats';
import { DEFAULT_CLICK_STATS, DEFAULT_DRAG_STATS, DEFAULT_DEFAULTS, DEFAULT_SUB_MENUS } from '@/components/statDefaults';

export default function MatchStats() {
    // With HashRouter, query params live in the hash segment, so use react-router's location.
    const location = useLocation();
    const urlParams = new URLSearchParams(location.search);
    const matchId = urlParams.get('id');
    const debugPitch = urlParams.get('debug') === '1';

    const [modalOpen, setModalOpen] = useState(false);
    const [editingStat, setEditingStat] = useState(null);
    const [isPassModal, setIsPassModal] = useState(false);
    const [clickCoords, setClickCoords] = useState(null);
    const [passEndCoords, setPassEndCoords] = useState(null);

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
    const clickStats = settingsRecord?.click_stats_config ? (() => { try { return JSON.parse(settingsRecord.click_stats_config); } catch { return DEFAULT_CLICK_STATS; } })() : DEFAULT_CLICK_STATS;
    const dragStats = settingsRecord?.drag_stats_config ? (() => { try { return JSON.parse(settingsRecord.drag_stats_config); } catch { return DEFAULT_DRAG_STATS; } })() : DEFAULT_DRAG_STATS;
    const appDefaults = settingsRecord?.defaults_config ? (() => { try { return JSON.parse(settingsRecord.defaults_config); } catch { return DEFAULT_DEFAULTS; } })() : DEFAULT_DEFAULTS;
    const subMenus = settingsRecord?.sub_menus_config ? (() => { try { return JSON.parse(settingsRecord.sub_menus_config); } catch { return DEFAULT_SUB_MENUS; } })() : DEFAULT_SUB_MENUS;

    const [half, setHalf] = useState(appDefaults.half || 'first');

    const [quickLogEnabled, setQuickLogEnabled] = useState(() => {
        try {
            const stored = window.localStorage.getItem('gaa_quick_log_enabled');
            if (stored === 'true') return true;
            if (stored === 'false') return false;
        } catch { }
        return true;
    });

    useEffect(() => {
        try { window.localStorage.setItem('gaa_quick_log_enabled', String(!!quickLogEnabled)); } catch { }
    }, [quickLogEnabled]);

    const [defaultPlayerId, setDefaultPlayerId] = useState('');

    const [flipSecondHalfCoords, setFlipSecondHalfCoords] = useState(() => {
        try {
            const stored = window.localStorage.getItem('gaa_flip_second_half_coords');
            if (stored === 'true') return true;
            if (stored === 'false') return false;
        } catch { }
        return appDefaults.flip_second_half_coords !== false;
    });

    useEffect(() => {
        try { window.localStorage.setItem('gaa_flip_second_half_coords', String(!!flipSecondHalfCoords)); } catch { }
    }, [flipSecondHalfCoords]);

    const [flipEtFirstCoords, setFlipEtFirstCoords] = useState(() => {
        try {
            const stored = window.localStorage.getItem('gaa_flip_et_first_coords');
            if (stored === 'true') return true;
            if (stored === 'false') return false;
        } catch { }
        return appDefaults.flip_et_first_coords === true;
    });

    useEffect(() => {
        try { window.localStorage.setItem('gaa_flip_et_first_coords', String(!!flipEtFirstCoords)); } catch { }
    }, [flipEtFirstCoords]);

    // Build player groups: match home/away teams, then unassigned
    const homeTeam = teams.find(t => t.id === match?.home_team_id);
    const awayTeam = teams.find(t => t.id === match?.away_team_id);
    const matchTeamIds = [match?.home_team_id, match?.away_team_id].filter(Boolean);

    let playerGroups = [];
    if (homeTeam) {
        playerGroups.push({ team: homeTeam, players: allPlayers.filter(p => p.team_id === homeTeam.id) });
    }
    if (awayTeam) {
        playerGroups.push({ team: awayTeam, players: allPlayers.filter(p => p.team_id === awayTeam.id) });
    }
    const unassigned = allPlayers.filter(p => !p.team_id || !matchTeamIds.includes(p.team_id));
    if (unassigned.length > 0 || playerGroups.length === 0) {
        playerGroups.push({ team: null, players: unassigned });
    }

    const createStatMutation = useMutation({
        mutationFn: (data) => db.entities.StatEntry.create(data),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['stats', matchId] }); toast.success('Stat logged'); }
    });

    const updateStatMutation = useMutation({
        mutationFn: ({ id, data }) => db.entities.StatEntry.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
            toast.success('Stat updated');
        }
    });

    const deleteStatMutation = useMutation({
        mutationFn: (id) => db.entities.StatEntry.delete(id),
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
        // Snap to nearest 20m line midpoint: (20, 45) or (120, 45)
        const leftDist = Math.sqrt(Math.pow(coords.x - 20, 2) + Math.pow(coords.y - 45, 2));
        const rightDist = Math.sqrt(Math.pow(coords.x - 120, 2) + Math.pow(coords.y - 45, 2));
        return leftDist < rightDist ? { x: 20, y: 45 } : { x: 120, y: 45 };
    };

    const handlePointClick = (coords) => {
        setEditingStat(null);
        setClickCoords(coords);
        setIsPassModal(false);
        setPassEndCoords(null);
        setModalOpen(true);
    };

    const handlePassDraw = (start, end) => {
        setEditingStat(null);
        setClickCoords(start);
        setPassEndCoords(end);
        setIsPassModal(true);
        setModalOpen(true);
    };

    const normalizeCoords = (x, y) => {
        const isSecondHalf = half === 'second';
        const isEtFirst = half === 'et_first';
        const isEtSecond = half === 'et_second';

        const shouldFlip =
            (!!flipSecondHalfCoords && (isSecondHalf || isEtSecond)) ||
            (!!flipEtFirstCoords && isEtFirst);

        return shouldFlip ? { x: 140 - x, y: 90 - y } : { x, y };
    };

    const handleStatSubmit = (data) => {
        // Edit path: update fields, keep coordinates/timestamp as originally logged.
        if (editingStat?.id) {
            const subMenuData = {};
            subMenus.forEach(section => {
                if (data[section.id]) subMenuData[section.id] = data[section.id];
            });

            const patch = {
                player_name: data.player?.name,
                player_number: data.player?.number,
                stat_type: data.stat_type,
                recipient_name: data.recipient?.name,
                recipient_number: data.recipient?.number,
                is_pass: data.is_pass,
                extra_data: JSON.stringify(subMenuData),
            };

            // Keep data model consistent if someone edits a drag stat to a type that shouldn't have an end point.
            if (data.is_pass && data.stat_type === 'kickout') {
                patch.end_x_position = undefined;
                patch.end_y_position = undefined;
                patch.raw_end_x_position = undefined;
                patch.raw_end_y_position = undefined;
            }

            updateStatMutation.mutate({ id: editingStat.id, data: patch });
            setEditingStat(null);
            setModalOpen(false);
            return;
        }

        const isKickout = data.stat_type === 'kickout';
        let rawStart = { x: data.x_position, y: data.y_position };
        if (isKickout) rawStart = snapKickoutOrigin(rawStart);

        const rawEnd = (data.end_x_position != null && data.end_y_position != null)
            ? { x: data.end_x_position, y: data.end_y_position }
            : null;

        const start = normalizeCoords(rawStart.x, rawStart.y);
        const hasEnd = !!rawEnd;
        const end = hasEnd ? normalizeCoords(rawEnd.x, rawEnd.y) : {};

        const statData = {
            match_id: matchId,
            player_name: data.player?.name,
            player_number: data.player?.number,
            stat_type: data.stat_type,
            x_position: start.x,
            y_position: start.y,
            end_x_position: hasEnd ? end.x : undefined,
            end_y_position: hasEnd ? end.y : undefined,
            raw_x_position: rawStart.x,
            raw_y_position: rawStart.y,
            raw_end_x_position: hasEnd ? rawEnd.x : undefined,
            raw_end_y_position: hasEnd ? rawEnd.y : undefined,
            recipient_name: data.recipient?.name,
            recipient_number: data.recipient?.number,
            is_pass: data.is_pass,
            half: half,
            timestamp: new Date().toISOString()
        };

        const subMenuData = {};
        subMenus.forEach(section => {
            if (data[section.id]) subMenuData[section.id] = data[section.id];
        });
        statData.extra_data = JSON.stringify(subMenuData);

        if (quickLogEnabled) {
            // Quick log: carry forward the next default player.
            const nextPlayerId = data.recipient?.id || data.player?.id || '';
            if (nextPlayerId) setDefaultPlayerId(nextPlayerId);
        }

        createStatMutation.mutate(statData);
    };

    const openEditStat = (stat) => {
        setEditingStat(stat);
        setIsPassModal(!!stat.is_pass);
        setClickCoords({
            x: stat.raw_x_position ?? stat.x_position,
            y: stat.raw_y_position ?? stat.y_position,
        });
        setPassEndCoords(
            stat.raw_end_x_position != null && stat.raw_end_y_position != null
                ? { x: stat.raw_end_x_position, y: stat.raw_end_y_position }
                : (stat.end_x_position != null && stat.end_y_position != null ? { x: stat.end_x_position, y: stat.end_y_position } : null)
        );
        setModalOpen(true);
    };

    const safeParse = (s) => {
        try { return JSON.parse(s); } catch { return {}; }
    };

    const buildInitialModalData = () => {
        if (!editingStat) return null;
        const player = allPlayers.find(p => p.number === editingStat.player_number && p.name === editingStat.player_name)
            || allPlayers.find(p => p.number === editingStat.player_number)
            || allPlayers.find(p => p.name === editingStat.player_name);
        const recipient = allPlayers.find(p => p.number === editingStat.recipient_number && p.name === editingStat.recipient_name)
            || allPlayers.find(p => p.number === editingStat.recipient_number)
            || allPlayers.find(p => p.name === editingStat.recipient_name);

        const subMenuValues = editingStat.extra_data ? safeParse(editingStat.extra_data) : {};

        let passType = undefined;
        if (editingStat.is_pass) {
            passType = (editingStat.stat_type === 'kickout' || editingStat.stat_type === 'carry') ? editingStat.stat_type : 'pass';
            if (editingStat.stat_type === 'handpass' && !subMenuValues.pass_body) subMenuValues.pass_body = 'handpass';
        }

        return {
            playerId: player?.id || '',
            recipientId: recipient?.id || '',
            statType: editingStat.is_pass ? '' : (editingStat.stat_type || ''),
            passType,
            subMenuValues,
        };
    };

    const initialModalData = useMemo(() => buildInitialModalData(), [editingStat, allPlayers]);

    const exportToCSV = () => {
        if (stats.length === 0) { toast.error('No stats to export'); return; }

        // Ensure CSV rows reflect the order stats were logged.
        // ISO timestamps sort correctly as strings.
        const orderedStats = [...stats].sort((a, b) => {
            const at = a?.timestamp || a?.created_date || '';
            const bt = b?.timestamp || b?.created_date || '';
            return String(at).localeCompare(String(bt));
        });

        const baseHeaders = ['Match ID','Player Name','Player Number','Stat Type','X Position','Y Position',
            'End X','End Y',
            'Raw X','Raw Y','Raw End X','Raw End Y',
            'Recipient Name','Recipient Number','Is Pass','Half','Timestamp'];
        const subMenuHeaders = subMenus.map(s => s.label);
        const headers = [...baseHeaders, ...subMenuHeaders];

        const rows = orderedStats.map(stat => {
            const base = [
                stat.match_id, stat.player_name, stat.player_number, stat.stat_type,
                stat.x_position?.toFixed(2), stat.y_position?.toFixed(2),
                stat.end_x_position?.toFixed(2) || '', stat.end_y_position?.toFixed(2) || '',
                stat.raw_x_position?.toFixed?.(2) ?? '', stat.raw_y_position?.toFixed?.(2) ?? '',
                stat.raw_end_x_position?.toFixed?.(2) ?? '', stat.raw_end_y_position?.toFixed?.(2) ?? '',
                stat.recipient_name || '', stat.recipient_number || '',
                stat.is_pass ? 'Yes' : 'No',
                stat.half, stat.timestamp
            ];
            const extraData = stat.extra_data ? (() => { try { return JSON.parse(stat.extra_data); } catch { return {}; } })() : {};
            const subMenuValues = subMenus.map(s => extraData[s.id] || stat[s.id] || '');
            return [...base, ...subMenuValues];
        });

        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csvContent = [headers.join(','), ...rows.map(row => row.map(esc).join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `match_stats_${match?.opponent || 'match'}_${new Date().toISOString().split('T')[0]}.csv`;
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

    return (
        <div className="min-h-screen bg-slate-50">
            <MatchHeader
                match={match}
                matchTitle={matchTitle}
                half={half}
                onHalfChange={setHalf}
                quickLogEnabled={quickLogEnabled}
                onQuickLogEnabledChange={setQuickLogEnabled}
                flipSecondHalfCoords={flipSecondHalfCoords}
                onFlipSecondHalfCoordsChange={setFlipSecondHalfCoords}
                flipEtFirstCoords={flipEtFirstCoords}
                onFlipEtFirstCoordsChange={setFlipEtFirstCoords}
                onUndo={handleUndoLast}
                onExport={exportToCSV}
                statsCount={stats.length}
            />

            <div className="max-w-7xl mx-auto px-4 py-6">
                <div className="mb-4 flex items-center justify-between">
                    <Link to={createPageUrl('Home')}>
                        <Button variant="ghost" size="sm" className="gap-2">
                            <ArrowLeft className="w-4 h-4" /> Back
                        </Button>
                    </Link>
                    <Link to={createPageUrl('Settings')}>
                        <Button variant="outline" size="sm" className="gap-2">
                            <Settings className="w-4 h-4" /> Settings
                        </Button>
                    </Link>
                </div>

                <div className="grid lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2">
                        <div className="bg-slate-900 rounded-2xl p-4 shadow-xl relative overflow-hidden">
                            <GAAPitch onPointClick={handlePointClick} onPassDraw={handlePassDraw} debug={debugPitch} />
                            <StatMarkers stats={stats} clickStats={clickStats} />
                        </div>
                        <p className="text-center text-sm text-slate-500 mt-3">
                            Click to log a stat. Click and drag to log a pass / carry.
                        </p>
                    </div>

                    <div className="space-y-6">
                        <RecentStats
                            stats={stats}
                            onEdit={openEditStat}
                            onDelete={(id) => deleteStatMutation.mutate(id)}
                        />
                    </div>
                </div>
            </div>

            <StatModal
                open={modalOpen}
                onClose={() => { setModalOpen(false); setEditingStat(null); }}
                playerGroups={playerGroups}
                onSubmit={handleStatSubmit}
                isPass={isPassModal}
                startCoords={clickCoords}
                endCoords={passEndCoords}
                clickStats={clickStats}
                dragStats={dragStats}
                subMenus={subMenus}
                initialData={initialModalData}
                defaultPlayerId={quickLogEnabled ? defaultPlayerId : ''}
                submitLabel={editingStat ? 'Save' : 'Log Stat'}
            />
        </div>
    );
}
