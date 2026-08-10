import React from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
    homeAttacksRight,
    liveMode,
    liveClockSeconds,
    liveModeSettings,
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
    subTemporary,
    setSubTemporary,
    subGoalkeeperChange,
    setSubGoalkeeperChange,
    subNewGoalkeeperId,
    setSubNewGoalkeeperId,
    liveModeSettings: subLiveModeSettings,
    allPlayers,
    homePlayers: subHomePlayers,
    awayPlayers: subAwayPlayers,
    homeOnField: subHomeOnField,
    awayOnField: subAwayOnField,
    homeTeamName,
    awayTeamName,
    currentGoalkeeperBySide,
    subOutIsCurrentGoalkeeper,
    logSubstitution,
  } = subDialogProps;

  const [subTeamFilter, setSubTeamFilter] = React.useState('all');
  const visibleSubPlayers = React.useMemo(() => {
    if (subTeamFilter === 'home') return subHomePlayers || [];
    if (subTeamFilter === 'away') return subAwayPlayers || [];
    return allPlayers || [];
  }, [subTeamFilter, allPlayers, subHomePlayers, subAwayPlayers]);
  const subOutPlayer = React.useMemo(() => (allPlayers || []).find((player) => player.id === subOut) || null, [allPlayers, subOut]);
  const subOutSide = React.useMemo(() => {
    if (subOutPlayer && (subHomePlayers || []).some((player) => player.id === subOutPlayer.id)) return 'home';
    if (subOutPlayer && (subAwayPlayers || []).some((player) => player.id === subOutPlayer.id)) return 'away';
    return null;
  }, [subAwayPlayers, subHomePlayers, subOutPlayer]);
  const goalkeeperOverrideOptions = React.useMemo(() => {
    if (subOutSide !== 'home' && subOutSide !== 'away') return [];
    const onFieldIds = new Set(subOutSide === 'home' ? (subHomeOnField || []) : (subAwayOnField || []));
    onFieldIds.delete(subOut);
    if (subIn) onFieldIds.add(subIn);
    const sourcePlayers = subOutSide === 'home' ? (subHomePlayers || []) : (subAwayPlayers || []);
    return sourcePlayers.filter((player) => onFieldIds.has(player.id));
  }, [subAwayOnField, subHomeOnField, subAwayPlayers, subHomePlayers, subIn, subOut, subOutSide]);

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
        homeAttacksRight={homeAttacksRight}
        liveMode={liveMode}
        liveClockSeconds={liveClockSeconds}
        liveModeSettings={liveModeSettings}
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
            {subOutIsCurrentGoalkeeper && (
              <div className="space-y-3 rounded-md border border-slate-200 px-3 py-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="sub-new-goalkeeper"
                    checked={!!subGoalkeeperChange}
                    onCheckedChange={(checked) => setSubGoalkeeperChange(!!checked)}
                    className="mt-0.5"
                  />
                  <div className="space-y-1">
                    <Label htmlFor="sub-new-goalkeeper">Sub is new goalkeeper?</Label>
                    <div className="text-xs text-slate-500">
                      Default is the player coming on for the current goalkeeper.
                    </div>
                    <div className="text-xs text-slate-500">
                      Current goalkeeper: {currentGoalkeeperBySide?.[subOutSide]?.number != null ? `#${currentGoalkeeperBySide[subOutSide].number} ` : ''}{currentGoalkeeperBySide?.[subOutSide]?.name || (subOutSide === 'away' ? awayTeamName : homeTeamName)}
                    </div>
                  </div>
                </div>

                {!subGoalkeeperChange && (
                  <div className="space-y-2">
                    <Label>Set new goalkeeper</Label>
                    <Select value={subNewGoalkeeperId} onValueChange={setSubNewGoalkeeperId}>
                      <SelectTrigger><SelectValue placeholder="Choose goalkeeper..." /></SelectTrigger>
                      <SelectContent>
                        {goalkeeperOverrideOptions.map((player) => (
                          <SelectItem key={player.id} value={player.id}>#{player.number} {player.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
            {subLiveModeSettings?.showTemporarySub !== false && <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
              <div className="space-y-0.5">
                <Label>Temporary Sub</Label>
                <div className="text-xs text-slate-500">Mark this substitution as temporary.</div>
              </div>
              <Switch checked={!!subTemporary} onCheckedChange={setSubTemporary} />
            </div>}
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setSubDialogOpen(false); setSubOut(''); setSubIn(''); setSubTemporary(false); setSubGoalkeeperChange(false); setSubNewGoalkeeperId(''); setSubTeamFilter('all'); }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                disabled={!subOut || !subIn || (subOutIsCurrentGoalkeeper && !subGoalkeeperChange && !subNewGoalkeeperId)}
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
