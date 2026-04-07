import React from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StatModalV4 from '@/components/pitch/StatModalV4';

export default function MatchStatsDialogs({
  modalProps,
  halfPromptProps,
  subDialogProps,
  endPeriodPromptProps,
  nextHalfReminderProps,
}) {
  const {
    modalOpen,
    closeModal,
    handleStatSubmit,
    isPassModal,
    clickCoords,
    passEndCoords,
    currentVideoTimeS,
    halfStartTimeS,
    homePlayers,
    awayPlayers,
    homeOnField,
    awayOnField,
    homeTeamColor,
    awayTeamColor,
    lastReceiver,
    editingStat,
    previousStat,
    customFields,
    shortcutConfig,
    defaultCounterAttack,
  } = modalProps;

  const {
    halfPrompt,
    setHalfPrompt,
    getDirForHalf,
    half,
    directionByPeriod,
    persistDirectionByPeriod,
    setHalf,
  } = halfPromptProps;

  const {
    subDialogOpen,
    setSubDialogOpen,
    subOut,
    setSubOut,
    subIn,
    setSubIn,
    allPlayers,
    homePlayers,
    awayPlayers,
    homeTeamName,
    awayTeamName,
    logSubstitution,
  } = subDialogProps;

  const [subTeamFilter, setSubTeamFilter] = React.useState('all');
  const visibleSubPlayers = React.useMemo(() => {
    if (subTeamFilter === 'home') return homePlayers || [];
    if (subTeamFilter === 'away') return awayPlayers || [];
    return allPlayers || [];
  }, [subTeamFilter, allPlayers, homePlayers, awayPlayers]);

  const {
    endPeriodPrompt,
    setEndPeriodPrompt,
    handleEndPeriodChoice,
  } = endPeriodPromptProps;

  const {
    nextHalfReminder,
    setNextHalfReminder,
    setHalfStartFromVideoFor,
  } = nextHalfReminderProps;

  return (
    <>
      <StatModalV4
        key={[
          String(editingStat?.id || 'new'),
          (homePlayers || []).map((p) => `${p.id}:${p.number ?? ''}:${p.name || ''}`).join(','),
          (awayPlayers || []).map((p) => `${p.id}:${p.number ?? ''}:${p.name || ''}`).join(','),
          (homeOnField || []).join(','),
          (awayOnField || []).join(','),
        ].join('|')}
        open={modalOpen}
        onClose={closeModal}
        onSubmit={handleStatSubmit}
        isDrag={isPassModal}
        startCoords={clickCoords}
        endCoords={passEndCoords}
        currentVideoTimeS={currentVideoTimeS}
        halfStartTimeS={halfStartTimeS}
        homePlayers={homePlayers}
        awayPlayers={awayPlayers}
        homeRoster={homePlayers}
        awayRoster={awayPlayers}
        homeOnFieldIds={homeOnField}
        awayOnFieldIds={awayOnField}
        homeTeamColor={homeTeamColor}
        awayTeamColor={awayTeamColor}
        defaultReceiver={lastReceiver}
        initialStat={editingStat}
        previousStat={previousStat}
        customFields={customFields}
        shortcutConfig={shortcutConfig}
        defaultCounterAttack={defaultCounterAttack}
      />

      <AlertDialog open={halfPrompt.open} onOpenChange={(open) => !open && setHalfPrompt({ open: false, nextHalf: null })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch period?</AlertDialogTitle>
            <AlertDialogDescription>
              Switching to the new period. Would you like to flip the Home attacking direction too? This affects new stats only.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setHalfPrompt({ open: false, nextHalf: null })}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const nextHalf = halfPrompt.nextHalf;
                if (!nextHalf) return;
                const prevDir = getDirForHalf(half);
                const nextDir = prevDir === 'left' ? 'right' : 'left';
                await persistDirectionByPeriod({ ...(directionByPeriod || {}), [nextHalf]: nextDir });
                setHalf(nextHalf);
                setHalfPrompt({ open: false, nextHalf: null });
              }}
            >
              Flip direction
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-slate-900 hover:bg-slate-800"
              onClick={async () => {
                const nextHalf = halfPrompt.nextHalf;
                if (!nextHalf) return;
                const prevDir = getDirForHalf(half);
                await persistDirectionByPeriod({ ...(directionByPeriod || {}), [nextHalf]: prevDir });
                setHalf(nextHalf);
                setHalfPrompt({ open: false, nextHalf: null });
              }}
            >
              Keep direction
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={subDialogOpen} onOpenChange={setSubDialogOpen}>
        <DialogContent className="w-full sm:max-w-lg">
          <DialogHeader><DialogTitle>Substitution</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Team Filter</Label>
              <Select value={subTeamFilter} onValueChange={setSubTeamFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Players</SelectItem>
                  <SelectItem value="home">{homeTeamName || 'Home'}</SelectItem>
                  <SelectItem value="away">{awayTeamName || 'Away'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Player subbed out</Label>
              <Select value={subOut} onValueChange={setSubOut}>
                <SelectTrigger><SelectValue placeholder="Select player..." /></SelectTrigger>
                <SelectContent>
                  {visibleSubPlayers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>#{p.number} {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Player subbed in</Label>
              <Select value={subIn} onValueChange={setSubIn}>
                <SelectTrigger><SelectValue placeholder="Select player..." /></SelectTrigger>
                <SelectContent>
                  {visibleSubPlayers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>#{p.number} {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setSubDialogOpen(false); setSubOut(''); setSubIn(''); setSubTeamFilter('all'); }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                disabled={!subOut || !subIn}
                onClick={logSubstitution}
              >
                Log sub
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={endPeriodPrompt.open} onOpenChange={(open) => !open && setEndPeriodPrompt({ open: false, nextHalf: null })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End half?</AlertDialogTitle>
            <AlertDialogDescription>
              This will log an end-of-half marker, then switch to the next half. Would you like to flip the Home attacking direction too? This affects new stats only.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setEndPeriodPrompt({ open: false, nextHalf: null })}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleEndPeriodChoice(true)}>
              Flip direction
            </AlertDialogAction>
            <AlertDialogAction className="bg-slate-900 hover:bg-slate-800" onClick={() => handleEndPeriodChoice(false)}>
              Keep direction
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={nextHalfReminder.open} onOpenChange={(open) => !open && setNextHalfReminder({ open: false, nextHalf: null })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set next half start time?</AlertDialogTitle>
            <AlertDialogDescription>
              Remember to set the {String(nextHalfReminder.nextHalf || '').replace('_', ' ')} video start time. This keeps cross-half timing and video sync accurate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setNextHalfReminder({ open: false, nextHalf: null })}>
              Later
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const targetHalf = nextHalfReminder.nextHalf;
                if (!targetHalf) return;
                await setHalfStartFromVideoFor(targetHalf);
                setNextHalfReminder({ open: false, nextHalf: null });
              }}
            >
              Set from video
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
