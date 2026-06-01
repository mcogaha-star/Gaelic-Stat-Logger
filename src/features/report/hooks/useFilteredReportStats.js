import { useMemo } from 'react';
import { getMatchTimeS } from '@/lib/reportAnalytics';
import { collectPlayerIds, deriveOutcome, safeParseJSON, statMatchesActionType } from '../shared';

export function useFilteredReportStats({ stats, overviewHalf, reportFilters, match, imputedTimeById }) {
  const overviewStats = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    if (overviewHalf === 'first') return list.filter((s) => s?.half === 'first');
    if (overviewHalf === 'second') return list.filter((s) => s?.half === 'second');
    return list;
  }, [stats, overviewHalf]);

  const filteredForReport = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    const minM = Number(reportFilters.timeMin);
    const maxM = Number(reportFilters.timeMax);
    const minS = Number.isFinite(minM) && reportFilters.timeMin !== '' ? minM * 60 : null;
    const maxS = Number.isFinite(maxM) && reportFilters.timeMax !== '' ? maxM * 60 : null;

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
      if (minS != null || maxS != null) {
        const t = getMatchTimeS(s, match, imputedTimeById);
        if (!Number.isFinite(t)) return false;
        if (minS != null && t < minS) return false;
        if (maxS != null && t > maxS) return false;
      }
      return true;
    });
  }, [stats, reportFilters, match, imputedTimeById]);

  return {
    overviewStats,
    filteredForReport,
  };
}

export default useFilteredReportStats;
