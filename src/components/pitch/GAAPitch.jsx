import React, { useRef, useState, useCallback } from 'react';
import pitchImg from '@/assets/pitch.png';

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
            {/* Background image (replace src/assets/pitch.png with your exact pitch image) */}
            <img
                src={pitchImg}
                alt="Gaelic Pitch"
                className="absolute inset-0 w-full h-full object-fill"
                draggable="false"
            />
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
                        {/* Use high-contrast colors so points don't blend into the pitch. */}
                        <circle cx={startPoint.x} cy={startPoint.y} r="1.6" fill="#38bdf8" stroke="#0f172a" strokeWidth="0.35" />
                        <circle cx={currentPoint.x} cy={currentPoint.y} r="1.6" fill="#ef4444" stroke="#0f172a" strokeWidth="0.35" />
                    </>
                )}
            </svg>
        </div>
    );
}
