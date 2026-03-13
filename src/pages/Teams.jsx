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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Plus, ChevronDown, ChevronRight, Pencil, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';

const POSITIONS = [
    'Goalkeeper', 'Corner Back', 'Full Back', 'Wing Back',
    'Centre Back', 'Midfielder', 'Wing Forward', 'Centre Forward',
    'Corner Forward', 'Full Forward', 'Substitute'
];

export default function Teams() {
    const [expandedTeam, setExpandedTeam] = useState(null);
    const [teamDialog, setTeamDialog] = useState({ open: false, team: null });
    const [playerDialog, setPlayerDialog] = useState({ open: false, player: null, teamId: null });
    const [teamForm, setTeamForm] = useState({ name: '', color: '#22c55e' });
    const [playerForm, setPlayerForm] = useState({ name: '', number: '', position: '' });

    const queryClient = useQueryClient();

    const { data: teams = [], isLoading } = useQuery({
        queryKey: ['teams'],
        queryFn: () => db.entities.Team.list('name')
    });

    const { data: players = [] } = useQuery({
        queryKey: ['players'],
        queryFn: () => db.entities.Player.list('number')
    });

    const createTeamMutation = useMutation({
        mutationFn: (data) => db.entities.Team.create(data),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['teams'] }); closeTeamDialog(); toast.success('Team created'); }
    });
    const updateTeamMutation = useMutation({
        mutationFn: ({ id, data }) => db.entities.Team.update(id, data),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['teams'] }); closeTeamDialog(); toast.success('Team updated'); }
    });
    const deleteTeamMutation = useMutation({
        mutationFn: (id) => db.entities.Team.delete(id),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['teams'] }); toast.success('Team deleted'); }
    });

    const createPlayerMutation = useMutation({
        mutationFn: (data) => db.entities.Player.create(data),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['players'] }); closePlayerDialog(); toast.success('Player added'); }
    });
    const updatePlayerMutation = useMutation({
        mutationFn: ({ id, data }) => db.entities.Player.update(id, data),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['players'] }); closePlayerDialog(); toast.success('Player updated'); }
    });
    const deletePlayerMutation = useMutation({
        mutationFn: (id) => db.entities.Player.delete(id),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['players'] }); toast.success('Player deleted'); }
    });

    const openTeamDialog = (team = null) => {
        setTeamForm(team ? { name: team.name, color: team.color || '#22c55e' } : { name: '', color: '#22c55e' });
        setTeamDialog({ open: true, team });
    };
    const closeTeamDialog = () => setTeamDialog({ open: false, team: null });

    const openPlayerDialog = (teamId, player = null) => {
        setPlayerForm(player ? { name: player.name, number: player.number?.toString() || '', position: player.position || '' } : { name: '', number: '', position: '' });
        setPlayerDialog({ open: true, player, teamId });
    };
    const closePlayerDialog = () => setPlayerDialog({ open: false, player: null, teamId: null });

    const handleTeamSubmit = () => {
        if (!teamForm.name) { toast.error('Enter a team name'); return; }
        if (teamDialog.team) {
            updateTeamMutation.mutate({ id: teamDialog.team.id, data: teamForm });
        } else {
            createTeamMutation.mutate(teamForm);
        }
    };

    const handlePlayerSubmit = () => {
        if (!playerForm.number) { toast.error('Enter number'); return; }
        const data = {
            name: (playerForm.name || '').trim() || String(parseInt(playerForm.number)),
            number: parseInt(playerForm.number),
            position: playerForm.position,
            team_id: playerDialog.teamId
        };
        if (playerDialog.player) {
            updatePlayerMutation.mutate({ id: playerDialog.player.id, data });
        } else {
            createPlayerMutation.mutate(data);
        }
    };

    const getTeamPlayers = (teamId) => players.filter(p => p.team_id === teamId).sort((a, b) => a.number - b.number);

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
            <header className="bg-white border-b">
                <div className="max-w-4xl mx-auto px-4 py-6 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link to={createPageUrl('Home')}>
                            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">Teams</h1>
                            <p className="text-slate-500">Manage teams and their players</p>
                        </div>
                    </div>
                    <Button onClick={() => openTeamDialog()} className="gap-2 bg-green-600 hover:bg-green-700">
                        <Plus className="w-4 h-4" /> Add Team
                    </Button>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 py-8 space-y-4">
                {isLoading ? (
                    <div className="h-48 bg-white rounded-xl animate-pulse" />
                ) : teams.length === 0 ? (
                    <div className="bg-white rounded-xl border p-12 text-center">
                        <Users className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-slate-900 mb-2">No teams yet</h3>
                        <p className="text-slate-500 mb-4">Create your first team to start managing players</p>
                        <Button onClick={() => openTeamDialog()} className="gap-2 bg-green-600 hover:bg-green-700">
                            <Plus className="w-4 h-4" /> Add Team
                        </Button>
                    </div>
                ) : (
                    teams.map(team => {
                        const teamPlayers = getTeamPlayers(team.id);
                        const isExpanded = expandedTeam === team.id;
                        return (
                            <div key={team.id} className="bg-white rounded-xl border overflow-hidden shadow-sm">
                                <div
                                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition-colors"
                                    onClick={() => setExpandedTeam(isExpanded ? null : team.id)}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: team.color || '#22c55e' }} />
                                        <span className="font-semibold text-slate-900 text-lg">{team.name}</span>
                                        <Badge variant="secondary">{teamPlayers.length} players</Badge>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); openTeamDialog(team); }}>
                                            <Pencil className="w-4 h-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); deleteTeamMutation.mutate(team.id); }}>
                                            <Trash2 className="w-4 h-4 text-red-500" />
                                        </Button>
                                        {isExpanded ? <ChevronDown className="w-5 h-5 text-slate-400 ml-1" /> : <ChevronRight className="w-5 h-5 text-slate-400 ml-1" />}
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className="border-t bg-slate-50">
                                        <div className="px-4 py-3 flex justify-end">
                                            <Button size="sm" onClick={() => openPlayerDialog(team.id)} className="gap-1.5 bg-green-600 hover:bg-green-700">
                                                <Plus className="w-3.5 h-3.5" /> Add Player
                                            </Button>
                                        </div>
                                        {teamPlayers.length === 0 ? (
                                            <p className="text-center text-slate-400 py-8 text-sm">No players in this team yet</p>
                                        ) : (
                                            <table className="w-full">
                                                <thead>
                                                    <tr className="text-xs text-slate-500 uppercase bg-white border-t border-b">
                                                        <th className="px-4 py-2 text-left font-medium">#</th>
                                                        <th className="px-4 py-2 text-left font-medium">Name</th>
                                                        <th className="px-4 py-2 text-left font-medium">Position</th>
                                                        <th className="px-4 py-2 w-20"></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {teamPlayers.map(player => (
                                                        <tr key={player.id} className="border-t hover:bg-white transition-colors">
                                                            <td className="px-4 py-2.5 font-bold text-slate-900">{player.number}</td>
                                                            <td className="px-4 py-2.5 font-medium text-slate-800">{player.name}</td>
                                                            <td className="px-4 py-2.5 text-slate-500 text-sm">{player.position || '-'}</td>
                                                            <td className="px-4 py-2.5">
                                                                <div className="flex items-center gap-0.5 justify-end">
                                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openPlayerDialog(team.id, player)}>
                                                                        <Pencil className="w-3.5 h-3.5" />
                                                                    </Button>
                                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deletePlayerMutation.mutate(player.id)}>
                                                                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                                                                    </Button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </main>

            {/* Team Dialog */}
            <Dialog open={teamDialog.open} onOpenChange={(open) => !open && closeTeamDialog()}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{teamDialog.team ? 'Edit Team' : 'Add Team'}</DialogTitle></DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Team Name *</Label>
                            <Input placeholder="e.g. Galway U21" value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Colour</Label>
                            <div className="flex gap-2 items-center">
                                <input type="color" value={teamForm.color} onChange={(e) => setTeamForm({ ...teamForm, color: e.target.value })} className="w-12 h-10 rounded border cursor-pointer p-1" />
                                <Input value={teamForm.color} onChange={(e) => setTeamForm({ ...teamForm, color: e.target.value })} placeholder="#22c55e" />
                            </div>
                        </div>
                        <Button onClick={handleTeamSubmit} className="w-full bg-green-600 hover:bg-green-700" disabled={createTeamMutation.isPending || updateTeamMutation.isPending}>
                            {teamDialog.team ? 'Update Team' : 'Create Team'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Player Dialog */}
            <Dialog open={playerDialog.open} onOpenChange={(open) => !open && closePlayerDialog()}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{playerDialog.player ? 'Edit Player' : 'Add Player'}</DialogTitle></DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Name *</Label>
                            <Input placeholder="Player name" value={playerForm.name} onChange={(e) => setPlayerForm({ ...playerForm, name: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Number *</Label>
                            <Input type="number" min="1" max="99" placeholder="Jersey number" value={playerForm.number} onChange={(e) => setPlayerForm({ ...playerForm, number: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Position</Label>
                            <Select value={playerForm.position} onValueChange={(v) => setPlayerForm({ ...playerForm, position: v })}>
                                <SelectTrigger><SelectValue placeholder="Select position" /></SelectTrigger>
                                <SelectContent>
                                    {POSITIONS.map(pos => <SelectItem key={pos} value={pos}>{pos}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <Button onClick={handlePlayerSubmit} className="w-full bg-green-600 hover:bg-green-700" disabled={createPlayerMutation.isPending || updatePlayerMutation.isPending}>
                            {playerDialog.player ? 'Update Player' : 'Add Player'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
