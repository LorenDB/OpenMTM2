import test from "node:test";
import assert from "node:assert/strict";
import { garageSummary, raceLengthLabel, raceTypeName, trackPreviewBmp } from "../src/game/menu-data.js";

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
