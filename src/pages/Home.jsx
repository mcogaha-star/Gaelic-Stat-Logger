const db = globalThis.__B44_DB__ || {
  auth: { isAuthenticated: async () => false, me: async () => null },
  entities: new Proxy({}, { get: () => ({ filter: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
  integrations: { Core: { UploadFile: async () => ({ file_url: '' }) } }
};

import React, { useState } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Calendar, MapPin, Trophy, ChevronRight, Activity, Users, Settings, Trash2, Info, BarChart3 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ensureServerMatch, generatePublicMatchId, softDeleteServerMatch } from '@/lib/serverSync';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const WIND_DIRECTION_OPTIONS = Array.from({ length: 24 }, (_, index) => {
    const degrees = index * 15;
    return { value: String(degrees), label: `${degrees}°` };
});

function WindHalfPitchPreview() {
    return (
        <svg viewBox="0 0 85 100" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden="true">
            <rect width="85" height="100" fill="#42eb22" />
            <g fill="none" stroke="#ffffff" strokeWidth="0.45">
                <rect x="0.5" y="0.5" width="84" height="99" />
                <line x1="0" y1="12.5" x2="85" y2="12.5" />
                <line x1="0" y1="22" x2="85" y2="22" />
                <line x1="0" y1="56" x2="85" y2="56" />
                <line x1="0" y1="81" x2="85" y2="81" />
                <line x1="0" y1="90.5" x2="85" y2="90.5" strokeDasharray="1.2 1.2" />
                <rect x="31.5" y="0.5" width="22" height="5.5" />
                <path d="M 24 22 A 18.5 18.5 0 0 0 61 22" />
                <path d="M 29.5 22 A 13 13 0 0 0 55.5 22" />
            </g>
        </svg>
    );
}

export default function Home() {
    const navigate = useNavigate();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [deleteDialog, setDeleteDialog] = useState({ open: false, match: null });
    const [newMatch, setNewMatch] = useState({
        home_team_id: '',
        away_team_id: '',
        date: '',
        venue: '',
        competition: '',
        level: 'Senior',
        code: 'GAA',
        wind_speed: '',
        wind_direction: '',
    });
    const queryClient = useQueryClient();
    const windDegrees = Number(newMatch.wind_direction);
    const windPreviewRotation = Number.isFinite(windDegrees) ? windDegrees : 0;

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

    const { data: allStats = [] } = useQuery({
        queryKey: ['all-stats'],
        queryFn: () => db.entities.StatEntry.list('-timestamp')
    });

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
            const res = await ensureServerMatch({
                publicMatchId: created.public_match_id,
                matchDate: created.date,
                code: created.code || 'GAA',
                level: created.level || 'Other',
                windSpeed: created.wind_speed === '' ? null : created.wind_speed,
                windDirection: created.wind_direction === '' ? null : created.wind_direction,
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
                wind_speed: '',
                wind_direction: '',
            });
            toast.success('Match created');
        }
    });

    const handleCreateMatch = () => {
        if (!newMatch.date) { toast.error('Please fill in date'); return; }
        if (!newMatch.home_team_id || !newMatch.away_team_id) { toast.error('Please select both teams'); return; }
        createMatchMutation.mutate(newMatch);
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

            queryClient.invalidateQueries({ queryKey: ['matches'] });
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
                            <h1 className="text-2xl font-bold text-slate-900">Gaelic Stats</h1>
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
                                            <Label>Code</Label>
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
                                                    {teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                            {teams.length === 0 && (
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
                                                    {teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
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
                                                    <div className="relative mx-auto aspect-[85/100] w-full max-w-[180px] overflow-hidden rounded-lg border border-slate-200 bg-emerald-100">
                                                        <WindHalfPitchPreview />
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
                            <Link to={createPageUrl('Teams')}>
                                <Button variant="outline" className="gap-2"><Users className="w-4 h-4" /> Teams</Button>
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
        </div>
    );
}



