import test from "node:test";
import assert from "node:assert/strict";
import {
  CRAFT_MAX_FT_S, FLY_SCHEMES, GROUND_CLEARANCE_FT, PITCH_LIMIT, TRAXX_CLIMB_FT_S, TRAXX_MOVE_FT_S, TURN_RAD_S, ZOOM_MAX,
  createFlyCamera, flyForward, nextFlyScheme, stepFlyCamera,
} from "../src/game/fly-camera.js";
import { flyInput, flyKeyCodes, flyUsesMouse } from "../src/game/input/fly-controls.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test("Traxx: the arrows move along the heading and turn, A and Z climb and sink", () => {
  const cam = createFlyCamera({ pos: [100, 50, 100] });
  stepFlyCamera(cam, flyInput("traxx", new Set(["ArrowUp", "KeyA"])), 0.5, "traxx");
  near(cam.pos[0], 100); near(cam.pos[2], 100 + TRAXX_MOVE_FT_S * 0.5); near(cam.pos[1], 50 + TRAXX_CLIMB_FT_S * 0.5);
  stepFlyCamera(cam, flyInput("traxx", new Set(["ArrowRight"])), 1, "traxx");
  near(cam.yaw, TURN_RAD_S);
  // Tilting the view does not change where the arrows take it: the move stays level.
  stepFlyCamera(cam, flyInput("traxx", new Set(["PageUp"])), 0.5, "traxx");
  const y = cam.pos[1];
  stepFlyCamera(cam, flyInput("traxx", new Set(["ArrowUp"])), 0.1, "traxx");
  near(cam.pos[1], y);
  assert.equal(cam.roll, 0);
});

test("Traxx: the mouse looks around within 85 degrees and the wheel zooms within its range", () => {
  const cam = createFlyCamera();
  stepFlyCamera(cam, { lookY: -100000 }, 0, "traxx");
  near(cam.pitch, PITCH_LIMIT);
  stepFlyCamera(cam, { zoom: 1000 }, 0, "traxx");
  assert.equal(cam.zoom, ZOOM_MAX);
  assert.equal(flyUsesMouse("traxx"), true);
  assert.equal(flyUsesMouse("tv"), false);
});

test("Terminal Velocity: the craft flies where it points at the throttle's speed, Up puts the nose down, and it banks into a turn", () => {
  const cam = createFlyCamera({ pos: [0, 500, 0] });
  cam.throttle = 1;
  stepFlyCamera(cam, {}, 1, "tv");
  near(cam.pos[2], CRAFT_MAX_FT_S); near(cam.pos[1], 500);
  stepFlyCamera(cam, flyInput("tv", new Set(["ArrowUp"])), 0.5, "tv");
  assert.ok(cam.pitch < 0 && cam.pos[1] < 500);
  stepFlyCamera(cam, flyInput("tv", new Set(["ArrowRight"])), 0.2, "tv");
  assert.ok(cam.roll > 0 && cam.yaw > 0);
  for (let k = 0; k < 100; k++) stepFlyCamera(cam, {}, 0.05, "tv");
  near(cam.roll, 0);
  stepFlyCamera(cam, flyInput("tv", new Set(["KeyZ"])), 10, "tv");
  assert.equal(cam.throttle, 0);
});

test("the camera stays above the ground", () => {
  const cam = createFlyCamera({ pos: [0, 0, 0] });
  stepFlyCamera(cam, flyInput("traxx", new Set(["KeyZ"])), 5, "traxx", () => 120);
  near(cam.pos[1], 120 + GROUND_CLEARANCE_FT);
});

test("the look vector, the scheme cycle and the keys kept from the page", () => {
  const f = flyForward(createFlyCamera({ yaw: Math.PI / 2 }));
  near(f[0], 1); near(f[2], 0);
  assert.deepEqual(FLY_SCHEMES.map(nextFlyScheme), ["tv", "hb", "traxx"]);
  assert.ok(flyKeyCodes("tv").has("Home") && flyKeyCodes("traxx").has("PageDown"));
});

test("Hellbender: X and Z for the speed, F for the turbo thrust, and no roll keys", async () => {
  const { flyInput, flyKeyCodes } = await import("../src/game/input/fly-controls.js");
  const { TURBO_FACTOR, CRAFT_MAX_FT_S } = await import("../src/game/fly-camera.js");
  assert.deepEqual(flyInput("hb", new Set(["KeyX", "KeyF", "ArrowUp", "ArrowLeft"])), { pitch: -1, yaw: -1, throttle: 1, turbo: 1 });
  assert.equal(flyInput("hb", new Set(["KeyZ"])).throttle, -1);
  assert.ok(!flyKeyCodes("hb").has("Home") && !flyKeyCodes("hb").has("KeyA"));
  // Terminal Velocity keeps A and Z, and has no turbo.
  assert.equal(flyInput("tv", new Set(["KeyA", "KeyF"])).throttle, 1);
  assert.equal(flyInput("tv", new Set(["KeyF"])).turbo, undefined);
  const plain = createFlyCamera({ pos: [0, 100, 0] }), fast = createFlyCamera({ pos: [0, 100, 0] });
  plain.throttle = fast.throttle = 1;
  stepFlyCamera(plain, {}, 1, "hb");
  stepFlyCamera(fast, { turbo: 1 }, 1, "hb");
  assert.ok(Math.abs(plain.pos[2] - CRAFT_MAX_FT_S) < 1e-9);
  assert.ok(Math.abs(fast.pos[2] - CRAFT_MAX_FT_S * TURBO_FACTOR) < 1e-9);
});

test("the list of keys the O key shows: each scheme's own, then the common ones", async () => {
  const { flyKeyLines } = await import("../src/game/input/fly-controls.js");
  const traxx = flyKeyLines("traxx");
  assert.ok(traxx.includes("Up: forward") && traxx.includes("A: climb") && traxx.includes("Mouse drag: look"));
  assert.ok(traxx.includes("T: follow the course") && traxx.includes("O: show or hide this list"));
  const hb = flyKeyLines("hb", { following: true });
  assert.ok(hb.includes("X: faster") && hb.includes("F: turbo thrust") && hb.includes("Up: nose down"));
  assert.ok(hb.includes("T: stop following the course") && hb.includes("Up, Down: follow faster, slower"));
  assert.ok(!hb.some((line) => line.startsWith("Mouse")));
  assert.ok(!flyKeyLines("tv", { course: false }).some((line) => line.includes("the course")));
});

test("following the course: the straights joined into a loop, the camera carried along it over the ground", async () => {
  const { TOUR_FT_S, TOUR_HEIGHT_FT, createCourseTour, startTourNear, stepCourseTour, tourPoint } = await import("../src/game/fly-camera.js");
  // A square of four straights, 1000 ft a side.
  const seg = (a, b) => ({ startFt: [a[0], 0, a[1]], endFt: [b[0], 0, b[1]] });
  const course = [seg([0, 0], [0, 1000]), seg([0, 1000], [1000, 1000]), seg([1000, 1000], [1000, 0]), seg([1000, 0], [0, 0])];
  const tour = createCourseTour(course);
  assert.equal(tour.total, 4000);
  assert.deepEqual(tourPoint(tour, 500), [0, 500]);
  assert.deepEqual(tourPoint(tour, 1500), [500, 1000]);
  assert.deepEqual(tourPoint(tour, 4500), [0, 500], "round again");
  assert.equal(createCourseTour([]), null);
  assert.equal(createCourseTour(null), null);
  // An open course is not closed back to its start.
  assert.equal(createCourseTour(course.slice(0, 2), { open: true }).total, 2000);
  assert.equal(createCourseTour(course.slice(0, 2)).total, 2000 + Math.hypot(1000, 1000));
  // It starts where the camera is, and is carried on at the tour's speed.
  startTourNear(tour, 990, 400);
  assert.ok(Math.abs(tour.at - 2600) <= 16, `at ${tour.at}`);
  const camera = createFlyCamera({ pos: [1000, 50, 400] });
  for (let i = 0; i < 120; i++) stepCourseTour(tour, camera, 1 / 60, {}, () => 20);
  assert.ok(Math.abs(tour.at - (2600 + 2 * TOUR_FT_S)) < 20);
  assert.ok(Math.abs(camera.pos[0] - 1000) < 5 && camera.pos[2] < 400 && camera.pos[2] > 150, `camera at ${camera.pos}`);
  assert.ok(Math.abs(camera.pos[1] - (20 + TOUR_HEIGHT_FT)) < 6, `height ${camera.pos[1]}`);
  // Looking down the course, toward -z.
  assert.ok(Math.abs(Math.abs(camera.yaw) - Math.PI) < 0.2, `yaw ${camera.yaw}`);
  // Up goes faster.
  const before = tour.speed;
  stepCourseTour(tour, camera, 0.5, { move: 1 }, () => 20);
  assert.ok(tour.speed > before);
});
