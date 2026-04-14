import React from 'react';
import { PitchViz } from '../shared';

export default function VisualiserTab({ filteredForViz, homeTeam, awayTeam, vizColorBy, vizTeam, onOpenVideoAt }) {
  return (
    <div className="space-y-4">
      <PitchViz
        stats={filteredForViz}
        homeColor={homeTeam?.color}
        awayColor={awayTeam?.color}
        colorBy={vizColorBy}
        mirrorAwayWhenBoth={vizTeam !== 'home'}
        align="left"
        directionLabel="Home ->"
        onOpenVideoAt={onOpenVideoAt}
      />
    </div>
  );
}
