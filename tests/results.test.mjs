import test from "node:test";
import assert from "node:assert/strict";
import { winnerBoard, winnerCells } from "../src/ui/screens/results.js";

test("Winner's Circle rows follow the artwork's seven columns", () => {
  assert.deepEqual(winnerCells({
    place: 1, name: "Player", truckName: "Bear Foot", score: 0,
    finished: true, raceTime: 65.25, laps: 3, best: 21.5,
  }, { laps: 3, difficulty: 2 }), ["1st", "Player", "Bear Foot", "Professional", "", "01:05.25", "00:21.50"]);

  assert.deepEqual(winnerCells({
    place: 2, name: "Mark", truckName: "Bigfoot", score: 12, finished: true, raceTime: 0, laps: 0, best: 0,
  }, { summit: true, laps: 5, difficulty: 0 }), ["2nd", "Mark", "Bigfoot", "Rookie", "12", "05:00.00", ""]);
});

test("the headset's Winner's Circle: the table without the difficulty, the player's row marked, and the ways on", () => {
  const calls = [];
  const rows = [
    { place: 1, name: "Mark", truckName: "Bigfoot", finished: true, raceTime: 61, laps: 3, best: 20 },
    { place: 2, name: "Player", truckName: "Bear Foot", finished: false, raceTime: 0, laps: 2, best: 21.5, player: true },
  ];
  const board = winnerBoard(rows, {
    laps: 3, note: "Hall of Fame: 2nd on Farm Road 29.",
    onAgain: () => calls.push("again"), onNew: () => calls.push("new"), onLeave: () => calls.push("leave"),
  });
  assert.equal(board.title, "Winner's Circle");
  assert.deepEqual(board.lines, ["Hall of Fame: 2nd on Farm Road 29."]);
  assert.deepEqual(board.table.map((row) => [...row]), [
    ["1st", "Mark", "Bigfoot", "01:01.00", "00:20.00"], ["2nd", "Player", "Bear Foot", "2/3", "00:21.50"],
  ]);
  assert.deepEqual(board.table.map((row) => row.highlight), [false, true]);
  assert.deepEqual(board.items.map((item) => item.label), ["Race again", "New race", "Leave VR"]);
  // "Race again" is what a press chooses first.
  board.select();
  board.move(1); board.select();
  board.move(1); board.select();
  assert.deepEqual(calls, ["again", "new", "leave"]);
  // A Rumble shows the score where a race shows the time.
  const rumble = winnerBoard([{ place: 1, name: "Player", truckName: "Bigfoot", score: 31.6, player: true }], { summit: true, laps: 5 });
  assert.deepEqual([...rumble.table[0]], ["1st", "Player", "Bigfoot", "32", ""]);
  assert.deepEqual(rumble.lines, []);
});
