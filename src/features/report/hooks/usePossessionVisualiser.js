import { useState } from 'react';
import { createPageUrl } from '@/utils';

export function usePossessionVisualiser({ matchId, preRollSeconds = 7 }) {
  const [sharedVizOpen, setSharedVizOpen] = useState(false);
  const [sharedVizTitle, setSharedVizTitle] = useState('');
  const [sharedVizStats, setSharedVizStats] = useState([]);

  const openPossessionVisualiser = ({ title, stats }) => {
    setSharedVizStats(Array.isArray(stats) ? stats : []);
    setSharedVizTitle(title || 'Visualise');
    setSharedVizOpen(true);
  };

  const openSharedVideoAt = (timeS) => {
    const t = Number(timeS);
    if (!matchId || !Number.isFinite(t)) return;
    const seekTo = Math.max(0, Math.floor(t - preRollSeconds));
    const url = `${window.location.origin}${window.location.pathname}#${createPageUrl(`Video?matchId=${matchId}`)}`;
    window.open(url, 'gstl_video', 'popup=yes,width=1100,height=650');
    try {
      const ch = new BroadcastChannel('gstl_video');
      const msg = { matchId, type: 'SEEK_TO', time_s: seekTo };
      ch.postMessage(msg);
      setTimeout(() => ch.postMessage(msg), 350);
      setTimeout(() => { ch.postMessage(msg); ch.close(); }, 900);
    } catch {
      // ignore
    }
  };

  return {
    sharedVizOpen,
    setSharedVizOpen,
    sharedVizTitle,
    sharedVizStats,
    openPossessionVisualiser,
    openSharedVideoAt,
    preRollSeconds,
  };
}

export default usePossessionVisualiser;
