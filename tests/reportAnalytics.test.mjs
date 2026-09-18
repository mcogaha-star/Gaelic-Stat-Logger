import assert from 'node:assert/strict';
import test from 'node:test';

import {
  derivePossessionOutcome,
  getDefenseTurnoverFlowOverride,
  isTurnoverFollowedByThrowInForSankey,
  rebuildPossessionRows,
} from '../src/lib/reportAnalytics.js';

const selection = (kind, teamSide, id = null) => ({
  kind,
  team_side: teamSide,
  ...(id ? { id } : {}),
});

test('kick out against has an explicit defensive turnover Sankey flow', () => {
  const expected = {
    typeLabel: 'Over Endline',
    outcomeLabel: 'Own Kickout',
  };

  assert.deepEqual(getDefenseTurnoverFlowOverride('kickout_against'), expected);
  assert.deepEqual(getDefenseTurnoverFlowOverride('Kickout Against'), expected);
  assert.equal(getDefenseTurnoverFlowOverride('interception'), null);
});

test('turnover followed by a throw-in is excluded from the turnover Sankey', () => {
  const turnover = { id: 'turnover-1', play_id: 1, half: 'first', stat_type: 'turnover' };
  const throwIn = { id: 'throw-in-1', play_id: 2, half: 'first', stat_type: 'throw_in' };

  assert.equal(isTurnoverFollowedByThrowInForSankey(turnover, [turnover, throwIn]), true);
});

test('substitution rows do not break a turnover-to-throw-in Sankey exclusion', () => {
  const turnover = { id: 'turnover-1', play_id: 1, half: 'first', stat_type: 'turnover' };
  const substitution = { id: 'sub-1', play_id: 2, half: 'first', stat_type: 'substitution' };
  const throwIn = { id: 'throw-in-1', play_id: 3, half: 'first', stat_type: 'throw_in' };

  assert.equal(isTurnoverFollowedByThrowInForSankey(turnover, [turnover, substitution, throwIn]), true);
});

test('period end prevents turnover-to-throw-in Sankey exclusion', () => {
  const turnover = { id: 'turnover-1', play_id: 1, half: 'first', stat_type: 'turnover' };
  const periodEnd = { id: 'period-end-1', play_id: 2, half: 'first', stat_type: 'period_end' };
  const throwIn = { id: 'throw-in-1', play_id: 3, half: 'second', stat_type: 'throw_in' };

  assert.equal(isTurnoverFollowedByThrowInForSankey(turnover, [turnover, periodEnd, throwIn]), false);
});

test('an intervening live action keeps the turnover in the Sankey', () => {
  const turnover = { id: 'turnover-1', play_id: 1, half: 'first', stat_type: 'turnover' };
  const pass = { id: 'pass-1', play_id: 2, half: 'first', stat_type: 'pass' };
  const throwIn = { id: 'throw-in-1', play_id: 3, half: 'first', stat_type: 'throw_in' };

  assert.equal(isTurnoverFollowedByThrowInForSankey(turnover, [turnover, pass, throwIn]), false);
});

test('kick out against ends possession and the following kickout starts a new one', () => {
  const rows = rebuildPossessionRows([
    {
      id: 'turnover-1',
      play_id: 1,
      stat_type: 'turnover',
      team_side: 'home',
      half: 'first',
      extra_data: JSON.stringify({
        turnover: {
          turnover_type: 'kickout_against',
          lost_by: selection('player', 'home', 'home-14'),
          forced_by: selection('team', 'away'),
          recovered_by: { kind: 'none' },
          unforced: false,
          brought_back_adv: false,
        },
      }),
    },
    {
      id: 'kickout-2',
      play_id: 2,
      stat_type: 'kickout',
      team_side: 'away',
      half: 'first',
      extra_data: JSON.stringify({
        kickout: {
          team_side: 'away',
          outcome: 'clean',
          won_by: selection('player', 'away', 'away-8'),
          lost_by: selection('team', 'home'),
        },
      }),
    },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].possession_team_side, 'home');
  assert.equal(derivePossessionOutcome([rows[0]], 'home'), 'Turnover');
  assert.equal(rows[1].possession_team_side, 'away');
  assert.notEqual(rows[1].possession_id, rows[0].possession_id);
  assert.equal(rows[1].__possession_start_source, 'Kickout Won');
});

test('goal kick for ends as own kick out before the following kickout possession', () => {
  const rows = rebuildPossessionRows([
    {
      id: 'shot-1',
      play_id: 1,
      stat_type: 'shot',
      team_side: 'away',
      half: 'first',
      extra_data: JSON.stringify({
        shot: {
          outcome: 'short',
          result: 'opposition',
          recovered_by: selection('player', 'home', 'home-1'),
        },
      }),
    },
    {
      id: 'carry-2',
      play_id: 2,
      stat_type: 'carry',
      team_side: 'home',
      half: 'first',
      extra_data: JSON.stringify({
        carry: {
          carrier: selection('player', 'home', 'home-1'),
          outcome: 'goal_kick_for',
        },
      }),
    },
    {
      id: 'kickout-3',
      play_id: 3,
      stat_type: 'kickout',
      team_side: 'home',
      half: 'first',
      extra_data: JSON.stringify({
        kickout: {
          team_side: 'home',
          outcome: 'clean',
          won_by: selection('player', 'home', 'home-8'),
        },
      }),
    },
  ]);

  assert.equal(rows.length, 3);
  assert.equal(rows[1].possession_team_side, 'home');
  assert.equal(derivePossessionOutcome([rows[1]], 'home'), 'Own Kick Out');
  assert.equal(rows[2].possession_team_side, 'home');
  assert.notEqual(rows[2].possession_id, rows[1].possession_id);
  assert.equal(rows[2].__possession_start_source, 'Kickout Won');
});
