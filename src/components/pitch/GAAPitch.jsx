import React, { useRef, useState, useCallback } from 'react';

const PITCH_W = 145;
const PITCH_H = 85;

export default function GAAPitch({ onPointClick, onPassDraw, debug = false }) {
    const svgRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const [startPoint, setStartPoint] = useState(null);
    const [currentPoint, setCurrentPoint] = useState(null);
    const [hoverPoint, setHoverPoint] = useState(null);

    const getCoordinates = useCallback((e) => {
        const svg = svgRef.current;
        if (!svg) return null;
        
        const rect = svg.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        const x = ((clientX - rect.left) / rect.width) * PITCH_W;
        const y = ((clientY - rect.top) / rect.height) * PITCH_H;
        
        return { x: Math.max(0, Math.min(PITCH_W, x)), y: Math.max(0, Math.min(PITCH_H, y)) };
    }, []);

    const handleMouseDown = (e) => {
        e.preventDefault();
        const coords = getCoordinates(e);
        if (coords) {
            setStartPoint(coords);
            setCurrentPoint(coords);
            setIsDragging(true);
        }
    };

    const handleMouseMove = (e) => {
        e.preventDefault();
        const coords = getCoordinates(e);
        if (!coords) return;
        setHoverPoint(coords);
        if (isDragging) setCurrentPoint(coords);
    };

    const handleMouseUp = (e) => {
        if (!isDragging || !startPoint) return;
        
        const endPoint = getCoordinates(e) || currentPoint;
        const distance = Math.sqrt(
            Math.pow(endPoint.x - startPoint.x, 2) + 
            Math.pow(endPoint.y - startPoint.y, 2)
        );

        if (distance < 3) {
            onPointClick(startPoint);
        } else {
            onPassDraw(startPoint, endPoint);
        }

        setIsDragging(false);
        setStartPoint(null);
        setCurrentPoint(null);
    };

    return (
        <div className="w-full aspect-[145/85] relative select-none">
            <svg
                ref={svgRef}
                viewBox={`0 0 ${PITCH_W} ${PITCH_H}`}
                className="absolute inset-0 w-full h-full cursor-crosshair"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleMouseDown}
                onTouchMove={handleMouseMove}
                onTouchEnd={handleMouseUp}
            >
                {/* Pitch background styled to match the provided reference image */}
                <rect x="0" y="0" width={PITCH_W} height={PITCH_H} fill="#49d21f" />

                {/* Lighter end-zone bands (approx) */}
                <rect x="13" y="0" width="7" height={PITCH_H} fill="#9be37a" opacity="0.65" />
                <rect x={PITCH_W - 20} y="0" width="7" height={PITCH_H} fill="#9be37a" opacity="0.65" />

                {/* Main boundary */}
                <rect x="0" y="0" width={PITCH_W} height={PITCH_H} fill="none" stroke="#dff3c6" strokeWidth="0.9" />

                {/* Key vertical lines (13m, 20m, 45m, halfway, mirrored) */}
                {[
                    13, 20, 45,
                    PITCH_W / 2,
                    PITCH_W - 45, PITCH_W - 20, PITCH_W - 13,
                ].map((x) => (
                    <line key={x} x1={x} y1="0" x2={x} y2={PITCH_H} stroke="#dff3c6" strokeWidth="0.9" opacity="0.95" />
                ))}

                {/* Halfway dashed line */}
                <line
                    x1={PITCH_W / 2}
                    y1="0"
                    x2={PITCH_W / 2}
                    y2={PITCH_H}
                    stroke="#dff3c6"
                    strokeWidth="1.0"
                    strokeDasharray="2.5,2.5"
                    opacity="0.95"
                />

                {/* Large/small rectangles (approx) */}
                {(() => {
                    const centerY = PITCH_H / 2;
                    const smallW = 4.5;
                    const smallH = 14;
                    const bigW = 13;
                    const bigH = 28;
                    return (
                        <>
                            {/* Left goal areas */}
                            <rect x="0" y={centerY - bigH / 2} width={bigW} height={bigH} fill="none" stroke="#dff3c6" strokeWidth="0.9" />
                            <rect x="0" y={centerY - smallH / 2} width={smallW} height={smallH} fill="none" stroke="#dff3c6" strokeWidth="0.9" />
                            {/* Right goal areas */}
                            <rect x={PITCH_W - bigW} y={centerY - bigH / 2} width={bigW} height={bigH} fill="none" stroke="#dff3c6" strokeWidth="0.9" />
                            <rect x={PITCH_W - smallW} y={centerY - smallH / 2} width={smallW} height={smallH} fill="none" stroke="#dff3c6" strokeWidth="0.9" />
                        </>
                    );
                })()}

                {/* 20m arcs (approx, centered on goal) */}
                {(() => {
                    const cy = PITCH_H / 2;
                    const r = 20;
                    return (
                        <>
                            <path d={`M 20 ${cy - r} A ${r} ${r} 0 0 1 20 ${cy + r}`} fill="none" stroke="#dff3c6" strokeWidth="0.9" opacity="0.95" />
                            <path d={`M ${PITCH_W - 20} ${cy - r} A ${r} ${r} 0 0 0 ${PITCH_W - 20} ${cy + r}`} fill="none" stroke="#dff3c6" strokeWidth="0.9" opacity="0.95" />
                        </>
                    );
                })()}

                {debug && (
                    <>
                        {/* Calibration helpers: key lines and snap points */}
                        <line x1={PITCH_W / 2} y1="0" x2={PITCH_W / 2} y2={PITCH_H} stroke="white" strokeWidth="0.3" opacity="0.6" />
                        <line x1="0" y1={PITCH_H / 2} x2={PITCH_W} y2={PITCH_H / 2} stroke="white" strokeWidth="0.3" opacity="0.6" />
                        <circle cx="20" cy={PITCH_H / 2} r="1.2" fill="#f59e0b" opacity="0.9" />
                        <circle cx={PITCH_W - 20} cy={PITCH_H / 2} r="1.2" fill="#f59e0b" opacity="0.9" />

                        {hoverPoint && (
                            <>
                                <line x1={hoverPoint.x} y1="0" x2={hoverPoint.x} y2={PITCH_H} stroke="#60a5fa" strokeWidth="0.25" opacity="0.5" />
                                <line x1="0" y1={hoverPoint.y} x2={PITCH_W} y2={hoverPoint.y} stroke="#60a5fa" strokeWidth="0.25" opacity="0.5" />
                                <circle cx={hoverPoint.x} cy={hoverPoint.y} r="1.1" fill="#60a5fa" opacity="0.9" />
                                <text x="2" y="6" fontSize="4" fill="white" opacity="0.9">
                                    {`x=${hoverPoint.x.toFixed(1)} y=${hoverPoint.y.toFixed(1)}`}
                                </text>
                            </>
                        )}
                    </>
                )}

                {/* Drawing line when dragging */}
                {isDragging && startPoint && currentPoint && (
                    <>
                        <line
                            x1={startPoint.x}
                            y1={startPoint.y}
                            x2={currentPoint.x}
                            y2={currentPoint.y}
                            stroke="#fbbf24"
                            strokeWidth="0.8"
                            strokeDasharray="2,1"
                        />
                        <circle cx={startPoint.x} cy={startPoint.y} r="1.5" fill="#22c55e" />
                        <circle cx={currentPoint.x} cy={currentPoint.y} r="1.5" fill="#ef4444" />
                    </>
                )}
            </svg>
        </div>
    );
}
