import React, { useRef, useState, useCallback } from 'react';
import pitchImg from '@/assets/pitch.png';

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
        
        const x = ((clientX - rect.left) / rect.width) * 140;
        const y = ((clientY - rect.top) / rect.height) * 90;
        
        return { x: Math.max(0, Math.min(140, x)), y: Math.max(0, Math.min(90, y)) };
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
        <div className="w-full aspect-[140/90] relative select-none">
            {/* Background image */}
            <img 
                src={pitchImg}
                alt="GAA Pitch"
                // Use fill so the image aligns 1:1 with the 140x90 coordinate plane.
                className="absolute inset-0 w-full h-full object-fill"
            />
            
            {/* Interactive overlay */}
            <svg
                ref={svgRef}
                viewBox="0 0 140 90"
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
                        <line x1="70" y1="0" x2="70" y2="90" stroke="white" strokeWidth="0.3" opacity="0.6" />
                        <line x1="0" y1="45" x2="140" y2="45" stroke="white" strokeWidth="0.3" opacity="0.6" />
                        <line x1="20" y1="0" x2="20" y2="90" stroke="white" strokeWidth="0.25" opacity="0.35" />
                        <line x1="120" y1="0" x2="120" y2="90" stroke="white" strokeWidth="0.25" opacity="0.35" />
                        <circle cx="20" cy="45" r="1.2" fill="#f59e0b" opacity="0.9" />
                        <circle cx="120" cy="45" r="1.2" fill="#f59e0b" opacity="0.9" />

                        {hoverPoint && (
                            <>
                                <line x1={hoverPoint.x} y1="0" x2={hoverPoint.x} y2="90" stroke="#60a5fa" strokeWidth="0.25" opacity="0.5" />
                                <line x1="0" y1={hoverPoint.y} x2="140" y2={hoverPoint.y} stroke="#60a5fa" strokeWidth="0.25" opacity="0.5" />
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
