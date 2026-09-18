import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectHighestXpShotPerPossession,
  sumPossessionExpectedPoints,
} from '../src/lib/expectedPoints.js';

test('aggregate xP uses the highest-valued shot from each possession', () => {
  const shots = [
    { id: 'a', team_side: 'home', half: 'first', possession_id: 1, xp: 0.35 },
    { id: 'b', team_side: 'home', half: 'first', possession_id: 1, xp: 0.7 },
    { id: 'c', team_side: 'home', half: 'first', possession_id: 2, xp: 0.25 },
  ];

  assert.deepEqual(selectHighestXpShotPerPossession(shots).map((shot) => shot.id), ['b', 'c']);
  assert.equal(sumPossessionExpectedPoints(shots), 0.95);
});

test('missing possession identifiers keep shots as separate attacks', () => {
  const shots = [
    { id: 'a', team_side: 'home', xp: 0.2 },
    { id: 'b', team_side: 'home', xp: 0.4 },
  ];

  assert.ok(Math.abs(sumPossessionExpectedPoints(shots) - 0.6) < 1e-12);
});

test('possession identifiers are scoped by team and half', () => {
  const shots = [
    { id: 'a', team_side: 'home', half: 'first', possession_id: 1, xp: 0.2 },
    { id: 'b', team_side: 'away', half: 'first', possession_id: 1, xp: 0.3 },
    { id: 'c', team_side: 'home', half: 'second', possession_id: 1, xp: 0.4 },
  ];

  assert.equal(sumPossessionExpectedPoints(shots), 0.9);
});
