import { useMemo, useState } from 'react';
import {
  createPossessionClipRef,
  createTimestampClipRef,
  formatTimeMMSS,
  getVideoClipSettings,
  openReportVideoSelection,
} from '@/lib/videoWorkflow';

export function usePossessionVisualiser({ match = null, matchId, homeTeam = null, awayTeam = null, preRollSeconds = 5 }) {
  const [sharedVizOpen, setSharedVizOpen] = useState(false);
  const [sharedVizTitle, setSharedVizTitle] = useState('');
  const [sharedVizStats, setSharedVizStats] = useState([]);
  const resolvedMatchId = match?.id || matchId || '';
  const clipSettings = useMemo(() => {
    const base = getVideoClipSettings(match);
    return {
      ...base,
      play_preroll_s: Number.isFinite(Number(preRollSeconds)) ? Math.max(0, Number(preRollSeconds)) : base.play_preroll_s,
    };
  }, [match, preRollSeconds]);

  const openPossessionVisualiser = ({ title, stats }) => {
    setSharedVizStats(Array.isArray(stats) ? stats : []);
    setSharedVizTitle(title || 'Visualise');
    setSharedVizOpen(true);
  };

  const openSharedVideoAt = (timeS) => {
    const clip = createTimestampClipRef({
      matchId: resolvedMatchId,
      timeS,
      label: `Event - ${formatTimeMMSS(Number(timeS))}`,
      clipSettings,
    });
    if (!clip) return;
    openReportVideoSelection(resolvedMatchId, [clip], {
      sourceLabel: 'Event - 1 clip',
    });
  };

  const openSharedVideoPossession = (possession) => {
    const clip = createPossessionClipRef(possession, match, homeTeam, awayTeam, clipSettings);
    if (!clip) return;
    openReportVideoSelection(resolvedMatchId, [clip], {
      sourceLabel: 'Possession - 1 clip',
    });
  };

  const openSharedVideoSelection = (clips, { sourceLabel = 'Selection' } = {}) => {
    const list = Array.isArray(clips) ? clips.filter(Boolean) : [];
    if (!resolvedMatchId || !list.length) return false;
    return openReportVideoSelection(resolvedMatchId, list, { sourceLabel });
  };

  return {
    sharedVizOpen,
    setSharedVizOpen,
    sharedVizTitle,
    sharedVizStats,
    openPossessionVisualiser,
    openSharedVideoAt,
    openSharedVideoSelection,
    openSharedVideoPossession,
    preRollSeconds,
  };
}

export default usePossessionVisualiser;
