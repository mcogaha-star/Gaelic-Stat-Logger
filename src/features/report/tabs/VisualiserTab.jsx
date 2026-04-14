import React from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { MultiSelect, PitchViz, toTitleCase } from '../shared';

export default function VisualiserTab({
  filteredForViz,
  homeTeam,
  awayTeam,
  vizColorBy,
  setVizColorBy,
  vizTeam,
  setVizTeam,
  vizActions,
  setVizActions,
  vizHalves,
  setVizHalves,
  vizCounters,
  setVizCounters,
  vizPlayerIds,
  setVizPlayerIds,
  playerOptions,
  onOpenVideoAt,
  resetAllFilters,
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
      <PitchViz
        stats={filteredForViz}
        homeColor={homeTeam?.color}
        awayColor={awayTeam?.color}
        colorBy={vizColorBy}
        showColorControls={false}
        mirrorAwayWhenBoth={vizTeam !== 'home'}
        align="left"
        directionLabel="Home ->"
        onOpenVideoAt={onOpenVideoAt}
      />
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sticky top-4">
        <div className="font-semibold text-slate-900">Visualiser Filters</div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-600">Team</Label>
          <Select value={vizTeam} onValueChange={setVizTeam}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="both">Both</SelectItem>
              <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
              <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <MultiSelect label="Action" values={vizActions} onChange={setVizActions} options={['shot', 'kickout', 'pass', 'carry', 'turnover', 'foul', 'defensive_contact', 'throw_in'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
        <MultiSelect label="Half" values={vizHalves} onChange={setVizHalves} options={['first', 'second', 'et_first', 'et_second'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
        <MultiSelect label="Set Defence" placeholder="Any" values={vizCounters} onChange={setVizCounters} options={[{ value: 'defence_set_yes', label: 'Yes' }, { value: 'defence_set_no', label: 'No' }]} />
        <MultiSelect label="Player" values={vizPlayerIds} onChange={setVizPlayerIds} options={(playerOptions || []).map((p) => ({ value: p.id, label: (p.team_side === 'away' ? 'Away: ' : 'Home: ') + p.label }))} />
        <div className="space-y-1">
          <Label className="text-xs text-slate-600">Color By</Label>
          <Select value={vizColorBy} onValueChange={setVizColorBy}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="team">Team</SelectItem>
              <SelectItem value="action">Action</SelectItem>
              <SelectItem value="outcome">Outcome</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="text-xs text-slate-500">Showing {filteredForViz.length} events.</div>
        <Button type="button" variant="outline" className="w-full" onClick={resetAllFilters}>
          Reset All Filters
        </Button>
      </div>
    </div>
  );
}
