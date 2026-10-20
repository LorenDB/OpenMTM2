# CART Precision Racing: the car simulation

The first reverse-engineering pass over `CART.EXE` (CART Precision Racing, built 15 January 1998),
written so that OpenPhotex can implement an optional **CPR Physics** model and so that OpenMTM2's CPR
tracks can drop the guesses they rely on today. It follows `MTM2_PHYSICS.md` and `EVO2_PHYSICS.md`:
one section per stage of the step, every constant with the address it was read from. Section 15 lists
where OpenMTM2 differs from the game today, and section 16 is the plan for the code.

CPR has no player base to speak of, so this work is low priority. It is here for completeness: with
it, OpenPhotex simulates every Terminal Reality racing game it reads.

Nothing here is decompiled code. Facts not confirmed in code are marked **hypothesis**.

The short answers:

- CPR's car is a rigid body on **four independent tire models with real suspension**, integrated in
  body axes by explicit Euler. The frame of MTM2's model is there (body-axis state, Euler's equations,
  hull points, the one-to-four point contact solvers, the course and autopilot), but everything that
  makes a force is new: a turbo engine with boost and mixture, a six-speed box, a differential, slip
  ratio and slip angle tires with load sensitivity, temperature, wear, compounds and camber, springs
  with four-way dampers and a third spring, wings and drafting.
- **Walls are infinitely tall.** The game tests them in plan view only: a car can never go over one.
  The drawn height of one wall panel is **4 ft** (OpenPhotex calibrated 4.5 ft from screenshots), and
  a Tree "wall" is a 60 ft card that is never solid.
- **Trackside objects never collide.** The SIT boxes (the BIN models) are scenery only. A car meets
  the ground, the walls and the other cars, nothing else.
- **The road always wins inside the track.** Where a point lies inside the road ribbon its height is
  the road's, whatever the terrain does there; the terrain counts only outside it.
- **Surface grip is known:** Road x1.0, Curb x0.9, Grass x0.6, Dirt x0.7, Rocks x0.7 (x0.4 off the
  road at the hardest assistance setting). OpenMTM2 maps the surfaces onto MTM2 ground types today.
- **Particles are simple:** a ring of 1,024 dirt particles in four colours thrown by tires off the
  road (and by every tire in the rain), and a pool of 96 smoke puffs (the `PUFF2` and `PUFF3`
  animated sprites).

---

## 0. The binary and the workspace

- `CART.EXE`, 3,515,904 bytes, PE timestamp 1998-01-15 16:18, MSVC with MFC (linker 3.10). Image base
  0x400000, `.text` 0x401000-0x5ac1fa. It is **not incrementally linked**: calls are direct and
  Ghidra's caller counts are right, as in MTM1.
- `CPR_DIR=~/games/cpr tools/re/decompile.sh cpr` builds the workspace in `re/cpr/` (git-ignored).
  Every helper reads it with `RE_TARGET=cpr`; `match.py` takes `MATCH=cpr:mtm1` and `fdiff.py`
  `FDIFF=cpr:mtm2`.
- The simulation is CPR's own. `match.py` pairs almost nothing between CPR's simulation range and
  MTM1's (19 pairs, one above 0.6), so the functions were read, not diffed.
- Assertion strings name the source files (`D:\indy\indy\core\vehicle.cpp`...). The modules that
  matter here:

| Module | Range | What it holds |
|---|---|---|
| (no assertions) | 0x460000-0x479000 | the car simulation: step, engine, tires, aero, walls, cars |
| `core\track.cpp` | 0x4473b0-0x44cda0 | the `.TRK` reader and writer, wall drawing, the wall list, track height |
| `core\Ground.c` | 0x43ab60-0x43d730 | the terrain heightfield |
| `core\vehicle.cpp` | 0x4b2b00-0x4b4282 | the vehicle records of the SIT |
| `core\simobj.cpp` | 0x51f030-0x520580 | the SIT reader and writer, object placement, checkpoints, pit stalls |
| `core\Dirt.c` | 0x50ad90 | dirt particles |
| `core\indypart.cpp` | 0x4fe370-0x4fe8f0 | car parts and their damage |
| `core\Garage.cpp` | 0x4ab7f0-0x4abf20 | the setup file |
| `core\Flag.cpp`, `pitcrew.cpp`, `ANALYSIS.CPP` | 0x4449b0, 0x528920, 0x418a00 | flags, the pit crew, telemetry |

- Engine globals: `0xb548d8` the car array (stride 0x1aac, count at `0xac7bd8`), `0x63a7f4` the
  player's car, `0xa4518c` the substep dt, `0xa45250` air density, `0xa45244` the weather, `0x5e7024`
  the assistance level (**hypothesis**: it is `mAssistance` of the Driving Aids, 0 to 2, read where the
  game treats 2 as the hardest), `0x5e7334` a global grip factor (1.0).

## 1. Units, frames and step

- Feet, seconds, pounds-force, slugs, radians, as MTM2. Body axes x right, y up, z forward. The
  engine's own world coordinates are integers of 1/256 ft (the `.TRK` reader multiplies by 256,
  `0x532390`).
- **Frame time** (`0x463810`): the frame's ticks / 65536 times a time scale (`0x5ec58c`, 1.0).
- **Substeps.** The frame is cut into equal steps of at most 1/15 s (`0x3d888889`). In each, every car
  runs the autopilot (`0x468620`), then its physics: the player's car in its own equal substeps of at
  most **0.02 s** (`0x3ca3d70a`), the other cars once per step. Walls, car contacts and the race order
  run once a frame, after all the steps (`0x4629b0`, `0x462bd0`).
- **Air density** (`0x463810`): 0.002377 slug/ft^3 when ambient temperature is off; otherwise
  2116.2 / ((T + 459.7) x 1716.48) with T the race's ambient temperature in degrees F (the ideal gas law
  at sea level pressure; `0x5b16e8`, `0x5b16d8`, `0x5b16e0`).
- **Gravity**: the car's weight is summed every step from its parts (chassis, the four corners, fuel:
  car +0x1690 family) and mass is weight x 0.031081 (1 / 32.174, `0x5b1710`).

## 2. The car's state

Offsets in the car record (all floats unless said):

| Offset | Field |
|---|---|
| +0x4 | body-to-world matrix (3x3) |
| +0x4c, +0x40c | front and rear axle (stride 0x3c0); each holds two tires (stride 0x1a8) |
| +0x804, +0x808 | throttle, last throttle |
| +0x8b0 + 4 x gear | gear ratios; +0x8d8 final drive; +0x8e0 gear (1 P, 2 R, 3 N, 4 to 9 first to sixth) |
| +0x7cc | engine rpm; +0x7fc upshift rpm, +0x800 downshift rpm |
| +0x864, +0x868 | boost (inHg) and its rate; +0x86c pop-off valve latch |
| +0x878 | rev limit (15,000 rpm; 10,000 in one mode) |
| +0x8f8, +0x8fc, +0x900 | fuel shown, fuel used, fuel left |
| +0x984 | 17 hull points (body), with their world positions now (+0x99 words on) and before (+0x33 words on) |
| +0xea4 | the car being drafted (999 none); +0x1570 the draft factor |
| +0x15c8 | world position; +0x15d4 world velocity |
| +0x15e0 | body velocity (x, y, z); +0x1634 body rates |
| +0x15f8, +0x1604 | force and moment sums (body) |
| +0x1650 | mass; +0x1660, +0x1664, +0x1668 the three moments of inertia |
| +0x167c | drag area; +0x1aa0 the off-the-wheels timer |

Per tire (from the axle's tire record): +0x88 compound, +0xa0 damper force, +0xa8 normal load,
+0x110 the load on the contact patch, +0x13c spin rate, +0x140 surface (type << 16), +0x198 slip
ratio, +0x19c combined slip, +0x1a0 temperature, +0x1a4 wear (grip factor), +0x84 rolling radius.

## 3. One step (`0x463810`, `0x46fe40`)

For each substep of a car:

1. Autopilot and driver controls (`0x468620`, every car, the player's included: it drives the
   assists).
2. Save the pose; tire geometry for both axles (`0x478740`).
3. Engine (`0x475580`).
4. Weight and mass from the parts; gravity into the force sum.
5. Aerodynamics and drafting (`0x470370`).
6. Gearbox and wheels: the player's car `0x4784d0` (full tire model `0x476e00` per axle), the other
   cars `0x46f4d0` (a lighter tire model `0x476550`).
7. Aerodynamic moments (`0x4707e0`).
8. Hull contacts with the ground (`0x470b90`): the four corner points (contact points 7 to 10), each
   only while its tire is off the ground and it is within 0.25 ft of the surface, solved by
   `0x471ce0`, `0x472070`, `0x472a50`, `0x473be0` for one to four contacts (MTM2's scheme).
9. Force sums (`0x464f60`, clamped in size by `0x5b1760`); moment sums (`0x465150`).
10. Accelerations (`0x4654c0`): Euler's equations, each angular acceleration clamped to +-13 rad/s^2.
11. Integration (`0x4656e0`, `0x465b00`).
12. Reset the 16 contact depths to -9999 (`0x470140`).
13. Suspension travel limits (`0x471030`) and the post-step (`0x470cf0`).

Once a frame, after every car's steps (`0x4629b0`): each car's hull points to world, the walls
(`0x46e280`), the car contacts (`0x46d550`, each car against the cars on its list), the walls again
for any car moved by a contact. Then the race order (`0x462bd0`, by laps and distance along the
course).

## 4. Engine (`0x475580`)

- Turbocharged. Boost is manifold pressure in inHg: 29.92 is one atmosphere (`0x5b2140`), the ceiling
  45 (`0x5b2170`). The boost knob raises the wastegate target; boost follows it at a rate set by
  `0x5b2158`, `0x5b2160`, `0x5b2168` and is held in 0..1 of its range.
- **Pop-off valve**: a latch at +0x86c opens above 0.99 of full boost and closes below 0.95
  (`0x3f7d70a4`, `0x3f733333`).
- **Torque** is the product of a mixture table (`0x5ec360`, 16 steps of 0.025 from a lambda of 0.899:
  0.70, 0.77, 0.825, 0.871, 0.909, 0.941, 0.965, 0.981, 0.988, 0.995, **1.0**, 0.995, 0.988, 0.981,
  0.965, 0.941, 0.909), a boost table (`0x5ec3a8`, steps of 1.25 inHg down from 45: 1.0 falling by
  0.02 a step to 0.68), the air density x 420.698 (`0x5b21a8`), and the fuel flow for the throttle.
  The mixture is the fuel knob (+0x880 x +0x828 + +0x824). The exact composition is **hypothesis**.
- **Friction torque** by rpm (`0x5ec3f0`, every 1,000 rpm from 0 to 15,000, lb-ft): 8, 9, 10, 12, 16,
  20, 28, 35, 42, 50, 62, 75, 87.4, 99.6, 112.8, 126.8.
- **Rev limiter** (+0x89c picks it): 15,000 rpm (0x466a6000); 10,000 in mode 2; in mode 1 the rpm of
  88 ft/s (60 mph) in the current gear, 88 / rear tire radius x ratio x 9.5493 (`0x5b20c8`, `0x5b20d0`):
  the pit lane speed limiter.
- **Fuel**: used at the engine's flow when the Fuel Consumption realism option is on, for the player's
  car only; shown in gallons (x 0.148148, `0x5b21a0`). An empty tank cuts the throttle.

## 5. Gearbox and differential

- **Gears** (`0x4784d0`): P, R, N and six forward gears. The automatic box shifts up above the upshift
  rpm and down below the downshift rpm; in a computer car or with Cued Shift it also asks for shifts
  1,000 rpm under and 500 rpm over (`0x5b25e8`, `0x5b25f0`). A shift adds a torque spike of the
  engine's inertia reflected through the new ratio.
- **Driveline** (`0x477d60`): only an axle with a drive share turns (the rear). Its differential
  (axle +0x3bc) is one of three: 1 limited slip, which splits the torque by the two wheels' speeds,
  each side held to 0.3..0.7 (`0x5b2558`, `0x5b2568`); 2 locked, both wheels at one speed; 3 open,
  half each. Wheel spin uses rad/s to rpm 9.5493 (`0x5b2518`).

## 6. Tires and suspension (`0x476e00`, player; `0x476550`, other cars)

### 6.1 Normal load

- The spring force is the spring rate times the deflection, plus an anti-roll term (0.25 x the bar's
  rate x the axle's roll, `0x5b2358`) and the third spring (0.1 x its rate x its travel, `0x5b2360`).
- **Bump stop**: past the travel limit less 0.02 ft (`0x5b2368`), 90,000 lb/ft more (`0x5b2370`).
- **Dampers**, four-way, by damper speed v (ft/s): a slow line 60 + 13.33 x slow click + 175 x |v|
  (`0x5b2388`, `0x5b2380`, `0x5b2390`) and a fast line whose slope is
  700 + (fast click / 6) x ((60 + 13.33 x slow click + 30) x 2.39981 - 700) (`0x5b23a8`, `0x5b23a0`,
  `0x5b23b0`); the force is the smaller of the two. Bump and rebound each have their own pair of
  clicks (tire +0xcc..+0xd8).
- The normal load (spring plus damper, at least 1 lb) times the installation ratio is the tire's load.

### 6.2 Grip

- **Load sensitivity**: mu by load from a table every 100 lb (`0x5ec430` front, `0x5ec488` rear),
  interpolated and held at the last entry, then x 1.1875 (`0x5b23d8`):

| Load (lb) | 0 | 200 | 400 | 600 | 800 | 1000 | 1200 | 1300+ | 1900+ |
|---|---|---|---|---|---|---|---|---|---|
| Front | 2.30 | 2.13 | 1.97 | 1.80 | 1.63 | 1.47 | 1.30 | 1.22 | 1.22 |
| Rear | 2.35 | 2.25 | 2.15 | 2.05 | 1.95 | 1.85 | 1.75 | 1.70 | 1.40 |

- **Compound and weather** (tire +0x88, weather `0xa45244`): dry or overcast, compound 0 x1.0 (wears
  x1.1), compound 1 x0.95, the rain tire (4) x0.7 (wears x2); in rain, compound 0 x0.6, compound 1 x0.5,
  the rain tire x0.9.
- **Surface** (the `.TTX` type under the tire): Road x1.0, Curb x0.9, Grass x0.6, Dirt x0.7, Rocks x0.7.
  At assistance level 2 Grass, Dirt and Rocks are all x0.4. Off the road the tire wears at a quarter of
  the rate.
- **Wear** (+0x1a4) multiplies the grip, from 1.0 down to no less than 0.7, when Tire Wear is on.
- **Camber**: lateral grip x cos^5(camber + 4 degrees) (`0x5b2458`).

### 6.3 Forces

- **Slip ratio**: (wheel speed - ground speed) / max(|ground speed|, 10 ft/s), held to -1..2.
- **Slip angle** from the contact patch velocity (a ground speed under 20 ft/s is taken as 20).
- Each slip is normalised by the tire's stiffness over its capacity (load x mu), and the
  **combined slip** is their root sum of squares.
- The force factor is a curve of the combined slip (`0x475480`): from 0 at no slip, 0.245, 0.465,
  0.643, 0.774, 0.865, 0.924, 0.961, 0.983, 0.994, 0.999 in steps of 0.25, to **1.0 at 2.75**, then
  falling slowly to 0.941 at 6 (`0x5ec4e0`) and on to 0.82 (`0x5ec548`, steps of 10).
- The longitudinal and lateral forces share that factor in proportion to their slips (a friction
  circle), times load x mu.
- **Temperature** (+0x1a0, when Tire Temps is on): rises by combined slip x 30 x dt and falls by
  speed x 0.225 x dt (speed at least 50 ft/s), held to 0..400. How temperature feeds back into grip is
  not found yet.

## 7. Aerodynamics and drafting (`0x470370`, `0x4707e0`)

- **Drag and downforce**: 0.5 x density x v^2 (v the forward speed) x the reference area (+0x167c) x
  the draft factor, times a drag coefficient sum (+0x1684) and a lift coefficient sum (+0x1680). Each sum
  is a body term plus the front and rear wings (angle x 0.05 x the wing's slope, `0x5b1e68`) plus the
  Gurney flaps; the front and rear shares (+0x940, +0x980, +0x93c, +0x97c) load each axle. The per-wing
  slopes come from the wing type in the setup (**hypothesis** on the exact terms).
- **Side force**: 0.5 x density x v_lateral^2 x a side area (+0x1678 x +0x169c) x the draft factor,
  limited to 0.8 of what would stop the sideways motion in one step (`0x5b1e70`).
- **Drafting**: for the car ahead (+0xea4), the gap g = its distance / its speed (both at least 5),
  held to 0..1, a time in seconds; and the lateral share s = |lateral offset| / distance x 2.74725, held
  to at most 1. Then **draft = 1 - 0.6 x (1 - g)^4 x (1 - s)** (`0x5b1e58`, `0x5b1e30`). Right behind a
  car, drag and downforce drop by 40%.
- **Aerodynamic moments** (`0x4707e0`): damping moments on two of the rates (x-0.05 for the player,
  x-0.15 for the other cars) and a third term (-0.0025 for the player; for the other cars a per-race
  value, -0.2 for the pace car); which rate is which axis is **hypothesis**. The downforce adds a pitch
  moment about the CG.

## 8. Integration and post-step

- Explicit Euler in body axes (`0x4656e0`): rates += angular acceleration x dt, body velocity += its
  acceleration x dt; then world velocity = matrix x body velocity and position += world velocity x dt
  (`0x465b00`).
- **At rest**: with the throttle under `0x5b1798`, speed squared under `0x5b17a0` and all four tires
  down, the car is held still. With more than two hull contacts and a small speed it is stopped too.
- **Off its wheels** (`0x4656e0`): a timer starts at 30. It falls by 3 a second while two or more of
  the player's wheels are off the ground, or by 2 a second while any of a computer car's are. At zero
  the player's car is put back at its last saved place on the track (+0x18e0) and the computer car is
  retired with random parts broken (as is the player's in one session type, `0x5ebd50` +0x38 = 5).
- **Travel limits** (`0x471030`): a wheel past its travel lifts the body at that corner, which pitches
  and rolls it (MTM2's post-step idea).

## 9. Ground

- The height under a point (`0x448070`): if the point lies inside the track's ribbon (`0x5332b0` finds
  the record, the slot and which of the slot's two triangles), it is that triangle's plane; otherwise
  it is the terrain. **The road wins whenever the point is inside it**, above or below the terrain.
- The terrain (`0x43cbc0`): 256 x 256 cells of 32 ft (8,192 ft, wrapping) from the level's 16-bit
  heights, each cell split into two triangles whose diagonal **alternates cell by cell**
  (checkerboard). OpenPhotex's terrain sampler should be checked against this split.
- The surface type under a point (`0x513c10`) is the `.TTX` type of the slot's texture: 0 Road, 1 Curb,
  2 Grass, 3 Dirt, 4 Rocks; 2 to 4 also set an "off road" bit.

## 10. Walls

### 10.1 What is a wall

- The `.TRK` reader (`0x4473b0`) forces the wall type on the two tree points (2, "Left tree", and
  pointCount - 3, "Right tree") to 0 unless it is 7. A tree can stand only on a tree point, and only a
  tree.
- The **wall list** (`CRaceTrack::makeWallList`, `0x44be30`) holds, for each car, the walls of the
  record it is on and of its neighbours, at most 20. **Wall types 0 and 7 are left out**: a Tree is
  never solid.

### 10.2 The test (`0x46e280`)

- A wall is a line segment in plan view (x, z), from a point of one record to the same point of the
  next. **Height plays no part**: a wall is solid from the ground to the sky.
- Each of the car's 17 hull points is swept from where it was to where it is. A point that crosses
  the wall's line within its length (from 0.5 ft before its start to 0.5 ft past its end) has hit it.
- The response: the car is moved back by the point's overshoot, then 0.5 ft further off the wall; the
  velocity into the wall is removed (an impulse of mass x the normal speed, no bounce) and that impulse's
  moment about the hit point is applied. The hit point picks a part to damage (`0x46c050`,
  `0x50d810`) and plays a crash sound; on race types 4 and 7 it also marks the car (+0xe1c;
  **hypothesis**: a caution).
- **Assisted wall hits** (`0x480920`): at assistance levels under 2, the player's forward speed is cut
  by 10% at each hit, on race types 4 and 7 always, elsewhere above 161.3 ft/s (110 mph).

### 10.3 How tall a wall is drawn (`0x44a1a0`, `0x448a80`)

- A wall panel spans 4/256 of a 256 ft unit: **one panel is 4 ft**.
- Short 4 ft; Wall med 8 ft; Tall 12 ft; Very tall 16 ft; Short wall with catch fencing: a 4 ft wall
  with fence from 4 to 12 ft; Wall-catch-wall: wall 0 to 4, fence 4 to 12, wall 12 to 16 ft.
- **Tree** (`0x449de0`): a card 60 ft tall (0x3c of the 256ths), drawn only with trackside trees on.

## 11. Other cars (`0x46d550`)

Each car is tested against a list of near cars (999 ends it), by hull points against the other car,
with the same part damage, sound and assisted speed cut as a wall. The constants are 0.25 and 15,000
(`0x5b1cc0`, `0x5b1cd8`); the full geometry is left for the second pass.

## 12. Trackside objects

The SIT's boxes (`0x487e50`, count at `0xae413c`) are placed as engine objects for drawing
(`0x51ee60`) and culled each frame (`0x520920`). No simulation function reads them: **no trackside
object collides**. The SIT reader refuses ramps, cylinders and top-crush cars outright ("No ramps,
please!", `0x51f490`).

## 13. Particles and effects

### 13.1 Dirt and spray (`0x50ad90`, `0x51ea80`)

- A ring of 1,024 particles (`0x5f5e20` wraps at 0x400), each with a position, a velocity, a life of
  3 s and a gravity of -1/8 of its unit a step (**hypothesis** on the unit).
- Four kinds, each a base colour scaled by 0.75..1.0 at random and matched to the palette through a
  32 x 32 x 32 colour cube (`0xaba4b0`): 0 tan dust (199, 177, 156), 1 grass green (59, 85, 44),
  2 and 3 grey (128, 128, 128) (`0x5f5e28`, `0x5f5e38`, `0x5f5e48`).
- Thrown (`0x51ea80`, from the per-frame drawing, when particles are on and detail is above 1) at three
  points of each car, three particles a point a frame, while the surface under it is off the road:
  Grass throws green, Rocks grey, Dirt tan. **In rain every surface throws kind 3, the road
  included.** A particle takes the point's velocity, x0.5..1.5 upwards and x0.9..1.1 across.

### 13.2 Smoke (`0x513b20`, `0x513c50`)

- A pool of 96 puffs (`0xac263c`, stride 0x44), each drawn as the `PUFF2` or `PUFF3` sprite at random
  (12 frames each, `ART\PUFF2_01.RAW` to `ART\PUFF3_12.RAW` with their own `.ACT`, in CPR's
  `STARTUP.POD`), living 1.5 to 3.5 s, sized at random, spawned 0.4 ft over its source (`0x5bcab0`).
  Only with `smokeEffectFlag` (cart.ini, Graphics) on.
- Spawned by part damage (`0x4fec80`, indypart.cpp) and the network replay of it (`0x411b90`,
  `0x412150`). Tire smoke from wheelspin is **hypothesis**: the call from `0x480c20` is the next thing
  to read.

There are no sparks and no skid marks; a skid is a sound (`skid1.wav`).

## 14. Assists and realism

The options the game keeps (`0x5467a0` prints them):

- **Realism**: percent of race, pit errors, fuel consumption, repair damage, mechanical failures,
  tire temperatures, tire wear, ambient temperature, road qualifying time, weather, accurate
  performance, skip the pace lap, pit stops.
- **Driving aids**: assistance, steer on line, anti-lock brakes, traction control, steer on track,
  show the driving line, auto shift, cued shift, braking cones, spin control.

The autopilot (`0x468620`) follows the SIT's courses as MTM2's does (records of 0x4c bytes, 1 straight
and 2 curve, the segment at car word 0x389) and drives every car. For the player it carries the aids.

## 15. Where OpenMTM2 differs from the game today

| Today (port's rule) | CART.EXE | Under MTM physics | Under CPR physics |
|---|---|---|---|
| Wall panel 4.5 ft (`CPR_WALL_PART_HEIGHT_FT`, a screenshot calibration) | 4 ft (10.3) | fix: draw and collide 4 ft panels | 4 ft, drawing only |
| Tree wall 9 units (40.5 ft) and **solid** (`buildCprRoad` emits type 7 walls; `cpr-road.js` turns every wall into a box): 470 tree segments at Elkhart, 212 at Mid-Ohio, 118 at Portland | 60 ft card, never solid (10.1, 10.3) | fix: draw 60 ft, no box | same |
| A wall may stand on a tree point | the reader clears it (10.1) | fix in `parseCprTrk` | same |
| Wall boxes as tall as their panels: a jumping truck clears them | infinitely tall (10.2) | port's choice: keep, or raise the boxes | 2D segment test |
| Surfaces mapped to MTM2 ground types (`CPR_SURFACE_VALUES`) | Road 1.0, Curb 0.9, Grass 0.6, Dirt 0.7, Rocks 0.7 (6.2) | keep MTM2's types (the trucks' tires are MTM2's) | CPR's factors |
| Road counts only where it is not below the terrain (OpenPhotex `world/road.ts`) | road wins inside the ribbon (9) | port's choice: either | CPR's rule |
| Objects solid unless trees or over the road (`track-build.js` `overRoad`) | no object collides (12) | port's choice: keep (trucks expect scenery to be hard) | none solid |
| MTM2 dust from MTM2 surface values; nothing CPR's | four-colour dirt off road, spray in rain, smoke puffs (13) | optional "CPR particles" | same |
| CPR cars drive as small monster trucks on MTM2's model | section 4 to 8 | unchanged | CPR's model |

## 16. Implementation suggestion

### 16.1 Phase 0: track fixes, independent of the physics (OpenPhotex, then vendor)

Small, testable, and they improve CPR tracks under every model:

1. `CPR_WALL_PART_HEIGHT_FT` 4.5 to **4.0**; `CPR_WALL_LAYERS[7]` becomes a 60 ft card
   (`{ part: 0, units: 15 }`, or a `treeHeightFt` of its own), and `docs/LEVELS.md` says where both come
   from.
2. `parseCprTrk` clears a non-tree wall type on points 2 and pointCount - 3, as the game's reader does.
3. `buildCprRoad` marks walls `solid: wallType !== 7`; `worker/cpr-road.js` makes boxes only of solid
   walls, and draws trees as camera-facing cards or not at all (the game draws them only with
   trackside trees on).
4. Tests: Laguna's type 4 and type 5 walls (10 and 4 of them) stand 16 ft; no type 7 wall reaches
   `sim.walls` at Elkhart, Mid-Ohio or Portland; a tree point in a synthetic `.TRK` with type 2 reads
   back 0.

### 16.2 Phase 1: the CPR model in OpenPhotex (`src/sim/cpr/`, `cprSim`)

Shaped like `src/sim/evo/`, so the worker treats it the same way:

| File | Holds |
|---|---|
| `rules.ts` | `CPR_RULES`: substep 0.02 s, the surface factors, compound and weather tables, the assistance switches |
| `spec.ts` | `CprSpec` (weights, inertia, CG, wheelbase, spring and damper rates, wings, gears, engine tables) and `cprSpecFromMtm2` for trucks |
| `engine.ts` | boost, pop-off valve, mixture and boost tables, friction, rev limiter, fuel (4) |
| `driveline.ts` | six gears, auto and cued shift, the three differentials (5) |
| `tire.ts` | springs, bump stop, four-way dampers, load-sensitive mu, slip, the force curve, temperature, wear, camber (6) |
| `aero.ts` | drag, downforce, drafting (7) |
| `walls.ts` | the swept plan-view segment test and its response (10.2), with a wall list by track record |
| `step.ts` | the order of section 3, reusing `sim/mtm2`'s math, hull contact solvers and post-step where section 3 says they match |

- **Ground**: a `cprGround(terrain, road)` that gives the road precedence inside the ribbon (section
  9). OpenPhotex's `createRoadGround` takes an option for it, so MTM physics can keep today's rule.
- **Car against car**: MTM2's truck-against-truck hull test until `0x46d550` is in the docs (port's
  rule).
- **Computer cars**: MTM2's autopilot, as the Evo model does, on CPR's courses (already built).
- **Spec**: section 2 gives the layout, not the stock figures. Each car's chassis, engine and tire come
  from `drivers.txt` (`number, teamNumber, chassis, engine, tire, vehicleFile`), which sits in the
  `UI.POD` that this install does not have; the per-chassis and per-engine figures and the default
  setups are in the vehicle constructor and `Garage.cpp`. **Read those before writing `spec.ts`**
  (16.5). Until then one generic Indy car (about 1,550 lb, 15,000 rpm, the tables above) is the honest
  fallback and should be labelled as such.
- Tests (`test/sim-cpr.test.ts`), one per documented fact: the draft factor at g = 0, 0.5, 1; the force
  curve's peak at 2.75; mu at 0, 650 and 2,000 lb for each axle; the pop-off latch at 0.99 and 0.95; a
  hull point crossing a wall is moved 0.5 ft off it with no normal speed; a tree never stops a car.

### 16.3 Phase 2: the physics selector (OpenMTM2)

- `app/settings.js`: one more entry in `PHYSICS_MODELS`,
  `{ id: "cpr", label: "CART Precision Racing", note: "The 1998 game's car model: turbo engine, six
  gears, slip-based tires with wear and temperature, wings and drafting; walls are endless, scenery is
  not solid" }`.
- `resolvePhysics`: `byGame("CPR")` gives `"cpr"` under "Auto (by track)". Under "Auto (by vehicle)" a
  CPR car gives `"cpr"` only once the model is built and tested; until then it keeps `"mtm2"`.
- `worker/sim-worker.js`: `C.isCprRules(init.rules)` picks `cprSim` as `E.isEvoRules` picks Evo's;
  the CPR walls go in as segments (`init.cprWalls`, from `worker/cpr-road.js`) rather than boxes, and
  CPR physics leaves the trackside boxes out of `levelBoxes`.
- `snapshot()`: `gears: 6`, and the extra gauges the model has (boost, fuel, tire temperatures) for
  the HUD to show when present.
- The console's `physics cpr` works as soon as the entry exists (it lists `PHYSICS_MODELS`).
- An MTM truck under CPR physics drives on `cprSpecFromMtm2` (its weight and anchors, MTM2's engine
  curve, CPR's tire model held at its last mu entry for the heavier loads), as Evo does for trucks.

### 16.4 Phase 3: CPR particles (OpenMTM2)

`game/cpr-particles.js` (the rules of 13.1, testable under Node) and `render/cpr-particles.js` (one
instanced draw), behind an Options, Advanced switch "CPR particles", on by default on CPR tracks like
"Evo particles" on Evo tracks. Dust colour by the `.TTX` surface under each tire, spray from every tire
in Rain, and smoke puffs from damage. The `PUFF2` and `PUFF3` sprites (12 frames each) are in CPR's
`STARTUP.POD`, so the puffs can be the game's own art, animated as they age.

### 16.5 Phase 4: the second reverse-engineering pass

Before Phase 1 is more than a skeleton:

1. The vehicle constructor and `drivers.txt`'s chassis, engine and tire tables: weights, inertia, CG,
   drag area, wing coefficients, torque scale, gear sets (`vehicle.cpp`, `Garage.cpp` `0x4abf20`).
2. The default setups for road, oval and short oval (`defaultGarageSetupFilename`, `0x4b8a90`).
3. The car contact geometry (`0x46d550`) and the part damage map (`0x46c050`, `indypart.cpp`): which
   hull points break which parts, and what a broken wing or suspension does to the model.
4. The lighter computer-car tire model (`0x476550`) against the player's.
5. Temperature's effect on grip, the brake model (bias, proportioning, ABS) and traction control.
6. The smoke sources (`0x480c20`, `0x4fec80`) and the yellow flag rules (`Flag.cpp`).

### 16.6 Other features worth having

In rough order of value against effort:

1. **Drafting under every model.** The draft factor of section 7 is a dozen lines and needs nothing
   else from CPR; it would give MTM2's ovals a slipstream. Off by default.
2. **The garage setup for CPR cars**: wings, springs, dampers, gears, fuel, from the setup file layout
   (`Garage.cpp`); only meaningful under CPR physics.
3. **CPR's cockpit**: the instrument cluster art (`IC200SCR.AAI` to `PI480RPM.AAI`) and
   `DATA\THROTTLE.*` in `RACECAR.POD`, and the driver's helmet model (`Helmet name` in the `.CAR`).
4. **Telemetry** (`ANALYSIS.CPP`): the game logs channels (throttle, brake, gear, rpm, slip,
   temperatures) for a graph screen. The replay recorder already keeps most of them; a results-screen
   graph would suit the web port.
5. **Pit stops** with the crew's animations (`MOTION\*.PIT`, `*.ANI`, `pitcrew.cpp`): fuel and tires,
   needing the fuel and wear models first.
6. **The pace car** (`LAGPACE.CAR`, `paceCarFlag`) for a rolling start on the ovals.
7. **Yellow flags** after crashes on ovals (`Flag.cpp`; 10.2 may be where they start), with the field
   held behind the pace car.

## 17. Still open

- Which value of `0x5e7024` is which assistance level, and whether it is `mAssistance` at all.
- The exact torque and downforce formulas (4, 7), and how temperature feeds back into grip (6.3).
- The particle velocity source (the three emitter points of 13.1) and the gravity unit.
- The car's stock figures (16.5).
