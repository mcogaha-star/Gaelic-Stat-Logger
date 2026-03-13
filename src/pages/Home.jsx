const db = globalThis.__B44_DB__ || {
  auth: { isAuthenticated: async () => false, me: async () => null },
  entities: new Proxy({}, { get: () => ({ filter: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
  integrations: { Core: { UploadFile: async () => ({ file_url: '' }) } }
};

import React, { useState } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Calendar, MapPin, Trophy, ChevronRight, Activity, Users, Settings, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ensureServerMatch, generatePublicMatchId, softDeleteServerMatch } from '@/lib/serverSync';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export default function Home() {
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
    });
    const queryClient = useQueryClient();

    const { data: matches = [], isLoading } = useQuery({
        queryKey: ['matches'],
        queryFn: () => db.entities.Match.list('-created_date')
    });

    const { data: teams = [] } = useQuery({
        queryKey: ['teams'],
        queryFn: () => db.entities.Team.list('name')
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
            if (s.stat_type === 'goal') add(s.match_id, side, 'goals', 1);
            if (s.stat_type === 'point') add(s.match_id, side, 'points', 1);
            if (s.stat_type === '2_point') add(s.match_id, side, 'points', 2);
        }
        return map;
    }, [allStats, matches]);

    const createMatchMutation = useMutation({
        mutationFn: async (data) => {
            const payload = {
                ...data,
                public_match_id: data.public_match_id || generatePublicMatchId(),
            };

            const created = await db.entities.Match.create(payload);

            // Best-effort server upload (redacted): exclude venue/competition.
            const res = await ensureServerMatch({
                publicMatchId: created.public_match_id,
                matchDate: created.date,
                code: created.code || 'GAA',
                level: created.level || 'Other',
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
                            <Link to={createPageUrl('Teams')}>
                                <Button variant="outline" className="gap-2"><Users className="w-4 h-4" /> Teams</Button>
                            </Link>
                            <Link to={createPageUrl('Settings')}>
                                <Button variant="outline" size="icon"><Settings className="w-4 h-4" /></Button>
                            </Link>
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
                                    </div>
                                    <div className="pt-3 border-t">
                                        <Button onClick={handleCreateMatch} className="w-full bg-green-600 hover:bg-green-700" disabled={createMatchMutation.isPending}>
                                            Create Match
                                        </Button>
                                    </div>
                                </DialogContent>
                            </Dialog>
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
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
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
