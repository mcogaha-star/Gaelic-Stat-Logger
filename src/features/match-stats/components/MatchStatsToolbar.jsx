import React from 'react';
import { ArrowLeft, ArrowRight, Clock, Repeat2, Undo2, Users, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function MatchStatsToolbar({
  half,
  getDirForHalf,
  setHalfStartFromVideo,
  videoReady,
  flipDirectionForHalf,
  openEndHalfPrompt,
  onOpenSubDialog,
  handleUndoLast,
  statsCount,
  openVideoPopout,
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-0.5">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Home Attacking
        </span>
        <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 text-white px-3 py-1 shadow-sm">
          {getDirForHalf(half) === 'left' ? (
            <ArrowLeft className="w-4 h-4" />
          ) : (
            <ArrowRight className="w-4 h-4" />
          )}
          <span className="font-mono text-sm tracking-tight">
            {getDirForHalf(half) === 'left' ? 'Left' : 'Right'}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={setHalfStartFromVideo}
          title={videoReady ? 'Set the start time for this half from the current video time' : 'Open the video window to set half start'}
          className="gap-2"
        >
          <Clock className="w-4 h-4" />
          Set Half Start
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => flipDirectionForHalf(half)}
          title="Flip home attacking direction (affects new stats only)"
        >
          Flip
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openEndHalfPrompt}
          title="Log end of half and switch"
          className="gap-2"
        >
          <Repeat2 className="w-4 h-4" />
          End Half
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onOpenSubDialog}
          title="Log a substitution"
          className="gap-2"
        >
          <Users className="w-4 h-4" />
          Sub
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleUndoLast}
          disabled={!statsCount}
          title="Undo last stat (Ctrl/Cmd+Z)"
          className="gap-2"
        >
          <Undo2 className="w-4 h-4" />
          Undo
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openVideoPopout}
          title="Open video window"
          className="gap-2"
        >
          <Video className="w-4 h-4" />
          Video
        </Button>
      </div>
    </div>
  );
}
