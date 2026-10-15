# OpenMTM2 extensions

Extensions add optional game modes without making them part of the original game simulation. OpenMTM2
currently ships with Hockey and Tag. They appear in the Races screen and in Options, but their rules,
settings, rendering and worker state stay behind extension loader contracts.

## Ownership boundary

Hockey and Tag were not modes in Monster Truck Madness or Monster Truck Madness 2. They must never be
implemented in OpenPhotex. OpenPhotex owns TRI file formats and behavior found in the original games.
An OpenMTM2 extension may call public OpenPhotex simulation primitives, but its rules and adapters belong
in this repository:

- `src/game/extensions/` contains pure rules, manifests, race preparation and worker runtimes.
- `src/render/extensions/` contains optional three.js presentation.
- `src/game/extensions/loader.js` is the mode, settings and selection registry.
- `src/game/extensions/race-loader.js` adapts a mode to race setup, HUD and results.
- `src/game/extensions/session-loader.js` adapts a mode to the simulation worker lifecycle.
- `src/render/extensions/loader.js` creates optional scene objects.

Core modules may import those loaders. They must not import Hockey, Tag or another concrete extension.
A new extension should require a registry entry and its own modules, not a new mode branch in `flow.js`,
`settings.js`, `race-select.js`, `race.js`, `results.js` or `sim-worker.js`.

## User-facing behavior

The Races screen combines the core modes with every extension available for the installed tracks. An
extension declares its label, accepted tracks, length control, fixed weather if any, detail level and
settings. The length, weather and mode selectors share one row, with Mode at the far right.

Options has an Extensions tab. Each registered extension gets its own panel, built from that extension's
settings schema. Values are stored below `settings.extensions.<id>`. Extension races use the normal
countdown, selected computer opponents, Garage setup and difficulty. Their results use place, score in
the Points column and the extension's result time. They do not enter the Hall of Fame.

## Extension pseudo-format

This is the intended shape, not a serialized file format. Functions remain ordinary ES module exports.

```js
export const MY_EXTENSION = Object.freeze({
  id: "my-mode",                 // stable lowercase id
  name: "My Mode",               // menu and Options title
  description: "What it does.",
  length: {
    key: "rounds",               // key below settings.extensions["my-mode"]
    label: "Rounds",             // Races screen length label
    default: 3,
    min: 1,
    max: 99,
  },
  settings: [
    { key: "rounds", label: "Rounds", type: "number", min: 1, max: 99, default: 3 },
  ],
  acceptsTrack(track) { return true; },
  trackLocked: false,             // true when the mode owns the track choice
  weather: null,                  // null uses the player's weather; a number locks it
  detailLevel: null,              // null uses the normal setting
});
```

Register the manifest in `game/extensions/loader.js`. Add a race adapter in `race-loader.js` that returns
only the pieces the mode needs:

```js
{
  id: "my-mode",
  dress: { mode: "my-mode", ...replaySafeData },
  course: optionalCourse,
  walls: optionalWalls,
  start(index, normalGridStart) { return normalGridStart; },
  simulation: { mode: "my-mode", ...plainWorkerData },
}
```

Register a factory in `session-loader.js`. Its runtime can implement these generic hooks:

```js
{
  id: "my-mode",
  held(index) { return false; },
  tick() {},
  drive(truck, index) {},
  touch(a, b) {},
  afterTruckStep(truck) {},
  specialBox: null,
  collideSpecial(index, box, collide) { collide(); },
  addSpecialWalls(allBoxes, nearbyBoxes) {},
  view(secondsSinceStart) { return { mode: "my-mode" }; },
  score(index) { return 0; },
  finish() {},
}
```

Hooks are optional except for those the mode uses. The runtime owns mode state. The worker owns fixed-step
timing, trucks, collisions and race transport. Data returned by `view` must be structured-clone safe.

If the extension draws anything, register one scene adapter in `render/extensions/loader.js`. It returns
`updateMarker` and `dispose`; a replay receives the same plain `dress` data. Rendering modules are the only
extension modules that may import three.js.

Keep rules pure where practical and test them under Node. Add an integration test that starts a worker
session through the generic `extension` payload, checks the public `race.extension` state, and verifies
the finish condition. Also test selection availability, settings defaults and migration when changing a
stored setting shape.

## Shipped extension: Hockey

Hockey runs only on the MTM2 Breakneck Ridge track (`ROCKQRY.SIT`) in Snow. Both track and weather are
locked while it is selected. Goals to win range from 1 to 99, with 3 as the default.

The rink is derived from the level. Its frozen lake contains `HPUCK.BIN`, a type 0 puck with mass 93.24
slugs and a 24 x 8 x 24 ft box, plus two non-colliding type 7 `HPOST3.BIN` goal frames. Each frame has two
invisible type 0 posts, 4 x 4 x 20 ft, at its mouth. The goals are the two frames; the posts are modelless
boxes within 45 ft. The long axis joins the goals. A mouth spans the inner faces of its posts, and the top
is the frame top. The water level is the ice. The shore is where the unfrozen ground rises to that level.

The extension adds boards 8 ft high and 2 ft thick, 8 ft inside the shore. Corners are cut at 45 degrees,
from 20 to 120 ft as needed to keep their midpoint on the ice. Boards collide with trucks and the puck.
A truck more than 4 ft outside for 2 seconds returns to its face-off spot.

The level places the puck at 22 ft, below the 28.5 ft ice. Hockey starts it at rink center with its bottom
0.3 ft above the ice and publishes that pose before the first frame. The puck retains the original ice
surface. Trucks use gravel grip on the frozen water because the original ice grip and at-rest clamp leave
a stopped truck unable to drive away. Sounds and wheel effects still identify the surface as ice.

The player's team is red or blue at random. Computer trucks alternate starting with the other team, so
team sizes differ by at most one. Red defends the low-x goal. Driver labels use team colors. Goal frames
are tinted red and blue after their texture is made grey enough to accept the tint. Replays redraw the
boards and goal tints.

At a face-off, each team stands on its own half facing the other goal. Its first four slots in rink-local
feet are `(40, 28)`, `(40, -28)`, `(95, 55)` and `(95, -55)`. The normal 3 second countdown holds the first
face-off. Later face-offs hold trucks for 3 seconds.

A goal requires the whole puck to cross the line going out of the rink, between the posts and below the
frame top. The attacking team scores. Its last touching truck receives individual credit; an own goal
scores for the team only. Play continues for 2.5 seconds, then trucks and puck reset. A puck 20 ft beyond
the boards, 6 ft below the ice or 200 ft above it resets without a goal. The target goal ends the game
after the celebration. Places sort by team score, individual goals and entry order.

Rink-only unsticking gives a truck 0.6 ft/s in its gear direction after it has held throttle above half
while moving under 0.05 ft/s for 0.5 seconds. This handles the simulation clamp when a truck is pressed
against boards or another truck.

Computer teams assign the nearest truck as attacker and keep that role until a teammate is 25 ft nearer.
With at least three trucks, the last computer truck defends 60 ft in front of its goal while the puck is
in the other half. Other trucks are wings, alternating sides, 70 ft behind and 55 ft across from the puck.
The attacker lines up behind the puck and carries it toward a point 10 ft beyond the mouth at 40 ft/s.
It never reverses toward the target and keeps at least 0.12 of speed in a sharp turn. Extension-driven
trucks recover upright like the player and are not lifted merely for moving slowly.

## Shipped extension: Tag

Tag runs on any track and any weather that track permits. Round length is 1 to 99 minutes, with 5 as the
default. Time begins after the normal countdown.

One truck is selected as It. It remains in Park for 5 seconds after the countdown while the field gets
away, although another truck can still shove it. A hull contact passes It to the touched truck. There is
no hold after a tag. The new It cannot tag the previous It back for 10 seconds.

Every truck starts with 100 points. After the opening hold, each whole second gives every free truck 1
point and removes 1 from It. A tag transfers at least 8 and at most 28 points from the victim to the
tagger, capped by the victim's points and scaled by the victim's shared place. Places sort by points and
then entry order. The HUD lists scores like a Rumble and tracks each truck's time as It.

An orange arrow hangs above It, faces the camera, and remains a world object so terrain or a wall can
hide it. It is hidden from inside that truck's cab. Normal truck names still follow the Names key.

Computer It pursues a legal target, favoring distance with a 55 ft divided by place bias, and leads the
target by travel time over 80 ft/s up to 1.5 seconds. It can route around a tall solid object, approach a
target 14 ft higher by a slope step, and use a ramp facing the target when still at least 140 ft away.
With no legal target it wanders.

Free computer trucks do not drive laps. Their roaming rectangle is the course extent plus 700 ft, or a
1400 ft area around the grid when no course covers ground. When It is beyond 180 ft, about 62 percent of
new aims wander, about 30 percent seek high ground, a ridge, cover or a ramp away, and the rest flee.
When It is closer, about 55 percent hide and the rest flee. Aims last 4 to 8 seconds or until reached.
Dry points are preferred when possible. A truck calls the helicopter after failing to move 12 ft in 6
seconds, except while It is deliberately held.
