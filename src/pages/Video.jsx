import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { createPageUrl } from '@/utils';
import { toast } from 'sonner';
import { eventMatchesShortcut, isTypingTarget, parseShortcutConfig, prettyShortcut } from '@/lib/shortcuts';
import { useAuth } from '@/lib/AuthContext';
import { getAuthorInitials } from '@/lib/videoWorkflow';

const CHANNEL_NAME = 'gstl_video';

const db = globalThis.__B44_DB__ || {
  entities: new Proxy({}, { get: () => ({ filter: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
};

function safeParseJSON(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

function formatTimeMMSS(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const s = Math.floor(seconds);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function extractYouTubeId(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  // Supports youtu.be/<id>, youtube.com/watch?v=<id>, youtube.com/embed/<id>
  const m1 = u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
  if (m1) return m1[1];
  const m2 = u.match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
  if (m2) return m2[1];
  const m3 = u.match(/\/embed\/([a-zA-Z0-9_-]{6,})/);
  if (m3) return m3[1];
  return '';
}

function ensureYouTubeAPI() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const existing = document.querySelector('script[data-youtube-api="1"]');
    if (existing) {
      const check = setInterval(() => {
        if (window.YT && window.YT.Player) {
          clearInterval(check);
          resolve(window.YT);
        }
      }, 100);
      return;
    }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.dataset.youtubeApi = '1';
    document.body.appendChild(tag);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      resolve(window.YT);
    };
  });
}

export default function Video() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search || ''), [location.search]);
  const matchId = params.get('matchId') || params.get('id') || '';
  const reviewMode = params.get('review') === '1';
  const reelId = params.get('reelId') || '';
  const selectionKey = params.get('selectionKey') || '';

  const channelRef = useRef(null);
  const localVideoRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const ytContainerRef = useRef(null);
  const intervalRef = useRef(null);
  const reviewRootRef = useRef(null);
  const completedClipRef = useRef('');

  const [sourceType, setSourceType] = useState('youtube'); // 'youtube' | 'local'
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [timeS, setTimeS] = useState(0);
  const [pipActive, setPipActive] = useState(false);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);
  const [showClipList, setShowClipList] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [publicNoteDraft, setPublicNoteDraft] = useState('');
  const [privateNoteDraft, setPrivateNoteDraft] = useState('');
  const [noteVisibilityTab, setNoteVisibilityTab] = useState('public');

  const { data: settingsRecords = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => db.entities.AppSettings.list(),
  });
  const shortcutConfig = useMemo(
    () => parseShortcutConfig(settingsRecords?.[0]?.keyboard_shortcuts_config),
    [settingsRecords]
  );
  const { data: reviewReel = null } = useQuery({
    queryKey: ['review-reel', reelId],
    queryFn: () => db.entities.HighlightReel.get(reelId),
    enabled: reviewMode && !!reelId,
  });
  const { data: reviewClipsRaw = [] } = useQuery({
    queryKey: ['review-clips', reelId],
    queryFn: () => db.entities.HighlightReelClip.filter({ reel_id: reelId }),
    enabled: reviewMode && !!reelId,
  });
  const { data: reviewNotes = [] } = useQuery({
    queryKey: ['review-notes', matchId],
    queryFn: () => db.entities.VideoNote.filter({ match_id: matchId }),
    enabled: reviewMode && !!matchId,
  });
  const reviewSelectionClips = useMemo(() => {
    if (!reviewMode || !selectionKey) return [];
    try {
      const raw = window.sessionStorage.getItem(`gstl_video_selection:${selectionKey}`);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [reviewMode, selectionKey]);
  const reviewClips = useMemo(
    () => (selectionKey ? reviewSelectionClips : (reviewClipsRaw || [])).slice().sort((a, b) => {
      const aOrder = Number(a?.order_index);
      const bOrder = Number(b?.order_index);
      if (Number.isFinite(aOrder) && Number.isFinite(bOrder) && aOrder !== bOrder) return aOrder - bOrder;
      return Number(a?.start_time || 0) - Number(b?.start_time || 0);
    }),
    [selectionKey, reviewSelectionClips, reviewClipsRaw]
  );
  const currentClip = reviewMode ? (reviewClips[currentClipIndex] || null) : null;

  const pipSupported = typeof document !== 'undefined' && !!document.pictureInPictureEnabled;
  const canCloseWindow = typeof window !== 'undefined' && !!window.opener;

  const enterPiP = async () => {
    try {
      const v = localVideoRef.current;
      if (!v) return;
      if (!pipSupported || !v.requestPictureInPicture) {
        toast.error('Picture-in-Picture not supported in this browser');
        return;
      }
      if (!ready) {
        toast.error('Load a local video first');
        return;
      }
      await v.requestPictureInPicture();
    } catch (e) {
      toast.error('Could not start Picture-in-Picture');
    }
  };

  const handleCloseOrBack = () => {
    // Some browsers block window.close() unless the window was opened by script.
    if (canCloseWindow) {
      try { window.close(); } catch { /* ignore */ }
      // If the close is blocked, fall back to navigation.
      setTimeout(() => {
        try {
          window.location.href = createPageUrl(`MatchStats?id=${matchId}`);
        } catch { /* ignore */ }
      }, 80);
      return;
    }
    window.location.href = createPageUrl(`MatchStats?id=${matchId}`);
  };

  const seekRelative = (deltaS) => {
    const delta = Number(deltaS);
    if (!Number.isFinite(delta)) return;
    if (sourceType === 'local' && localVideoRef.current) {
      const v = localVideoRef.current;
      v.currentTime = Math.max(0, (v.currentTime || 0) + delta);
      return;
    }
    if (sourceType === 'youtube' && ytPlayerRef.current?.seekTo && ytPlayerRef.current?.getCurrentTime) {
      const next = Math.max(0, Number(ytPlayerRef.current.getCurrentTime() || 0) + delta);
      ytPlayerRef.current.seekTo(next, true);
    }
  };

  const togglePlayPause = () => {
    if (sourceType === 'local' && localVideoRef.current) {
      const v = localVideoRef.current;
      if (v.paused) v.play().catch(() => {});
      else v.pause();
      return;
    }
    if (sourceType === 'youtube' && ytPlayerRef.current) {
      try {
        const state = ytPlayerRef.current.getPlayerState?.();
        if (state === 1) ytPlayerRef.current.pauseVideo?.();
        else ytPlayerRef.current.playVideo?.();
      } catch {
        // ignore
      }
    }
  };

  const changePlaybackRate = (delta) => {
    const step = Number(delta);
    if (!Number.isFinite(step)) return;
    if (sourceType === 'local' && localVideoRef.current) {
      const v = localVideoRef.current;
      const next = Math.min(2, Math.max(0.25, Number(v.playbackRate || 1) + step));
      v.playbackRate = Number(next.toFixed(2));
      toast.message(`Speed ${next.toFixed(2)}x`);
      return;
    }
    if (sourceType === 'youtube' && ytPlayerRef.current?.getPlaybackRate && ytPlayerRef.current?.setPlaybackRate) {
      try {
        const next = Math.min(2, Math.max(0.25, Number(ytPlayerRef.current.getPlaybackRate() || 1) + step));
        ytPlayerRef.current.setPlaybackRate(next);
        toast.message(`Speed ${next.toFixed(2)}x`);
      } catch {
        // ignore
      }
    }
  };

  const pausePlayback = () => {
    if (sourceType === 'local' && localVideoRef.current) {
      localVideoRef.current.pause();
      return;
    }
    if (sourceType === 'youtube' && ytPlayerRef.current?.pauseVideo) {
      ytPlayerRef.current.pauseVideo();
    }
  };

  const playPlayback = () => {
    if (sourceType === 'local' && localVideoRef.current) {
      localVideoRef.current.play().catch(() => {});
      return;
    }
    if (sourceType === 'youtube' && ytPlayerRef.current?.playVideo) {
      ytPlayerRef.current.playVideo();
    }
  };

  const seekToAbsolute = (seconds) => {
    const target = Math.max(0, Number(seconds) || 0);
    if (sourceType === 'local' && localVideoRef.current) {
      localVideoRef.current.currentTime = target;
      return;
    }
    if (sourceType === 'youtube' && ytPlayerRef.current?.seekTo) {
      ytPlayerRef.current.seekTo(target, true);
    }
  };

  const jumpToClip = (index, { autoplay = true } = {}) => {
    if (!reviewClips.length) return;
    const nextIndex = Math.max(0, Math.min(reviewClips.length - 1, Number(index) || 0));
    const clip = reviewClips[nextIndex];
    setCurrentClipIndex(nextIndex);
    completedClipRef.current = '';
    if (!clip) return;
    seekToAbsolute(Number(clip.start_time));
    if (autoplay) {
      window.setTimeout(() => playPlayback(), 100);
    } else {
      pausePlayback();
    }
  };

  const requestReviewFullscreen = async () => {
    try {
      if (reviewRootRef.current?.requestFullscreen) {
        await reviewRootRef.current.requestFullscreen();
      }
    } catch {
      toast.error('Could not enter fullscreen');
    }
  };

  // Load/save local-only config on the match record.
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    (async () => {
      const rec = await db.entities.Match.get(matchId);
      if (cancelled) return;
      const cfg = safeParseJSON(rec?.video_config || '{}', {});
      if (typeof cfg?.youtubeUrl === 'string') setYoutubeUrl(cfg.youtubeUrl);
      // A local file cannot be restored across sessions/popouts, so always fall back
      // to a usable YouTube/default state instead of reopening the video page blank.
      if (cfg?.sourceType === 'youtube' && typeof cfg?.youtubeUrl === 'string' && cfg.youtubeUrl.trim()) {
        setSourceType('youtube');
      } else {
        setSourceType('youtube');
      }
    })();
    return () => { cancelled = true; };
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    // Persist only YouTube URL. Local-file mode is session-only and should not reopen blank.
    const payload = { sourceType: 'youtube', youtubeUrl };
    db.entities.Match.update(matchId, { video_config: JSON.stringify(payload) }).catch(() => {});
  }, [matchId, youtubeUrl]);

  // Open a BroadcastChannel for communicating with the match window.
  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = ch;
    const onMsg = (e) => {
      const msg = e?.data;
      if (!msg || msg.matchId !== matchId) return;
      if (msg.type === 'REQUEST_TIME') {
        ch.postMessage({ matchId, type: 'TIME_UPDATE', time_s: timeS, playing, ready });
      }
      if (msg.type === 'SEEK_TO') {
        const t = Number(msg?.time_s);
        if (!Number.isFinite(t) || t < 0) return;
        if (sourceType === 'local' && localVideoRef.current) {
          localVideoRef.current.currentTime = t;
        }
        if (sourceType === 'youtube' && ytPlayerRef.current && ytPlayerRef.current.seekTo) {
          ytPlayerRef.current.seekTo(t, true);
        }
      }
      if (msg.type === 'VIDEO_COMMAND') {
        if (msg.command === 'toggle_play_pause') togglePlayPause();
        if (msg.command === 'back_3') seekRelative(-3);
        if (msg.command === 'forward_3') seekRelative(3);
        if (msg.command === 'back_10') seekRelative(-10);
        if (msg.command === 'forward_10') seekRelative(10);
        if (msg.command === 'back_20') seekRelative(-20);
        if (msg.command === 'forward_20') seekRelative(20);
        if (msg.command === 'slower') changePlaybackRate(-0.25);
        if (msg.command === 'faster') changePlaybackRate(0.25);
      }
      if (msg.type === 'SET_SOURCE') {
        const nextType = msg?.sourceType;
        if (nextType === 'youtube' || nextType === 'local') setSourceType(nextType);
        if (typeof msg?.youtubeUrl === 'string') setYoutubeUrl(msg.youtubeUrl);
      }
    };
    ch.addEventListener('message', onMsg);
    return () => {
      ch.removeEventListener('message', onMsg);
      ch.close();
    };
  }, [matchId, timeS, playing, ready, sourceType]);

  // Broadcast time updates at ~5Hz when ready.
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || !matchId) return;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    intervalRef.current = setInterval(() => {
      const payload = { matchId, type: 'TIME_UPDATE', time_s: timeS, playing, ready };
      ch.postMessage(payload);
    }, 200);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [matchId, timeS, playing, ready]);

  // Notify main window when player is ready.
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || !matchId) return;
    ch.postMessage({ matchId, type: 'VIDEO_READY', sourceType, ready: !!ready });
  }, [matchId, sourceType, ready]);

  // Local video event wiring.
  useEffect(() => {
    const v = localVideoRef.current;
    if (!v) return;
    const onTime = () => setTimeS(v.currentTime || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeking', onTime);
    v.addEventListener('seeked', onTime);

    const onEnterPiP = () => setPipActive(true);
    const onLeavePiP = () => setPipActive(false);
    v.addEventListener('enterpictureinpicture', onEnterPiP);
    v.addEventListener('leavepictureinpicture', onLeavePiP);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeking', onTime);
      v.removeEventListener('seeked', onTime);
      v.removeEventListener('enterpictureinpicture', onEnterPiP);
      v.removeEventListener('leavepictureinpicture', onLeavePiP);
    };
  }, [sourceType]);

  // YouTube player creation/refresh
  useEffect(() => {
    let cancelled = false;
    if (sourceType !== 'youtube') return;
    const id = extractYouTubeId(youtubeUrl);
    if (!id) {
      setReady(false);
      return;
    }
    setReady(false);
    setPlaying(false);
    ensureYouTubeAPI().then((YT) => {
      if (cancelled) return;
      if (!ytContainerRef.current) return;
      // Destroy prior player
      try {
        if (ytPlayerRef.current && ytPlayerRef.current.destroy) ytPlayerRef.current.destroy();
      } catch { /* ignore */ }
      ytPlayerRef.current = new YT.Player(ytContainerRef.current, {
        videoId: id,
        playerVars: {
          origin: window.location.origin,
          rel: 0,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            setReady(true);
          },
          onStateChange: (ev) => {
            // 1 playing, 2 paused
            if (cancelled) return;
            if (ev?.data === 1) setPlaying(true);
            if (ev?.data === 2) setPlaying(false);
          },
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [sourceType, youtubeUrl]);

  // Poll YouTube current time when ready (TIME_UPDATE uses the latest).
  useEffect(() => {
    if (sourceType !== 'youtube') return;
    if (!ready) return;
    const t = setInterval(() => {
      try {
        const p = ytPlayerRef.current;
        if (p && p.getCurrentTime) {
          const ct = p.getCurrentTime();
          if (Number.isFinite(ct)) setTimeS(ct);
        }
      } catch {
        // ignore
      }
    }, 200);
    return () => clearInterval(t);
  }, [sourceType, ready]);

  useEffect(() => {
    if (!reviewMode) return;
    if (!reviewClips.length) {
      setCurrentClipIndex(0);
      return;
    }
    setCurrentClipIndex((current) => Math.max(0, Math.min(reviewClips.length - 1, current)));
  }, [reviewMode, reviewClips.length]);

  useEffect(() => {
    if (!reviewMode || !currentClip || !ready) return;
    const clipId = String(currentClip.id || currentClip.source_ref || currentClipIndex);
    const clipEnd = Number(currentClip.end_time);
    if (!Number.isFinite(clipEnd)) return;
    if (timeS < clipEnd - 0.05) {
      completedClipRef.current = '';
      return;
    }
    if (completedClipRef.current === clipId) return;
    completedClipRef.current = clipId;
    if (autoplayEnabled && currentClipIndex < reviewClips.length - 1) {
      jumpToClip(currentClipIndex + 1, { autoplay: true });
      return;
    }
    pausePlayback();
    seekToAbsolute(clipEnd);
  }, [reviewMode, currentClip, ready, timeS, autoplayEnabled, currentClipIndex, reviewClips.length]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (isTypingTarget(e.target)) return;
      if (reviewMode) {
        const key = String(e.key || '').toLowerCase();
        if (key === ' ') {
          e.preventDefault();
          togglePlayPause();
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          seekRelative(-3);
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          seekRelative(3);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (currentClipIndex > 0) jumpToClip(currentClipIndex - 1, { autoplay: true });
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (currentClipIndex < reviewClips.length - 1) jumpToClip(currentClipIndex + 1, { autoplay: true });
          return;
        }
        if (key === 'l') {
          e.preventDefault();
          setShowClipList((current) => !current);
          return;
        }
        if (key === 'n') {
          e.preventDefault();
          setShowNotes((current) => !current);
          return;
        }
      }
      for (const [command, shortcut] of Object.entries(shortcutConfig?.video || {})) {
        if (!eventMatchesShortcut(e, shortcut)) continue;
        e.preventDefault();
        if (command === 'toggle_play_pause') togglePlayPause();
        if (command === 'back_3') seekRelative(-3);
        if (command === 'forward_3') seekRelative(3);
        if (command === 'back_10') seekRelative(-10);
        if (command === 'forward_10') seekRelative(10);
        if (command === 'back_20') seekRelative(-20);
        if (command === 'forward_20') seekRelative(20);
        if (command === 'slower') changePlaybackRate(-0.25);
        if (command === 'faster') changePlaybackRate(0.25);
        break;
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [shortcutConfig, sourceType, playing, reviewMode, currentClipIndex, reviewClips.length]);

  useEffect(() => {
    if (!reviewMode || !ready || !currentClip) return;
    seekToAbsolute(Number(currentClip.start_time));
  }, [reviewMode, ready, currentClip?.id]);

  const currentClipPublicNote = useMemo(
    () => reviewNotes.find((note) => note?.target_type === currentClip?.source_type && String(note?.target_id || '') === String(currentClip?.source_ref || '') && note?.visibility === 'public') || null,
    [reviewNotes, currentClip]
  );
  const currentClipPrivateNote = useMemo(
    () => reviewNotes.find((note) => note?.target_type === currentClip?.source_type && String(note?.target_id || '') === String(currentClip?.source_ref || '') && note?.visibility === 'private') || null,
    [reviewNotes, currentClip]
  );
  useEffect(() => {
    setPublicNoteDraft(currentClipPublicNote?.text || '');
    setPrivateNoteDraft(currentClipPrivateNote?.text || '');
    setNoteVisibilityTab(currentClipPublicNote?.text ? 'public' : 'private');
  }, [currentClipPublicNote?.id, currentClipPrivateNote?.id, currentClip?.id]);

  const saveCurrentClipNotes = async () => {
    if (!currentClip?.source_type || !currentClip?.source_ref || !matchId) return;
    const nextInitials = getAuthorInitials(user);
    const entries = [
      { visibility: 'public', text: publicNoteDraft, existing: currentClipPublicNote },
      { visibility: 'private', text: privateNoteDraft, existing: currentClipPrivateNote },
    ];
    for (const entry of entries) {
      const text = String(entry.text || '').trim();
      if (!text) {
        if (entry.existing?.id) await db.entities.VideoNote.delete(entry.existing.id);
        continue;
      }
      const payload = {
        match_id: matchId,
        target_type: currentClip.source_type,
        target_id: String(currentClip.source_ref),
        visibility: entry.visibility,
        text,
        author_user_id: user?.id || null,
        author_initials: entry.visibility === 'public' ? nextInitials : null,
      };
      if (entry.existing?.id) await db.entities.VideoNote.update(entry.existing.id, payload);
      else await db.entities.VideoNote.create(payload);
    }
    await queryClient.invalidateQueries({ queryKey: ['review-notes', matchId] });
    toast.success('Notes saved');
  };

  const header = (
    <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
      <div className="flex items-baseline gap-2">
        <div className="font-semibold">{reviewMode ? 'Review Player' : 'Video'}</div>
        <div className="text-xs text-slate-500">
          {reviewMode ? (selectionKey ? 'Current Selection' : (reviewReel?.name || 'Highlight Reel')) : `Match ${matchId ? matchId.slice(0, 8) : ''}`}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="font-mono text-sm">{formatTimeMMSS(timeS)}</div>
        <div className="hidden md:block text-[11px] text-slate-500">
          {`Play/Pause ${prettyShortcut(shortcutConfig?.video?.toggle_play_pause)}`}
        </div>
        {sourceType === 'local' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={!pipSupported || !ready}
            onClick={enterPiP}
            title={pipSupported ? 'Keeps the video above the logger while you click around' : 'Picture-in-Picture not supported'}
          >
            {pipActive ? 'PiP On' : 'PiP'}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={handleCloseOrBack}>
          {canCloseWindow ? 'Close' : 'Back'}
        </Button>
      </div>
    </div>
  );

  const sourcePicker = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={sourceType === 'youtube' ? 'default' : 'outline'}
          className="h-8"
          onClick={() => setSourceType('youtube')}
        >
          YouTube
        </Button>
        <Button
          type="button"
          size="sm"
          variant={sourceType === 'local' ? 'default' : 'outline'}
          className="h-8"
          onClick={() => setSourceType('local')}
        >
          Local File
        </Button>
      </div>
      <Link className="text-xs text-slate-500 underline" to={createPageUrl(`MatchStats?id=${matchId}`)}>
        Back to Match
      </Link>
    </div>
  );

  const sourceSetup = sourceType === 'youtube' ? (
    <div className="space-y-1">
      <Label className="text-xs">YouTube URL</Label>
      <Input
        className="h-9"
        value={youtubeUrl}
        onChange={(e) => setYoutubeUrl(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=..."
      />
      {!reviewMode ? (
        <>
          <div className="text-xs text-slate-500">Tip: press play, then return to the match window to log stats.</div>
          <div className="text-xs text-slate-500">
            Note: browsers cannot keep a normal popup "always on top". If your browser/OS supports Picture-in-Picture for YouTube, use that to keep the video visible.
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-500">The review player uses the saved clip timestamps on top of the current source.</div>
      )}
    </div>
  ) : (
    <div className="space-y-1">
      <Label className="text-xs">Video File</Label>
      <Input
        className="h-9"
        type="file"
        accept="video/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setFileName(file.name);
          const url = URL.createObjectURL(file);
          const v = localVideoRef.current;
          if (v) {
            v.src = url;
            v.load();
            setReady(true);
            toast.success('Video loaded');
          }
        }}
      />
      {fileName ? <div className="text-xs text-slate-500">Loaded: {fileName}</div> : <div className="text-xs text-slate-500">Select a file (local-only).</div>}
      <div className="text-xs text-slate-500">
        Tip: use the <span className="font-semibold">PiP</span> button in the header to keep the video above the logger while you click the pitch.
      </div>
    </div>
  );

  const playerSurface = (
    <div className="rounded-xl bg-white border shadow-sm overflow-hidden">
      {sourceType === 'youtube' ? (
        <div className="aspect-video bg-black">
          <div ref={ytContainerRef} className="w-full h-full" />
        </div>
      ) : (
        <video ref={localVideoRef} className="w-full" controls />
      )}
    </div>
  );

  if (reviewMode) {
    return (
      <div className="min-h-screen bg-slate-50">
        {header}
        <div ref={reviewRootRef} className="mx-auto max-w-7xl px-4 py-4">
          <div className={`grid gap-4 ${showClipList ? 'lg:grid-cols-[280px_minmax(0,1fr)]' : 'grid-cols-1'}`}>
            {showClipList ? (
              <div className="rounded-xl border bg-white shadow-sm">
                <div className="border-b px-3 py-2 text-sm font-semibold text-slate-900">Clips</div>
                <div className="max-h-[78vh] overflow-y-auto p-2">
                  {reviewClips.map((clip, index) => (
                    <button
                      key={clip.id || `${clip.source_ref}-${index}`}
                      type="button"
                      className={`mb-2 w-full rounded-lg border px-3 py-2 text-left text-sm ${index === currentClipIndex ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-900'}`}
                      onClick={() => jumpToClip(index, { autoplay: true })}
                    >
                      <div className="font-medium">{clip.label || `Clip ${index + 1}`}</div>
                      <div className={`text-xs ${index === currentClipIndex ? 'text-slate-200' : 'text-slate-500'}`}>
                        {formatTimeMMSS(Number(clip.start_time))} - {formatTimeMMSS(Number(clip.end_time))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-4">
              {sourcePicker}
              <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
                {sourceSetup}
                {playerSurface}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-8" disabled={currentClipIndex <= 0} onClick={() => jumpToClip(currentClipIndex - 1, { autoplay: true })}>Previous Clip</Button>
                  <Button type="button" variant="outline" size="sm" className="h-8" disabled={currentClipIndex >= reviewClips.length - 1} onClick={() => jumpToClip(currentClipIndex + 1, { autoplay: true })}>Next Clip</Button>
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={togglePlayPause}>Play / Pause</Button>
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => seekRelative(-3)}>-3s</Button>
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => seekRelative(3)}>+3s</Button>
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={requestReviewFullscreen}>Fullscreen</Button>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                  <div className="flex items-center gap-2">
                    <span>Autoplay</span>
                    <Switch checked={autoplayEnabled} onCheckedChange={setAutoplayEnabled} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span>Show Clip List</span>
                    <Switch checked={showClipList} onCheckedChange={setShowClipList} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span>Show Notes</span>
                    <Switch checked={showNotes} onCheckedChange={setShowNotes} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">Space Play/Pause</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">← -3s</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">→ +3s</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">↑ Previous</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">↓ Next</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">L Clip List</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">N Notes</span>
                </div>
              </div>
                {showNotes ? (
                  <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
                    <div className="text-sm font-semibold text-slate-900">Notes</div>
                    <div className="space-y-3">
                      <div className="inline-flex rounded-xl bg-slate-100 p-1">
                        <Button type="button" variant={noteVisibilityTab === 'public' ? 'default' : 'outline'} size="sm" className="h-8 px-3 text-xs" onClick={() => setNoteVisibilityTab('public')}>
                          Public
                        </Button>
                        <Button type="button" variant={noteVisibilityTab === 'private' ? 'default' : 'outline'} size="sm" className="h-8 px-3 text-xs" onClick={() => setNoteVisibilityTab('private')}>
                          Private
                        </Button>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-2 flex items-center justify-between text-sm font-medium text-slate-900">
                          <span>{noteVisibilityTab === 'public' ? 'Public' : 'Private'}</span>
                          {noteVisibilityTab === 'public' && currentClipPublicNote?.author_initials ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px]">{currentClipPublicNote.author_initials}</span> : null}
                        </div>
                        <Textarea
                          value={noteVisibilityTab === 'public' ? publicNoteDraft : privateNoteDraft}
                          onChange={(e) => noteVisibilityTab === 'public' ? setPublicNoteDraft(e.target.value) : setPrivateNoteDraft(e.target.value)}
                          rows={7}
                          placeholder={noteVisibilityTab === 'public' ? 'Shared with the match' : 'Private to your copy'}
                        />
                      </div>
                    </div>
                  <div className="flex items-center justify-end">
                    <Button type="button" disabled={!currentClip} onClick={saveCurrentClipNotes}>Save Notes</Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {header}
      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {sourcePicker}
        <div className="space-y-2">
          {sourceSetup}
          {playerSurface}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={togglePlayPause}>Play / Pause</Button>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => seekRelative(-10)}>-10s</Button>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => seekRelative(10)}>+10s</Button>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => changePlaybackRate(-0.25)}>Slower</Button>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => changePlaybackRate(0.25)}>Faster</Button>
          </div>
          {sourceType === 'youtube' && !extractYouTubeId(youtubeUrl) ? (
            <div className="text-xs text-slate-600">Paste a valid YouTube URL to load the player.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
