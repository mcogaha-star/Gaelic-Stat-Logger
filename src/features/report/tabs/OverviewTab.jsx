import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatPct } from '../shared';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';

function teamBandStyle(color, side) {
  return {
    [side]: 0,
    background: `linear-gradient(180deg, ${color || '#94a3b8'} 0%, ${color || '#94a3b8'} 100%)`,
  };
}

const paneClassName = 'report-pane';

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
  const clickableOutcomeKeys = new Set(['Score', 'Missed Shot', 'Turnover']);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const [breakdownCategory, setBreakdownCategory] = React.useState('');
  const momentumRows = React.useMemo(
    () => (Array.isArray(overviewMomentum?.rows) ? overviewMomentum.rows.map((row) => ({
      ...row,
      swing: Number.isFinite(Number(row?.home)) ? Number(row.home) - 50 : 0,
      homeSwing: Number.isFinite(Number(row?.home)) ? Math.max(0, Number(row.home) - 50) : 0,
      awaySwing: Number.isFinite(Number(row?.home)) ? Math.min(0, Number(row.home) - 50) : 0,
    })) : []),
    [overviewMomentum]
  );
  const showMomentum = overviewMomentum.mode !== 'none' && momentumRows.length > 0;
  const possessionOutcomeRows = Array.isArray(overviewPossessionOutcome?.rows) ? overviewPossessionOutcome.rows : [];
  const openBreakdown = React.useCallback((key) => {
    if (!clickableOutcomeKeys.has(key)) return;
    setBreakdownCategory(key);
    setBreakdownOpen(true);
  }, []);
  const breakdownRows = React.useMemo(
    () => (breakdownCategory ? (overviewPossessionOutcome?.breakdownRows?.[breakdownCategory] || []) : []),
    [overviewPossessionOutcome, breakdownCategory]
  );
  const breakdownSeries = React.useMemo(() => {
    if (!breakdownRows.length) return [];
    const keys = Array.from(new Set(breakdownRows.flatMap((row) => Object.keys(row || {}))))
      .filter((key) => !['team', 'side'].includes(key));
    const palette = ['#047857', '#0ea5e9', '#6366f1', '#f59e0b', '#dc2626', '#7c3aed', '#334155'];
    return keys.map((key, index) => ({ key, color: palette[index % palette.length] }));
  }, [breakdownRows]);
  const formatSigned = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'NA';
    if (n > 0) return `+${n}`;
    return `${n}`;
  };
  const renderPossessionOutcomeTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    const total = outcomeSeries.reduce((sum, series) => sum + Number(row?.[series.k] || 0), 0);
    return (
      <div className="grid min-w-[10rem] gap-1.5 rounded-xl border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
        <div className="font-medium">{row.team}</div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Total Possessions</span>
          <span className="font-mono font-medium tabular-nums text-foreground">{total}</span>
        </div>
        {outcomeSeries.map((series) => (
          <div key={series.k} className="flex justify-between gap-4">
            <span className="text-muted-foreground">{series.k}</span>
            <span className="font-mono font-medium tabular-nums text-foreground">{Number(row?.[series.k] || 0)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2 items-stretch">
            <Card className={`h-full lg:order-2 ${paneClassName}`}>
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
                        domain={[0, Math.max(1, Number(scoreTimeline.axisMax || 0), ...scoreTimeline.points.map((p) => Number(p?.x) || 0))]}
                        allowDuplicatedCategory={false}
                        ticks={scoreTimeline.mode === 'time' ? scoreTimeline.tickValues : undefined}
                        tickFormatter={(v) => (scoreTimeline.mode === 'time'
                          ? (scoreTimeline.tickFormatter ? scoreTimeline.tickFormatter(Number(v)) : String(v))
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
                              const heading = scoreTimeline.mode === 'time' ? `Time: ${row?.label || ''}` : `Play: ${String(row?.x ?? '')}`;
                              const event = row?.eventLabel ? ` • ${row.eventLabel}` : '';
                              return `${heading}${event}`;
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

            <Card className="report-pane h-full lg:order-1">
              <CardContent className="p-4 space-y-4 h-full flex flex-col">
                <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm">
                  <div className="absolute inset-y-0 left-0 w-2" style={teamBandStyle(homeTeam?.color || '#22c55e', 'left')} />
                  <div className="absolute inset-y-0 right-0 w-2" style={teamBandStyle(awayTeam?.color || '#ef4444', 'right')} />
                  <div className="grid grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)] items-center gap-3 text-slate-600">
                    <div className="min-w-0 justify-self-start pr-2 text-base font-semibold text-slate-900">
                      <span className="truncate">{homeTeam?.name || 'Home'}</span>
                    </div>
                    <div className="font-semibold text-[1rem] text-slate-800 text-center">Metric</div>
                    <div className="min-w-0 justify-self-end pl-2 text-right text-base font-semibold text-slate-900">
                      <span className="truncate">{awayTeam?.name || 'Away'}</span>
                    </div>
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
                      {
                        label: 'Shot Scoring',
                        home: `${homeScores}/${summary.home.shots} (${formatPct(summary.home.shots ? (homeScores / summary.home.shots) * 100 : NaN)})`,
                        away: `${awayScores}/${summary.away.shots} (${formatPct(summary.away.shots ? (awayScores / summary.away.shots) * 100 : NaN)})`,
                      },
                      {
                        label: 'Points Per Shot',
                        home: summary.home.shots ? (summary.home.totalPoints / summary.home.shots).toFixed(2) : 'NA',
                        away: summary.away.shots ? (summary.away.totalPoints / summary.away.shots).toFixed(2) : 'NA',
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
                        label: 'Turnovers Won',
                        home: `${summary.home.turnoversWon} (${formatSigned(summary.home.turnoversWon - summary.home.turnovers)})`,
                        away: `${summary.away.turnoversWon} (${formatSigned(summary.away.turnoversWon - summary.away.turnovers)})`,
                      },
                      {
                        label: 'Points Per Possession',
                        home: summary.home.possessions ? (summary.home.totalPoints / summary.home.possessions).toFixed(2) : 'NA',
                        away: summary.away.possessions ? (summary.away.totalPoints / summary.away.possessions).toFixed(2) : 'NA',
                      },
                    ];

                    return metrics.map((m) => (
                      <div key={m.label} className="rounded-xl border border-slate-200 bg-gradient-to-r from-white to-slate-50 px-3 py-2 shadow-sm">
                        <div className="grid grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)] items-center gap-3">
                          <div className={`text-left tabular-nums ${m.strong ? 'font-semibold text-slate-900' : 'text-slate-900'}`}>{m.home}</div>
                          <div className="text-center text-sm font-semibold text-slate-700">{m.label}</div>
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
            <Card className={`h-full ${paneClassName}`}>
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
                        dataKey="x"
                        type="number"
                        domain={[0, Math.max(5 * 60, overviewMomentum.axisMaxSeconds || 5 * 60)]}
                        ticks={overviewMomentum.tickValues}
                        tickFormatter={(value) => overviewMomentum.tickFormatter ? overviewMomentum.tickFormatter(Number(value)) : String(value)}
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
                        <ReferenceLine key={marker.key} x={Number(marker.x)} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: marker.label, position: 'insideTop', fill: '#475569', fontSize: 10 }} />
                      ))}
                      <Area type="monotone" dataKey="homeSwing" stroke="none" fill={homeTeam?.color || '#22c55e'} fillOpacity={0.18} isAnimationActive={false} />
                      <Area type="monotone" dataKey="awaySwing" stroke="none" fill={awayTeam?.color || '#ef4444'} fillOpacity={0.18} isAnimationActive={false} />
                      <Line type="monotone" dataKey="swing" stroke="#0f172a" strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4 }} />
                    </ComposedChart>
                  </ChartContainer>
                </div>
                )}
              </CardContent>
            </Card>

            <Card className="report-pane h-full">
              <CardContent className="p-4 space-y-3 h-full flex flex-col">
                <div className="space-y-2">
                  <div className="font-semibold text-slate-900">Possession Outcomes</div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {outcomeSeries.map((series) => (
                      <button
                        key={series.k}
                        type="button"
                        onClick={() => openBreakdown(series.k)}
                        disabled={!clickableOutcomeKeys.has(series.k)}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 ${clickableOutcomeKeys.has(series.k) ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50' : 'border-slate-100 bg-slate-50 text-slate-400 cursor-default'}`}
                      >
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: series.c }} />
                        <span>{series.k}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <ChartContainer id="possession-outcomes-overview" className="h-[240px] w-full flex-1" config={{}}>
                  <BarChart data={possessionOutcomeRows} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="team" className="text-xs" />
                    <YAxis allowDecimals={false} className="text-xs" />
                    <Tooltip content={renderPossessionOutcomeTooltip} />
                    {outcomeSeries.map((o) => (
                      <Bar
                        key={o.k}
                        dataKey={o.k}
                        stackId="a"
                        fill={o.c}
                        onClick={() => openBreakdown(o.k)}
                        cursor={clickableOutcomeKeys.has(o.k) ? 'pointer' : 'default'}
                      />
                    ))}
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
      </div>

      <Dialog open={breakdownOpen} onOpenChange={setBreakdownOpen}>
        <DialogContent className="max-w-4xl w-[94vw]">
          <DialogHeader>
            <DialogTitle>{breakdownCategory} Breakdown</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-slate-600">
              Breakdown of the selected possession outcome by team.
            </div>
            <ChartContainer id="overview-outcome-breakdown" className="h-[320px] w-full" config={{}}>
              <BarChart data={breakdownRows} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="team" className="text-xs" />
                <YAxis allowDecimals={false} className="text-xs" />
                <Tooltip />
                <Legend />
                {breakdownSeries.map((series) => (
                  <Bar key={series.key} dataKey={series.key} stackId="a" fill={series.color} />
                ))}
              </BarChart>
            </ChartContainer>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
