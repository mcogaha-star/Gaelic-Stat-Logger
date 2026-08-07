const TEAM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOCAL_FALLBACK_ACTOR_ID = 'local-device-user';

function nowIso() {
  return new Date().toISOString();
}

function cleanCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function getWorkspaceActor(user) {
  return {
    id: String(user?.id || LOCAL_FALLBACK_ACTOR_ID),
    isLocalFallback: !user?.id,
    email: user?.email || '',
  };
}

export function generateTeamWorkspaceCode(length = 8) {
  const chars = [];
  for (let index = 0; index < length; index += 1) {
    chars.push(TEAM_CODE_ALPHABET[Math.floor(Math.random() * TEAM_CODE_ALPHABET.length)]);
  }
  return chars.join('');
}

export function parseIdList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function stringifyIdList(value) {
  return JSON.stringify(parseIdList(value));
}

export async function listWorkspaceBundle(db) {
  const [
    workspaces,
    members,
    joinRequests,
    groups,
    groupMatches,
    stintPresets,
  ] = await Promise.all([
    db.entities.TeamWorkspace.list('name'),
    db.entities.TeamWorkspaceMember.list('created_date'),
    db.entities.TeamWorkspaceJoinRequest.list('-created_date'),
    db.entities.AnalysisGroup.list('name'),
    db.entities.AnalysisGroupMatch.list('sort_order'),
    db.entities.StintPreset.list('name'),
  ]);
  return {
    workspaces: Array.isArray(workspaces) ? workspaces : [],
    members: Array.isArray(members) ? members : [],
    joinRequests: Array.isArray(joinRequests) ? joinRequests : [],
    groups: Array.isArray(groups) ? groups : [],
    groupMatches: Array.isArray(groupMatches) ? groupMatches : [],
    stintPresets: Array.isArray(stintPresets) ? stintPresets : [],
  };
}

export function getWorkspaceMembership({ workspaceId, actorId, members = [] }) {
  return (Array.isArray(members) ? members : []).find((member) => (
    String(member?.workspace_id || '') === String(workspaceId || '')
    && String(member?.user_id || '') === String(actorId || '')
    && String(member?.status || 'approved') !== 'revoked'
  )) || null;
}

export function getAccessibleWorkspaces({ actorId, bundle }) {
  const workspaces = Array.isArray(bundle?.workspaces) ? bundle.workspaces : [];
  const members = Array.isArray(bundle?.members) ? bundle.members : [];
  return workspaces.filter((workspace) => {
    if (workspace?.archived_at) return false;
    if (String(workspace?.created_by || '') === String(actorId || '')) return true;
    return members.some((member) => (
      String(member?.workspace_id || '') === String(workspace?.id || '')
      && String(member?.user_id || '') === String(actorId || '')
      && String(member?.status || 'approved') === 'approved'
    ));
  });
}

export function getWorkspaceRole({ workspace, actorId, members = [] }) {
  if (!workspace?.id) return null;
  if (String(workspace?.created_by || '') === String(actorId || '')) return 'admin';
  const membership = getWorkspaceMembership({ workspaceId: workspace.id, actorId, members });
  return membership?.role || null;
}

export function isWorkspaceAdmin({ workspace, actorId, members = [] }) {
  return getWorkspaceRole({ workspace, actorId, members }) === 'admin';
}

async function generateUniqueWorkspaceCode(db) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const teamCode = generateTeamWorkspaceCode();
    const existing = await db.entities.TeamWorkspace.filter({ team_code: teamCode });
    if (!Array.isArray(existing) || existing.length === 0) return teamCode;
  }
  return `${generateTeamWorkspaceCode(6)}${Date.now().toString().slice(-2)}`;
}

export async function createTeamWorkspace({
  db,
  actorId,
  name,
  primaryTeamRef,
  joinPolicy = 'approval_required',
}) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Enter a workspace name');
  if (!primaryTeamRef) throw new Error('Choose a primary team');
  const teamCode = await generateUniqueWorkspaceCode(db);
  const workspace = await db.entities.TeamWorkspace.create({
    name: trimmedName,
    primary_team_ref: primaryTeamRef,
    team_code: teamCode,
    join_policy: joinPolicy === 'open' ? 'open' : 'approval_required',
    created_by: actorId,
    archived_at: null,
  });
  await db.entities.TeamWorkspaceMember.create({
    workspace_id: workspace.id,
    user_id: actorId,
    role: 'admin',
    status: 'approved',
  });
  return workspace;
}

export async function updateWorkspaceSettings(db, workspaceId, patch = {}) {
  if (!workspaceId) throw new Error('Workspace is missing');
  const next = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) next.name = String(patch.name || '').trim();
  if (Object.prototype.hasOwnProperty.call(patch, 'join_policy')) next.join_policy = patch.join_policy === 'open' ? 'open' : 'approval_required';
  if (Object.prototype.hasOwnProperty.call(patch, 'primary_team_ref')) next.primary_team_ref = patch.primary_team_ref || null;
  return db.entities.TeamWorkspace.update(workspaceId, next);
}

export async function joinWorkspaceByCode({ db, actorId, rawCode }) {
  const teamCode = cleanCode(rawCode);
  if (!teamCode) throw new Error('Enter a team code');
  const matches = await db.entities.TeamWorkspace.filter({ team_code: teamCode });
  const workspace = Array.isArray(matches) ? matches.find((row) => !row?.archived_at) : null;
  if (!workspace?.id) throw new Error('Team workspace not found');

  const existingMemberships = await db.entities.TeamWorkspaceMember.filter({
    workspace_id: workspace.id,
    user_id: actorId,
  });
  const approvedMembership = (Array.isArray(existingMemberships) ? existingMemberships : []).find((row) => String(row?.status || 'approved') === 'approved');
  if (approvedMembership) {
    return { status: 'joined', workspace, membership: approvedMembership };
  }

  if (String(workspace?.created_by || '') === String(actorId || '')) {
    const membership = await db.entities.TeamWorkspaceMember.create({
      workspace_id: workspace.id,
      user_id: actorId,
      role: 'admin',
      status: 'approved',
    });
    return { status: 'joined', workspace, membership };
  }

  if (String(workspace?.join_policy || 'approval_required') === 'open') {
    const membership = await db.entities.TeamWorkspaceMember.create({
      workspace_id: workspace.id,
      user_id: actorId,
      role: 'viewer',
      status: 'approved',
    });
    return { status: 'joined', workspace, membership };
  }

  const existingRequests = await db.entities.TeamWorkspaceJoinRequest.filter({
    workspace_id: workspace.id,
    user_id: actorId,
  });
  const pending = (Array.isArray(existingRequests) ? existingRequests : []).find((row) => String(row?.status || '') === 'pending');
  if (pending) return { status: 'pending', workspace, request: pending };

  const request = await db.entities.TeamWorkspaceJoinRequest.create({
    workspace_id: workspace.id,
    user_id: actorId,
    status: 'pending',
    requested_at: nowIso(),
    reviewed_at: null,
    reviewed_by: null,
  });
  return { status: 'pending', workspace, request };
}

export async function reviewWorkspaceJoinRequest({
  db,
  requestId,
  approve,
  reviewerId,
}) {
  const request = await db.entities.TeamWorkspaceJoinRequest.get(requestId);
  if (!request?.id) throw new Error('Join request not found');
  const status = approve ? 'approved' : 'declined';
  const reviewed = await db.entities.TeamWorkspaceJoinRequest.update(requestId, {
    status,
    reviewed_at: nowIso(),
    reviewed_by: reviewerId,
  });
  let membership = null;
  if (approve) {
    const existingMemberships = await db.entities.TeamWorkspaceMember.filter({
      workspace_id: request.workspace_id,
      user_id: request.user_id,
    });
    const existing = (Array.isArray(existingMemberships) ? existingMemberships : []).find((row) => String(row?.status || 'approved') === 'approved');
    membership = existing || await db.entities.TeamWorkspaceMember.create({
      workspace_id: request.workspace_id,
      user_id: request.user_id,
      role: 'viewer',
      status: 'approved',
    });
  }
  return { request: reviewed, membership };
}

export async function createAnalysisGroup({
  db,
  workspaceId,
  actorId,
  name,
  description = '',
  groupType = 'custom',
}) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Enter a group name');
  return db.entities.AnalysisGroup.create({
    workspace_id: workspaceId,
    name: trimmedName,
    description: String(description || '').trim(),
    group_type: groupType || 'custom',
    created_by: actorId,
    archived_at: null,
  });
}

export async function upsertAnalysisGroupMatch({
  db,
  groupId,
  matchId,
  perspectiveTeamRef = null,
  isScoutingMatch = false,
  includeInAdvanced = false,
}) {
  const existingRows = await db.entities.AnalysisGroupMatch.filter({ group_id: groupId, match_id: matchId });
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  if (existing?.id) {
    return db.entities.AnalysisGroupMatch.update(existing.id, {
      perspective_team_ref: perspectiveTeamRef || null,
      is_scouting_match: !!isScoutingMatch,
      include_in_advanced: !!includeInAdvanced,
    });
  }
  const siblings = await db.entities.AnalysisGroupMatch.filter({ group_id: groupId });
  return db.entities.AnalysisGroupMatch.create({
    group_id: groupId,
    match_id: matchId,
    perspective_team_ref: perspectiveTeamRef || null,
    is_scouting_match: !!isScoutingMatch,
    sort_order: Array.isArray(siblings) ? siblings.length : 0,
    include_in_advanced: !!includeInAdvanced,
  });
}

export async function removeAnalysisGroupMatch({ db, groupId, matchId }) {
  const rows = await db.entities.AnalysisGroupMatch.filter({ group_id: groupId, match_id: matchId });
  await Promise.all((Array.isArray(rows) ? rows : []).map((row) => row?.id ? db.entities.AnalysisGroupMatch.delete(row.id) : null));
}

export async function createStintPreset({
  db,
  workspaceId,
  name,
  includePlayerIds = [],
  excludePlayerIds = [],
  perspective = 'workspace_team',
  notes = '',
}) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Enter a stint preset name');
  return db.entities.StintPreset.create({
    workspace_id: workspaceId,
    name: trimmedName,
    include_player_refs: stringifyIdList(includePlayerIds),
    exclude_player_refs: stringifyIdList(excludePlayerIds),
    perspective,
    notes: String(notes || '').trim(),
  });
}

export async function deleteStintPreset({ db, presetId }) {
  return db.entities.StintPreset.delete(presetId);
}

export async function linkMatchToWorkspace({
  db,
  match,
  workspaceId,
  perspectiveTeamRef = null,
}) {
  if (!match?.id) throw new Error('Match is missing');
  return db.entities.Match.update(match.id, {
    team_workspace_id: workspaceId,
    workspace_perspective_team_ref: perspectiveTeamRef || null,
  });
}

export async function unlinkMatchFromWorkspace({ db, match }) {
  if (!match?.id) throw new Error('Match is missing');
  return db.entities.Match.update(match.id, {
    team_workspace_id: null,
    workspace_perspective_team_ref: null,
  });
}

export async function autoLinkWorkspaceMatches({
  db,
  workspace,
  matches = [],
}) {
  if (!workspace?.id || !workspace?.primary_team_ref) return [];
  const updates = [];
  for (const match of Array.isArray(matches) ? matches : []) {
    if (!match?.id) continue;
    const isOwnTeamMatch = String(match?.home_team_id || '') === String(workspace.primary_team_ref)
      || String(match?.away_team_id || '') === String(workspace.primary_team_ref);
    if (!isOwnTeamMatch) continue;
    if (String(match?.team_workspace_id || '') === String(workspace.id)) continue;
    updates.push(linkMatchToWorkspace({
      db,
      match,
      workspaceId: workspace.id,
      perspectiveTeamRef: workspace.primary_team_ref,
    }));
  }
  return Promise.all(updates);
}
