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
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, ArrowLeft, Trash2, Pencil, Users } from 'lucide-react';
import { toast } from 'sonner';

const POSITIONS = [
    'Goalkeeper',
    'Corner Back',
    'Full Back',
    'Wing Back',
    'Centre Back',
    'Midfielder',
    'Wing Forward',
    'Centre Forward',
    'Corner Forward',
    'Full Forward',
    'Substitute'
];

export default function Players() {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingPlayer, setEditingPlayer] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        number: '',
        position: '',
        team_type: 'my_team'
    });

    const queryClient = useQueryClient();

    const { data: players = [], isLoading } = useQuery({
        queryKey: ['players'],
        queryFn: () => db.entities.Player.list('number')
    });

    const createMutation = useMutation({
        mutationFn: (data) => db.entities.Player.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['players'] });
            handleCloseDialog();
            toast.success('Player added');
        }
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => db.entities.Player.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['players'] });
            handleCloseDialog();
            toast.success('Player updated');
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => db.entities.Player.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['players'] });
            toast.success('Player deleted');
        }
    });

    const handleCloseDialog = () => {
        setDialogOpen(false);
        setEditingPlayer(null);
        setFormData({ name: '', number: '', position: '', team_type: 'my_team' });
    };

    const handleEditPlayer = (player) => {
        setEditingPlayer(player);
        setFormData({
            name: player.name,
            number: player.number?.toString() || '',
            position: player.position || '',
            team_type: player.team_type || 'my_team'
        });
        setDialogOpen(true);
    };

    const handleSubmit = () => {
        if (!formData.number) {
            toast.error('Please fill in number');
            return;
        }

        const data = {
            name: (formData.name || '').trim() || String(parseInt(formData.number)),
            number: parseInt(formData.number),
            position: formData.position,
            team_type: formData.team_type
        };

        if (editingPlayer) {
            updateMutation.mutate({ id: editingPlayer.id, data });
        } else {
            createMutation.mutate(data);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
            {/* Header */}
            <header className="bg-white border-b">
                <div className="max-w-4xl mx-auto px-4 py-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <Link to={createPageUrl('Home')}>
                                <Button variant="ghost" size="icon">
                                    <ArrowLeft className="w-5 h-5" />
                                </Button>
                            </Link>
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900">Players</h1>
                                <p className="text-slate-500">Manage your squad</p>
                            </div>
                        </div>
                        <Dialog open={dialogOpen} onOpenChange={(open) => {
                            if (!open) handleCloseDialog();
                            else setDialogOpen(true);
                        }}>
                            <DialogTrigger asChild>
                                <Button className="gap-2 bg-green-600 hover:bg-green-700">
                                    <Plus className="w-4 h-4" />
                                    Add Player
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>
                                        {editingPlayer ? 'Edit Player' : 'Add Player'}
                                    </DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <Label>Name *</Label>
                                        <Input 
                                            placeholder="Player name"
                                            value={formData.name}
                                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Number *</Label>
                                        <Input 
                                            type="number"
                                            min="1"
                                            max="99"
                                            placeholder="Jersey number"
                                            value={formData.number}
                                            onChange={(e) => setFormData({...formData, number: e.target.value})}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Position</Label>
                                        <Select 
                                            value={formData.position} 
                                            onValueChange={(v) => setFormData({...formData, position: v})}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select position" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {POSITIONS.map(pos => (
                                                    <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Team</Label>
                                        <Select 
                                            value={formData.team_type} 
                                            onValueChange={(v) => setFormData({...formData, team_type: v})}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="my_team">My Team</SelectItem>
                                                <SelectItem value="opponent">Opponent</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <Button 
                                        onClick={handleSubmit} 
                                        className="w-full bg-green-600 hover:bg-green-700"
                                        disabled={createMutation.isPending || updateMutation.isPending}
                                    >
                                        {editingPlayer ? 'Update Player' : 'Add Player'}
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-4xl mx-auto px-4 py-8">
                {isLoading ? (
                    <div className="h-64 bg-white rounded-xl animate-pulse" />
                ) : players.length === 0 ? (
                    <Card className="text-center py-12">
                        <CardContent>
                            <Users className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-slate-900 mb-2">No players yet</h3>
                            <p className="text-slate-500 mb-4">Add players to your squad to start logging stats</p>
                            <Button 
                                onClick={() => setDialogOpen(true)}
                                className="gap-2 bg-green-600 hover:bg-green-700"
                            >
                                <Plus className="w-4 h-4" />
                                Add Player
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-20">#</TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Position</TableHead>
                                    <TableHead>Team</TableHead>
                                    <TableHead className="w-24"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {players.map(player => (
                                    <TableRow key={player.id}>
                                        <TableCell className="font-bold text-lg">
                                            {player.number}
                                        </TableCell>
                                        <TableCell className="font-medium">
                                            {player.name}
                                        </TableCell>
                                        <TableCell className="text-slate-500">
                                                {player.position || '-'}
                                            </TableCell>
                                            <TableCell>
                                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${player.team_type === 'opponent' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                                    {player.team_type === 'opponent' ? 'Opponent' : 'My Team'}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleEditPlayer(player)}
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => deleteMutation.mutate(player.id)}
                                                >
                                                    <Trash2 className="w-4 h-4 text-red-500" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Card>
                )}
            </main>
        </div>
    );
}
