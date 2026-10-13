import test from "node:test";
import assert from "node:assert/strict";
import { beginTournament, moveToEvent, restoreTournament, runEvent, takeDragWeekend, takeRace, tournamentFromText, tournamentText } from "../src/app/tournament.js";
import { standings } from "../src/game/events/tournament.js";

const tracks = [
  { file: "DRAG5.SIT", name: "Trans World Dome (J)", raceType: "drag", defaultLaps: 1 },
  { file: "CIRC4.SIT", name: "Winding Way", raceType: "circuit", defaultLaps: 3 },
];
const trucks = ["A", "B", "C", "D"].map((n) => ({ file: `${n}.TRK`, name: n }));
const TRN = "== Tournament Name ==\r\nTwo\r\n== Tournament Description File ==\r\n\r\n== Has Drag Race Flag ==\r\n1\r\n== Number Of Tracks ==\r\n2\r\n== Track Entry #1 ==\r\nCIRC4.SIT,4\r\n== Track Entry #2 ==\r\nDRAG5.SIT,0\r\n";

function fakeContext() {
  const data = new Map(), went = [];
  return {
    data, went, settings: {},
    profiles: { current: 0, drivers: [{ name: "Me", lastTruck: "B.TRK", garage: {}, races: 0, wins: 0 }] },
    assets: { call: async (name, { key, value } = {}) => (name === "saveUserData" ? (data.set(key, value), true) : name === "userData" ? data.get(key) ?? null : null) },
    router: { go: (name, params) => { went.push([name, params]); } },
  };
}

test("a tournament file is read and written back unchanged", () => {
  assert.equal(tournamentText(tournamentFromText(TRN, tracks)), TRN);
  assert.equal(tournamentFromText("not one", tracks), null);
});

test("a tournament runs its events through the race and the drag weekend, keeps its points and survives a reload", async () => {
  const context = fakeContext();
  const t = await beginTournament(context, tournamentFromText(TRN, tracks), { tracks, trucks, size: 4, difficulty: 1, random: () => 0.5 });
  assert.deepEqual(t.run.drivers.map((d) => [d.name, d.player]).slice(0, 1), [["Me", true]]);
  assert.equal(t.run.drivers[0].truck, "B.TRK");
  // The circuit: the race screen, with the field's trucks and the event's laps.
  await runEvent(context);
  const [screen, params] = context.went.at(-1);
  assert.equal(screen, "race");
  assert.equal(params.laps, 4);
  assert.equal(params.tournament, true);
  assert.deepEqual(params.opponents, t.run.drivers.slice(1).map((d) => d.truck));
  // Its results, counted once.
  const rows = [{}, {}, {}, {}];
  assert.equal(await takeRace(context, rows, [900, 700, 500, 400]), true);
  assert.equal(await takeRace(context, rows, [900, 700, 500, 400]), false);
  assert.equal(t.run.current, 1);
  // The run was stored: a reload finds it.
  const again = fakeContext();
  again.data = context.data;
  again.assets = context.assets;
  assert.equal((await restoreTournament(again, { tracks, trucks })).run.current, 1);
  // The drag strip: a drag weekend of the same four drivers.
  await runEvent(context);
  assert.equal(context.went.at(-1)[0], "drag-event");
  assert.equal(context.dragWeekend.tournament, true);
  assert.deepEqual(context.dragWeekend.event.drivers.map((d) => d.truck), t.run.drivers.map((d) => d.truck));
  // Not over yet: nothing to take. Over: MTM1's drag points join the totals.
  assert.equal(await takeDragWeekend(context), false);
  Object.assign(context.dragWeekend.event, { phase: "done", winner: 0 });
  context.dragWeekend.event.drivers.forEach((d, i) => Object.assign(d, { qualify: 5 + i, seed: i + 1, best: 5 + i, out: i === 0 ? null : i === 1 ? 1 : 0 }));
  assert.equal(await takeDragWeekend(context), true);
  assert.equal(t.run.done, true);
  assert.equal(context.dragWeekend, null);
  // Driver 0: 900 + (100 + 250 + 300 + 50).
  assert.deepEqual(standings(t.run)[0], { driver: 0, points: 1600 });
  // The console's `tourney goto 1`: the first event opens again.
  assert.equal((await moveToEvent(context, 0)).file, "CIRC4.SIT");
  assert.equal(t.run.done, false);
});

test("a finished tournament enters the player's total in the Hall of Fame, once", async () => {
  const { enterHall } = await import("../src/app/tournament.js");
  const { TOURNAMENT_MODE, emptyHall, topFor, tournamentBoards, tournamentKey } = await import("../src/game/hall-of-fame.js");
  const hall = emptyHall();
  const stored = {};
  const context = {
    hall, settings: {},
    assets: { call: async (name, args) => { if (name === "saveUserData") stored[args.name] = args.data; return null; } },
    tournament: {
      difficulty: 2,
      run: {
        name: "Summer Tour", done: true, current: 2,
        drivers: [{ name: "Me", truck: "BIGFOOT.TRK", player: true }, { name: "Cpu", truck: "GRAVE.TRK", player: false }],
        events: [{ points: [900, 700] }, { points: [700, 1000] }],
      },
    },
  };
  assert.equal(await enterHall(context), 1);
  assert.equal(await enterHall(context), 1, "the same answer, entered once");
  const board = topFor(hall, tournamentKey("Summer Tour"), TOURNAMENT_MODE);
  assert.equal(board.length, 1);
  assert.deepEqual([board[0].name, board[0].points, board[0].difficulty, board[0].laps], ["Me", 1600, 2, 2]);
  assert.deepEqual(tournamentBoards(hall), [{ key: "TOURNAMENT:SUMMER TOUR", name: "Summer Tour" }]);
  // Not finished: nothing.
  assert.equal(await enterHall({ tournament: { run: { done: false } } }), null);
});
