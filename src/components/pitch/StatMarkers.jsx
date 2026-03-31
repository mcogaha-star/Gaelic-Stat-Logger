import React from 'react';

import { DEFAULT_CLICK_STATS, DEFAULT_DRAG_STATS } from '@/components/statDefaults';

const PITCH_W = 145;
const PITCH_H = 85;

const buildColorMap = (clickStats, dragStats) => {
    const map = {};
    (clickStats || DEFAULT_CLICK_STATS).forEach(s => { map[s.value] = s.color; });
    (dragStats || DEFAULT_DRAG_STATS).forEach(s => { map[s.value] = s.color; });
    // v0.4 primary actions only (no derived handpass/kickpass types).
    return map;
};

export default function StatMarkers({ stats, clickStats, dragStats }) {
    const STAT_COLORS = buildColorMap(clickStats, dragStats);

    const mostRecent = (() => {
        if (!stats?.length) return null;
        return [...stats].sort((a, b) => {
            const at = a?.timestamp || a?.created_date || '';
            const bt = b?.timestamp || b?.created_date || '';
            return String(bt).localeCompare(String(at));
        })[0];
    })();

    const getPitchDimsForStat = (stat) => {
        // New logs embed pitch dims in extra_data.pitch; older logs assume 140x90.
        try {
            const extra = stat?.extra_data ? JSON.parse(stat.extra_data) : null;
            const w = extra?.pitch?.w;
            const h = extra?.pitch?.h;
            if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) return { w, h };
        } catch {}
        return { w: 140, h: 90 };
    };

    const toCurrentPlane = (stat, point) => {
        if (!point) return null;
        const dims = getPitchDimsForStat(stat);
        if (dims.w === PITCH_W && dims.h === PITCH_H) return point;
        return {
            x: (point.x / dims.w) * PITCH_W,
            y: (point.y / dims.h) * PITCH_H,
        };
    };
    
    return (
        <svg viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} className="absolute inset-0 w-full h-full pointer-events-none">
            {stats.map((stat, index) => {
                if (!mostRecent || stat.id !== mostRecent.id) return null;
                if (stat?.raw_x_position == null || stat?.raw_y_position == null) return null;
                const color = STAT_COLORS[stat.stat_type] || '#ffffff';

                const start = toCurrentPlane(stat, { x: stat.raw_x_position, y: stat.raw_y_position });
                const end = (stat.raw_end_x_position != null && stat.raw_end_y_position != null)
                    ? toCurrentPlane(stat, { x: stat.raw_end_x_position, y: stat.raw_end_y_position })
                    : null;
                
                // Only show a line for the most recent drag stat when an end point is present.
                if (stat.is_pass && end) {
                    return (
                        <g key={index}>
                            <line
                                x1={start.x}
                                y1={start.y}
                                x2={end.x}
                                y2={end.y}
                                stroke={color}
                                strokeWidth="0.6"
                                markerEnd="url(#arrowhead)"
                            />
                            <circle
                                cx={start.x}
                                cy={start.y}
                                r="1.2"
                                fill={color}
                            />
                            <circle
                                cx={end.x}
                                cy={end.y}
                                r="1.2"
                                fill={color}
                                fillOpacity="0.6"
                            />
                        </g>
                    );
                }
                
                // Show only the most recent marker as a dot.
                return (
                    <circle
                        key={index}
                        cx={start.x}
                        cy={start.y}
                        r="1.5"
                        fill={color}
                        stroke="white"
                        strokeWidth="0.3"
                    />
                );
            })}
            <defs>
                <marker
                    id="arrowhead"
                    markerWidth="4"
                    markerHeight="4"
                    refX="3"
                    refY="2"
                    orient="auto"
                >
                    <polygon points="0 0, 4 2, 0 4" fill="#ffffff" />
                </marker>
            </defs>
        </svg>
    );
}
