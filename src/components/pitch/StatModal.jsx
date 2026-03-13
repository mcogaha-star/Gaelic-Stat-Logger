import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DEFAULT_CLICK_STATS, DEFAULT_DRAG_STATS, DEFAULT_SUB_MENUS } from '@/components/statDefaults';

export default function StatModal({
    open,
    onClose,
    playerGroups = [],
    onSubmit,
    isPass = false,
    startCoords,
    endCoords,
    clickStats,
    dragStats,
    subMenus: subMenusProp,
    initialData,
    defaultPlayerId,
    defaultRecipientId,
    submitLabel
}) {
    const activeClickStats = (clickStats || DEFAULT_CLICK_STATS).filter(s => s.visible !== false);
    const activeDragStats = (dragStats || DEFAULT_DRAG_STATS).filter(s => s.visible !== false);
    // Support both old (object) and new (array) sub-menu format
    const subMenus = Array.isArray(subMenusProp) ? subMenusProp : DEFAULT_SUB_MENUS;

    const [selectedPlayer, setSelectedPlayer] = useState('');
    const [selectedRecipient, setSelectedRecipient] = useState('');
    const [selectedStat, setSelectedStat] = useState('');
    const [selectedLoser, setSelectedLoser] = useState('');
    const [passType, setPassType] = useState('');
    const [subMenuValues, setSubMenuValues] = useState({});

    const allPlayers = playerGroups.flatMap(g => g.players || []);

    const buildInitialValues = () => {
        const vals = {};
        subMenus.forEach(s => { vals[s.id] = s.default_value || ''; });
        // v0.3 dynamic fields (not in sub-menu config, but stored in extra_data)
        vals.foul_fouled_player = vals.foul_fouled_player || '';
        vals.foul_fouler_player = vals.foul_fouler_player || '';
        vals.turnover_caused_by = vals.turnover_caused_by || '';
        vals.tackler = vals.tackler || '';
        vals.kickout_intended_recipient = vals.kickout_intended_recipient || '';
        vals.throw_loser_player = vals.throw_loser_player || '';
        return vals;
    };

    useEffect(() => {
        if (!open) return;

        const baseVals = buildInitialValues();
        const mergedVals = { ...baseVals, ...(initialData?.subMenuValues || {}) };
        setSubMenuValues(mergedVals);

        if (initialData) {
            setPassType(initialData.passType || activeDragStats[0]?.value || 'pass');
            setSelectedPlayer(initialData.playerId || '');
            setSelectedRecipient(initialData.recipientId || '');
            setSelectedStat(initialData.statType || '');
            setSelectedLoser(initialData.loserId || '');
            return;
        }

        setPassType(activeDragStats[0]?.value || 'pass');
        setSelectedPlayer(defaultPlayerId || '');
        setSelectedRecipient(defaultRecipientId || '');
        setSelectedStat('');
        setSelectedLoser('');
    }, [open, initialData, defaultPlayerId, defaultRecipientId]);

    // Kickout convenience: if no default player is set, default to #1 when present.
    useEffect(() => {
        if (!open) return;
        if (!isPass) return;
        if (initialData) return;
        if (passType !== 'kickout') return;
        if (selectedPlayer) return;
        const gk = allPlayers.find(p => String(p.number) === '1');
        if (gk?.id) setSelectedPlayer(gk.id);
    }, [open, isPass, initialData, passType, selectedPlayer, allPlayers]);

    const setVal = (id, value) => setSubMenuValues(prev => ({ ...prev, [id]: value }));

    const shouldShowFoulPanel = () => {
        if (!isPass) {
            if (selectedStat === 'foul') return true;
            if (selectedStat === 'turnover') return (subMenuValues.turnover_type || '') === 'foul';
            return false;
        }

        if (passType === 'pass') {
            return (subMenuValues.pass_outcome || '') === 'free_lost';
        }
        if (passType === 'kickout') {
            return (subMenuValues.kickout_outcome || '') === 'foul';
        }
        if (passType === 'carry') {
            const co = subMenuValues.carry_outcome || '';
            return co === 'free_won' || co === 'free_against';
        }
        return false;
    };

    // Current stat identifier for filtering sub-menu sections
    const currentType = isPass ? passType : selectedStat;

    // Dynamically find a sub-menu section by searching for a specific option value and applies_to match
    const findSection = (optionValue, appliesTo) =>
        subMenus.find(s => s.options?.some(o => o.value === optionValue) && (!appliesTo || s.applies_to?.includes(appliesTo)));

    // Evaluate whether a section's condition is met
    const evalCondition = (section) => {
        if (!section.condition) return true;
        if (section.condition === 'not_handpass') {
            const sec = findSection('handpass', 'pass');
            return sec ? subMenuValues[sec.id] !== 'handpass' : true;
        }
        if (section.condition === 'only_play') {
            const sec = subMenus.find(s => s.options?.some(o => o.value === 'play') && s.applies_to?.includes(currentType));
            return sec ? subMenuValues[sec.id] === 'play' : false;
        }
        if (section.condition === 'show_foul_panel') {
            return shouldShowFoulPanel();
        }
        if (section.condition === 'kickout_mark_show') {
            return isPass && passType === 'kickout' && (subMenuValues.kickout_outcome || '') === 'won_clean';
        }
        if (section.condition === 'kickpass_mark_show') {
            if (!isPass || passType !== 'pass') return false;
            if ((subMenuValues.pass_outcome || '') !== 'completed') return false;
            const style = subMenuValues.pass_style || '';
            if (!(style === 'high' || style === 'chest')) return false;
            const passBodySection = subMenus.find(s => s.applies_to?.includes('pass') && s.options?.some(o => o.value === 'handpass'));
            const isHandpass = passBodySection ? (subMenuValues[passBodySection.id] === 'handpass') : false;
            return !isHandpass;
        }
        if (section.condition === 'foul_type_show') {
            const turnoverSec = findSection('foul', 'turnover_against');
            return selectedStat === 'foul_against' ||
                (selectedStat === 'turnover_against' && turnoverSec && subMenuValues[turnoverSec.id] === 'foul');
        }
        return true;
    };

    // Active sections for current type
    const activeSections = subMenus.filter(s =>
        s.applies_to && s.applies_to.includes(currentType) && evalCondition(s)
    );

    // Split by group: 'pre' renders before recipient, 'post' after
    const preSections = activeSections.filter(s => (s.group || 'pre') === 'pre');
    const postSections = activeSections.filter(s => s.group === 'post');

    // Derive stat type for submission
    const derivedStatType = () => {
        if (!isPass) return selectedStat;
        if (passType !== 'pass') return passType;
        const passBodySection = subMenus.find(s => s.applies_to?.includes('pass') && s.options?.some(o => o.value === 'handpass'));
        return passBodySection && subMenuValues[passBodySection.id] === 'handpass' ? 'handpass' : 'kickpass';
    };

    const canSubmit = () => {
        if (!selectedPlayer) return false;
        if (!isPass) return !!selectedStat;
        if (!passType) return false;
        return true;
    };

    const handleSubmit = () => {
        if (!canSubmit()) return;
        const player = allPlayers.find(p => p.id === selectedPlayer);
        const recipient = allPlayers.find(p => p.id === selectedRecipient);
        const loser = allPlayers.find(p => p.id === selectedLoser);
        const data = {
            player,
            recipient: isPass ? recipient : (selectedStat === 'throw_ball_won' ? loser : null),
            stat_type: derivedStatType(),
            is_pass: isPass,
            x_position: startCoords?.x,
            y_position: startCoords?.y,
            end_x_position: endCoords?.x,
            end_y_position: endCoords?.y,
        };
        // Attach all active sub-menu values that have a value set
        activeSections.forEach(s => {
            if (subMenuValues[s.id]) data[s.id] = subMenuValues[s.id];
        });
        // Attach v0.3 dynamic values (player-based pickers etc.)
        ['foul_fouled_player', 'foul_fouler_player', 'turnover_caused_by', 'tackler', 'kickout_intended_recipient', 'throw_loser_player'].forEach((k) => {
            if (subMenuValues[k]) data[k] = subMenuValues[k];
        });
        if (!isPass && selectedStat === 'throw_ball_won') {
            if (selectedLoser) data.throw_loser_player = selectedLoser;
        }
        onSubmit(data);
        onClose();
    };

    const handleClose = () => {
        setSubMenuValues(buildInitialValues());
        setSelectedPlayer(''); setSelectedRecipient(''); setSelectedStat(''); setSelectedLoser('');
        onClose();
    };

    // Click stats grouped by category
    const clickStatsByCategory = activeClickStats.reduce((acc, stat) => {
        const cat = stat.category || 'other';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(stat);
        return acc;
    }, {});

    const PlayerSelect = ({ label, value, onChange }) => (
        <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700">{label}</Label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="h-12"><SelectValue placeholder="Select player..." /></SelectTrigger>
                <SelectContent>
                    {playerGroups.map(group => (
                        <React.Fragment key={group.team?.id || 'all'}>
                            {group.team && (
                                <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-50 sticky top-0">
                                    {group.team.name}
                                </div>
                            )}
                            {(group.players || []).map(p => (
                                <SelectItem key={p.id} value={p.id}>
                                    <span className="font-semibold mr-2">#{p.number}</span>{p.name}
                                </SelectItem>
                            ))}
                        </React.Fragment>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );

    const SpecialPlayerSelect = ({ label, value, onChange, includeUnforced = false }) => (
        <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700">{label}</Label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="h-12"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="team">Team</SelectItem>
                    {includeUnforced && <SelectItem value="unforced">Unforced</SelectItem>}
                    <SelectItem value="none">None</SelectItem>
                    {playerGroups.map(group => (
                        <React.Fragment key={group.team?.id || 'all'}>
                            {group.team && (
                                <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-50 sticky top-0">
                                    {group.team.name}
                                </div>
                            )}
                            {(group.players || []).map(p => (
                                <SelectItem key={p.id} value={p.id}>
                                    <span className="font-semibold mr-2">#{p.number}</span>{p.name}
                                </SelectItem>
                            ))}
                        </React.Fragment>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );

    const renderSection = (section) => {
        const val = subMenuValues[section.id] || '';
        const opts = section.options || [];
        if (opts.length === 0) return null;

        if (section.display_type === 'select') {
            if (opts.length <= 4) {
                const cols = opts.length <= 2 ? opts.length : 2;
                return (
                    <div key={section.id} className="space-y-2">
                        <Label className="text-sm font-medium text-slate-700">{section.label}</Label>
                        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                            {opts.map(opt => (
                                <Button
                                    key={opt.value}
                                    type="button"
                                    variant={val === opt.value ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setVal(section.id, opt.value)}
                                    className="text-xs"
                                >
                                    {opt.label}
                                </Button>
                            ))}
                        </div>
                    </div>
                );
            }
            return (
                <div key={section.id} className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">{section.label}</Label>
                    <Select value={val} onValueChange={(v) => setVal(section.id, v)}>
                        <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent>
                            {opts.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
            );
        }

        if (section.display_type === 'radio') {
            return (
                <div key={section.id} className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">{section.label}</Label>
                    <RadioGroup value={val} onValueChange={(v) => setVal(section.id, v)}>
                        <div className={`grid gap-2 ${opts.length <= 2 ? 'grid-cols-2' : opts.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                            {opts.map(opt => (
                                <div key={opt.value} className="flex items-center space-x-2 border rounded-md p-2 cursor-pointer hover:bg-slate-50" onClick={() => setVal(section.id, opt.value)}>
                                    <RadioGroupItem value={opt.value} id={`${section.id}_${opt.value}`} />
                                    <Label htmlFor={`${section.id}_${opt.value}`} className="cursor-pointer text-xs">{opt.label}</Label>
                                </div>
                            ))}
                        </div>
                    </RadioGroup>
                </div>
            );
        }

        // buttons (default)
        const cols = opts.length <= 2 ? opts.length : opts.length <= 4 ? 2 : 3;
        return (
            <div key={section.id} className="space-y-2">
                <Label className="text-sm font-medium text-slate-700">{section.label}</Label>
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                    {opts.map(opt => (
                        <Button
                            key={opt.value}
                            type="button"
                            variant={val === opt.value ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setVal(section.id, opt.value)}
                            className="text-xs"
                        >
                            {opt.label}
                        </Button>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="w-full sm:max-w-xl md:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="text-xl font-semibold">
                        {isPass ? 'Log Pass / Carry' : 'Log Stat'}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-5 py-4 flex-1 overflow-y-auto pr-1">
                    {/* Player */}
                    <PlayerSelect
                        label={!isPass && selectedStat === 'foul' ? 'Fouler' : (!isPass && selectedStat === 'throw_ball_won' ? 'Winner' : (isPass ? 'Passer / Carrier' : 'Player'))}
                        value={selectedPlayer}
                        onChange={setSelectedPlayer}
                    />

                    {/* Drag type selector */}
                    {isPass && activeDragStats.length > 0 && (
                        <div className="space-y-2">
                            <Label className="text-sm font-medium text-slate-700">Type</Label>
                            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${activeDragStats.length}, 1fr)` }}>
                                {activeDragStats.map(opt => (
                                    <Button
                                        key={opt.value}
                                        type="button"
                                        variant={passType === opt.value ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => setPassType(opt.value)}
                                    >
                                        {opt.label}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Click stat type picker */}
                    {!isPass && (
                        <div className="space-y-3">
                            <Label className="text-sm font-medium text-slate-700">Stat Type</Label>
                            <div className="space-y-4 max-h-52 overflow-y-auto pr-1">
                                {Object.entries(clickStatsByCategory).map(([cat, stats]) => (
                                    <div key={cat}>
                                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 capitalize">{cat}</div>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                            {stats.map(stat => (
                                                <Button
                                                    key={stat.value}
                                                    type="button"
                                                    variant={selectedStat === stat.value ? 'default' : 'outline'}
                                                    size="sm"
                                                    onClick={() => setSelectedStat(stat.value)}
                                                    className="justify-start text-xs h-auto py-1.5"
                                                >
                                                    <div className="w-2 h-2 rounded-full mr-1.5 flex-shrink-0" style={{ backgroundColor: stat.color }} />
                                                    {stat.label}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Pre-recipient dynamic sections */}
                    {preSections.map(renderSection)}

                    {/* Turnover "won by" (player/team/unforced) */}
                    {!isPass && selectedStat === 'turnover' && (
                        <SpecialPlayerSelect
                            label="Won By"
                            value={subMenuValues.turnover_caused_by || ''}
                            onChange={(v) => setVal('turnover_caused_by', v)}
                            includeUnforced={true}
                        />
                    )}

                    {/* Throw ball won: loser */}
                    {!isPass && selectedStat === 'throw_ball_won' && (
                        <SpecialPlayerSelect
                            label="Loser"
                            value={selectedLoser || ''}
                            onChange={(v) => setSelectedLoser(v)}
                        />
                    )}

                    {/* Recipient (pass + kickout) */}
                    {isPass && (passType === 'pass' || passType === 'kickout') && (
                        <PlayerSelect label="Recipient" value={selectedRecipient} onChange={setSelectedRecipient} />
                    )}

                    {/* Kickout intended recipient */}
                    {isPass && passType === 'kickout' && (
                        <SpecialPlayerSelect
                            label="Intended Recipient"
                            value={subMenuValues.kickout_intended_recipient || ''}
                            onChange={(v) => setVal('kickout_intended_recipient', v)}
                        />
                    )}

                    {/* Carry: dispossession tackler */}
                    {isPass && passType === 'carry' && (subMenuValues.carry_outcome || '') === 'dispossessed' && (
                        <SpecialPlayerSelect
                            label="Tackler"
                            value={subMenuValues.tackler || ''}
                            onChange={(v) => setVal('tackler', v)}
                        />
                    )}

                    {/* Foul-related player dropdowns */}
                    {shouldShowFoulPanel() && (
                        <>
                            {/* Carry free won/against have different semantics */}
                            {isPass && passType === 'carry' && (subMenuValues.carry_outcome || '') === 'free_won' && (
                                <SpecialPlayerSelect
                                    label="Fouler"
                                    value={subMenuValues.foul_fouler_player || ''}
                                    onChange={(v) => setVal('foul_fouler_player', v)}
                                />
                            )}
                            {isPass && passType === 'carry' && (subMenuValues.carry_outcome || '') === 'free_against' && (
                                <SpecialPlayerSelect
                                    label="Player Fouled"
                                    value={subMenuValues.foul_fouled_player || ''}
                                    onChange={(v) => setVal('foul_fouled_player', v)}
                                />
                            )}

                            {/* Foul/turnover: pick player fouled */}
                            {!isPass && (selectedStat === 'foul' || selectedStat === 'turnover') && (
                                <SpecialPlayerSelect
                                    label="Player Fouled"
                                    value={subMenuValues.foul_fouled_player || ''}
                                    onChange={(v) => setVal('foul_fouled_player', v)}
                                />
                            )}
                            {/* Pass free lost: select fouler */}
                            {isPass && passType === 'pass' && (subMenuValues.pass_outcome || '') === 'free_lost' && (
                                <SpecialPlayerSelect
                                    label="Fouler"
                                    value={subMenuValues.foul_fouler_player || ''}
                                    onChange={(v) => setVal('foul_fouler_player', v)}
                                />
                            )}

                            {/* Kickout foul: pick player fouled */}
                            {isPass && passType === 'kickout' && (subMenuValues.kickout_outcome || '') === 'foul' && (
                                <SpecialPlayerSelect
                                    label="Player Fouled"
                                    value={subMenuValues.foul_fouled_player || ''}
                                    onChange={(v) => setVal('foul_fouled_player', v)}
                                />
                            )}
                        </>
                    )}

                    {/* Post-recipient dynamic sections */}
                    {postSections.map(renderSection)}
                </div>

                <div className="flex gap-3 pt-4 border-t">
                    <Button variant="outline" onClick={handleClose} className="flex-1">Cancel</Button>
                    <Button onClick={handleSubmit} disabled={!canSubmit()} className="flex-1 bg-green-600 hover:bg-green-700">
                        {submitLabel || 'Log Stat'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
