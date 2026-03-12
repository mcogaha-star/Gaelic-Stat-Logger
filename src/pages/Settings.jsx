const db = globalThis.__B44_DB__ || {
  auth: { isAuthenticated: async () => false, me: async () => null },
  entities: new Proxy({}, { get: () => ({ filter: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
  integrations: { Core: { UploadFile: async () => ({ file_url: '' }) } }
};

import React, { useState, useEffect } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Save, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_CLICK_STATS, DEFAULT_DRAG_STATS, DEFAULT_DEFAULTS, DEFAULT_SUB_MENUS } from '@/components/statDefaults';
import SubMenuEditor from '@/components/settings/SubMenuEditor';

export default function Settings() {
    const queryClient = useQueryClient();

    const { data: settingsRecords = [] } = useQuery({
        queryKey: ['app-settings'],
        queryFn: () => db.entities.AppSettings.list()
    });

    const settingsRecord = settingsRecords[0];

    const [clickStats, setClickStats] = useState(DEFAULT_CLICK_STATS);
    const [dragStats, setDragStats] = useState(DEFAULT_DRAG_STATS);
    const [defaults, setDefaults] = useState(DEFAULT_DEFAULTS);
    const [subMenus, setSubMenus] = useState(DEFAULT_SUB_MENUS);
    const [addingClick, setAddingClick] = useState(false);
    const [addingDrag, setAddingDrag] = useState(false);
    const [newClickStat, setNewClickStat] = useState({ value: '', label: '', color: '#64748b', category: 'other' });
    const [newDragStat, setNewDragStat] = useState({ value: '', label: '', color: '#64748b' });

    useEffect(() => {
        if (settingsRecord) {
            try { if (settingsRecord.click_stats_config) setClickStats(JSON.parse(settingsRecord.click_stats_config)); } catch {}
            try { if (settingsRecord.drag_stats_config) setDragStats(JSON.parse(settingsRecord.drag_stats_config)); } catch {}
            try { if (settingsRecord.defaults_config) setDefaults(JSON.parse(settingsRecord.defaults_config)); } catch {}
            try { if (settingsRecord.sub_menus_config) setSubMenus(JSON.parse(settingsRecord.sub_menus_config)); } catch {}
        }
    }, [settingsRecord?.id]);

    const saveMutation = useMutation({
        mutationFn: (data) => settingsRecord
            ? db.entities.AppSettings.update(settingsRecord.id, data)
            : db.entities.AppSettings.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['app-settings'] });
            toast.success('Settings saved');
        }
    });

    const handleSave = () => {
        saveMutation.mutate({
            click_stats_config: JSON.stringify(clickStats),
            drag_stats_config: JSON.stringify(dragStats),
            defaults_config: JSON.stringify(defaults),
            sub_menus_config: JSON.stringify(subMenus),
        });
    };

    const updateClickStat = (value, key, val) => setClickStats(clickStats.map(s => s.value === value ? { ...s, [key]: val } : s));
    const updateDragStat = (value, key, val) => setDragStats(dragStats.map(s => s.value === value ? { ...s, [key]: val } : s));

    const addClickStat = () => {
        if (!newClickStat.label || !newClickStat.value) { toast.error('Fill in both label and value slug'); return; }
        if (clickStats.find(s => s.value === newClickStat.value)) { toast.error('Value slug already exists'); return; }
        setClickStats([...clickStats, { ...newClickStat, visible: true }]);
        setNewClickStat({ value: '', label: '', color: '#64748b', category: 'other' });
        setAddingClick(false);
    };

    const addDragStat = () => {
        if (!newDragStat.label || !newDragStat.value) { toast.error('Fill in both label and value slug'); return; }
        if (dragStats.find(s => s.value === newDragStat.value)) { toast.error('Value slug already exists'); return; }
        setDragStats([...dragStats, { ...newDragStat, visible: true }]);
        setNewDragStat({ value: '', label: '', color: '#64748b' });
        setAddingDrag(false);
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
            <header className="bg-white border-b">
                <div className="max-w-3xl mx-auto px-4 py-6 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link to={createPageUrl('Home')}>
                            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
                            <p className="text-slate-500">Configure stat types and defaults</p>
                        </div>
                    </div>
                    <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2 bg-green-600 hover:bg-green-700">
                        <Save className="w-4 h-4" />
                        {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
                    </Button>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-4 py-8">
                <Tabs defaultValue="click">
                    <TabsList className="mb-6 w-full">
                        <TabsTrigger value="click" className="flex-1">Click Stats</TabsTrigger>
                        <TabsTrigger value="drag" className="flex-1">Drag Stats</TabsTrigger>
                        <TabsTrigger value="submenus" className="flex-1">Sub-menus</TabsTrigger>
                        <TabsTrigger value="defaults" className="flex-1">Defaults</TabsTrigger>
                    </TabsList>

                    {/* Click Stats */}
                    <TabsContent value="click" className="space-y-2">
                        <p className="text-sm text-slate-500 mb-4">Stats logged by tapping a single point on the pitch. Edit labels, colours, and visibility.</p>
                        {clickStats.map(stat => (
                            <div key={stat.value} className="flex items-center gap-2 p-3 border rounded-lg bg-white">
                                <input
                                    type="color"
                                    value={stat.color}
                                    onChange={(e) => updateClickStat(stat.value, 'color', e.target.value)}
                                    className="w-8 h-8 rounded cursor-pointer border flex-shrink-0"
                                />
                                <input
                                    className="flex-1 text-sm font-medium bg-transparent outline-none min-w-0"
                                    value={stat.label}
                                    onChange={(e) => updateClickStat(stat.value, 'label', e.target.value)}
                                />
                                <Select value={stat.category || 'other'} onValueChange={(v) => updateClickStat(stat.value, 'category', v)}>
                                    <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="scoring">Scoring</SelectItem>
                                        <SelectItem value="other">Other</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Badge variant="outline" className="text-xs flex-shrink-0">{stat.value}</Badge>
                                <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={() => updateClickStat(stat.value, 'visible', stat.visible === false ? true : false)}>
                                    {stat.visible !== false ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={() => setClickStats(clickStats.filter(s => s.value !== stat.value))}>
                                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                                </Button>
                            </div>
                        ))}
                        {addingClick ? (
                            <div className="p-4 border rounded-lg bg-white space-y-3 border-dashed border-green-400">
                                <div className="grid grid-cols-2 gap-3">
                                    <div><Label className="text-xs mb-1">Label</Label><Input placeholder="e.g. Mark Won" value={newClickStat.label} onChange={(e) => setNewClickStat({ ...newClickStat, label: e.target.value })} /></div>
                                    <div><Label className="text-xs mb-1">Value Slug</Label><Input placeholder="e.g. mark_won" value={newClickStat.value} onChange={(e) => setNewClickStat({ ...newClickStat, value: e.target.value.toLowerCase().replace(/\s+/g, '_') })} /></div>
                                    <div>
                                        <Label className="text-xs mb-1">Colour</Label>
                                        <div className="flex gap-2"><input type="color" value={newClickStat.color} onChange={(e) => setNewClickStat({ ...newClickStat, color: e.target.value })} className="w-10 h-10 rounded border" /><Input value={newClickStat.color} onChange={(e) => setNewClickStat({ ...newClickStat, color: e.target.value })} /></div>
                                    </div>
                                    <div>
                                        <Label className="text-xs mb-1">Category</Label>
                                        <Select value={newClickStat.category} onValueChange={(v) => setNewClickStat({ ...newClickStat, category: v })}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent><SelectItem value="scoring">Scoring</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={addClickStat} className="bg-green-600 hover:bg-green-700">Add</Button>
                                    <Button size="sm" variant="outline" onClick={() => setAddingClick(false)}>Cancel</Button>
                                </div>
                            </div>
                        ) : (
                            <Button variant="outline" className="w-full gap-2 border-dashed" onClick={() => setAddingClick(true)}>
                                <Plus className="w-4 h-4" /> Add Click Stat
                            </Button>
                        )}
                    </TabsContent>

                    {/* Drag Stats */}
                    <TabsContent value="drag" className="space-y-2">
                        <p className="text-sm text-slate-500 mb-4">Stats logged by dragging between two points (passes, kickouts, carries).</p>
                        {dragStats.map(stat => (
                            <div key={stat.value} className="flex items-center gap-2 p-3 border rounded-lg bg-white">
                                <input
                                    type="color"
                                    value={stat.color}
                                    onChange={(e) => updateDragStat(stat.value, 'color', e.target.value)}
                                    className="w-8 h-8 rounded cursor-pointer border flex-shrink-0"
                                />
                                <input
                                    className="flex-1 text-sm font-medium bg-transparent outline-none"
                                    value={stat.label}
                                    onChange={(e) => updateDragStat(stat.value, 'label', e.target.value)}
                                />
                                <Badge variant="outline" className="text-xs flex-shrink-0">{stat.value}</Badge>
                                <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={() => updateDragStat(stat.value, 'visible', stat.visible === false ? true : false)}>
                                    {stat.visible !== false ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={() => setDragStats(dragStats.filter(s => s.value !== stat.value))}>
                                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                                </Button>
                            </div>
                        ))}
                        {addingDrag ? (
                            <div className="p-4 border rounded-lg bg-white space-y-3 border-dashed border-green-400">
                                <div className="grid grid-cols-2 gap-3">
                                    <div><Label className="text-xs mb-1">Label</Label><Input placeholder="e.g. Sideline Kick" value={newDragStat.label} onChange={(e) => setNewDragStat({ ...newDragStat, label: e.target.value })} /></div>
                                    <div><Label className="text-xs mb-1">Value Slug</Label><Input placeholder="e.g. sideline_kick" value={newDragStat.value} onChange={(e) => setNewDragStat({ ...newDragStat, value: e.target.value.toLowerCase().replace(/\s+/g, '_') })} /></div>
                                    <div className="col-span-2">
                                        <Label className="text-xs mb-1">Colour</Label>
                                        <div className="flex gap-2"><input type="color" value={newDragStat.color} onChange={(e) => setNewDragStat({ ...newDragStat, color: e.target.value })} className="w-10 h-10 rounded border" /><Input value={newDragStat.color} onChange={(e) => setNewDragStat({ ...newDragStat, color: e.target.value })} /></div>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={addDragStat} className="bg-green-600 hover:bg-green-700">Add</Button>
                                    <Button size="sm" variant="outline" onClick={() => setAddingDrag(false)}>Cancel</Button>
                                </div>
                            </div>
                        ) : (
                            <Button variant="outline" className="w-full gap-2 border-dashed" onClick={() => setAddingDrag(true)}>
                                <Plus className="w-4 h-4" /> Add Drag Stat
                            </Button>
                        )}
                    </TabsContent>

                    {/* Sub-menus */}
                    <TabsContent value="submenus" className="space-y-2">
                        <SubMenuEditor
                            subMenus={subMenus}
                            onChange={setSubMenus}
                            allStatTypes={[
                                ...clickStats.map(s => ({ value: s.value, label: s.label })),
                                ...dragStats.map(s => ({ value: s.value, label: s.label })),
                            ]}
                        />
                    </TabsContent>

                    {/* Defaults */}
                    <TabsContent value="defaults">
                        <div className="bg-white border rounded-xl p-6 space-y-4">
                            <p className="text-sm text-slate-500">Default values pre-selected when logging stats.</p>
                            <div className="space-y-2">
                                <Label>Default Half</Label>
                                <Select value={defaults.half || 'first'} onValueChange={(v) => setDefaults({ ...defaults, half: v })}>
                                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="first">1st Half</SelectItem>
                                        <SelectItem value="second">2nd Half</SelectItem>
                                        <SelectItem value="et_first">ET 1st Half</SelectItem>
                                        <SelectItem value="et_second">ET 2nd Half</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </main>
        </div>
    );
}