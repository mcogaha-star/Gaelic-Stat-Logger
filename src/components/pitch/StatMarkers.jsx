import React from 'react';

import { DEFAULT_CLICK_STATS, DEFAULT_DRAG_STATS } from '@/components/statDefaults';

const buildColorMap = (clickStats, dragStats) => {
    const map = {};
    (clickStats || DEFAULT_CLICK_STATS).forEach(s => { map[s.value] = s.color; });
    (dragStats || DEFAULT_DRAG_STATS).forEach(s => { map[s.value] = s.color; });
    // pass/carry/kickout derived types
    map['handpass'] = '#06b6d4';
    map['kickpass'] = '#14b8a6';
    map['kickout'] = '#8b5cf6';
    map['carry'] = '#14b8a6';
    return map;
};

export default function StatMarkers({ stats, clickStats, dragStats }) {
    const STAT_COLORS = buildColorMap(clickStats, dragStats);
    // Find the most recent pass for line display
    const mostRecentPass = [...stats].reverse().find(stat => stat.is_pass && stat.end_x_position != null);
    
    return (
        <svg viewBox="0 0 140 90" className="absolute inset-0 w-full h-full pointer-events-none">
            {stats.map((stat, index) => {
                const color = STAT_COLORS[stat.stat_type] || '#ffffff';
                
                // Only show pass line for the most recent pass
                if (stat.is_pass && stat.end_x_position != null && stat.id === mostRecentPass?.id) {
                    return (
                        <g key={index}>
                            <line
                                x1={stat.x_position}
                                y1={stat.y_position}
                                x2={stat.end_x_position}
                                y2={stat.end_y_position}
                                stroke={color}
                                strokeWidth="0.6"
                                markerEnd="url(#arrowhead)"
                            />
                            <circle
                                cx={stat.x_position}
                                cy={stat.y_position}
                                r="1.2"
                                fill={color}
                            />
                            <circle
                                cx={stat.end_x_position}
                                cy={stat.end_y_position}
                                r="1.2"
                                fill={color}
                                fillOpacity="0.6"
                            />
                        </g>
                    );
                }
                
                // Show all non-pass markers (or pass markers without lines)
                return (
                    <circle
                        key={index}
                        cx={stat.x_position}
                        cy={stat.y_position}
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