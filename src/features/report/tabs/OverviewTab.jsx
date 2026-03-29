import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { formatMMSS, formatPct } from '../shared';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';

export default function OverviewTab({
  homeTeam,
  awayTeam,
  scoreTimeline,
  summary,
  overviewMomentum,
  overviewPossessionOutcome,
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="font-semibold text-slate-900">Score Timeline</div>
          {scoreTimeline.points.length <= 1 ? (
            <div className="text-xs text-slate-500">No scoring events in the selected window.</div>
          ) : (
            <ChartContainer
              id="score-timeline"
              className="h-[280px] w-full"
              config={{
                home: { label: homeTeam?.name || 'Home', color: homeTeam?.color || '#22c55e' },
                away: { label: awayTeam?.name || 'Away', color: awayTeam?.color || '#ef4444' },
              }}
            >
              <LineChart data={scoreTimeline.points} margin={{ top: 12, right: 16, left: 0, bottom: 6 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="x"
                  tickFormatter={(v) => (scoreTimeline.mode === 'time' ? formatMMSS(Number(v)) : String(v))}
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
                        const x = Number(row?.x);
                        return scoreTimeline.mode === 'time' ? `Time: ${formatMMSS(x)}` : `Play: ${String(x)}`;
                      }}
                    />
                  }
                />
                {Number.isFinite(Number(scoreTimeline.htX)) && (
                  <ReferenceLine x={Number(scoreTimeline.htX)} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'HT', position: 'insideTop', fill: '#475569', fontSize: 10 }} />
                )}
                <Line type="stepAfter" dataKey="home_total" name="home_total" stroke="var(--color-home)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="stepAfter" dataKey="away_total" name="away_total" stroke="var(--color-away)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ChartContainer>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)] items-center gap-3 text-xs text-slate-600 pt-2">
            <div className="inline-flex items-center gap-2 min-w-0 justify-self-start">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: homeTeam?.color || '#22c55e' }} />
              <span className="truncate">{homeTeam?.name || 'Home'}</span>
            </div>
            <div className="font-medium text-center">Metric</div>
            <div className="inline-flex items-center gap-2 min-w-0 justify-end justify-self-end">
              <span className="truncate">{awayTeam?.name || 'Away'}</span>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: awayTeam?.color || '#ef4444' }} />
            </div>
          </div>

          <div className="grid gap-2 pt-2">
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
                  home: summary.home.turnoversWon - summary.away.turnoversWon,
                  away: summary.away.turnoversWon - summary.home.turnoversWon,
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

          <div className="pt-5 space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Momentum</div>
                {overviewMomentum.mode === 'none' ? (
                  <div className="text-xs text-slate-500">No timeline data available (no normalized time values).</div>
                ) : (
                  <ChartContainer
                    id="momentum"
                    className="h-[220px] w-full"
                    config={{
                      home: { label: homeTeam?.name || 'Home', color: homeTeam?.color || '#22c55e' },
                      away: { label: awayTeam?.name || 'Away', color: awayTeam?.color || '#ef4444' },
                    }}
                  >
                    <LineChart data={overviewMomentum.rows} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="minute"
                        type="number"
                        domain={[0, Math.max(5, overviewMomentum.axisMaxMinutes || 5)]}
                        tickCount={Math.max(4, Math.ceil((overviewMomentum.axisMaxMinutes || 5) / 10))}
                        tickFormatter={(value) => `${Math.round(value)}`}
                        className="text-xs"
                      />
                      <YAxis className="text-xs" domain={[0, 100]} tick={false} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <ReferenceLine y={50} stroke="#94a3b8" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="home" stroke={homeTeam?.color || '#22c55e'} strokeWidth={3} dot={false} activeDot={{ r: 4 }} />
                      <Line type="monotone" dataKey="away" stroke={awayTeam?.color || '#ef4444'} strokeWidth={3} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ChartContainer>
                )}
                <div className="text-[11px] text-slate-500">Composite share using a rolling 5-minute window (points, productivity, turnover control, possession wins, efficiency).</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Possession Outcomes</div>
                <ChartContainer id="possession-outcomes-overview" className="h-[240px] w-full" config={{}}>
                  <BarChart data={overviewPossessionOutcome} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="team" className="text-xs" />
                    <YAxis allowDecimals={false} className="text-xs" />
                    <Tooltip content={<ChartTooltipContent />} />
                    <Legend />
                    {[
                      { k: 'Score', c: '#1d4ed8' },
                      { k: 'Missed Shot', c: '#64748b' },
                      { k: 'Turnover', c: '#dc2626' },
                      { k: 'Half End', c: '#94a3b8' },
                    ].map((o) => (
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
