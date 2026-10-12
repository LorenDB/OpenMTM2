/*
  The ice of Snow (docs/VISUALS.md, "Ice"): its cracks, the stars a hard blow leaves in it, the bands a body dragged
  over it scores, and how they are kept for the graphics card.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  ICE, ICE_HULL, ICE_MARKS, ICE_SCRAPES, ICE_STARS, crackPlane, createIceMarks, iceHullContacts, lineToCellFt, markReachFt, seenAsideFt, standOnFt, starReachFt,
} from "../src/game/ice.js";

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);

test("the ice's own cracks lie in three fields, none of them even: long cracks, plates, hairlines", () => {
  assert.equal(ICE.plateFt, 13);
  assert.ok(ICE.hairlineFt < ICE.plateFt / 2);
  assert.ok(ICE.floeFt > ICE.plateFt * 4, "a floe holds many plates");
  assert.equal(ICE.crackDepthFt, 0.9);
  assert.ok(ICE.hairlineDepthFt < ICE.crackDepthFt && ICE.crackDepthFt < ICE.floeDepthFt);
  // Not every crack between two cells shows, so plates join into shapes of their own: fewest where the ice is whole.
  assert.ok(ICE.platesKept[0] < ICE.platesKept[1] && ICE.platesKept[0] > 0 && ICE.platesKept[1] < 1);
  assert.ok(ICE.floesKept > 0 && ICE.floesKept < 1);
  assert.ok(ICE.hairlinesKept > 0 && ICE.hairlinesKept < 1);
  assert.ok(ICE.patchFt > ICE.floeFt, "whole and broken ice lie in patches wider than a floe");
  // The cells are pushed about, but less than half their width, so none folds over another.
  assert.ok(ICE.warp > 0.2 && ICE.warp < 0.5);
  assert.ok(ICE.vary > 0 && ICE.vary < 1);
  // What lies in the ice is seen nearer the upright than through air.
  assert.ok(ICE.bend > 0 && ICE.bend < 1);
});

test("in Snow what is over the level's water stands on the ice, not on the bed under it", () => {
  // A rut, the shade under a truck and a replay's wheels lie at the ice's level over ground under it.
  assert.equal(standOnFt(180, 5, 185), 185);
  // Ground over the water's level, and the deck of a bridge over the ice, are what they are.
  assert.equal(standOnFt(190, 5, 185), 190);
  // In any other weather the water is water: what is under it is the bed; and a track without water has no ice.
  for (const weather of [0, 1, 2, 3, 4, 6, 7, 8]) assert.equal(standOnFt(180, weather, 185), 180, `weather ${weather}`);
  assert.equal(standOnFt(180, 5, null), 180);
});

test("a blow stars the ice by how hard it is: none under 7 ft/s, 3.5 ft at that, 20 ft from 45 ft/s", () => {
  assert.equal(starReachFt(0), 0);
  assert.equal(starReachFt(6.9), 0);
  assert.equal(starReachFt(NaN), 0);
  assert.equal(starReachFt(7), 3.5);
  assert.equal(starReachFt(45), 20);
  assert.equal(starReachFt(200), 20);
  let last = 0;
  for (let speed = 7; speed <= 45; speed += 2) {
    assert.ok(starReachFt(speed) >= last, `at ${speed}`);
    last = starReachFt(speed);
  }
});

test("a star's cracks run out from the blow in a moment, and stay", () => {
  const ice = createIceMarks();
  assert.equal(ice.strike(100, 200, 3), 0, "too light");
  assert.equal(ice.count, 0);
  const reach = ice.strike(100, 200, 30, 0.37);
  assert.equal(reach, starReachFt(30));
  // At the instant of the blow nothing has run yet.
  ice.update(0);
  let [star] = ice.list();
  assert.deepEqual({ kind: star.kind, x: star.x, z: star.z, seed: star.seed }, { kind: "star", x: 100, z: 200, seed: 0.37 });
  assert.equal(star.reachFt, 0);
  // After the time it is named for, all but 1/e of the way; soon after, all of it, for good.
  ice.update(ICE_STARS.runSeconds);
  near(ice.list()[0].reachFt, reach * (1 - Math.exp(-1)));
  ice.update(3);
  near(ice.list()[0].reachFt, reach, 1e-4);
  ice.update(600);
  near(ice.list()[0].reachFt, reach, 1e-9);
  // Time does not run backward.
  ice.update(-5);
  near(ice.list()[0].reachFt, reach, 1e-9);
  // What the graphics card is given: where, how far by now, its number; then 0 for a star and how far it will run.
  star = ice.list()[0];
  assert.deepEqual([...ice.marks.subarray(star.slot * 8, star.slot * 8 + 8)], [100, 200, Math.fround(reach), Math.fround(0.37), 0, Math.fround(reach), 0, 0]);
});

test("while a star's cracks run, the graphics card is told each frame; once they have run, no more", () => {
  const ice = createIceMarks();
  assert.deepEqual(ice.update(0), { marks: true, grid: true }, "a new sheet is told once");
  assert.deepEqual(ice.update(0.016), { marks: false, grid: false });
  ice.strike(50, 50, 30, 0.5);
  assert.deepEqual(ice.update(0.016), { marks: true, grid: true });
  assert.deepEqual(ice.update(0.016), { marks: true, grid: false });
  ice.update(5);
  assert.deepEqual(ice.update(0.016), { marks: false, grid: false });
});

test("a second blow in the same place widens the star that is there; a lighter one leaves it", () => {
  const ice = createIceMarks();
  ice.strike(0, 0, 12, 0.1);
  ice.update(5);
  const small = starReachFt(12);
  // Within the joining distance: the same star, running on from where it had got to.
  assert.equal(ice.strike(1, 1, 40, 0.9), starReachFt(40));
  assert.equal(ice.count, 1);
  ice.update(0);
  let [star] = ice.list();
  near(star.reachFt, small, 1e-6);
  assert.equal(star.seed, 0.1, "it keeps the cracks it had");
  ice.update(5);
  near(ice.list()[0].reachFt, starReachFt(40), 1e-6);
  // A lighter blow there changes nothing.
  assert.equal(ice.strike(0.5, 0, 9, 0.5), starReachFt(40));
  near(ice.list()[0].reachFt, starReachFt(40), 1e-6);
  // Further off than that it is a star of its own.
  ice.strike(ICE_STARS.joinFt + 1, 0, 20, 0.2);
  assert.equal(ice.count, 2);
});

test("the ice keeps 1024 marks for good, the oldest making way; a thaw heals them", () => {
  const ice = createIceMarks();
  assert.equal(ICE_MARKS.kept, 1024);
  // Each in a cell of its own, two cells apart, all in one 2048 ft square of the world.
  const at = (i) => [(i % 32) * 64 + 16, Math.floor(i / 32) * 64 + 16];
  for (let i = 0; i < 1024; i++) ice.strike(...at(i), 30, i / 2048);
  assert.equal(ice.count, 1024);
  // However long they lie, they stay.
  ice.update(3600);
  assert.equal(ice.list()[0].x, 16);
  assert.equal(ice.listedAt(16, 16).length, 1);
  // One more: the oldest goes, and its place is the new one's.
  const first = ice.list()[0].slot;
  ice.strike(5000, 5000, 30, 0.5);
  assert.equal(ice.count, 1024);
  assert.equal(ice.list()[0].x, at(1)[0]);
  assert.equal(ice.list().at(-1).slot, first);
  assert.deepEqual(ice.listedAt(16, 16), [], "the cell it reached into lists it no more");
  ice.clear();
  assert.equal(ice.count, 0);
  assert.ok(ice.grid.every((n) => n === -1) && ice.marks.every((n) => n === 0));
  // A star has seven to eleven cracks, and its middle is crushed.
  assert.equal(ICE_STARS.spokes, 7);
  assert.equal(ICE_STARS.spokes + ICE_STARS.spokesMore - 1, 11);
  assert.ok(ICE_STARS.crushed > 0 && ICE_STARS.crushed < 0.3);
});

test("each cell lists every mark that reaches into it, and no other: what a point of the ice looks at", () => {
  assert.deepEqual({ cellFt: ICE_MARKS.cellFt, cells: ICE_MARKS.cells, perCell: ICE_MARKS.perCell }, { cellFt: 32, cells: 64, perCell: 16 });
  assert.equal(ICE_MARKS.perCell % 4, 0, "a cell's list goes to the graphics card four to an entry");
  assert.equal(ICE_MARKS.kept % ICE_MARKS.perRow, 0);
  // A star 20 ft across, its faces seen a little further.
  assert.equal(markReachFt({ kind: "star", fullFt: 20 }), 20 + seenAsideFt(ICE_STARS.deepFt));
  near(seenAsideFt(1.2), (1.2 * 0.75) / 0.3 + 0.2);
  const ice = createIceMarks();
  ice.strike(1000, 1000, 45, 0.5);
  const [star] = ice.list(), reach = markReachFt(star);
  // Every point the star can be seen at is in a cell that lists it.
  for (let a = 0; a < 64; a++) {
    for (const r of [0, reach * 0.5, reach * 0.999]) {
      const x = 1000 + Math.cos(a / 10) * r, z = 1000 + Math.sin(a / 10) * r;
      assert.deepEqual(ice.listedAt(x, z), [star.slot], `at ${x}, ${z}`);
    }
  }
  // A cell further than its reach does not list it, and a cell lists nothing after its last.
  assert.deepEqual(ice.listedAt(1000 + reach + 33, 1000), []);
  assert.deepEqual(ice.listedAt(1000 + reach + 2, 1000 + reach + 2), [], "a corner cell the round star does not reach");
  // The cells repeat over the world: one 2048 ft off shares the list.
  assert.equal(ICE_MARKS.cells * ICE_MARKS.cellFt, 2048);
  assert.deepEqual(ice.listedAt(1000 + 2048, 1000), [star.slot]);
  assert.deepEqual(ice.listedAt(1000 - 2048, 1000 - 4096), [star.slot], "and so do places further off, and less than nothing");
});

test("a line comes to a square as near as its nearest part", () => {
  assert.equal(lineToCellFt(-5, 5, 15, 5, 0, 0, 10, 10), 0, "through it");
  assert.equal(lineToCellFt(5, 5, 5, 5, 0, 0, 10, 10), 0, "a point in it");
  near(lineToCellFt(-5, 12, 15, 12, 0, 0, 10, 10), 2);
  // An end nearest a corner.
  near(lineToCellFt(13, 14, 13, 30, 0, 0, 10, 10), 5);
  // Running past a corner, nearer the corner than either end is to the square.
  near(lineToCellFt(0, 22, 22, 0, 0, 0, 10, 10), Math.SQRT2);
});

test("a cell lists at most 16 marks: the 17th makes the oldest there make way, from every cell it was in", () => {
  const ice = createIceMarks();
  // Sixteen stars 3 ft apart in the cell from 96 to 128 ft each way, each reaching into the cells round it.
  for (let i = 0; i < 16; i++) ice.strike(100 + (i % 4) * 3, 100 + Math.floor(i / 4) * 3, 30, i / 32);
  const first = ice.list()[0];
  assert.equal(ice.listedAt(110, 110).length, 16);
  assert.ok(ice.listedAt(80, 110).includes(first.slot), "the first reaches into the cell to the west");
  ice.strike(120, 120, 30, 0.9);
  assert.equal(ice.count, 16);
  assert.equal(ice.listedAt(110, 110).length, 16);
  assert.ok(ice.list().every((mark) => mark.born !== first.born));
  assert.ok(!ice.listedAt(80, 110).includes(first.slot), "gone from every cell, not only the full one");
  // The lists are oldest first.
  const listed = ice.listedAt(110, 110), born = ice.list().map((mark) => mark.born);
  assert.deepEqual(listed.map((slot) => ice.list().find((mark) => mark.slot === slot).born), [...born].sort((a, b) => a - b));
});

test("a hull point that comes down on the ice strikes it as fast as it came down; one that stays down drags over it", () => {
  assert.equal(ICE_HULL.downFt, 0.4);
  const last = new Map(), overIce = () => true, dt = 0.02;
  const frame = (hull) => iceHullContacts({ hull, levelFt: 10, overIce, last, dt });
  // Falling at 15 ft/s, then down on it.
  assert.deepEqual(frame([[0, 12, 0], null]), { blows: [], down: [] });
  assert.deepEqual(frame([[0, 11.7, 0], null]), { blows: [], down: [] });
  let { blows, down } = frame([[0.5, 10.1, 0], null]);
  assert.equal(blows.length, 1);
  near(blows[0].speedFtPerS, 80);
  assert.deepEqual(down, [[0.5, 0]]);
  // Staying down while it slides: no more blows, only dragging.
  ({ blows, down } = frame([[1.5, 10.05, 0], null]));
  assert.deepEqual({ blows, down }, { blows: [], down: [[1.5, 0]] });
  // Over ground that is not under the ice, nothing; nor in a frame of no length.
  assert.deepEqual(iceHullContacts({ hull: [[0, 10, 0]], levelFt: 10, overIce: () => false, last: new Map(), dt }), { blows: [], down: [] });
  assert.deepEqual(iceHullContacts({ hull: [[0, 10, 0]], levelFt: 10, overIce, last: new Map(), dt: 0 }), { blows: [], down: [] });
});

test("a body dragged over the ice scores a band as wide as what of it is down, laid straight where it goes straight", () => {
  const ice = createIceMarks(), chain = {};
  // A body on its roof, its four corners down, 6 ft apart across the way it slides (along +x).
  const body = (x) => [[x - 4, -3], [x + 4, -3], [x - 4, 3], [x + 4, 3]];
  ice.drag(chain, body(0), 0.25);
  assert.equal(ice.count, 0, "nothing until it has gone a step");
  ice.drag(chain, body(1), 0.5);
  assert.equal(ice.count, 0);
  ice.drag(chain, body(ICE_SCRAPES.stepFt), 0.5);
  let marks = ice.list();
  assert.equal(marks.length, 1);
  assert.equal(marks[0].kind, "scrape");
  assert.deepEqual(marks[0].from, [0, 0]);
  near(marks[0].halfFt, 3 + ICE_SCRAPES.marginFt);
  assert.equal(marks[0].seed, 0.25, "the band's own number, from where it began");
  // Straight on: the same piece, drawn on to 16 ft and no further.
  for (let x = 3; x <= 30; x += 1.5) ice.drag(chain, body(x));
  marks = ice.list();
  assert.equal(marks.length, 2);
  assert.ok(Math.hypot(marks[0].to[0] - marks[0].from[0], marks[0].to[1] - marks[0].from[1]) <= ICE_SCRAPES.longestFt);
  assert.deepEqual(marks[1].from, marks[0].to, "one piece runs on from the last");
  near(marks[1].startFt, marks[0].to[0], 1e-9);
  const packed = [...ice.marks.subarray(marks[1].slot * 8, marks[1].slot * 8 + 8)];
  assert.deepEqual(packed.slice(4), [1, Math.fround(marks[1].halfFt), 0.25, Math.fround(marks[1].startFt)]);
  // A turn begins another piece.
  ice.drag(chain, body(31.5).map(([x, z]) => [x, z + 3]));
  assert.equal(ice.count, 3);
  // A jump from one place to another, or lifting off the ice, ends the band.
  ice.drag(chain, body(100), 0.75);
  ice.drag(chain, body(102), 0.75);
  assert.equal(ice.count, 4);
  assert.equal(ice.list().at(-1).seed, 0.75);
  ice.drag(chain, []);
  assert.equal(chain.last, null);
  // A point down alone scores a band no narrower than the least.
  const one = {};
  ice.drag(one, [[500, 500]]);
  ice.drag(one, [[500, 503]]);
  near(ice.list().at(-1).halfFt, ICE_SCRAPES.leastHalfFt);
});

test("a scored band reaches as far as its cracks off it, and is listed wherever it does", () => {
  assert.ok(ICE_SCRAPES.spurs > 0 && ICE_SCRAPES.spurs < 1);
  assert.ok(ICE_SCRAPES.spurAngle[0] > 0.5 && ICE_SCRAPES.spurAngle[1] < Math.PI / 2, "out and back from the band");
  assert.ok(ICE_SCRAPES.spurFt[1] * Math.cos(ICE_SCRAPES.spurAngle[0]) < ICE_SCRAPES.spurEveryFt, "a crack reaches back less far than the next place one may be");
  const ice = createIceMarks(), chain = {};
  ice.drag(chain, [[0, 0]]);
  ice.drag(chain, [[3, 3]]);
  const [piece] = ice.list(), reach = markReachFt(piece);
  near(reach, ICE_SCRAPES.leastHalfFt + ICE_SCRAPES.spurFt[1] + seenAsideFt(ICE_SCRAPES.spurDeepFt));
  // Off the line's end, square to it, it is listed; a cell further off does not list it.
  assert.deepEqual(ice.listedAt(3 + reach * 0.7, 3 - reach * 0.7 + 0.5), [piece.slot]);
  assert.deepEqual(ice.listedAt(-0.01, -0.01), [piece.slot]);
  assert.deepEqual(ice.listedAt(40, 40), []);
});

test("a crack's face is seen through the ice where the eye's line meets it, down to the crack's foot", () => {
  // A point a quarter foot from the crack, with the eye's line closing on it half a foot for each foot down: half a foot down.
  near(crackPlane(0.25, 0.5, ICE.crackDepthFt), 0.5);
  // Further from it, the line meets the face below its foot: not seen.
  assert.equal(crackPlane(0.5, 0.5, ICE.crackDepthFt), null);
  // Looked at along the crack, or from the side the eye's line draws away from it, or straight down: only the line.
  assert.equal(crackPlane(0.25, 0, ICE.crackDepthFt), null);
  assert.equal(crackPlane(0.25, -0.5, ICE.crackDepthFt), null);
  assert.equal(crackPlane(0, 0, ICE.crackDepthFt), 0);
  // The steeper the look across it, the wider the band of face: the most the ice lets the line close is its bend.
  const widest = (closing) => closing * ICE.crackDepthFt;
  assert.ok(widest(ICE.bend / ICE.flattest) > widest(ICE.bend) && widest(ICE.bend) > 0);
});

test("a blow breaks the ice as ice breaks, no two stars alike", () => {
  assert.ok(ICE_STARS.spread > 0.2 && ICE_STARS.spread < 0.5, "a crack leaves the blow out of step, but never past the next");
  assert.ok(ICE_STARS.shortest > 0 && ICE_STARS.shortest < 0.5);
  assert.ok(ICE_STARS.lopsided > 0 && ICE_STARS.lopsided < 0.6);
  assert.ok(ICE_STARS.kink > 0 && ICE_STARS.kink < 0.3, "a crack turns a little where its pieces meet");
  assert.ok(ICE_STARS.raggedFt > 0 && ICE_STARS.raggedFt < 0.15);
  assert.ok(ICE_STARS.forks > 0 && ICE_STARS.forks < 1);
  assert.deepEqual(ICE_STARS.rings, [0.3, 0.6]);
  assert.ok(ICE_STARS.ringsVary > 0 && ICE_STARS.ringsVary < 0.5, "the two rings never cross");
  assert.ok(ICE_STARS.rings[0] * (1 + ICE_STARS.ringsVary) < ICE_STARS.rings[1] * (1 - ICE_STARS.ringsVary) + 0.2);
  assert.ok(ICE_STARS.joins > 0 && ICE_STARS.joins < 1, "some gaps are joined, not all");
  // A fresh crack runs deeper than the plates' old ones.
  assert.ok(ICE_STARS.deepFt > ICE.crackDepthFt);
  // Each piece tipped by a few hundredths of a radian: enough to throw the sky back differently, not to stand up.
  assert.ok(ICE_STARS.tiltRad > 0.01 && ICE_STARS.tiltRad < 0.1);
  // Water wells up round the crushed middle, out to a little more than twice its width.
  assert.ok(ICE_STARS.wet > 1 && ICE_STARS.wet < 4);
});
