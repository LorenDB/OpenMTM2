# 4x4 Evolution 2: the vehicle simulation

The second reverse-engineering pass over `4x42.exe` (25 September 2001), written so that OpenPhotex
can implement an **Evo 2 Physics** option. It follows `MTM2_PHYSICS.md`'s form: one section per
stage of the step, every constant with the address it was read from. The first pass
(`EVO2_EXE_ANALYSIS.md`) covers the world side (surfaces, vegetation, particles) and is not
repeated here. Section 10 compares Evo 1 (`4x4LE.exe`, 16 August 2001), and section 11 is the
plan for the code.

Nothing here is decompiled code. Facts not confirmed in code are marked **hypothesis**.

The short answers:

- Evo's vehicle is a rigid body with **four independent tire models**, integrated in body axes
  by explicit Euler at a variable step. MTM2's framework survives (16 contact points, the hull
  contact solvers, the surface encoding); everything that produces tire forces is new.
- Every vehicle drives on its own `.TRK` figures: weight, inertia, CG, spring rates, tire grip,
  a torque curve, a gearbox, a transfer case, a torque split, two differentials, brakes and
  aerodynamics.
- **Evo 1 runs the same model with the same constants**, with four differences: Evo 2 pulls
  airborne vehicles down at 1.75 g, moves the default CG 2 ft forward (and its `.TRK` spring
  rates were regenerated to match), cuts rear grip when steering hard above 20 mph, and grips
  three times harder when the body slides on the ground (section 10).

---

## 1. Units, frames and step

- Feet, seconds, pounds-force, slugs, radians. g = 32.174 ft/s².
- Body axes: x right, y up, z forward (the `.TRK` and `.SMF` frame). Orientation is three Euler
  angles at vehicle +0xC, +0x10, +0x14 (pitch, roll, heading: the `.SIT` `wOrient` order).
- **Body state** (object at vehicle +0x4C): body-axis velocity +0xC..+0x14, angular rates
  +0x18..+0x20 (pitch, yaw, roll **hypothesis** on the last two), linear acceleration
  +0x24..+0x2C, angular acceleration +0x30..+0x38, external force accumulator +0x3C..+0x44,
  external moment accumulator +0x48..+0x50.
- **dt** (`0x52b450`): the frame time in 1/65536 s units times a time scale (`0x679770`). A
  frame longer than 0.1 s is split into equal substeps (the count comes from a float-to-int
  helper whose argument Ghidra hides; **hypothesis**: `floor(dt / 0.1) + 1`). There is no fixed
  physics rate, as in MTM2.
- **Weather grip** (`0x52b450`): 1.0, Rain (weather 3) 0.8, Snow (weather 4) 0.6, kept in
  `0xcad9fc` for the step.

## 2. The vehicle's parameters

From the `.TRK` (reader `0x5ed4b0`; layout in `EVO2_EXE_ANALYSIS.md` 6.2) and the constructor
`0x5e9c80`. Vehicle offsets:

| Offset | Field | Use |
|---|---|---|
| +0x1204 | `dry_weight` (default 3000) | weight |
| +0x2F0, +0x5A8 | front, rear axle weight (default 500 each) | weight |
| +0x714 | `fuel.weight` | weight |
| +0x1208, +0x120C, +0x1210 | `ixx,iyy,izz` | inertia |
| +0x1214..+0x121C | `refArea` (side, top, front) | aero |
| +0x1220, +0x1224, +0x1228 | `CL`, `CD`, `CY` | aero |
| +0x122C, +0x1230, +0x1234 | `clp,cmq,cnr` | aero damping |
| +0x1238 | `max_brake_force_pct` | brakes |
| +0x123C | `drive_type` | centre differential |
| +0x1240 | transfer case: 0 2WD, 1 4WD High, 2 4WD Low | driveline |
| +0x1244 | handbrake | grip, brakes |
| +0x1270..+0x1278 | CG (default 0, 0.5, **2.0**) plus `cgModifier` | moment arms |
| +0x1298 | `brakeBalance` | brakes |
| +0x12B8, +0x12BC | parts: torque modifier, tire CF modifier | engine, grip |
| +0x2C4, +0x2C8, +0x2E0, +0x2E4 | front `maxangle`, `maxcompr`, `spring_rate`, damping | suspension |
| +0x57C, +0x580, +0x598, +0x59C | the same, rear | suspension |
| +0x2F8, +0x5B0 | front, rear brake input | brakes |
| +0x2FC, +0x308, +0x314 | front `torque_pct`, `axleBias`, `slipDiffType` (rear +0x5B4, +0x5C0, +0x5CC) | driveline |
| tire +0x88 | `CF` (live copy at tire +0x88, base at tire +0x90) | grip |
| tire +0x8 | tire tread (0 shallow, 1 medium, 2 deep, 3 studded) | grip |

Tires are at +0x60 (front right), +0x18C (front left), +0x318 (rear right), +0x444 (rear left),
0x12C bytes each. The two axle blocks sit after each pair of tires.

**Weight** W = `dry_weight` + `fuel.weight` + both axle weights.

**Springs** (`0x5ecba0`, `CVehicle::setSprings`, s in [0, 1] from the garage; the constructor
uses the same formula):

    sag      = min(front maxcompr, rear maxcompr) * (0.5 - 0.4 * (0.5 - s))
    k_rear   = W_sprung * (zFront - zCG) / (zFront - zRear) * 0.5 / sag
    k_front  = W_sprung * (zCG - zRear) / (zFront - zRear) * 0.5 / sag
    damping  = 3.5 * sqrt(k)            (per axle)

with `W_sprung` = `dry_weight` + both axle weights and z the axles' and CG's forward
positions. The CG height is reset to the hub height + sag + `cgModifier.y`. **Hypothesis:** a stock
vehicle without race springs keeps its `.TRK` `spring_rate` (the garage only enables the setting
with race springs; when `setSprings` is called was not traced). **The Shocks setting is not used**: its own text
says "not hooked up" (`0x5ecdd0`).

## 3. The step

Each substep, per vehicle (`0x553920`, vtable slot +0x44 of the vehicle class at `0x667fd4`):

1. **Grip setup** (3.1).
2. Contact probes (`0x553d80`, per tire `0x553dd0`): hub positions along the spring arms, tire
   point velocities `v + omega x r`.
3. Effective final ratio: `final_drive * axle_ratio`, times `xfrLowRatio` in 4WD Low.
4. Gearbox (`0x553fb0`, section 6).
5. Forces (`0x554330`): gravity (4), aero forces (8), drivetrain and tires (5, 6), aero damping
   (8), hull contacts (7), force sum (9.1).
6. Moments (`0x5570d0` -> `0x557100`), body accelerations (`0x5575d0`), velocity update
   (`0x5577f0`), position (`0x5578b0`), orientation (`0x557ec0`). Section 9.
7. Probes again, tire spin update (`0x558490`).
8. AI and replay/network hooks.

### 3.1 Grip setup (`0x553920`)

- Every tire's live CF = base CF * the parts' tire CF modifier (+0x12BC).
- **Steering at speed** (Evo 2 only): when the front steering angle (+0x2DC) is at least 0.0025
  rad either way, the speed is above 20 mph (forward speed * 0.681818 > 20), and the yaw rate is
  above 0.35 rad/s in the direction of the steering, both rear tires' CF is multiplied by
  `(0.45 - |steer|) / 0.45` (constants `0x64b377`, `0x64b37b`, `0x64b37f`, `0x64b383`,
  `0x64b387`). Otherwise the rear tires keep their CF.
- **Wheel centred** (steering within 0.0025): the front tires take the rear tires' CF.
- **Brake balance**: while the front brake input is above 0.35, a balance under 0.5 lowers the
  front tires' CF by `CF * frontBrake * (1 - balance / 0.5)`; a balance over 0.5 lowers the rear
  tires' CF by `CF * rearBrake * (balance - 0.5) * 2`.
- **Handbrake** (+0x1244 = 1): rear brake input 1, rear CF * 0.1 (`0x667178`).
- A vehicle with a positive crash timer (+0x1248) runs `0x55e240` instead of the step
  (**not traced**: crash or reset sequence).

## 4. Gravity and mass (`0x554600`)

    mass = W / 32.174             (any tire touching)
    mass = W / 56.3045            (all four tires off the ground, Evo 2 only)

The gravity force stays `-W` along world down (turned into body axes), so **an airborne vehicle
accelerates downward at 1.75 g** (56.3045 / 32.174). The body forces start from it.

## 5. Tires

### 5.1 Spring force and friction capacity (`0x559770`, `0x559500`)

Per tire:

    spring  = compression * spring_rate - compressionRate * damping      (at least 0)
    load    = spring force vector . ground normal                        (0 off the ground)
    grip    = CF * mu(surface) * weather * tread(surface)
    Fmax    = grip * load

`mu` is the surface table (`0x545ac0`, `EVO2_EXE_ANALYSIS.md` 4.2). **Tread factor**
(`0x559500`), by tire tread and surface:

| Surface | Shallow | Medium | Deep | Studded |
|---|---|---|---|---|
| Cement | 1.0 | 0.9 | 0.8 | 0.7 |
| Dirt | 0.9 | 1.0 | 0.9 | 0.8 |
| Water | 0.7 | 0.9 | 1.0 | 0.8 |
| Mud | 0.8 | 0.9 | 1.0 | 0.9 |
| Sand | 0.8 | 0.9 | 1.0 | 0.9 |
| Grass | 0.9 | 1.0 | 0.9 | 0.9 |
| Gravel | 0.8 | 0.9 | 1.0 | 0.9 |
| Ice | 0.6 | 0.8 | 0.8 | 1.0 |
| Snow | 0.6 | 0.8 | 0.9 | 1.0 |
| Metal | 0.9 | 1.0 | 0.9 | 0.6 |
| Wood | 0.9 | 1.0 | 0.9 | 0.8 |
| Rock | 0.8 | 0.9 | 1.0 | 0.7 |
| others | 1.0 | 1.0 | 1.0 | 1.0 |

### 5.2 Slip angle and lateral force (`0x55a7a0`, `0x559920`, `0x55a720`)

- The tire's velocity is taken into the tire frame: the ground slope under the tire gives two
  angles (`0x559920`, kept at tire +0xB4, +0xB8), the axle's steering angle (axle +0x27C) turns
  it. Longitudinal velocity at tire +0x50, lateral at +0x48.
- **Slip angle** = `atan2(lateral, longitudinal)`, with a zero longitudinal velocity read as
  +/-10 ft/s. Kept at tire +0x84.
- **Lateral coefficient** from a piecewise-linear table of (slip angle, coefficient)
  (`0x679930`), odd-symmetric:

| Slip | 0 | 5° | 10° | 15° | 20° | 25° | 90° | 155° | 160° | 167.6° | 170° | 175° | 180° |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Coefficient | 0 | -0.5 | -0.8 | -0.9 | -1.0 | -1.0 | -0.95 | -1.0 | -1.0 | -0.9 | -0.8 | -0.5 | 0 |

- **Lateral force** = the slope component of the vehicle's gravity share at the tire +
  `Fmax * coefficient`.
- **Under 14.67 ft/s** (10 mph): the force is capped at `Fmax`, and a sticking term (the force
  that would cancel the tire's lateral velocity this step, `-vLat / dt * mass` times the tire's
  share of the load) replaces it when that is smaller. This holds a vehicle still on a slope.
- The force is rotated by the steering angle and added to the tire force.

### 5.3 Longitudinal force: drive, brakes, wheelspin (`0x559d30`, `0x559af0`)

Per tire:

- **Brakes and rolling resistance**: `(brake * max_brake_force_pct * 0.8 + 0.02) * load`,
  opposing the tire's motion, never reversing it (constants `0x64b49b`, `0x64b49f`).
- **Drive**: `gear_ratio[gear] * finalRatio * engineTorque / tireRadius`. In 2WD the front tires
  get none and each rear tire half; in 4WD the axle's split times the differential's share for
  that tire (section 6).
- The total is capped at `Fmax` in each direction (the forward cap applies only while the
  vehicle is still).
- **Wheelspin** (`0x559af0`): a threshold
  `T = 200 * 0.01 * (0.84 - 0.002 * speed) * grip * load` (times 0.1 for a tire off the
  ground). A drive force beyond T builds a slip value at
  `(excess + 0.001 * slip) * 330 / driveInertia` per second (230 above a slip of 50); within T
  the slip is multiplied by 0.99. Every step the slip is capped at 100 and otherwise multiplied
  by 0.7, and cleared under 1. A negative drive force counts half. The slip adds
  `0.3 * slip` to the tire's spin rate (tire +0xC8) and feeds the particles.
- **Tire to body** (`0x55aaf0`): each tire's ground-plane force is rotated through its slope
  angles into body axes.

## 6. Driveline

### 6.1 Engine (`0x559d30`, `0x559cb0`)

- **RPM** from the wheels: `mean(tire spin rates) * gear * finalRatio * 60 / 2pi`; a tire off the
  ground adds the body's forward speed over the tire radius. At least **800 RPM**. At the
  redline the RPM is set to `redline - 250` and the torque to 0. In neutral the RPM moves 10% a
  step toward `throttle * redline` and decays by 0.97 a step otherwise. The live RPM follows its
  target at rate dt.
- **Torque**: `torqueTable[i]` is the torque at `500 i` RPM, linear between entries, at most 23
  entries; times throttle times the parts' torque modifier.
- **Misfire**: while `0x5ec870` returns a negative value (**not traced**; likely fuel or damage),
  one step in five keeps 30% of the torque and the others none.
- A flag at +0x24D8 (value 2) with `0x892514` set multiplies torque by 1.1 (**not traced**).

### 6.2 Drivetrain inertia (`0x55a6b0`)

    I = (gearInertia[gear] + 0.8) * (0.8 * gear * finalRatio)^2 + 1.2 * finalRatio^2 + 11

### 6.3 Gearbox (`0x553fb0`)

Gear indices: 1 reverse, 2 neutral, 3 first, up to `maxGear - 1`; `gear_ratio[]` is indexed the
same way (the stock `[0, -2.294, 0, 3.059, ...]`).

- **Automatic** (+0x11F0 set): up one gear when the RPM reaches `upshift_rpm`, the gear is
  4 or above and under `maxGear`, and the speed is above the upshift speed
  `upshift_rpm * 2pi * tireRadius / (60 * gear_ratio * finalRatio)`. Down one gear when the RPM
  is under `dnshift_rpm`, the gear is 5 or above, and the speed is under the downshift speed.
  The constructor starts every vehicle in gear 4 (second), so **the automatic never uses first
  gear**: it runs from second to top.
- **Manual**: the shift request (+0x6D8, +1 or -1) moves one gear.
- With the "skip neutral" setting (`0xcad904` = 1) and the vehicle slow (+0x780 under 3),
  reverse goes straight to first and back.
- In reverse, both brake inputs are set to 1 at the end of the gearbox step (**hypothesis**: the
  controls then drive reverse with the brake key).

### 6.4 Centre split and differentials (`0x5589a0`, `0x5587c0`)

- **Centre**: each axle's `torque_pct`. With `drive_type` 2 the split adapts: when the axles'
  wheel speeds differ, 0.1 a step moves from the faster axle to the slower one while the
  faster one still has some. (The code also tests for a slow or airborne vehicle with a speed
  threshold of 0, so that branch never applies.)
- **Axle differential**, by `slipDiffType`:
  - **0 open:** 50/50.
  - **1 load sensing:** when one tire's load exceeds the other's by 1%, the lighter tire's share
    drops by `(heavy - light) / (heavy + light)` (at least 0). A tire off the ground resets the
    axle to 50/50.
  - **2 slip sensing:** when one tire's slip (5.3) exceeds the other's by more than 5, the
    spinning tire's share drops by `difference / sum`.
- **Not traced:** `axleBias` (read at `0x568890`).

## 7. Hull contacts (`0x558f00`, `0x547f90`)

MTM2's scheme (`MTM2_PHYSICS.md` 14.12): points 1 to 16 with a stored depth of at least -0.25
(hull points 1-12 from the `.TRK` scrape points, tire contacts 13-16) are the contacts; the
1-, 2-, 3- and 4-contact solvers (`0x548900`, `0x548c00`, `0x549680`, `0x54ab90`) share the
support, and each contact gets friction. Differences found:

- **Friction limit** `N_i * 1.5 * mu * weather` (`0x667090`), against MTM2's and Evo 1's 0.5.
- Hull contacts 1-12 report crash damage (`0x5d8aa0`) unless damage is off (`0x8924a0`).
- A contact on the roof points (5 to 8) at more than 14.67 ft/s raises the rollover event
  (`IAMROLLING`).
- The solvers' geometry is **assumed** to be MTM2's: the text cannot be diffed across the two
  compilers. Confirming it means reading `0x548c00` against `0x478cd0` by hand.

## 8. Aerodynamics

### 8.1 Drag and submersion (`0x556370`, `0x556220`, `0x556f70`)

The three `refArea` faces are split between air and fluid. For each tire corner below a fluid
surface, `0x556220` gives the wetted area of a side, top and front strip from the depth; that
area times the fluid's density (the surface table's density, `0x545ac0`) is added per axis, and
removed from the `refArea` left in air (0.002377 slug/ft³). Each wetted area also contributes a
moment about the CG. Then per body axis:

    F_x = -0.5 * vx * |vx| * CY * sum(rho A)_x
    F_y = -0.5 * vy * |vy| * CL * sum(rho A)_y
    F_z = -0.5 * vz * |vz| * CD * sum(rho A)_z

so `CL` is a vertical drag coefficient, not lift.

### 8.2 Damping moments (`0x558d60`)

    q     = 0.0011885 * |v|^2, at least 26.74125 (q at 150 ft/s)
    b     = 2 * |front right tire x|
    pitch = cmq * q_rate * A_top  * b * q      (the axes' pairing **hypothesis**)
    roll  = clp * p_rate * A_side * b * q
    yaw   = cnr * r_rate * A_side * b * q

## 9. Integration

### 9.1 Force sum (`0x559220`)

`F = gravity + aero + tires (body axes) + contacts + external accumulator`, with each tire's
vertical spring force added. **The total is capped at 500,000 lbf** (`0x64b43f`). The external
accumulator is then cleared.

### 9.2 Moments (`0x557100`)

The sum of every tire's forces crossed with its arm from the CG (+0x1270), the wetted-area
moments, the aero damping and the external moment accumulator.

### 9.3 Accelerations and velocity (`0x5575d0`, `0x5577f0`)

Euler's equations with the diagonal inertia, in body axes:

    alpha_x = ((Iy - Iz) / Ix) * wy * wz + Mx / Ix      clamped to +/-13 rad/s^2
    (and the same for y and z)
    a = F / mass + (v x omega terms)

then `omega += alpha dt`, `v += a dt` (explicit Euler).

### 9.4 Position (`0x5578b0`)

- **Catch-up:** a vehicle in last place whose driver type is not 2 has its velocity multiplied
  by `1 + 0.00005 * d` for this step, d being the distance to the vehicle one place ahead
  (at most 1000 ft): +5% at most.
- **Network correction**: in a network game, the pending position correction (+0x2558) is added
  and cleared (`EVO_MULTIPLAYER.md` 4.3).
- **Rest**: speed under 0.1 ft/s, or under 0.5 ft/s with three or more contacts, zeroes the
  linear and angular velocity.
- Position += world velocity * dt (skipped when the simulation is frozen, `0x8924a0`).

### 9.5 Orientation (`0x557ec0`)

The Euler angles are integrated from the body rates. When pitch passes +/-1.05 rad the angles
are reset and the step continues from the orientation matrix (`0xcad930`), avoiding gimbal
lock. In a network game the pending angle correction (+0x2564) is added and cleared.

## 10. Evo 1 against Evo 2

`4x4LE.exe` (16 August 2001, 2,277,376 bytes, MD5 `da68ef12ed94600a7649f7c27be6cb2b`) was
decompiled the same way (`tools/re/decompile.sh evo1`). Its simulation is plain C calls where
Evo 2 uses a C++ vtable, with the same stages in the same order (`0x5077c0`). Function by
function, against the constants:

| Stage | Evo 1 | Evo 2 | Same? |
|---|---|---|---|
| Engine, torque curve, inertia | `0x5104e0` | `0x559d30` | same constants |
| Wheelspin | `0x51d620` | `0x559af0` | same |
| Differentials, centre split | `0x51d870`, `0x50f4a0` | `0x5587c0`, `0x5589a0` | same |
| Lateral force and slip table | `0x510f10`, `0x607d90` | `0x55a7a0`, `0x679930` | same table |
| Surface mu and density | `0x504850` | `0x545ac0` | same values |
| Weather grip, handbrake 0.1 | `0x504f30`, `0x607d88` | `0x52b450`, `0x667178` | same |
| Euler clamp +/-13, force cap 500,000 | `0x505c80`, `0x505590` | `0x5575d0`, `0x559220` | same |
| Catch-up, rest thresholds | `0x505f90` | `0x5578b0` | same for vehicles |
| Aero damping | `0x50af10` | `0x558d60` | same for vehicles |
| **Gravity when airborne** | 1 g always (`0x50b2c0`) | **1.75 g** with four tires off the ground | **differs** |
| **Default CG** | (0, 0.5, 0), springs computed with the CG at the origin | **(0, 0.5, 2.0)** | **differs** |
| **Rear grip while steering above 20 mph** | absent | present (3.1) | **differs** |
| **Hull friction limit** | `0.5 * N * mu * weather` (`0x607e60`) | **1.5 *** | **differs** |
| Recovery timer | a 5 s timer in the position step resets a vehicle in state 1 that is stuck or airborne | moved out of the step (**not traced** where) | differs |

**The data differ too.** Of the 109 vehicles both games ship, every one has different spring
rates, and one has a different tire CF. The totals are the same; the split is not: the Blazer
(`CBLS24`) is 958 front / 1,253 rear lb/ft in Evo 1 and 1,450 / 761 in Evo 2. Both follow the
spring formula (2) with each game's own CG: Evo 1's put 43% of the stiffness at the front, Evo 2's
66%.

What this means for the feel, as **hypothesis**: Evo 1 vehicles are softer at the front and
stiffer at the rear (more rotation, looser), float longer in the air, and slide further on their
bodies; Evo 2 vehicles are nose-heavy, fall fast, lose rear grip when flicked at speed, and stop
quickly on their sides. That matches the community's preference for Evo 1's handling. **The
original Evo 1 release (2000) is not this build**; its physics may differ again.

---

## 11. Plan for the code

Concise, in order. Each step lands with its tests; nothing goes in that the sections above do
not state.

**OpenPhotex** (`src/sim/evo/`, pure TS, reusing `sim/mtm2/world` and `sim/mtm2/collide`):

1. `rules.ts`: `EVO2_RULES` and `EVO1_RULES` as named switches: `airborneGravity` (1.75 / 1),
   `defaultCgZ` (2 / 0), `steerRearGripCut` (true / false), `hullFrictionFactor` (1.5 / 0.5).
   `simRules("evo2" | "evo1")` returns them; `"mtm2"` and `"mtm1"` are unchanged.
2. `params.ts`: `.TRK` to parameters (2), including the spring formula; a stock-archive test that
   all 271 Evo `.TRK`s map (121 Evo 1, 150 Evo 2).
3. `surface.ts`: the tread table (5.1) beside the mu table; weather grip.
4. `tire.ts`: spring and load (5.1), slip angle and the lateral table (5.2), brakes and drive
   (5.3), wheelspin; tests from the tables and formulas.
5. `driveline.ts`: engine, inertia, gearbox, centre split, differentials (6).
6. `aero.ts`: drag with submersion and the damping moments (8).
7. `body.ts`: the step order (3), gravity (4), sums, Euler integration with the clamp, rest,
   catch-up, orientation (9).
8. Contacts: the MTM2 solvers with `hullFrictionFactor`, damage hook, rollover event (7). The
   solver geometry is checked by hand against `0x548c00` first.

**OpenMTM2**:

9. `PHYSICS_MODELS` gains `evo2` ("4x4 Evolution 2") and `evo1` ("4x4 Evolution"); the
   Options list and `physics` console command pick them up.
10. `sim-worker.js`: each truck picks its model. Evo vehicles under `evo1`/`evo2` run the Evo
    model with their `.TRK`; MTM and CPR vehicles keep MTM2's vehicle on the chosen world rules.
    Under `mtm1`/`mtm2` Evo vehicles keep today's mapping.
11. Controls: brake, handbrake, manual shifting and the transfer case (2WD, 4H, 4L) as inputs;
    the gauges show real RPM and gear.
12. Garage: Springs (2) and Brake balance (3.1) as settings; Shocks is not offered (the game
    ignores it).

**Before step 7 lands:** trace `0x55e240` (crash timer), where Evo 2 moved the recovery timer,
`axleBias` (`0x568890`) and the misfire condition (`0x5ec870`). Until then the port leaves them
out and says so in the option's note.
