import test from "node:test";
import assert from "node:assert/strict";
import {
  currentEvent, dragEventPoints, gotoEvent, recordEvent, standings, startProblem, startTournament, tournamentFromTrn, trnOf,
} from "../src/game/events/tournament.js";
import { parseTrn, writeTrn } from "../src/vendor/openphotex/index.js";

const tracks = [
  { file: "DRAG5.SIT", name: "Trans World Dome (J)", raceType: "drag", defaultLaps: 1 },
  { file: "CIRC4.SIT", name: "Winding Way", raceType: "circuit", defaultLaps: 3 },
  { file: "ISLAND.SIT", name: "Yucatan Adventure", raceType: "rally", defaultLaps: 1 },
  { file: "HILLCLIM.SIT", name: "Hill Climb Practice", raceType: "freeroam", freeRoamOnly: true, defaultLaps: 1 },
];
const TRI = { name: "Monster Truck Triathlon", descriptionFile: "tri.txt", hasDrag: true, events: [{ file: "DRAG5.SIT", laps: 0 }, { file: "CIRC4.SIT", laps: 10 }, { file: "ISLAND.SIT", laps: 0 }] };
const field = (n) => Array.from({ length: n }, (_, i) => ({ name: `D${i}`, truck: `T${i}.TRK`, player: i === 0 }));

test("a tournament from its .TRN: each event tied to its track, a circuit with its laps", () => {
  const t = tournamentFromTrn(TRI, tracks, { stock: true });
  assert.deepEqual(t.events.map((e) => [e.name, e.raceType, e.laps, e.problem]),
    [["Trans World Dome (J)", "drag", 0, null], ["Winding Way", "circuit", 10, null], ["Yucatan Adventure", "rally", 0, null]]);
  assert.equal(t.hasDrag, true);
  // Written back as the game writes it.
  assert.deepEqual(parseTrn(writeTrn(trnOf(t))), { ...TRI, warnings: [] });
});

test("a track that is missing, or has no race on it, keeps the tournament from starting", () => {
  const missing = tournamentFromTrn({ ...TRI, events: [{ file: "DOME.SIT", laps: 0 }] }, tracks);
  assert.match(startProblem(missing, 4), /DOME\.SIT is not installed/);
  const roam = tournamentFromTrn({ ...TRI, hasDrag: false, events: [{ file: "HILLCLIM.SIT", laps: 0 }] }, tracks);
  assert.match(startProblem(roam, 4), /has no race on it/);
});

test("a tournament with a drag race takes 2, 4 or 8 trucks; the others 1 to 8", () => {
  const withDrag = tournamentFromTrn(TRI, tracks);
  assert.equal(startProblem(withDrag, 4), null);
  assert.match(startProblem(withDrag, 5), /2, 4 or 8/);
  const without = tournamentFromTrn({ ...TRI, hasDrag: false, events: TRI.events.slice(1) }, tracks);
  assert.equal(startProblem(without, 5), null);
  assert.throws(() => startTournament(withDrag, field(3)));
});

test("the events run in order and the points add up; the most points first", () => {
  const run = startTournament(tournamentFromTrn(TRI, tracks), field(4));
  assert.equal(currentEvent(run).file, "DRAG5.SIT");
  recordEvent(run, [450, 350, 290, 280]);
  recordEvent(run, [700, 1000, 500, 400]);
  assert.equal(currentEvent(run).file, "ISLAND.SIT");
  assert.equal(run.done, false);
  recordEvent(run, [900, 500, 700, 400]);
  assert.equal(run.done, true);
  assert.equal(currentEvent(run), null);
  assert.deepEqual(standings(run), [{ driver: 0, points: 2050 }, { driver: 1, points: 1850 }, { driver: 2, points: 1490 }, { driver: 3, points: 1080 }]);
});

test("moving between events: forward passes them over with no points, back runs them again", () => {
  const run = startTournament(tournamentFromTrn(TRI, tracks), field(4));
  recordEvent(run, [100, 0, 0, 0]);
  gotoEvent(run, 2);
  assert.equal(currentEvent(run).file, "ISLAND.SIT");
  assert.equal(run.events[1].skipped, true);
  recordEvent(run, [0, 50, 0, 0]);
  assert.equal(run.done, true);
  assert.deepEqual(standings(run).slice(0, 2), [{ driver: 0, points: 100 }, { driver: 1, points: 50 }]);
  gotoEvent(run, 1);
  assert.equal(run.done, false);
  assert.equal(currentEvent(run).file, "CIRC4.SIT");
  assert.equal(run.events[2].points, null);
});

test("MTM1's drag points: qualifying place, 250 a pairing won, the final's bonus, 200 to a loser, 50 for the fastest pass", () => {
  // Four drivers, two rounds: driver 2 wins the final over driver 0; 1 and 3 went out in the semi-finals.
  const event = {
    bracket: [[{}, {}], [{}]], winner: 2,
    drivers: [
      { qualify: 4.9, seed: 2, out: 1, best: 4.7 }, { qualify: 5.2, seed: 4, out: 0, best: 5.2 },
      { qualify: 4.8, seed: 1, out: null, best: 4.75 }, { qualify: null, seed: 3, out: 0, best: null },
    ],
  };
  // 0: 90 + 250 + 200 + 50 (fastest). 1: 70 + 200. 2: 100 + 250 + 300. 3: no qualifying time, 200.
  assert.deepEqual(dragEventPoints(event), [590, 270, 650, 200]);
});
