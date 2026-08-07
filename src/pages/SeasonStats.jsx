const db = globalThis.__B44_DB__ || {
  entities: new Proxy({}, { get: () => ({ filter: async () => [], list: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
};

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, Calendar, CheckCircle2, Copy, FolderKanban, Gauge, GitCompareArrows, Plus, ShieldCheck, Users } from 'lucide-react';
import { toast } from 'sonner';

import { createPageUrl } from '@/utils';
import { useAuth } from '@/lib/AuthContext';
import {
  autoLinkWorkspaceMatches,
  createAnalysisGroup,
  createStintPreset,
  createTeamWorkspace,
  deleteStintPreset,
  getAccessibleWorkspaces,
  getWorkspaceActor,
  isWorkspaceAdmin,
  joinWorkspaceByCode,
  linkMatchToWorkspace,
  listWorkspaceBundle,
  removeAnalysisGroupMatch,
  reviewWorkspaceJoinRequest,
  updateWorkspaceSettings,
  upsertAnalysisGroupMatch,
} from '@/lib/teamWorkspaces';
import {
  buildSeasonAnalytics,
  formatSeasonMetricValue,
  normalizeMetricValue,
  SEASON_NORMALIZATION_OPTIONS,
  SEASON_PLAYER_METRICS,
  SEASON_POSSESSION_DENOMINATOR_OPTIONS,
  SEASON_TEAM_METRICS,
} from '@/lib/seasonAnalytics';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function formatMatchTitle(match, teamsById) {
  const home = teamsById.get(String(match?.home_team_id || ''));
  const away = teamsById.get(String(match?.away_team_id || ''));
  if (home?.name && away?.name) return `${home.name} vs ${away.name}`;
  return 'Match';
}

function formatMetricLabel(mode, denominatorLabel) {
  if (mode === 'per_game') return 'Per game';
  if (mode === 'per_60') return 'Per 60';
  if (mode === 'per_70') return 'Per 70';
  if (mode === 'per_10_possessions') return `Per 10 ${denominatorLabel.toLowerCase()}`;
  return 'Totals';
}

function sortMatchesByDate(matches = []) {
  return (Array.isArray(matches) ? matches : []).slice().sort((left, right) => {
    const a = Date.parse(String(left?.date || ''));
    const b = Date.parse(String(right?.date || ''));
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return b - a;
    return String(right?.created_date || '').localeCompare(String(left?.created_date || ''));
  });
}

function statusTone(state) {
  if (state === 'ready') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (state === 'excluded') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (state === 'partial_import') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function toPct(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0%';
  return `${numeric.toFixed(0)}%`;
}

function MetricCard({ label, value, subtitle = '' }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-slate-950">{value}</div>
      {subtitle ? <div className="mt-1 text-sm text-slate-500">{subtitle}</div> : null}
    </div>
  );
}

function ComparisonRow({ label, value, helper = '' }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div>
        <div className="font-medium text-slate-900">{label}</div>
        {helper ? <div className="text-xs text-slate-500">{helper}</div> : null}
      </div>
      <div className="text-lg font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function EmptyState({ title, body, action = null }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-lg font-semibold text-slate-900">{title}</div>
        <div className="max-w-2xl text-sm text-slate-600">{body}</div>
        {action}
      </CardContent>
    </Card>
  );
}

function SeasonConstructionDialog({ open, onOpenChange, backHref }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Season Analytics Is Still Being Built</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm text-slate-600">
          <p>
            This section is not ready for live team use yet.
          </p>
          <p>
            Team workspaces, team codes, groups, and season outputs are still in progress, so users should not rely on this area yet.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Link to={backHref}>
              <Button type="button" variant="outline" className="w-full sm:w-auto">
                Back
              </Button>
            </Link>
            <Button type="button" className="w-full bg-slate-900 hover:bg-slate-800 sm:w-auto" onClick={() => onOpenChange(false)}>
              Continue Anyway
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SeasonStats() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const params = new URLSearchParams(location.search || '');
  const queryWorkspaceId = params.get('workspace') || '';
  const queryGroupId = params.get('group') || '';
  const queryMatchId = params.get('matchId') || '';
  const queryTeamCode = String(params.get('teamCode') || '').trim().toUpperCase();

  const actor = useMemo(() => getWorkspaceActor(user), [user]);

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(queryWorkspaceId);
  const [selectedGroupId, setSelectedGroupId] = useState(queryGroupId);
  const [normalizationMode, setNormalizationMode] = useState('per_game');
  const [possessionDenominatorMode, setPossessionDenominatorMode] = useState('own');
  const [teamMetricKey, setTeamMetricKey] = useState('pointsFor');
  const [playerMetricKey, setPlayerMetricKey] = useState('points');
  const [opponentMetricKey, setOpponentMetricKey] = useState('pointsFor');
  const [stintMetricKey, setStintMetricKey] = useState('pointsFor');

  const [workspaceForm, setWorkspaceForm] = useState({
    name: '',
    primaryTeamRef: '',
    joinPolicy: 'approval_required',
  });
  const [groupForm, setGroupForm] = useState({
    name: '',
    description: '',
    groupType: 'custom',
  });
  const [joinCodeInput, setJoinCodeInput] = useState(queryTeamCode);
  const [presetForm, setPresetForm] = useState({
    name: '',
    notes: '',
    includeIds: [],
    excludeIds: [],
  });
  const [workspaceSyncing, setWorkspaceSyncing] = useState(false);
  const [autoJoinHandled, setAutoJoinHandled] = useState(false);
  const [constructionNoticeOpen, setConstructionNoticeOpen] = useState(true);

  const { data: matches = [] } = useQuery({
    queryKey: ['season-all-matches'],
    queryFn: () => db.entities.Match.list('-date'),
  });
  const { data: teams = [] } = useQuery({
    queryKey: ['season-all-teams'],
    queryFn: () => db.entities.Team.list('name'),
  });
  const { data: players = [] } = useQuery({
    queryKey: ['season-all-players'],
    queryFn: () => db.entities.Player.list('number'),
  });
  const { data: stats = [] } = useQuery({
    queryKey: ['season-all-stats'],
    queryFn: () => db.entities.StatEntry.list('play_id'),
  });
  const { data: matchupStints = [] } = useQuery({
    queryKey: ['season-all-matchup-stints'],
    queryFn: () => db.entities.MatchupStint.list('start_time_s'),
  });
  const { data: workspaceBundle = { workspaces: [], members: [], joinRequests: [], groups: [], groupMatches: [], stintPresets: [] } } = useQuery({
    queryKey: ['season-workspace-bundle'],
    queryFn: () => listWorkspaceBundle(db),
  });

  const teamsById = useMemo(
    () => new Map((Array.isArray(teams) ? teams : []).filter((team) => team?.id).map((team) => [String(team.id), team])),
    [teams],
  );

  const realMatches = useMemo(
    () => sortMatchesByDate((matches || []).filter((match) => !match?.is_demo)),
    [matches],
  );

  const accessibleWorkspaces = useMemo(
    () => getAccessibleWorkspaces({ actorId: actor.id, bundle: workspaceBundle }),
    [actor.id, workspaceBundle],
  );

  const selectedWorkspace = useMemo(
    () => accessibleWorkspaces.find((workspace) => String(workspace?.id || '') === String(selectedWorkspaceId || '')) || accessibleWorkspaces[0] || null,
    [accessibleWorkspaces, selectedWorkspaceId],
  );

  const selectedWorkspaceIsAdmin = useMemo(
    () => isWorkspaceAdmin({ workspace: selectedWorkspace, actorId: actor.id, members: workspaceBundle.members }),
    [actor.id, selectedWorkspace, workspaceBundle.members],
  );

  useEffect(() => {
    if (selectedWorkspace?.id && String(selectedWorkspaceId || '') !== String(selectedWorkspace.id)) {
      setSelectedWorkspaceId(selectedWorkspace.id);
    }
  }, [selectedWorkspace, selectedWorkspaceId]);

  const seasonAnalytics = useMemo(
    () => buildSeasonAnalytics({
      workspace: selectedWorkspace,
      selectedGroupId,
      allMatches: realMatches,
      allTeams: teams,
      allPlayers: players,
      allStats: stats,
      allMatchupStints: matchupStints,
      allGroups: workspaceBundle.groups,
      allGroupMatches: workspaceBundle.groupMatches,
      allStintPresets: workspaceBundle.stintPresets,
    }),
    [matchupStints, players, realMatches, selectedGroupId, selectedWorkspace, stats, teams, workspaceBundle.groupMatches, workspaceBundle.groups, workspaceBundle.stintPresets],
  );

  useEffect(() => {
    if (queryGroupId && String(selectedGroupId || '') !== String(queryGroupId)) setSelectedGroupId(queryGroupId);
  }, [queryGroupId, selectedGroupId]);

  useEffect(() => {
    if (!queryTeamCode || autoJoinHandled) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await joinWorkspaceByCode({ db, actorId: actor.id, rawCode: queryTeamCode });
        if (cancelled) return;
        await queryClient.invalidateQueries({ queryKey: ['season-workspace-bundle'] });
        if (result?.workspace?.id) {
          setSelectedWorkspaceId(result.workspace.id);
          navigate(createPageUrl(`SeasonStats?workspace=${encodeURIComponent(result.workspace.id)}`), { replace: true });
        }
        if (result?.status === 'pending') toast.success('Join request sent to the workspace admin');
        if (result?.status === 'joined') toast.success('Workspace opened');
      } catch (error) {
        if (!cancelled) toast.error(error?.message || 'Could not open that team code');
      } finally {
        if (!cancelled) setAutoJoinHandled(true);
      }
    })();
    return () => { cancelled = true; };
  }, [actor.id, autoJoinHandled, navigate, queryClient, queryTeamCode]);

  const updateRoute = (workspaceId, groupId = '') => {
    const next = new URLSearchParams();
    if (workspaceId) next.set('workspace', workspaceId);
    if (groupId) next.set('group', groupId);
    navigate(createPageUrl(`SeasonStats${next.toString() ? `?${next.toString()}` : ''}`));
  };

  const handleCreateWorkspace = async () => {
    try {
      const workspace = await createTeamWorkspace({
        db,
        actorId: actor.id,
        name: workspaceForm.name,
        primaryTeamRef: workspaceForm.primaryTeamRef,
        joinPolicy: workspaceForm.joinPolicy,
      });
      await autoLinkWorkspaceMatches({ db, workspace, matches: realMatches });
      await queryClient.invalidateQueries({ queryKey: ['season-workspace-bundle'] });
      await queryClient.invalidateQueries({ queryKey: ['season-all-matches'] });
      setWorkspaceForm({ name: '', primaryTeamRef: '', joinPolicy: 'approval_required' });
      setSelectedWorkspaceId(workspace.id);
      updateRoute(workspace.id);
      toast.success('Team workspace created');
    } catch (error) {
      toast.error(error?.message || 'Could not create workspace');
    }
  };

  const handleJoinWorkspace = async () => {
    try {
      const result = await joinWorkspaceByCode({ db, actorId: actor.id, rawCode: joinCodeInput });
      await queryClient.invalidateQueries({ queryKey: ['season-workspace-bundle'] });
      if (result?.workspace?.id) {
        setSelectedWorkspaceId(result.workspace.id);
        updateRoute(result.workspace.id);
      }
      toast.success(result?.status === 'pending' ? 'Join request sent' : 'Workspace opened');
    } catch (error) {
      toast.error(error?.message || 'Could not use that team code');
    }
  };

  const handleCopyTeamCode = async () => {
    if (!selectedWorkspace?.team_code) return;
    try {
      await navigator.clipboard.writeText(String(selectedWorkspace.team_code));
      toast.success('Team code copied');
    } catch {
      toast.error('Could not copy team code');
    }
  };

  const handleUpdateWorkspacePolicy = async (policy) => {
    if (!selectedWorkspace?.id || !selectedWorkspaceIsAdmin) return;
    try {
      await updateWorkspaceSettings(db, selectedWorkspace.id, { join_policy: policy });
      await queryClient.invalidateQueries({ queryKey: ['season-workspace-bundle'] });
      toast.success('Join policy updated');
    } catch (error) {
      toast.error(error?.message || 'Could not update join policy');
    }
  };

  const handleAutoLinkWorkspaceMatches = async () => {
    if (!selectedWorkspace?.id || !selectedWorkspaceIsAdmin) return;
    try {
      setWorkspaceSyncing(true);
      await autoLinkWorkspaceMatches({ db, workspace: selectedWorkspace, matches: realMatches });
      await queryClient.invalidateQueries({ queryKey: ['season-all-matches'] });
      toast.success('Primary-team matches linked to the workspace');
    } catch (error) {
      toast.error(error?.message || 'Could not link matches');
    } finally {
      setWorkspaceSyncing(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!selectedWorkspace?.id || !selectedWorkspaceIsAdmin) return;
    try {
      const group = await createAnalysisGroup({
        db,
        workspaceId: selectedWorkspace.id,
        actorId: actor.id,
        name: groupForm.name,
        description: groupForm.description,
        groupType: groupForm.groupType,
      });
      await queryClient.invalidateQueries({ queryKey: ['season-workspace-bundle'] });
      setGroupForm({ name: '', description: '', groupType: 'custom' });
      setSelectedGroupId(group.id);
      updateRoute(selectedWorkspace.id, group.id);
      toast.success('Group created');
    } catch (error) {
      toast.error(error?.message || 'Could not create group');
    }
  };

  const toggleWorkspaceMatch = async (match, linked) => {
    if (!selectedWorkspace?.id || !selectedWorkspaceIsAdmin || !match?.id) return;
    try {
      if (linked) {
        const perspective = String(match?.home_team_id || '') === String(selectedWorkspace.primary_team_ref || '')
          || String(match?.away_team_id || '') === String(selectedWorkspace.primary_team_ref || '')
          ? selectedWorkspace.primary_team_ref
          : match?.workspace_perspective_team_ref || match?.home_team_id || match?.away_team_id || null;
        await linkMatchToWorkspace({
          db,
          match,
          workspaceId: selectedWorkspace.id,
          perspectiveTeamRef: perspective,
        });
      } else {
        await db.entities.Match.update(match.id, {
          team_workspace_id: null,
          workspace_perspective_team_ref: null,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['season-all-matches'] });
    } catch (error) {
      toast.error(error?.message || 'Could not update workspace matches');
    }
  };

  const toggleGroupMatch = async (match, checked, row = null) => {
    if (!selectedGroupId || selectedGroupId === '__workspace__' || !selectedWorkspaceIsAdmin || !match?.id) return;
    try {
      if (checked) {
        const perspective = row?.perspective_team_ref
          || match?.workspace_perspective_team_ref
          || selectedWorkspace?.primary_team_ref
          || match?.home_team_id
          || match?.away_team_id
          || null;
        await upsertAnalysisGroupMatch({
          db,
          groupId: selectedGroupId,
          matchId: match.id,
          perspectiveTeamRef: perspective,
          isScoutingMatch: !!row?.is_scouting_match,
          includeInAdvanced: !!row?.include_in_advanced,
        });
      } else {
        await removeAnalysisGroupMatch({ db, groupId: selectedGroupId, matchId: match.id });
      }
      await queryClient.invalidateQueries({ queryKey: ['season-workspace-bundle'] });
    } catch (error) {
      toast.error(error?.message || 'Could not update group membership');
    }
  };

  const updateGroupMatchMeta = async (match, patch = {}) => {
    if (!selectedGroupId || selectedGroupId === '__workspace__' || !selectedWorkspaceIsAdmin || !match?.id) return;
    try {
      await upsertAnalysisGroupMatch({
        db,
        groupId: selectedGroupId,
        matchId: match.id,
        perspectiveTeamRef: patch.perspective_team_ref ?? match?.workspace_perspective_team_ref ?? selectedWorkspace?.primary_team_ref,
        isScoutingMatch: patch.is_scouting_match ?? false,
        includeInAdvanced: patch.include_in_advanced ?? false,
      });
      await queryClient.invalidateQueries({ queryKey: ['season-workspace-bundle'] });
    } catch (error) {
      toast.error(error?.message || 'Could not update group settings');
    }
  };

  const handleReviewJoinRequest = async (requestId, approve) => {
    if (!selectedWorkspaceIsAdmin) return;
    try {
      await reviewWorkspaceJoinRequest({
        db,
        requestId,
        approve,
        reviewerId: actor.id,
      });
      await queryClient.invalidateQueries({ queryKey: ['season-workspace-bundle'] });
      toast.success(approve ? 'Request approved' : 'Request declined');
    } catch (error) {
      toast.error(error?.message || 'Could not review request');
    }
  };

  const handleTogglePresetPlayer = (playerId, bucketKey) => {
    setPresetForm((current) => {
      const source = Array.isArray(current[bucketKey]) ? current[bucketKey] : [];
      const next = source.includes(playerId)
        ? source.filter((value) => value !== playerId)
        : [...source, playerId];
      const oppositeKey = bucketKey === 'includeIds' ? 'excludeIds' : 'includeIds';
      return {
        ...current,
        [bucketKey]: next,
        [oppositeKey]: (Array.isArray(current[oppositeKey]) ? current[oppositeKey] : []).filter((value) => value !== playerId),
      };
    });
  };

  const handleCreatePreset = async () => {
    if (!selectedWorkspace?.id || !selectedWorkspaceIsAdmin) return;
    try {
      await createStintPreset({
        db,
        workspaceId: selectedWorkspace.id,
        name: presetForm.name,
        includePlayerIds: presetForm.includeIds,
        excludePlayerIds: presetForm.excludeIds,
        notes: presetForm.notes,
      });
      await queryClient.invalidateQueries({ queryKey: ['season-workspace-bundle'] });
      setPresetForm({ name: '', notes: '', includeIds: [], excludeIds: [] });
      toast.success('Stint preset saved');
    } catch (error) {
      toast.error(error?.message || 'Could not save preset');
    }
  };

  const handleDeletePreset = async (presetId) => {
    if (!selectedWorkspaceIsAdmin) return;
    try {
      await deleteStintPreset({ db, presetId });
      await queryClient.invalidateQueries({ queryKey: ['season-workspace-bundle'] });
      toast.success('Stint preset deleted');
    } catch (error) {
      toast.error(error?.message || 'Could not delete preset');
    }
  };

  const teamMetric = useMemo(
    () => SEASON_TEAM_METRICS.find((metric) => metric.key === teamMetricKey) || SEASON_TEAM_METRICS[0],
    [teamMetricKey],
  );
  const playerMetric = useMemo(
    () => SEASON_PLAYER_METRICS.find((metric) => metric.key === playerMetricKey) || SEASON_PLAYER_METRICS[0],
    [playerMetricKey],
  );
  const opponentMetric = useMemo(
    () => SEASON_TEAM_METRICS.find((metric) => metric.key === opponentMetricKey) || SEASON_TEAM_METRICS[0],
    [opponentMetricKey],
  );
  const stintMetric = useMemo(
    () => SEASON_TEAM_METRICS.find((metric) => metric.key === stintMetricKey) || SEASON_TEAM_METRICS[0],
    [stintMetricKey],
  );
  const possessionDenominatorLabel = useMemo(
    () => SEASON_POSSESSION_DENOMINATOR_OPTIONS.find((option) => option.value === possessionDenominatorMode)?.label || 'Own Possessions',
    [possessionDenominatorMode],
  );

  const teamMetricValue = normalizeMetricValue({
    value: seasonAnalytics.teamAggregate?.[teamMetric.key],
    metric: teamMetric,
    row: seasonAnalytics.teamAggregate,
    normalizationMode,
    possessionDenominatorMode,
  });
  const teamPerMatchAverage = seasonAnalytics.advancedContexts.length
    ? seasonAnalytics.advancedContexts.reduce((sum, context) => sum + normalizeMetricValue({
      value: context.teamMetrics?.[teamMetric.key],
      metric: teamMetric,
      row: context.teamMetrics,
      normalizationMode,
      possessionDenominatorMode,
    }), 0) / seasonAnalytics.advancedContexts.length
    : 0;
  const opponentOverallAverage = seasonAnalytics.opponentRows.length
    ? seasonAnalytics.opponentRows.reduce((sum, row) => sum + normalizeMetricValue({
      value: row.overallAggregate?.[teamMetric.key],
      metric: teamMetric,
      row: row.overallAggregate,
      normalizationMode,
      possessionDenominatorMode,
    }), 0) / seasonAnalytics.opponentRows.length
    : 0;
  const opponentVsWorkspaceAverage = seasonAnalytics.opponentRows.length
    ? seasonAnalytics.opponentRows.reduce((sum, row) => sum + normalizeMetricValue({
      value: row.vsWorkspaceAggregate?.[teamMetric.key],
      metric: teamMetric,
      row: row.vsWorkspaceAggregate,
      normalizationMode,
      possessionDenominatorMode,
    }), 0) / seasonAnalytics.opponentRows.length
    : 0;

  const normalizedPlayerRows = useMemo(
    () => (seasonAnalytics.playerRows || []).map((row) => ({
      ...row,
      normalizedMetric: normalizeMetricValue({
        value: row?.[playerMetric.key],
        metric: playerMetric,
        row: {
          games: row.gamesPlayed,
          officialMinutes: row.minutesPlayed,
          minutesPlayed: row.minutesPlayed,
          ownPossessions: row.ownPossessions,
          oppPossessions: row.oppPossessions,
          totalPossessions: row.totalPossessions,
        },
        normalizationMode,
        possessionDenominatorMode,
      }),
    })).sort((left, right) => Number(right.normalizedMetric || 0) - Number(left.normalizedMetric || 0)),
    [normalizationMode, playerMetric, possessionDenominatorMode, seasonAnalytics.playerRows],
  );

  const selectedPlayerRow = normalizedPlayerRows[0] || null;
  const playerTeamAverage = normalizedPlayerRows.length
    ? normalizedPlayerRows.reduce((sum, row) => sum + Number(row.normalizedMetric || 0), 0) / normalizedPlayerRows.length
    : 0;
  const playerPositionAverage = selectedPlayerRow
    ? (() => {
      const peers = normalizedPlayerRows.filter((row) => String(row?.position || '') === String(selectedPlayerRow?.position || ''));
      return peers.length ? peers.reduce((sum, row) => sum + Number(row.normalizedMetric || 0), 0) / peers.length : 0;
    })()
    : 0;

  const normalizedOpponentRows = useMemo(
    () => (seasonAnalytics.opponentRows || []).map((row) => ({
      ...row,
      selectedMetric: normalizeMetricValue({
        value: row.selectedAggregate?.[opponentMetric.key],
        metric: opponentMetric,
        row: row.selectedAggregate,
        normalizationMode,
        possessionDenominatorMode,
      }),
      overallMetric: normalizeMetricValue({
        value: row.overallAggregate?.[opponentMetric.key],
        metric: opponentMetric,
        row: row.overallAggregate,
        normalizationMode,
        possessionDenominatorMode,
      }),
      vsWorkspaceMetric: normalizeMetricValue({
        value: row.vsWorkspaceAggregate?.[opponentMetric.key],
        metric: opponentMetric,
        row: row.vsWorkspaceAggregate,
        normalizationMode,
        possessionDenominatorMode,
      }),
    })),
    [normalizationMode, opponentMetric, possessionDenominatorMode, seasonAnalytics.opponentRows],
  );

  const normalizedStintRows = useMemo(
    () => (seasonAnalytics.stintRows || []).map((row) => ({
      ...row,
      normalizedMetric: normalizeMetricValue({
        value: row.metrics?.[stintMetric.key],
        metric: stintMetric,
        row: row.metrics,
        normalizationMode,
        possessionDenominatorMode,
      }),
    })).sort((left, right) => Number(right.normalizedMetric || 0) - Number(left.normalizedMetric || 0)),
    [normalizationMode, possessionDenominatorMode, seasonAnalytics.stintRows, stintMetric],
  );

  const workspaceLinkedMatchIds = new Set((seasonAnalytics.linkedMatches || []).map((match) => String(match?.id || '')));
  const selectedGroupRowsByMatchId = new Map((workspaceBundle.groupMatches || [])
    .filter((row) => String(row?.group_id || '') === String(selectedGroupId || ''))
    .map((row) => [String(row?.match_id || ''), row]));
  const candidateMatches = useMemo(() => realMatches.filter((match) => (
    String(match?.mode || 'analysis') === 'analysis'
    || String(match?.id || '') === String(queryMatchId || '')
    || workspaceLinkedMatchIds.has(String(match?.id || ''))
  )), [queryMatchId, realMatches, workspaceLinkedMatchIds]);

  const workspacePrimaryPlayers = useMemo(
    () => (players || []).filter((player) => String(player?.team_id || '') === String(selectedWorkspace?.primary_team_ref || '')),
    [players, selectedWorkspace?.primary_team_ref],
  );
  const seasonBackHref = queryMatchId ? createPageUrl(`MatchReport?id=${encodeURIComponent(queryMatchId)}`) : createPageUrl('Home');

  if (!accessibleWorkspaces.length && !selectedWorkspace) {
    return (
      <div className="min-h-screen bg-slate-50">
        <SeasonConstructionDialog open={constructionNoticeOpen} onOpenChange={setConstructionNoticeOpen} backHref={seasonBackHref} />
        <div className="border-b bg-white">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4">
            <Link to={seasonBackHref}>
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            </Link>
            <div>
              <div className="text-sm text-slate-500">Season Analytics</div>
              <div className="text-xl font-semibold text-slate-950">Create or Join a Team Workspace</div>
            </div>
          </div>
        </div>
        <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-950">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  Create Team Workspace
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Workspace Name</Label>
                  <Input value={workspaceForm.name} onChange={(event) => setWorkspaceForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Gaeliq Senior Men 2026" />
                </div>
                <div className="space-y-2">
                  <Label>Primary Team</Label>
                  <Select value={workspaceForm.primaryTeamRef} onValueChange={(value) => setWorkspaceForm((current) => ({ ...current, primaryTeamRef: value }))}>
                    <SelectTrigger><SelectValue placeholder="Select team" /></SelectTrigger>
                    <SelectContent>
                      {(teams || []).filter((team) => !team?.is_demo).map((team) => (
                        <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Join Policy</Label>
                  <Select value={workspaceForm.joinPolicy} onValueChange={(value) => setWorkspaceForm((current) => ({ ...current, joinPolicy: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="approval_required">Approval Required</SelectItem>
                      <SelectItem value="open">Open Join</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full bg-green-600 hover:bg-green-700" onClick={handleCreateWorkspace}>
                  Create Workspace
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-950">
                  <Users className="h-5 w-5 text-slate-700" />
                  Join by Team Code
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-slate-600">
                  Team codes open the shared season workspace. They do not create copied matches the way game share codes do.
                </p>
                <div className="space-y-2">
                  <Label>Team Code</Label>
                  <Input value={joinCodeInput} onChange={(event) => setJoinCodeInput(String(event.target.value || '').toUpperCase())} placeholder="Enter team code" />
                </div>
                <Button variant="outline" className="w-full" onClick={handleJoinWorkspace}>
                  Open Workspace
                </Button>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  if (!selectedWorkspace) {
    return (
      <div className="min-h-screen bg-slate-50">
        <SeasonConstructionDialog open={constructionNoticeOpen} onOpenChange={setConstructionNoticeOpen} backHref={seasonBackHref} />
        <div className="border-b bg-white">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4">
            <Link to={createPageUrl('Home')}>
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            </Link>
            <div>
              <div className="text-sm text-slate-500">Season Analytics</div>
              <div className="text-xl font-semibold text-slate-950">Loading workspace</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activeGroupLabel = seasonAnalytics.selectedGroup?.name || 'All Workspace Matches';
  const teamMetricDisplay = formatSeasonMetricValue(teamMetricValue, teamMetric, normalizationMode);
  const groupAverageDisplay = formatSeasonMetricValue(teamPerMatchAverage, teamMetric, normalizationMode);
  const opponentOverallDisplay = formatSeasonMetricValue(opponentOverallAverage, teamMetric, normalizationMode);
  const opponentVsUsDisplay = formatSeasonMetricValue(opponentVsWorkspaceAverage, teamMetric, normalizationMode);

  return (
    <div className="min-h-screen bg-slate-50">
      <SeasonConstructionDialog open={constructionNoticeOpen} onOpenChange={setConstructionNoticeOpen} backHref={seasonBackHref} />
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link to={seasonBackHref}>
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            </Link>
            <div className="min-w-0">
              <div className="text-sm text-slate-500">Season Analytics</div>
              <div className="truncate text-xl font-semibold text-slate-950">{selectedWorkspace.name}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={String(selectedWorkspace?.id || '')}
              onValueChange={(value) => {
                setSelectedWorkspaceId(value);
                setSelectedGroupId('');
                updateRoute(value);
              }}
            >
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select workspace" /></SelectTrigger>
              <SelectContent>
                {accessibleWorkspaces.map((workspace) => (
                  <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" className="gap-2" onClick={handleCopyTeamCode}>
              <Copy className="h-4 w-4" />
              {selectedWorkspace.team_code || 'No Code'}
            </Button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
        <Card className="border-slate-200">
          <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid flex-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <Label>Group</Label>
                <Select
                  value={String(selectedGroupId || '__workspace__')}
                  onValueChange={(value) => {
                    const nextValue = value === '__workspace__' ? '' : value;
                    setSelectedGroupId(nextValue);
                    updateRoute(selectedWorkspace.id, nextValue);
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__workspace__">All Workspace Matches</SelectItem>
                    {seasonAnalytics.groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Normalization</Label>
                <Select value={normalizationMode} onValueChange={setNormalizationMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEASON_NORMALIZATION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Possession Denominator</Label>
                <Select value={possessionDenominatorMode} onValueChange={setPossessionDenominatorMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEASON_POSSESSION_DENOMINATOR_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Join Policy</Label>
                <Select
                  value={String(selectedWorkspace?.join_policy || 'approval_required')}
                  onValueChange={handleUpdateWorkspacePolicy}
                  disabled={!selectedWorkspaceIsAdmin}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approval_required">Approval Required</SelectItem>
                    <SelectItem value="open">Open Join</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="gap-2" onClick={handleAutoLinkWorkspaceMatches} disabled={!selectedWorkspaceIsAdmin || workspaceSyncing}>
                <CheckCircle2 className="h-4 w-4" />
                {workspaceSyncing ? 'Linking...' : 'Auto-Link Own Matches'}
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => setJoinCodeInput(selectedWorkspace.team_code || '')}>
                <Users className="h-4 w-4" />
                Reuse Team Code
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Matches In Scope"
            value={seasonAnalytics.selectedMatchContexts.length}
            subtitle={`${seasonAnalytics.advancedContexts.length} advanced-ready`}
          />
          <MetricCard
            label="Active Group"
            value={activeGroupLabel}
            subtitle={formatMetricLabel(normalizationMode, possessionDenominatorLabel)}
          />
          <MetricCard
            label="Own Possessions / Game"
            value={seasonAnalytics.teamAggregate.games ? (seasonAnalytics.teamAggregate.ownPossessions / seasonAnalytics.teamAggregate.games).toFixed(1) : '0.0'}
            subtitle="Core pace marker"
          />
          <MetricCard
            label="Combined Possessions / Game"
            value={seasonAnalytics.teamAggregate.games ? (seasonAnalytics.teamAggregate.combinedPossessions / seasonAnalytics.teamAggregate.games).toFixed(1) : '0.0'}
            subtitle="Measures total game speed"
          />
        </div>

        {seasonAnalytics.selectedMatchContexts.length === 0 ? (
          <EmptyState
            title="No matches are in scope yet"
            body={selectedGroupId
              ? 'This custom group is empty. Add linked workspace matches to it from the Groups tab.'
              : 'Link analysis matches to the workspace first, then the dashboards will populate automatically.'}
          />
        ) : (
          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 rounded-2xl border border-slate-200 bg-white p-2">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="team">Team</TabsTrigger>
              <TabsTrigger value="players">Players</TabsTrigger>
              <TabsTrigger value="stints">Stints</TabsTrigger>
              <TabsTrigger value="opponents">Opponents</TabsTrigger>
              <TabsTrigger value="groups">Groups / Match Health</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-slate-950">
                      <Gauge className="h-5 w-5 text-slate-700" />
                      Pace and Output Snapshot
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    <ComparisonRow
                      label="Points For"
                      value={formatSeasonMetricValue(normalizeMetricValue({
                        value: seasonAnalytics.teamAggregate.pointsFor,
                        metric: SEASON_TEAM_METRICS.find((metric) => metric.key === 'pointsFor'),
                        row: seasonAnalytics.teamAggregate,
                        normalizationMode,
                        possessionDenominatorMode,
                      }), SEASON_TEAM_METRICS.find((metric) => metric.key === 'pointsFor'), normalizationMode)}
                      helper={formatMetricLabel(normalizationMode, possessionDenominatorLabel)}
                    />
                    <ComparisonRow
                      label="xP For"
                      value={formatSeasonMetricValue(normalizeMetricValue({
                        value: seasonAnalytics.teamAggregate.xpFor,
                        metric: SEASON_TEAM_METRICS.find((metric) => metric.key === 'xpFor'),
                        row: seasonAnalytics.teamAggregate,
                        normalizationMode,
                        possessionDenominatorMode,
                      }), SEASON_TEAM_METRICS.find((metric) => metric.key === 'xpFor'), normalizationMode)}
                      helper="Shot quality across the group"
                    />
                    <ComparisonRow
                      label="Opposition Possessions / Game"
                      value={seasonAnalytics.teamAggregate.games ? (seasonAnalytics.teamAggregate.oppPossessions / seasonAnalytics.teamAggregate.games).toFixed(1) : '0.0'}
                      helper="Defensive pace"
                    />
                    <ComparisonRow
                      label="Attack Possession Share"
                      value={seasonAnalytics.teamAggregate.ownPossessions ? toPct((seasonAnalytics.teamAggregate.attackPossessions / seasonAnalytics.teamAggregate.ownPossessions) * 100) : '0%'}
                      helper="Own possessions that reached the opposition 45"
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-slate-950">
                      <Calendar className="h-5 w-5 text-slate-700" />
                      Match Health Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {seasonAnalytics.selectedMatchContexts.map((context) => (
                      <div key={`${context.match.id}:${context.perspectiveTeamRef}`} className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-900">{formatMatchTitle(context.match, teamsById)}</div>
                            <div className="text-xs text-slate-500">{context.match.date || 'No date'}{context.match.competition ? ` - ${context.match.competition}` : ''}</div>
                          </div>
                          <div className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(context.health.state)}`}>
                            {context.health.state.replace(/_/g, ' ')}
                          </div>
                        </div>
                        {context.health.reasons?.length ? (
                          <div className="mt-2 text-xs text-slate-600">{context.health.reasons[0]}</div>
                        ) : null}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="team" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-slate-950">
                    <BarChart3 className="h-5 w-5 text-slate-700" />
                    Team Benchmarking
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="max-w-sm space-y-2">
                    <Label>Metric</Label>
                    <Select value={teamMetricKey} onValueChange={setTeamMetricKey}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SEASON_TEAM_METRICS.map((metric) => (
                          <SelectItem key={metric.key} value={metric.key}>{metric.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <MetricCard label={teamMetric.label} value={teamMetricDisplay} subtitle={formatMetricLabel(normalizationMode, possessionDenominatorLabel)} />
                    <MetricCard label="Own Group Average" value={groupAverageDisplay} subtitle="Match average in the selected scope" />
                    <MetricCard label="Opponent Overall Avg" value={opponentOverallDisplay} subtitle="How selected opponents usually perform" />
                    <MetricCard label="Opponent vs Us Avg" value={opponentVsUsDisplay} subtitle="How selected opponents perform in matches versus the workspace team" />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="players" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-slate-950">
                    <Users className="h-5 w-5 text-slate-700" />
                    Player Leaderboard
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="max-w-sm space-y-2">
                    <Label>Metric</Label>
                    <Select value={playerMetricKey} onValueChange={setPlayerMetricKey}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SEASON_PLAYER_METRICS.map((metric) => (
                          <SelectItem key={metric.key} value={metric.key}>{metric.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedPlayerRow ? (
                    <div className="grid gap-4 md:grid-cols-3">
                      <MetricCard label={selectedPlayerRow.name} value={formatSeasonMetricValue(selectedPlayerRow.normalizedMetric, playerMetric, normalizationMode)} subtitle={`${selectedPlayerRow.position || 'Role TBD'} • ${formatMetricLabel(normalizationMode, possessionDenominatorLabel)}`} />
                      <MetricCard label="Team Average" value={formatSeasonMetricValue(playerTeamAverage, playerMetric, normalizationMode)} subtitle="Average across players in scope" />
                      <MetricCard label="Position Average" value={formatSeasonMetricValue(playerPositionAverage, playerMetric, normalizationMode)} subtitle={selectedPlayerRow.position || 'Role comparison'} />
                    </div>
                  ) : null}
                  <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-left text-slate-600">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Player</th>
                          <th className="px-4 py-3 font-semibold">Position</th>
                          <th className="px-4 py-3 font-semibold text-right">{playerMetric.label}</th>
                          <th className="px-4 py-3 font-semibold text-right">Minutes</th>
                          <th className="px-4 py-3 font-semibold text-right">Own Poss</th>
                        </tr>
                      </thead>
                      <tbody>
                        {normalizedPlayerRows.map((row) => (
                          <tr key={row.key} className="border-t border-slate-200">
                            <td className="px-4 py-3 font-medium text-slate-900">{row.name}{row.number != null ? ` #${row.number}` : ''}</td>
                            <td className="px-4 py-3 text-slate-600">{row.position || 'Unassigned'}</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-950">{formatSeasonMetricValue(row.normalizedMetric, playerMetric, normalizationMode)}</td>
                            <td className="px-4 py-3 text-right text-slate-600">{row.minutesPlayed.toFixed(1)}</td>
                            <td className="px-4 py-3 text-right text-slate-600">{row.ownPossessions}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="stints" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-slate-950">
                    <GitCompareArrows className="h-5 w-5 text-slate-700" />
                    Named On-Field Stints
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="max-w-sm space-y-2">
                    <Label>Metric</Label>
                    <Select value={stintMetricKey} onValueChange={setStintMetricKey}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SEASON_TEAM_METRICS.map((metric) => (
                          <SelectItem key={metric.key} value={metric.key}>{metric.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {normalizedStintRows.length ? (
                    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-left text-slate-600">
                          <tr>
                            <th className="px-4 py-3 font-semibold">Preset</th>
                            <th className="px-4 py-3 font-semibold text-right">{stintMetric.label}</th>
                            <th className="px-4 py-3 font-semibold text-right">Minutes</th>
                            <th className="px-4 py-3 font-semibold text-right">Possessions</th>
                            {selectedWorkspaceIsAdmin ? <th className="px-4 py-3 font-semibold text-right">Actions</th> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {normalizedStintRows.map((row) => (
                            <tr key={row.id} className="border-t border-slate-200">
                              <td className="px-4 py-3">
                                <div className="font-medium text-slate-900">{row.name}</div>
                                {row.notes ? <div className="text-xs text-slate-500">{row.notes}</div> : null}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-slate-950">{formatSeasonMetricValue(row.normalizedMetric, stintMetric, normalizationMode)}</td>
                              <td className="px-4 py-3 text-right text-slate-600">{Number(row.metrics?.officialMinutes || 0).toFixed(1)}</td>
                              <td className="px-4 py-3 text-right text-slate-600">{Number(row.metrics?.combinedPossessions || 0)}</td>
                              {selectedWorkspaceIsAdmin ? (
                                <td className="px-4 py-3 text-right">
                                  <Button variant="ghost" size="sm" onClick={() => handleDeletePreset(row.id)}>Delete</Button>
                                </td>
                              ) : null}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
                      No stint presets yet. Save named player groups below to compare with/without units across the selected scope.
                    </div>
                  )}

                  {selectedWorkspaceIsAdmin ? (
                    <Card className="border-slate-200 bg-slate-50">
                      <CardHeader>
                        <CardTitle className="text-base text-slate-950">Create Stint Preset</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label>Preset Name</Label>
                            <Input value={presetForm.name} onChange={(event) => setPresetForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Starting six forwards" />
                          </div>
                          <div className="space-y-2">
                            <Label>Notes</Label>
                            <Input value={presetForm.notes} onChange={(event) => setPresetForm((current) => ({ ...current, notes: event.target.value }))} placeholder="What this unit is for" />
                          </div>
                        </div>
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="mb-3 font-medium text-slate-900">Include Players</div>
                            <div className="max-h-64 space-y-2 overflow-y-auto">
                              {workspacePrimaryPlayers.map((player) => (
                                <label key={`include-${player.id}`} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                                  <Checkbox checked={presetForm.includeIds.includes(player.id)} onCheckedChange={() => handleTogglePresetPlayer(player.id, 'includeIds')} />
                                  <span className="text-slate-900">{player.name}{player.number != null ? ` #${player.number}` : ''}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="mb-3 font-medium text-slate-900">Exclude Players</div>
                            <div className="max-h-64 space-y-2 overflow-y-auto">
                              {workspacePrimaryPlayers.map((player) => (
                                <label key={`exclude-${player.id}`} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                                  <Checkbox checked={presetForm.excludeIds.includes(player.id)} onCheckedChange={() => handleTogglePresetPlayer(player.id, 'excludeIds')} />
                                  <span className="text-slate-900">{player.name}{player.number != null ? ` #${player.number}` : ''}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                        <Button className="bg-green-600 hover:bg-green-700" onClick={handleCreatePreset}>
                          Save Stint Preset
                        </Button>
                      </CardContent>
                    </Card>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="opponents" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-slate-950">
                    <FolderKanban className="h-5 w-5 text-slate-700" />
                    Opponent Benchmarks
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="max-w-sm space-y-2">
                    <Label>Metric</Label>
                    <Select value={opponentMetricKey} onValueChange={setOpponentMetricKey}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SEASON_TEAM_METRICS.map((metric) => (
                          <SelectItem key={metric.key} value={metric.key}>{metric.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-left text-slate-600">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Opponent</th>
                          <th className="px-4 py-3 font-semibold text-right">Selected Group</th>
                          <th className="px-4 py-3 font-semibold text-right">Overall Avg</th>
                          <th className="px-4 py-3 font-semibold text-right">Vs Workspace Team Avg</th>
                        </tr>
                      </thead>
                      <tbody>
                        {normalizedOpponentRows.map((row) => (
                          <tr key={row.opponentId} className="border-t border-slate-200">
                            <td className="px-4 py-3 font-medium text-slate-900">{row.opponentName}</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-950">{formatSeasonMetricValue(row.selectedMetric, opponentMetric, normalizationMode)}</td>
                            <td className="px-4 py-3 text-right text-slate-600">{formatSeasonMetricValue(row.overallMetric, opponentMetric, normalizationMode)}</td>
                            <td className="px-4 py-3 text-right text-slate-600">{formatSeasonMetricValue(row.vsWorkspaceMetric, opponentMetric, normalizationMode)}</td>
                          </tr>
                        ))}
                        {!normalizedOpponentRows.length ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">No opponent benchmark rows yet.</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="groups" className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-slate-950">
                      <FolderKanban className="h-5 w-5 text-slate-700" />
                      Workspace Match Pool
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {candidateMatches.map((match) => {
                      const linked = workspaceLinkedMatchIds.has(String(match?.id || ''));
                      const groupRow = selectedGroupRowsByMatchId.get(String(match?.id || '')) || null;
                      const highlighted = String(match?.id || '') === String(queryMatchId || '');
                      return (
                        <div key={match.id} className={`rounded-2xl border p-4 ${highlighted ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900">{formatMatchTitle(match, teamsById)}</div>
                              <div className="text-xs text-slate-500">
                                {match.date || 'No date'}
                                {match.competition ? ` - ${match.competition}` : ''}
                                {String(match?.mode || '') ? ` - ${match.mode}` : ''}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button asChild variant="outline" size="sm">
                                <Link to={createPageUrl(`MatchReport?id=${encodeURIComponent(match.id)}`)}>Open Report</Link>
                              </Button>
                              {selectedWorkspaceIsAdmin ? (
                                <label className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">
                                  <Checkbox checked={linked} onCheckedChange={(checked) => toggleWorkspaceMatch(match, Boolean(checked))} />
                                  Linked
                                </label>
                              ) : linked ? (
                                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Linked</div>
                              ) : null}
                            </div>
                          </div>

                          {selectedGroupId && selectedGroupId !== '__workspace__' ? (
                            <div className="mt-4 grid gap-3 md:grid-cols-[auto,auto,minmax(0,1fr),auto]">
                              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                                <Checkbox checked={!!groupRow} onCheckedChange={(checked) => toggleGroupMatch(match, Boolean(checked), groupRow)} disabled={!selectedWorkspaceIsAdmin && !groupRow} />
                                In Group
                              </label>
                              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                                <Checkbox
                                  checked={!!groupRow?.is_scouting_match}
                                  onCheckedChange={(checked) => updateGroupMatchMeta(match, {
                                    perspective_team_ref: groupRow?.perspective_team_ref || match?.workspace_perspective_team_ref || selectedWorkspace.primary_team_ref,
                                    is_scouting_match: Boolean(checked),
                                    include_in_advanced: !!groupRow?.include_in_advanced,
                                  })}
                                  disabled={!groupRow || !selectedWorkspaceIsAdmin}
                                />
                                Scouting
                              </label>
                              <Select
                                value={String(groupRow?.perspective_team_ref || match?.workspace_perspective_team_ref || selectedWorkspace.primary_team_ref || '')}
                                onValueChange={(value) => updateGroupMatchMeta(match, {
                                  perspective_team_ref: value,
                                  is_scouting_match: !!groupRow?.is_scouting_match,
                                  include_in_advanced: !!groupRow?.include_in_advanced,
                                })}
                                disabled={!groupRow || !selectedWorkspaceIsAdmin}
                              >
                                <SelectTrigger><SelectValue placeholder="Perspective team" /></SelectTrigger>
                                <SelectContent>
                                  {match.home_team_id ? <SelectItem value={match.home_team_id}>{teamsById.get(String(match.home_team_id))?.name || 'Home'}</SelectItem> : null}
                                  {match.away_team_id ? <SelectItem value={match.away_team_id}>{teamsById.get(String(match.away_team_id))?.name || 'Away'}</SelectItem> : null}
                                </SelectContent>
                              </Select>
                              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                                <Checkbox
                                  checked={!!groupRow?.include_in_advanced}
                                  onCheckedChange={(checked) => updateGroupMatchMeta(match, {
                                    perspective_team_ref: groupRow?.perspective_team_ref || match?.workspace_perspective_team_ref || selectedWorkspace.primary_team_ref,
                                    is_scouting_match: !!groupRow?.is_scouting_match,
                                    include_in_advanced: Boolean(checked),
                                  })}
                                  disabled={!groupRow || !selectedWorkspaceIsAdmin}
                                />
                                Include Limited
                              </label>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-slate-950">
                        <ShieldCheck className="h-5 w-5 text-slate-700" />
                        Workspace Settings
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Primary Team</div>
                        <div className="mt-1 font-medium text-slate-900">{teamsById.get(String(selectedWorkspace.primary_team_ref || ''))?.name || 'Unknown team'}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team Code</div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <div className="font-mono text-lg font-semibold text-slate-950">{selectedWorkspace.team_code}</div>
                          <Button variant="outline" size="sm" onClick={handleCopyTeamCode}>Copy</Button>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Linked Matches</div>
                        <div className="mt-1 text-lg font-semibold text-slate-950">{seasonAnalytics.linkedMatches.length}</div>
                      </div>
                    </CardContent>
                  </Card>

                  {selectedWorkspaceIsAdmin ? (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-slate-950">
                          <Plus className="h-5 w-5 text-slate-700" />
                          Create Group
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          <Label>Group Name</Label>
                          <Input value={groupForm.name} onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. 2026 Championship" />
                        </div>
                        <div className="space-y-2">
                          <Label>Description</Label>
                          <Input value={groupForm.description} onChange={(event) => setGroupForm((current) => ({ ...current, description: event.target.value }))} placeholder="What these matches represent" />
                        </div>
                        <div className="space-y-2">
                          <Label>Group Type</Label>
                          <Select value={groupForm.groupType} onValueChange={(value) => setGroupForm((current) => ({ ...current, groupType: value }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="custom">Custom</SelectItem>
                              <SelectItem value="own_team">Own Team</SelectItem>
                              <SelectItem value="scouting">Scouting</SelectItem>
                              <SelectItem value="mixed">Mixed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button className="w-full bg-green-600 hover:bg-green-700" onClick={handleCreateGroup}>
                          Save Group
                        </Button>
                      </CardContent>
                    </Card>
                  ) : null}

                  {selectedWorkspaceIsAdmin ? (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-slate-950">
                          <Users className="h-5 w-5 text-slate-700" />
                          Join Requests
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {(workspaceBundle.joinRequests || [])
                          .filter((request) => String(request?.workspace_id || '') === String(selectedWorkspace.id || '') && String(request?.status || '') === 'pending')
                          .map((request) => (
                            <div key={request.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                              <div className="font-medium text-slate-900">{request.user_id}</div>
                              <div className="text-xs text-slate-500">{request.requested_at || request.created_date || ''}</div>
                              <div className="mt-3 flex gap-2">
                                <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleReviewJoinRequest(request.id, true)}>Approve</Button>
                                <Button size="sm" variant="outline" onClick={() => handleReviewJoinRequest(request.id, false)}>Decline</Button>
                              </div>
                            </div>
                          ))}
                        {(workspaceBundle.joinRequests || []).filter((request) => String(request?.workspace_id || '') === String(selectedWorkspace.id || '') && String(request?.status || '') === 'pending').length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                            No pending requests right now.
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
