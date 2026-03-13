import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';

const CONDITIONS = [
    { value: '__none__', label: 'Always show' },
    { value: 'not_handpass', label: 'Hide when Handpass selected' },
    { value: 'only_play', label: 'Only when Shot Situation = Play' },
    { value: 'show_foul_panel', label: 'Only when a foul panel applies (v0.3)' },
    { value: 'kickout_mark_show', label: 'Only when Kickout outcome = Won Clean (v0.3)' },
    { value: 'kickpass_mark_show', label: 'Only when Kickpass completed + high/chest (v0.3)' },
    // Legacy condition kept for backwards compatibility
    { value: 'foul_type_show', label: 'Only for foul-related stats (legacy)' },
];

const DISPLAY_TYPES = [
    { value: 'buttons', label: 'Buttons' },
    { value: 'radio', label: 'Radio (with border)' },
    { value: 'select', label: 'Dropdown' },
];

const GROUPS = [
    { value: 'pre', label: 'Before recipient (for pass type)' },
    { value: 'post', label: 'After recipient (for pass type)' },
];

function OptionRow({ opt, onChangeLabel, onChangeValue, onDelete }) {
    return (
        <div className="flex gap-2 items-center">
            <Input
                className="h-7 text-xs flex-1"
                value={opt.label}
                onChange={(e) => onChangeLabel(e.target.value)}
                placeholder="Label"
            />
            <Input
                className="h-7 text-xs w-28 font-mono"
                value={opt.value}
                onChange={(e) => onChangeValue(e.target.value)}
                placeholder="value"
            />
            <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={onDelete}>
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
            </Button>
        </div>
    );
}

function SectionCard({ section, allStatTypes, onUpdate, onDelete }) {
    const [expanded, setExpanded] = useState(false);
    const [newOpt, setNewOpt] = useState({ label: '', value: '' });

    const update = (key, val) => onUpdate({ ...section, [key]: val });

    const updateOption = (idx, key, val) => {
        const opts = [...section.options];
        opts[idx] = { ...opts[idx], [key]: val };
        update('options', opts);
    };

    const addOption = () => {
        if (!newOpt.label || !newOpt.value) return;
        update('options', [...section.options, { ...newOpt }]);
        setNewOpt({ label: '', value: '' });
    };

    const removeOption = (idx) => {
        update('options', section.options.filter((_, i) => i !== idx));
    };

    const toggleAppliesTo = (statValue) => {
        const current = section.applies_to || [];
        const next = current.includes(statValue)
            ? current.filter(v => v !== statValue)
            : [...current, statValue];
        update('applies_to', next);
    };

    return (
        <div className="border rounded-lg bg-white overflow-hidden">
            {/* Section header */}
            <div className="flex items-center gap-2 px-3 py-2">
                <GripVertical className="w-4 h-4 text-slate-300 flex-shrink-0" />
                <input
                    className="flex-1 text-sm font-medium bg-transparent outline-none min-w-0"
                    value={section.label}
                    onChange={(e) => update('label', e.target.value)}
                    placeholder="Section name"
                />
                <span className="text-xs text-slate-400 flex-shrink-0">{section.options.length} opts</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={onDelete}>
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={() => setExpanded(e => !e)}>
                    {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                </Button>
            </div>

            {expanded && (
                <div className="border-t bg-slate-50 px-4 py-3 space-y-4">
                    {/* Applies to */}
                    <div>
                        <Label className="text-xs text-slate-500 mb-2 block">Applies to (which stat types show this section)</Label>
                        <div className="flex flex-wrap gap-1.5">
                            {allStatTypes.map(st => (
                                <button
                                    key={st.value}
                                    type="button"
                                    onClick={() => toggleAppliesTo(st.value)}
                                    className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                                        (section.applies_to || []).includes(st.value)
                                            ? 'bg-slate-800 text-white border-slate-800'
                                            : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500'
                                    }`}
                                >
                                    {st.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Display type & condition & group */}
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <Label className="text-xs text-slate-500 mb-1 block">Display</Label>
                            <Select value={section.display_type || 'buttons'} onValueChange={(v) => update('display_type', v)}>
                                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {DISPLAY_TYPES.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label className="text-xs text-slate-500 mb-1 block">Condition</Label>
                            <Select value={section.condition || '__none__'} onValueChange={(v) => update('condition', v === '__none__' ? null : v)}>
                                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {CONDITIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label className="text-xs text-slate-500 mb-1 block">Default value</Label>
                            <Select value={section.default_value || '__none__'} onValueChange={(v) => update('default_value', v === '__none__' ? '' : v)}>
                                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">— none —</SelectItem>
                                    {section.options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div>
                        <Label className="text-xs text-slate-500 mb-1 block">Position (pass type only)</Label>
                        <Select value={section.group || 'pre'} onValueChange={(v) => update('group', v)}>
                            <SelectTrigger className="h-7 text-xs w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {GROUPS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Options */}
                    <div>
                        <Label className="text-xs text-slate-500 mb-2 block">Options <span className="text-slate-400">(label / value_slug)</span></Label>
                        <div className="space-y-1.5">
                            {section.options.map((opt, idx) => (
                                <OptionRow
                                    key={idx}
                                    opt={opt}
                                    onChangeLabel={(v) => updateOption(idx, 'label', v)}
                                    onChangeValue={(v) => updateOption(idx, 'value', v.toLowerCase().replace(/\s+/g, '_'))}
                                    onDelete={() => removeOption(idx)}
                                />
                            ))}
                        </div>
                        {/* Add option row */}
                        <div className="flex gap-2 items-center mt-2 pt-2 border-t border-slate-200">
                            <Input
                                className="h-7 text-xs flex-1"
                                placeholder="New label"
                                value={newOpt.label}
                                onChange={(e) => setNewOpt(p => ({ ...p, label: e.target.value }))}
                                onKeyDown={(e) => e.key === 'Enter' && addOption()}
                            />
                            <Input
                                className="h-7 text-xs w-28 font-mono"
                                placeholder="value_slug"
                                value={newOpt.value}
                                onChange={(e) => setNewOpt(p => ({ ...p, value: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                                onKeyDown={(e) => e.key === 'Enter' && addOption()}
                            />
                            <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={addOption}>
                                <Plus className="w-3.5 h-3.5 text-green-600" />
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function SubMenuEditor({ subMenus, onChange, allStatTypes = [] }) {
    const [addingSection, setAddingSection] = useState(false);
    const [newSection, setNewSection] = useState({ label: '', applies_to: [], display_type: 'buttons', condition: null, group: 'pre', default_value: '', options: [] });

    const updateSection = (id, updated) => onChange(subMenus.map(s => s.id === id ? updated : s));
    const deleteSection = (id) => onChange(subMenus.filter(s => s.id !== id));

    const confirmAddSection = () => {
        if (!newSection.label.trim()) return;
        const id = newSection.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_' + Date.now();
        onChange([...subMenus, { ...newSection, id }]);
        setNewSection({ label: '', applies_to: [], display_type: 'buttons', condition: null, group: 'pre', default_value: '', options: [] });
        setAddingSection(false);
    };

    const toggleNewAppliesTo = (val) => {
        const current = newSection.applies_to;
        setNewSection(p => ({
            ...p,
            applies_to: current.includes(val) ? current.filter(v => v !== val) : [...current, val]
        }));
    };

    return (
        <div className="space-y-2">
            <p className="text-sm text-slate-500 mb-4">
                Define form sections shown when logging a stat. Each section can apply to specific stat types, show/hide based on conditions, and have fully custom options.
            </p>

            {subMenus.map(section => (
                <SectionCard
                    key={section.id}
                    section={section}
                    allStatTypes={allStatTypes}
                    onUpdate={(updated) => updateSection(section.id, updated)}
                    onDelete={() => deleteSection(section.id)}
                />
            ))}

            {addingSection ? (
                <div className="border border-dashed border-green-400 rounded-lg bg-white p-4 space-y-3">
                    <div>
                        <Label className="text-xs mb-1">Section name *</Label>
                        <Input
                            placeholder="e.g. Shot Type"
                            value={newSection.label}
                            onChange={(e) => setNewSection(p => ({ ...p, label: e.target.value }))}
                            autoFocus
                        />
                    </div>
                    <div>
                        <Label className="text-xs text-slate-500 mb-2 block">Applies to</Label>
                        <div className="flex flex-wrap gap-1.5">
                            {allStatTypes.map(st => (
                                <button
                                    key={st.value}
                                    type="button"
                                    onClick={() => toggleNewAppliesTo(st.value)}
                                    className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                                        newSection.applies_to.includes(st.value)
                                            ? 'bg-slate-800 text-white border-slate-800'
                                            : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500'
                                    }`}
                                >
                                    {st.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label className="text-xs mb-1">Display type</Label>
                            <Select value={newSection.display_type} onValueChange={(v) => setNewSection(p => ({ ...p, display_type: v }))}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>{DISPLAY_TYPES.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label className="text-xs mb-1">Condition</Label>
                            <Select value={newSection.condition || '__none__'} onValueChange={(v) => setNewSection(p => ({ ...p, condition: v === '__none__' ? null : v }))}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>{CONDITIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" onClick={confirmAddSection} className="bg-green-600 hover:bg-green-700">Add Section</Button>
                        <Button size="sm" variant="outline" onClick={() => setAddingSection(false)}>Cancel</Button>
                    </div>
                </div>
            ) : (
                <Button variant="outline" className="w-full gap-2 border-dashed" onClick={() => setAddingSection(true)}>
                    <Plus className="w-4 h-4" /> Add New Section
                </Button>
            )}
        </div>
    );
}
