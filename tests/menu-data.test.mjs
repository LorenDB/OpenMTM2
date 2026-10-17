import test from "node:test";
import assert from "node:assert/strict";
import { garageSummary, raceLengthLabel, raceTypeName, trackInfoRows, trackPreviewBmp } from "../src/game/menu-data.js";

test("a track without a picture shows what its SIT says, the rows it does not say left out", () => {
  const rows = new Map(trackInfoRows({
    name: "Mud Run", game: "EVO2", locale: " ", author: "Somebody", raceType: "circuit", trackLength: 10560, checkpoints: 12,
    defaultLaps: 2, weatherMask: 0b11, level: "MUD.LVL", file: "MUD.SIT", pod: "MUD.POD",
  }, { type: "Circuit (EVO2)" }));
  assert.equal(rows.get("Type"), "Circuit (EVO2)");
  assert.equal(rows.get("Game"), "4x4 Evolution 2");
  assert.equal(rows.has("Location"), false);
  assert.equal(rows.get("Author"), "Somebody");
  assert.equal(rows.get("Length"), "10,560 ft (2.00 mi)");
  assert.equal(rows.get("Laps"), "2");
  assert.equal(rows.get("Weather"), "Clear, Cloudy");
  assert.equal(rows.get("File"), "MUD.SIT (MUD.POD)");
});

test("classic menu labels and stock track preview artwork", () => {
  assert.equal(raceTypeName("summit"), "Summit Rumble");
  assert.equal(raceLengthLabel("summit"), "Minutes");
  assert.equal(raceLengthLabel("rally"), "Laps");
  assert.equal(garageSummary({ transferSetting: 1500, tireCut: 1, suspension: 0 }), "1500 m/s");
});

test("a type 0 track is Free Roam", () => {
  assert.equal(raceTypeName("freeroam"), "Free Roam");
});

test("a track's preview is the picture its SIT names, whatever the game, and nothing guessed from its file name", () => {
  assert.equal(trackPreviewBmp({ file: "CIRC1.SIT", game: "MTM1", logoBmp: "CIRC1T" }), "CIRC1T");
  assert.equal(trackPreviewBmp({ file: "TPARK.SIT", game: "MTM2", logoBmp: "FARM" }), "FARM");
  // An eight-letter add-on: the SIT says ZO0NKITS, which no rule on ZO0NKITC.SIT would give for every track.
  assert.equal(trackPreviewBmp({ file: "ZO0NKITC.SIT", game: "MTM2", logoBmp: "ZO0NKITS" }), "ZO0NKITS");
  assert.equal(trackPreviewBmp({ file: "MYTRACK.SIT", game: "MTM2", logoBmp: null }), null);
  assert.equal(trackPreviewBmp(null), null);
});
