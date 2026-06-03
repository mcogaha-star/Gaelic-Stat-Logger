import { useEffect, useMemo, useRef, useState } from 'react';
import { collectPlayerIds, defenceSetStateKey, deriveCounterAttackState, deriveOutcome, groupByPossession, safeParseJSON } from '../shared';

const DEFAULT_REPORT_FILTERS = {
  team: 'both',
  halves: [],
  playerIds: [],
  actionTypes: [],
  outcomes: [],
  timeMin: '',
  timeMax: '',
};

export function useReportFilterState({ stats, match, imputedTimeById }) {
  const [vizTeam, setVizTeam] = useState('both');
  const [vizActions, setVizActions] = useState([]);
  const [vizHalves, setVizHalves] = useState([]);
  const [vizCounters, setVizCounters] = useState([]);
  const [vizPlayerIds, setVizPlayerIds] = useState([]);
  const [vizColorBy, setVizColorBy] = useState('team');
  const [activeTab, setActiveTab] = useState('summary');
  const [topFiltersOpen, setTopFiltersOpen] = useState(false);
  const [overviewHalf, setOverviewHalf] = useState('all');
  const previousActiveTabRef = useRef(activeTab);
  const [reportFiltersByTab, setReportFiltersByTab] = useState({});

  const [reportTeam, setReportTeam] = useState('both');
  const [reportHalves, setReportHalves] = useState([]);
  const [reportPlayerIds, setReportPlayerIds] = useState([]);
  const [reportActionTypes, setReportActionTypes] = useState([]);
  const [reportOutcomes, setReportOutcomes] = useState([]);
  const [reportTimeMin, setReportTimeMin] = useState('');
  const [reportTimeMax, setReportTimeMax] = useState('');

  const [scoringShotType, setScoringShotType] = useState([]);
  const [scoringSituation, setScoringSituation] = useState([]);
  const [scoringPressure, setScoringPressure] = useState([]);
  const [scoringMethod, setScoringMethod] = useState([]);
  const [scoringAttackType, setScoringAttackType] = useState('any');
  const [possessionsAttackTypeFilter, setPossessionsAttackTypeFilter] = useState('any');
  const [possessionsOutcomeFilter, setPossessionsOutcomeFilter] = useState([]);
  const [possessionsOriginFilter, setPossessionsOriginFilter] = useState([]);
  const [possessionsStartZoneFilter, setPossessionsStartZoneFilter] = useState([]);
  const [buildEventTypes, setBuildEventTypes] = useState([]);
  const [buildPressure, setBuildPressure] = useState([]);
  const [buildOutcome, setBuildOutcome] = useState([]);
  const [buildProgressiveOnly, setBuildProgressiveOnly] = useState(false);
  const [buildPnSide, setBuildPnSide] = useState('home');
  const [buildPnMin, setBuildPnMin] = useState(3);
  const [buildPnHalf, setBuildPnHalf] = useState('all');
  const [defenseEventCategory, setDefenseEventCategory] = useState('all');
  const [defenseTurnoverResult, setDefenseTurnoverResult] = useState('both');
  const [defenseTurnoverTypes, setDefenseTurnoverTypes] = useState([]);
  const [defenseDefTypes, setDefenseDefTypes] = useState([]);
  const [playersFocusPlayerId, setPlayersFocusPlayerId] = useState('all');

  useEffect(() => {
    const previousTab = previousActiveTabRef.current;
    if (previousTab === activeTab) return;

    const currentSnapshot = {
      team: reportTeam,
      halves: reportHalves,
      playerIds: reportPlayerIds,
      actionTypes: reportActionTypes,
      outcomes: reportOutcomes,
      timeMin: reportTimeMin,
      timeMax: reportTimeMax,
    };
    const nextSnapshot = { ...DEFAULT_REPORT_FILTERS, ...(reportFiltersByTab[activeTab] || {}) };

    setReportFiltersByTab((current) => ({
      ...current,
      [previousTab]: currentSnapshot,
    }));
    setReportTeam(nextSnapshot.team);
    setReportHalves(nextSnapshot.halves);
    setReportPlayerIds(nextSnapshot.playerIds);
    setReportActionTypes(nextSnapshot.actionTypes);
    setReportOutcomes(nextSnapshot.outcomes);
    setReportTimeMin(nextSnapshot.timeMin);
    setReportTimeMax(nextSnapshot.timeMax);
    previousActiveTabRef.current = activeTab;
  }, [activeTab]);

  const reportFilters = useMemo(() => ({
    team: reportTeam,
    setTeam: setReportTeam,
    halves: reportHalves,
    setHalves: setReportHalves,
    playerIds: reportPlayerIds,
    setPlayerIds: setReportPlayerIds,
    actionTypes: reportActionTypes,
    setActionTypes: setReportActionTypes,
    outcomes: reportOutcomes,
    setOutcomes: setReportOutcomes,
    timeMin: reportTimeMin,
    setTimeMin: setReportTimeMin,
    timeMax: reportTimeMax,
    setTimeMax: setReportTimeMax,
    imputedTimeById,
    match,
    allStats: stats,
  }), [reportTeam, reportHalves, reportPlayerIds, reportActionTypes, reportOutcomes, reportTimeMin, reportTimeMax, imputedTimeById, match, stats]);

  useEffect(() => {
    const allowedByTab = {
      scoring: ['shot'],
      possessions: ['pass', 'carry', 'shot', 'turnover', 'kickout', 'throw_in', 'foul'],
      build_up: ['pass', 'carry'],
      kickouts: ['kickout', 'throw_in'],
      misc: ['throw_in'],
      defense: ['turnover', 'foul'],
      fouls: ['foul', 'pass', 'carry', 'turnover', 'kickout', 'throw_in'],
      players_ana: ['shot', 'pass', 'carry', 'turnover', 'foul', 'kickout', 'throw_in'],
    };
    const allowed = allowedByTab[activeTab] || null;
    if (!allowed) return;

    const allowedSet = new Set(allowed);
    const nextActionTypes = (Array.isArray(reportActionTypes) ? reportActionTypes : []).filter((value) => allowedSet.has(value));
    const actionChanged =
      nextActionTypes.length !== reportActionTypes.length
      || nextActionTypes.some((value, index) => value !== reportActionTypes[index]);
    if (actionChanged) setReportActionTypes(nextActionTypes);

    const validOutcomes = new Set(
      (Array.isArray(stats) ? stats : [])
        .filter((s) => {
          const statType = String(s?.stat_type || '');
          if (!allowedSet.has(statType)) return false;
          if (nextActionTypes.length && !nextActionTypes.includes(statType)) return false;
          return true;
        })
        .map((s) => deriveOutcome(s, safeParseJSON(s?.extra_data || '{}', {})))
        .filter(Boolean)
    );

    const nextOutcomes = (Array.isArray(reportOutcomes) ? reportOutcomes : []).filter((value) => validOutcomes.has(value));
    const outcomesChanged =
      nextOutcomes.length !== reportOutcomes.length
      || nextOutcomes.some((value, index) => value !== reportOutcomes[index]);
    if (outcomesChanged) setReportOutcomes(nextOutcomes);
  }, [activeTab, reportActionTypes, reportOutcomes, stats]);

  const filteredForViz = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    const possessionGroups = groupByPossession(list);
    const counterStateByPossession = new Map(
      Array.from(possessionGroups.entries()).map(([key, evs]) => {
        const [teamSide] = String(key).split('-');
        const acting = (Array.isArray(evs) ? evs : []).filter((e) => e && e.team_side === teamSide);
        return [key, deriveCounterAttackState(acting)];
      })
    );
    return list.filter((s) => {
      if (!s) return false;
      if (vizTeam !== 'both' && s.team_side !== vizTeam) return false;
      if (vizActions.length && !vizActions.includes(s.stat_type)) return false;
      if (vizHalves.length && !vizHalves.includes(s.half)) return false;
      if (vizCounters.length) {
        const possKey = `${s?.possession_team_side || 'unknown'}-${s?.possession_id ?? 'na'}`;
        const state = counterStateByPossession.get(possKey) || 'No';
        const stateKey = defenceSetStateKey(state);
        if (!vizCounters.includes(stateKey)) return false;
      }
      if (vizPlayerIds.length) {
        const extra = safeParseJSON(s.extra_data || '{}', {});
        const ids = collectPlayerIds(extra);
        const any = vizPlayerIds.some((id) => ids.has(String(id)));
        if (!any) return false;
      }
      return true;
    });
  }, [stats, vizTeam, vizActions, vizHalves, vizCounters, vizPlayerIds]);

  const resetAllFilters = () => {
    setTopFiltersOpen(false);
    setOverviewHalf('all');

    setReportTeam('both');
    setReportHalves([]);
    setReportPlayerIds([]);
    setReportActionTypes([]);
    setReportOutcomes([]);
    setReportTimeMin('');
    setReportTimeMax('');
    setReportFiltersByTab({});

    setScoringShotType([]);
    setScoringSituation([]);
    setScoringPressure([]);
    setScoringMethod([]);
    setScoringAttackType('any');

    setPossessionsAttackTypeFilter('any');
    setPossessionsOutcomeFilter([]);
    setPossessionsOriginFilter([]);
    setPossessionsStartZoneFilter([]);

    setBuildEventTypes([]);
    setBuildPressure([]);
    setBuildOutcome([]);
    setBuildProgressiveOnly(false);
    setBuildPnSide('home');
    setBuildPnMin(3);
    setBuildPnHalf('all');

    setDefenseEventCategory('all');
    setDefenseTurnoverResult('both');
    setDefenseTurnoverTypes([]);
    setDefenseDefTypes([]);

    setPlayersFocusPlayerId('all');

    setVizTeam('both');
    setVizActions([]);
    setVizHalves([]);
    setVizCounters([]);
    setVizPlayerIds([]);
    setVizColorBy('team');
  };

  return {
    activeTab,
    setActiveTab,
    topFiltersOpen,
    setTopFiltersOpen,
    overviewHalf,
    setOverviewHalf,
    reportFilters,
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
    vizColorBy,
    setVizColorBy,
    scoringShotType,
    setScoringShotType,
    scoringSituation,
    setScoringSituation,
    scoringPressure,
    setScoringPressure,
    scoringMethod,
    setScoringMethod,
    scoringAttackType,
    setScoringAttackType,
    possessionsAttackTypeFilter,
    setPossessionsAttackTypeFilter,
    possessionsOutcomeFilter,
    setPossessionsOutcomeFilter,
    possessionsOriginFilter,
    setPossessionsOriginFilter,
    possessionsStartZoneFilter,
    setPossessionsStartZoneFilter,
    buildEventTypes,
    setBuildEventTypes,
    buildPressure,
    setBuildPressure,
    buildOutcome,
    setBuildOutcome,
    buildProgressiveOnly,
    setBuildProgressiveOnly,
    buildPnSide,
    setBuildPnSide,
    buildPnMin,
    setBuildPnMin,
    buildPnHalf,
    setBuildPnHalf,
    defenseEventCategory,
    setDefenseEventCategory,
    defenseTurnoverResult,
    setDefenseTurnoverResult,
    defenseTurnoverTypes,
    setDefenseTurnoverTypes,
    defenseDefTypes,
    setDefenseDefTypes,
    playersFocusPlayerId,
    setPlayersFocusPlayerId,
    filteredForViz,
    showTopFiltersButton: activeTab !== 'data',
    resetAllFilters,
  };
}

export default useReportFilterState;

