import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const analyticsModuleUrl = `${pathToFileURL(path.join(repoRoot, 'src/lib/reportAnalytics.js')).href}?ts=${Date.now()}`;
const { buildPlayerTimeAndPossessionStats } = await import(analyticsModuleUrl);

const fixture = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src/data/demoMatch.json'), 'utf8'));
const match = fixture.match || {};
const teams = Array.isArray(fixture.teams) ? fixture.teams : [];
const playerOptions = (Array.isArray(fixture.players) ? fixture.players : []).map((player) => ({
  ...player,
  team_side: player.team_id === match.home_team_id ? 'home' : player.team_id === match.away_team_id ? 'away' : null,
}));

const homeTeam = teams.find((team) => String(team.id) === String(match.home_team_id)) || { name: 'Home' };
const awayTeam = teams.find((team) => String(team.id) === String(match.away_team_id)) || { name: 'Away' };

const result = buildPlayerTimeAndPossessionStats({
  match,
  stats: Array.isArray(fixture.stats) ? fixture.stats : [],
  playerOptions,
  homeTeam,
  awayTeam,
});

const rowsById = new Map(Object.values(result.players).map((row) => [String(row.playerId), row]));
const getRow = (id, label) => {
  const row = rowsById.get(String(id));
  assert.ok(row, `${label} row was not produced.`);
  return row;
};

const getStints = (row, periodKey) => row.stints.filter((stint) => stint.periodKey === periodKey);
const sumLoggedMinutes = (row, periodKey) => getStints(row, periodKey).reduce((sum, stint) => sum + (Number(stint.loggedDurationMinutes) || 0), 0);
const approxEqual = (actual, expected, epsilon = 1e-9) => Math.abs(actual - expected) <= epsilon;

const daniel = getRow('c280633a-1f70-45e8-94ec-a49a23c165bb', 'Daniel O\'Flaherty');
assert.equal(daniel.started, true, 'Daniel O\'Flaherty should be treated as a starter.');
assert.equal(getStints(daniel, 'second').length, 0, 'Daniel O\'Flaherty should not have a second-half stint after being subbed off.');
assert.ok(daniel.minutesPlayed > 0 && daniel.minutesPlayed < 35, 'Daniel O\'Flaherty should not receive full-match minutes.');

const cillian = getRow('6e41550d-491a-45d6-ad98-3a8e2c9a8053', 'Cillian McDaid');
assert.equal(cillian.started, false, 'Cillian McDaid should remain a substitute.');
assert.ok(getStints(cillian, 'first').some((stint) => stint.startLoggedMinute > 0), 'Cillian McDaid should enter during the first half, not from kickoff.');
assert.ok(getStints(cillian, 'second').some((stint) => approxEqual(stint.startLoggedMinute, 0)), 'Cillian McDaid should carry into the second half from minute 0.');

const mattius = getRow('423a3f24-3569-495b-b46a-76a0def974da', 'Mattius Barret');
assert.equal(mattius.started, true, 'Mattius Barret should be on the pitch before the second-half kickoff substitution.');
assert.ok(sumLoggedMinutes(mattius, 'second') === 0, 'Mattius Barret should have zero logged second-half minutes after the t=0 substitution.');

const shay = getRow('324827c5-b9e9-4a54-8834-6539ce7d5757', 'Shay McGlinchey');
assert.equal(shay.started, false, 'Shay McGlinchey should remain a substitute.');
assert.equal(getStints(shay, 'first').length, 0, 'Shay McGlinchey should not appear in the first half.');
assert.ok(getStints(shay, 'second').some((stint) => approxEqual(stint.startLoggedMinute, 0)), 'Shay McGlinchey should start his second-half stint at 0.');

const ciaran = getRow('3ace3197-d844-4b80-b02d-b56d07cbaa5d', 'Ciaran Mulhern');
assert.equal(ciaran.blackCards, 1, 'Ciaran Mulhern should still have one black card recorded.');
assert.equal(ciaran.blackCardMinutesSubtracted, 10, 'Black card subtraction should remain 10 minutes.');
assert.ok(approxEqual(ciaran.minutesPlayedScaledBeforeCards - ciaran.minutesPlayed, 10), 'Black card subtraction should only affect final minutes.');

for (const row of rowsById.values()) {
  if (row.minutesPlayed > 0) {
    assert.ok(
      approxEqual(row.minutesRateFactor, row.rateMinutesBase / row.minutesPlayed),
      `Rate factor drifted for ${row.playerName}.`,
    );
  } else {
    assert.equal(row.minutesRateFactor, null, `${row.playerName} should not have a rate factor when minutes are zero.`);
  }
}

assert.ok(
  !result.warnings.some((warning) => warning.includes('already marked on pitch') || warning.includes('Mattius Barret')),
  'The rebuilt minutes path should eliminate duplicate sub-on and halftime off-pitch warnings.',
);

console.log('Player minutes regression checks passed.');
