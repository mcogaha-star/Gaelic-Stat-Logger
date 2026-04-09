import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { formatMMSS, formatPct } from '../shared';
import { formatMatchClock } from '@/lib/reportAnalytics';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';

export default function OverviewTab({
  homeTeam,
  awayTeam,
  match,
  scoreTimeline,
  summary,
  overviewMomentum,
  overviewPossessionOutcome,
}) {
  const outcomeSeries = [
    { k: 'Score', c: '#059669' },
    { k: 'Missed Shot', c: '#eab308' },
    { k: 'Turnover', c: '#f97316' },
    { k: 'Half End', c: '#64748b' },
  ];
  const momentumRows = React.useMemo(
    () => (Array.isArray(overviewMomentum?.rows) ? overviewMomentum.rows.map((row) => ({
      ...row,
      swing: Number.isFinite(Number(row?.home)) ? Number(row.home) - 50 : 0,
      homeSwing: Number.isFinite(Number(row?.home)) ? Math.max(0, Number(row.home) - 50) : 0,
      awaySwing: Number.isFinite(Number(row?.home)) ? Math.min(0, Number(row.home) - 50) : 0,
    })) : []),
    [overviewMomentum]
  );
  const momentumTicks = React.useMemo(() => {
    const maxMinutes = Math.max(5, Number(overviewMomentum?.axisMaxMinutes || 5));
    const boundaryMinutes = (overviewMomentum?.boundaryMarks || [])
      .map((marker) => Number(marker?.time) / 60)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const sectionStarts = [0, ...boundaryMinutes.filter((value) => value < maxMinutes)];
    const sectionEnds = [...boundaryMinutes.filter((value) => value <= maxMinutes), maxMinutes];
    const ticks = new Set([0, maxMinutes]);

    for (let i = 0; i < sectionStarts.length; i += 1) {
      const start = sectionStarts[i];
      const end = sectionEnds[i] ?? maxMinutes;
      ticks.add(start);
      for (let minute = start + 10; minute < end; minute += 10) ticks.add(minute);
      ticks.add(end);
    }

    return Array.from(ticks)
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= maxMinutes)
      .sort((a, b) => a - b);
  }, [overviewMomentum]);
  const showMomentum = overviewMomentum.mode !== 'none' && momentumRows.length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2 items-stretch">
            <Card className="h-full">
              <CardContent className="p-4 space-y-4 h-full flex flex-col">
                <div className="font-semibold text-slate-900">Score Timeline</div>
                {scoreTimeline.points.length <= 1 ? (
                  <div className="text-xs text-slate-500">No scoring events in the selected window.</div>
                ) : (
                  <ChartContainer
                    id="score-timeline"
                    className="h-[280px] w-full flex-1"
                    config={{
                      home: { label: homeTeam?.name || 'Home', color: homeTeam?.color || '#22c55e' },
                      away: { label: awayTeam?.name || 'Away', color: awayTeam?.color || '#ef4444' },
                    }}
                  >
                    <LineChart data={scoreTimeline.points} margin={{ top: 12, right: 16, left: 0, bottom: 6 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="x"
                        type="number"
                        domain={[0, Math.max(1, ...scoreTimeline.points.map((p) => Number(p?.x) || 0))]}
                        allowDuplicatedCategory={false}
                        ticks={scoreTimeline.mode === 'time'
                          ? Array.from({ length: Math.floor(Math.max(1, ...scoreTimeline.points.map((p) => Number(p?.x) || 0)) / 600) + 1 }, (_, i) => i * 600)
                          : undefined}
                        tickFormatter={(v) => (scoreTimeline.mode === 'time'
                          ? formatMatchClock(Number(v) + Number(scoreTimeline.t0 || 0), match)
                          : String(v))}
                        className="text-xs"
                      />
                      <YAxis allowDecimals={false} className="text-xs" />
                      <Tooltip
                        cursor={{ stroke: '#cbd5e1' }}
                        content={
                          <ChartTooltipContent
                            indicator="line"
                            formatter={(value, name, item) => {
                              const isHome = name === 'home_total' || name === 'home';
                              const row = item?.payload;
                              const goals = isHome ? row?.home_goals : row?.away_goals;
                              const pts = isHome ? row?.home_points : row?.away_points;
                              const label = isHome ? (homeTeam?.name || 'Home') : (awayTeam?.name || 'Away');
                              return (
                                <div className="flex w-full justify-between gap-4">
                                  <span className="text-muted-foreground">{label}</span>
                                  <span className="font-mono font-medium tabular-nums text-foreground">
                                    {Number(value)} ({goals}:{pts})
                                  </span>
                                </div>
                              );
                            }}
                            labelFormatter={(_, payload) => {
                              const row = payload?.[0]?.payload;
                              return scoreTimeline.mode === 'time' ? `Time: ${row?.label || ''}` : `Play: ${String(row?.x ?? '')}`;
                            }}
                          />
                        }
                      />
                      {(scoreTimeline.boundaryMarkers || []).map((marker) => (
                        <ReferenceLine key={marker.key} x={Number(marker.x)} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: marker.label, position: 'insideTop', fill: '#475569', fontSize: 10 }} />
                      ))}
                      <Line type="stepAfter" dataKey="home_total" name="home_total" stroke="var(--color-home)" strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line type="stepAfter" dataKey="away_total" name="away_total" stroke="var(--color-away)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card className="h-full">
              <CardContent className="p-4 space-y-4 h-full flex flex-col">
                <div className="grid grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)] items-center gap-3 text-xs text-slate-600">
                  <div className="inline-flex items-center gap-2 min-w-0 justify-self-start">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: homeTeam?.color || '#22c55e' }} />
                    <span className="truncate">{homeTeam?.name || 'Home'}</span>
                  </div>
                  <div className="font-semibold text-[0.9rem] text-slate-800 text-center">Metric</div>
                  <div className="inline-flex items-center gap-2 min-w-0 justify-end justify-self-end">
                    <span className="truncate">{awayTeam?.name || 'Away'}</span>
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: awayTeam?.color || '#ef4444' }} />
                  </div>
                </div>

                <div className="grid gap-2 w-full flex-1 content-start">
                  {(() => {
                    const homePts = summary.home.points1 + summary.home.points2 * 2;
                    const awayPts = summary.away.points1 + summary.away.points2 * 2;
                    const homeScores = summary.home.goals + summary.home.points1 + summary.home.points2;
                    const awayScores = summary.away.goals + summary.away.points1 + summary.away.points2;
                    const metrics = [
                      {
                        label: 'Score',
                        home: `${summary.home.goals}:${homePts} (${summary.home.totalPoints})`,
                        away: `${summary.away.goals}:${awayPts} (${summary.away.totalPoints})`,
                        strong: true,
                      },
                      { label: 'Shots', home: summary.home.shots, away: summary.away.shots },
                      {
                        label: 'Shot Conversion %',
                        home: summary.home.shots ? formatPct((homeScores / summary.home.shots) * 100) : 'NA',
                        away: summary.away.shots ? formatPct((awayScores / summary.away.shots) * 100) : 'NA',
                      },
                      {
                        label: 'Own Kickout Win %',
                        home: (() => {
                          const taken = summary.home.ownKickoutsTaken;
                          const won = summary.home.ownKickoutsWon;
                          const pct = taken ? (won / taken) * 100 : NaN;
                          return `${won} / ${taken} (${formatPct(pct)})`;
                        })(),
                        away: (() => {
                          const taken = summary.away.ownKickoutsTaken;
                          const won = summary.away.ownKickoutsWon;
                          const pct = taken ? (won / taken) * 100 : NaN;
                          return `${won} / ${taken} (${formatPct(pct)})`;
                        })(),
                      },
                      {
                        label: 'Turnover Differential',
                        home: summary.home.turnoversWon - summary.home.turnovers,
                        away: summary.away.turnoversWon - summary.away.turnovers,
                      },
                      {
                        label: 'Points Per Possession',
                        home: summary.home.possessions ? (summary.home.totalPoints / summary.home.possessions).toFixed(2) : 'NA',
                        away: summary.away.possessions ? (summary.away.totalPoints / summary.away.possessions).toFixed(2) : 'NA',
                      },
                      {
                        label: 'Points Per Shot',
                        home: summary.home.shots ? (summary.home.totalPoints / summary.home.shots).toFixed(2) : 'NA',
                        away: summary.away.shots ? (summary.away.totalPoints / summary.away.shots).toFixed(2) : 'NA',
                      },
                    ];

                    return metrics.map((m) => (
                      <div key={m.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <div className="grid grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)] items-center gap-3">
                          <div className={`text-left tabular-nums ${m.strong ? 'font-semibold text-slate-900' : 'text-slate-900'}`}>{m.home}</div>
                          <div className="text-center text-xs font-medium text-slate-600">{m.label}</div>
                          <div className={`text-right tabular-nums ${m.strong ? 'font-semibold text-slate-900' : 'text-slate-900'}`}>{m.away}</div>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 items-stretch">
            <Card className="h-full">
              <CardContent className="p-4 space-y-3 h-full flex flex-col">
                <div className="font-semibold text-slate-900">Momentum</div>
                {!showMomentum ? (
                  <div className="text-xs text-slate-500">No timeline data available (no normalized time values).</div>
                ) : (
                  <div className="relative h-[280px] w-full flex-1">
                  <div className="pointer-events-none absolute left-2 top-1 z-10 text-[11px] font-semibold" style={{ color: homeTeam?.color || '#22c55e' }}>
                    {homeTeam?.name || 'Home'}
                  </div>
                  <div className="pointer-events-none absolute left-2 bottom-7 z-10 text-[11px] font-semibold" style={{ color: awayTeam?.color || '#ef4444' }}>
                    {awayTeam?.name || 'Away'}
                  </div>
                  <ChartContainer
                    id="momentum"
                    className="h-full w-full"
                    config={{
                      home: { label: homeTeam?.name || 'Home', color: homeTeam?.color || '#22c55e' },
                      away: { label: awayTeam?.name || 'Away', color: awayTeam?.color || '#ef4444' },
                    }}
                  >
                    <ComposedChart data={momentumRows} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="minute"
                        type="number"
                        domain={[0, Math.max(5, overviewMomentum.axisMaxMinutes || 5)]}
                        ticks={momentumTicks}
                        tickFormatter={(value) => formatMatchClock(Number(value) * 60, match)}
                        className="text-xs"
                      />
                      <YAxis className="text-xs" domain={[-50, 50]} tick={false} axisLine={false} tickLine={false} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload?.[0]?.payload;
                          if (!row) return null;
                          return (
                            <div className="grid min-w-[8rem] gap-1.5 rounded-xl border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                              <div className="font-medium">{`Time: ${row?.label || ''}`}</div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">{homeTeam?.name || 'Home'}</span>
                                <span className="font-mono font-medium tabular-nums text-foreground">{Math.round(Number(row?.home || 50))}%</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">{awayTeam?.name || 'Away'}</span>
                                <span className="font-mono font-medium tabular-nums text-foreground">{Math.round(Number(row?.away || 50))}%</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
                      {(overviewMomentum.boundaryMarks || []).map((marker) => (
                        <ReferenceLine key={marker.key} x={Number(marker.time) / 60} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: marker.label, position: 'insideTop', fill: '#475569', fontSize: 10 }} />
                      ))}
                      <Area type="monotone" dataKey="homeSwing" stroke="none" fill={homeTeam?.color || '#22c55e'} fillOpacity={0.18} isAnimationActive={false} />
                      <Area type="monotone" dataKey="awaySwing" stroke="none" fill={awayTeam?.color || '#ef4444'} fillOpacity={0.18} isAnimationActive={false} />
                      <Line type="monotone" dataKey="swing" stroke="#0f172a" strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4 }} />
                    </ComposedChart>
                  </ChartContainer>
                </div>
                )}
                <div className="text-[11px] text-slate-500">Composite share using a rolling 5-minute window. Above the centre line favours home; below favours away.</div>
              </CardContent>
            </Card>

            <Card className="h-full">
              <CardContent className="p-4 space-y-3 h-full flex flex-col">
                <div className="font-semibold text-slate-900">Possession Outcomes</div>
                <ChartContainer id="possession-outcomes-overview" className="h-[240px] w-full flex-1" config={{}}>
                  <BarChart data={overviewPossessionOutcome} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="team" className="text-xs" />
                    <YAxis allowDecimals={false} className="text-xs" />
                    <Tooltip content={<ChartTooltipContent />} />
                    <Legend />
                    {outcomeSeries.map((o) => (
                      <Bar key={o.k} dataKey={o.k} stackId="a" fill={o.c} />
                    ))}
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
