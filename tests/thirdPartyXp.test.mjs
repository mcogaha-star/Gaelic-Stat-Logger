import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyXpImportToShots,
  buildThirdPartyShotExportRows,
  buildThirdPartyShotRecords,
  calcShotArcAngle,
  mapShotToThirdPartyRow,
  matchThirdPartyRowToShot,
  parseThirdPartyXpCsv,
  validateThirdPartyXpImport,
} from '../src/lib/thirdPartyXp.js';

function makeShot({ id, playId, time = 10, x = 105, y = 42.5, possessionId = 1, outcome = 'wide' }) {
  return {
    id,
    match_id: 'match-1',
    play_id: playId,
    stat_type: 'shot',
    team_side: 'home',
    possession_team_side: 'home',
    possession_id: possessionId,
    half: 'first',
    normalized_time_s: time,
    x_position: x,
    y_position: y,
    player_name: 'Player One',
    extra_data: JSON.stringify({
      shot: {
        player: { name: 'Player One', team_side: 'home' },
        pressure: 'low',
        type: 'point',
        situation: 'play',
        method: 'right',
        outcome,
      },
    }),
  };
}

const match = { id: 'match-1' };
const teams = { homeTeam: { name: 'Home' }, awayTeam: { name: 'Away' } };

test('ShotArc angle is bearing from the centreline and is independent of goal-mouth width', () => {
  assert.equal(calcShotArcAngle(100, 42.5), 0);
  assert.ok(Math.abs(calcShotArcAngle(100, 43.3) - 1.018) < 0.001);
  assert.ok(Math.abs(calcShotArcAngle(132, 42.73) - 1.014) < 0.001);
});

test('export sorts chronologically and marks retained shots as the same attack', () => {
  const stats = [
    makeShot({ id: 'second', playId: 2, possessionId: 1 }),
    makeShot({ id: 'third', playId: 3, possessionId: 2 }),
    makeShot({ id: 'first', playId: 1, possessionId: 1 }),
    { ...makeShot({ id: 'second-half', playId: 4, possessionId: 1 }), half: 'second' },
  ];

  const rows = buildThirdPartyShotExportRows(stats, match, teams);
  assert.deepEqual(rows.map((row) => row.NewAttack), ['Yes', 'No', 'Yes', 'Yes']);
});

test('two-decimal distance disambiguates otherwise identical shots', () => {
  const stats = [
    makeShot({ id: 'rounded-40', playId: 1, x: 105 }),
    makeShot({ id: 'distance-40-37', playId: 2, x: 104.63 }),
  ].map((shot) => ({ ...shot, play_id: 1, normalized_time_s: 10 }));
  const records = buildThirdPartyShotRecords(stats, match, teams);
  const row = { ...mapShotToThirdPartyRow(records[1], 'Yes'), ExpectedScore: '0.42' };

  const result = matchThirdPartyRowToShot(row, records);
  assert.equal(result.status, 'matched');
  assert.equal(result.record.id, 'distance-40-37');
});

test('truly identical candidate shots remain ambiguous', () => {
  const stats = [
    makeShot({ id: 'duplicate-one', playId: 1 }),
    makeShot({ id: 'duplicate-two', playId: 1 }),
  ];
  const records = buildThirdPartyShotRecords(stats, match, teams);
  const row = { ...mapShotToThirdPartyRow(records[0], 'Yes'), ExpectedScore: '0.42' };

  assert.equal(matchThirdPartyRowToShot(row, records).status, 'ambiguous');
});

test('blank ExpectedScore is invalid instead of becoming zero', () => {
  const csv = '"Team","PlayerName","GameHalf","GameTimeSeconds","ShotPressure","ShotType","SetPlay","ShotMethod","Distance","Angle","Side","ShotOutcome","NewAttack","ExpectedScore"\n'
    + '"Home","Player One","1","10","Low","Point attempt","Open Play","Right foot","40.00","0","Left","Wide","Yes",""';
  const parsed = parseThirdPartyXpCsv(csv);
  assert.ok(Number.isNaN(parsed.rows[0].__expectedScoreValue));
});

test('preflight rejects partial imports before any write', async () => {
  const stats = [
    makeShot({ id: 'one', playId: 1, possessionId: 1 }),
    makeShot({ id: 'two', playId: 2, time: 11, possessionId: 2 }),
  ];
  const records = buildThirdPartyShotRecords(stats, match, teams);
  const row = { ...mapShotToThirdPartyRow(records[0], 'Yes'), ExpectedScore: '0.3', __expectedScoreValue: 0.3, __rowIndex: 0 };
  const validation = validateThirdPartyXpImport([row], records, new Map(stats.map((stat) => [stat.id, stat])));
  assert.equal(validation.valid, false);
  assert.equal(validation.missingShots, 1);

  let writes = 0;
  await assert.rejects(
    applyXpImportToShots([row], records, new Map(stats.map((stat) => [stat.id, stat])), {
      updateLocalShot: async () => { writes += 1; },
    }),
    /No changes were saved/,
  );
  assert.equal(writes, 0);
});

test('a complete replacement import updates every eligible shot', async () => {
  const stats = [
    makeShot({ id: 'one', playId: 1, possessionId: 1 }),
    makeShot({ id: 'two', playId: 2, time: 11, possessionId: 2 }),
  ].map((stat, index) => ({
    ...stat,
    extra_data: JSON.stringify({
      ...JSON.parse(stat.extra_data),
      shot: { ...JSON.parse(stat.extra_data).shot, xp: { value: 0.1 + index } },
    }),
  }));
  const records = buildThirdPartyShotRecords(stats, match, teams);
  const rows = records.map((record, index) => ({
    ...mapShotToThirdPartyRow(record, 'Yes'),
    ExpectedScore: String(0.3 + (index * 0.1)),
    __expectedScoreValue: 0.3 + (index * 0.1),
    __rowIndex: index,
  }));
  const saved = new Map();

  const summary = await applyXpImportToShots(rows, records, new Map(stats.map((stat) => [stat.id, stat])), {
    updateLocalShot: async (id, patch) => saved.set(id, patch),
  });

  assert.equal(summary.updatedShotsCount, 2);
  assert.equal(JSON.parse(saved.get('one').extra_data).shot.xp.value, 0.3);
  assert.equal(JSON.parse(saved.get('two').extra_data).shot.xp.value, 0.4);
});

test('server failures are reported and do not write the local replacement', async () => {
  const stat = { ...makeShot({ id: 'one', playId: 1 }), server_stat_id: 'server-one' };
  const records = buildThirdPartyShotRecords([stat], match, teams);
  const row = { ...mapShotToThirdPartyRow(records[0], 'Yes'), ExpectedScore: '0.3', __expectedScoreValue: 0.3, __rowIndex: 0 };
  let localWrites = 0;

  await assert.rejects(
    applyXpImportToShots([row], records, new Map([[stat.id, stat]]), {
      updateServerShot: async () => ({ ok: false, reason: 'offline' }),
      updateLocalShot: async () => { localWrites += 1; },
    }),
    /Server save failed.*offline/,
  );
  assert.equal(localWrites, 0);
});

test('a later server failure rolls back earlier local and server updates', async () => {
  const stats = [
    { ...makeShot({ id: 'one', playId: 1, possessionId: 1 }), server_stat_id: 'server-one' },
    { ...makeShot({ id: 'two', playId: 2, time: 11, possessionId: 2 }), server_stat_id: 'server-two' },
  ];
  const records = buildThirdPartyShotRecords(stats, match, teams);
  const rows = records.map((record, index) => ({
    ...mapShotToThirdPartyRow(record, 'Yes'),
    ExpectedScore: String(0.3 + (index * 0.1)),
    __expectedScoreValue: 0.3 + (index * 0.1),
    __rowIndex: index,
  }));
  const localWrites = [];
  const serverWrites = [];

  await assert.rejects(
    applyXpImportToShots(rows, records, new Map(stats.map((stat) => [stat.id, stat])), {
      updateServerShot: async (id, patch) => {
        serverWrites.push([id, patch]);
        if (id === 'server-two') return { ok: false, reason: 'offline' };
        return { ok: true };
      },
      updateLocalShot: async (id, patch) => localWrites.push([id, patch]),
    }),
    /Earlier updates were rolled back/,
  );

  assert.equal(localWrites.length, 2);
  assert.equal(localWrites[0][0], 'one');
  assert.equal(localWrites[1][0], 'one');
  assert.equal(localWrites[1][1].extra_data, stats[0].extra_data);
  assert.deepEqual(serverWrites.map(([id]) => id), ['server-one', 'server-two', 'server-one']);
});
