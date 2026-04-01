import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { createPageUrl } from '@/utils';

const VIDEO_CHANNEL = 'gstl_video';

export function useMatchVideoControls({ db, matchId, match, half, halfStartByHalf, queryClient }) {
  const [currentVideoTimeS, setCurrentVideoTimeS] = useState(null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);

  const halfStartTimeS = useMemo(() => {
    const v = halfStartByHalf?.[half];
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }, [halfStartByHalf, half]);

  useEffect(() => {
    if (!matchId) return;
    const ch = new BroadcastChannel(VIDEO_CHANNEL);
    const onMsg = (e) => {
      const msg = e?.data;
      if (!msg || msg.matchId !== matchId) return;
      if (msg.type === 'TIME_UPDATE') {
        const t = Number(msg.time_s);
        if (Number.isFinite(t)) setCurrentVideoTimeS(t);
        setVideoPlaying(!!msg.playing);
        setVideoReady(!!msg.ready);
      }
      if (msg.type === 'VIDEO_READY') {
        setVideoReady(!!msg.ready);
      }
    };
    ch.addEventListener('message', onMsg);
    ch.postMessage({ matchId, type: 'REQUEST_TIME' });
    return () => {
      ch.removeEventListener('message', onMsg);
      ch.close();
    };
  }, [matchId]);

  const openVideoPopout = () => {
    if (!matchId) return;
    const url = `${window.location.origin}${window.location.pathname}#${createPageUrl(`Video?matchId=${matchId}`)}`;
    window.open(url, 'gstl_video', 'popup=yes,width=1100,height=650');
  };

  const sendVideoCommand = (command) => {
    if (!matchId) return;
    try {
      const ch = new BroadcastChannel(VIDEO_CHANNEL);
      const msg = { matchId, type: 'VIDEO_COMMAND', command };
      ch.postMessage(msg);
      setTimeout(() => ch.close(), 120);
    } catch {
      // ignore
    }
  };

  const setHalfStartFromVideoFor = async (targetHalf) => {
    if (!match?.id) return;
    if (!Number.isFinite(Number(currentVideoTimeS))) {
      toast.error('Open video window first');
      return;
    }
    const next = { ...(halfStartByHalf || {}) };
    next[targetHalf] = Math.floor(Number(currentVideoTimeS));
    await db.entities.Match.update(match.id, { video_half_start_time_s: JSON.stringify(next) });
    queryClient.invalidateQueries({ queryKey: ['match', matchId] });
    toast.success(`${String(targetHalf).replace('_', ' ')} start set`);
  };

  const setHalfStartFromVideo = async () => setHalfStartFromVideoFor(half);

  return {
    currentVideoTimeS,
    videoReady,
    videoPlaying,
    halfStartTimeS,
    openVideoPopout,
    sendVideoCommand,
    setHalfStartFromVideo,
    setHalfStartFromVideoFor,
  };
}

export default useMatchVideoControls;
