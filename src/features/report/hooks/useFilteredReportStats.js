import { useMemo } from 'react';
import { collectPlayerIds, deriveOutcome, safeParseJSON, statMatchesActionType, statMatchesDisplayTimeRange } from '../shared';

export function useFilteredReportStats({ stats, overviewHalf, reportFilters, match, imputedTimeById }) {
  const overviewStats = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    if (overviewHalf === 'first') return list.filter((s) => s?.half === 'first');
    if (overviewHalf === 'second') return list.filter((s) => s?.half === 'second');
    return list;
  }, [stats, overviewHalf]);

  const filteredForReport = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    return list.filter((s) => {
      if (!s) return false;
      if (reportFilters.team !== 'both' && s.team_side !== reportFilters.team) return false;
      if (reportFilters.halves.length && !reportFilters.halves.includes(s.half)) return false;
      if (reportFilters.actionTypes.length && !reportFilters.actionTypes.some((value) => statMatchesActionType(s, value))) return false;
      if (reportFilters.outcomes.length) {
        const extra = safeParseJSON(s.extra_data || '{}', {});
        const out = deriveOutcome(s, extra);
        if (!reportFilters.outcomes.includes(out)) return false;
      }
      if (reportFilters.playerIds.length) {
        const extra = safeParseJSON(s.extra_data || '{}', {});
        const ids = collectPlayerIds(extra);
        const any = reportFilters.playerIds.some((id) => ids.has(String(id)));
        if (!any) return false;
      }
      if (!statMatchesDisplayTimeRange(s, {
        timeMin: reportFilters.timeMin,
        timeMax: reportFilters.timeMax,
        match,
        imputedTimeById,
        stats: reportFilters?.allStats || list,
      })) return false;
      return true;
    });
  }, [stats, reportFilters, match, imputedTimeById]);

  return {
    overviewStats,
    filteredForReport,
  };
}

export default useFilteredReportStats;
