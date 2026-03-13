import React from 'react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, ArrowRight, Pencil } from 'lucide-react';
import { format } from 'date-fns';

const formatStatType = (type) => {
    return type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || '';
};

const safeParse = (s) => {
    try { return JSON.parse(s); } catch { return {}; }
};

const formatHalf = (half) =>
    half === 'second' ? '2nd'
        : half === 'et_first' ? 'ET 1st'
            : half === 'et_second' ? 'ET 2nd'
                : '1st';

export default function RecentStats({ stats, onDelete, onEdit }) {
    if (stats.length === 0) {
        return (
            <div className="bg-white rounded-xl border p-6 text-center text-slate-400">
                <p>No stats logged yet</p>
                <p className="text-sm mt-1">Click or drag on the pitch to log stats</p>
            </div>
        );
    }

    const recentStats = [...stats]
        .sort((a, b) => {
            const at = a?.timestamp || a?.created_date || '';
            const bt = b?.timestamp || b?.created_date || '';
            return String(bt).localeCompare(String(at));
        })
        .slice(0, 10);

    return (
        <div className="bg-white rounded-xl border">
            <div className="p-4 border-b">
                <h3 className="font-semibold text-slate-900">Recent Stats</h3>
            </div>
            <ScrollArea className="h-64">
                <div className="p-2 space-y-1">
                    {recentStats.map((stat) => (
                        (() => {
                            const extra = stat?.extra_data ? safeParse(stat.extra_data) : {};
                            const isSub = stat.stat_type === 'substitution';
                            const isPeriodEnd = stat.stat_type === 'period_end';
                            const titleLeft = stat.player_number != null ? `#${stat.player_number} ${stat.player_name || ''}`.trim() : '';
                            const titleRight = stat.recipient_number != null ? `#${stat.recipient_number} ${stat.recipient_name || ''}`.trim() : '';

                            const primaryTitle = isSub
                                ? `Sub: ${titleLeft || 'Out'} → ${titleRight || 'In'}`
                                : isPeriodEnd
                                    ? `End of ${formatHalf(extra.period || stat.half)} half`
                                    : (titleLeft || 'Event');

                            const secondary = isSub
                                ? ''
                                : isPeriodEnd
                                    ? ''
                                    : formatStatType(stat.stat_type);

                            return (
                        <div 
                            key={stat.id}
                            className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 group transition-colors"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-slate-900 truncate">
                                        {primaryTitle}
                                    </span>
                                    {(!isSub && (stat.is_pass || stat.stat_type === 'throw_ball_won') && stat.recipient_name) && (
                                        <>
                                            <ArrowRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                            <span className="text-slate-600 truncate">
                                                #{stat.recipient_number} {stat.recipient_name}
                                            </span>
                                        </>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    {secondary && (
                                        <span className="text-sm text-slate-500">
                                            {secondary}
                                        </span>
                                    )}
                                    <span className="text-xs text-slate-400">
                                        - {formatHalf(stat.half)} half
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => onEdit?.(stat)}
                                    title="Edit stat"
                                    disabled={isPeriodEnd}
                                >
                                    <Pencil className="w-4 h-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => onDelete(stat.id)}
                                    title="Delete stat"
                                >
                                    <Trash2 className="w-4 h-4 text-red-500" />
                                </Button>
                            </div>
                        </div>
                            );
                        })()
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}
