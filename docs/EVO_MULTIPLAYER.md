# 4x4 Evolution 1 and 2: multiplayer

A reverse-engineering survey of the network code of `4x42.exe` (Evo 2, 25 September 2001) and
`4x4LE.exe` (Evo 1, 16 August 2001), written for a future OpenMTM2 networking stack. OpenMTM2
has none today; this records what the games did, what still works, and what to copy.

Every fact carries an address in the Evo 2 build unless marked Evo 1. Facts not confirmed in
code are marked **hypothesis**. No decompiled code is reproduced.

The short answers:

- **Client/server sessions over UDP, with peer-to-peer vehicle updates.** A host runs the
  lobby, the race rules and the results; every machine simulates its own vehicles and sends their
  state to every other machine about **4 times a second**. A remote vehicle is simulated locally
  from the sender's pedals, steering and gear, its velocity is reset on each update, and its
  position error is blended away over **0.5 s** (snapped beyond 100 ft).
- Finding games went through a **master server** file on `4x4evolution.com`, a **GameSpy**
  account and buddy system, and an **IRC chat server** used as the lobby. All three are gone.
  Direct IP and LAN play need none of them.
- Up to **15 players**, several per machine, plus computer bots, late joining, teams, passwords,
  content checks with track downloads, and the race types Circuit, Rally, Bomb Tag and Mission.
- **The Evo 1 build analysed here has the same network code as Evo 2**: the same protocol
  version (19), packet layout, send rate, smoothing and snap distance. The handling differences
  between the games (`EVO2_PHYSICS.md` 10) change how remote vehicles behave between updates;
  the original 2000 release of Evo 1 was not available.

---

## 1. Method and builds

| | Evo 2 | Evo 1 |
|---|---|---|
| File | `4x42.exe`, MD5 `d476380ab257486896ba1a6593c70e87` | `4x4LE.exe`, MD5 `da68ef12ed94600a7649f7c27be6cb2b` |
| Built | 25 September 2001 | 16 August 2001 |
| Network module | `..\core\netgame.cpp` (`CNetGame`), `..\core\netirc.cpp`, `..\support\trisock.cpp`, `..\gamespy\*` | the same modules |
| Winsock | `WSOCK32.dll`: UDP (`sendto`, `recvfrom`) for the game, TCP (`connect`, `send`, `recv`) for IRC, GameSpy and HTTP | the same imports |

Workspaces: `tools/re/decompile.sh evo2` and `tools/re/decompile.sh evo1`.
`FDIFF=evo1:evo2 tools/re/fdiff.py` diffs a pair of functions.

## 2. Finding a game

### 2.1 The master server (`0x4e0e50`, `0x4e0f50`)

At start the game fetches `<host>.4x4evolution.com/evo2-backend.txt` (Evo 1:
`%s-backend.txt`), trying `master`, `master2` ... `master5` in turn. The file lists the IRC chat
server (`host:port`), the `trackQueryUrl`, and the GameSpy connection and search managers
(defaults `gpcm.gamespy.com`, `gpsp.gamespy.com`). **The domain and GameSpy are gone**, so the
Internet lobby no longer starts; the game offers "Continue anyway" without a chat server (Evo 1
`0x49f160`).

### 2.2 GameSpy (`..\gamespy\gp\*`)

Accounts (e-mail, nickname, password), profiles, a buddy list with status ("Offline", "Online",
"Playing"), instant messages and buddy authorisation (`gpiPeer.c`). It is identity and presence
only: no game traffic goes through it.

### 2.3 The IRC lobby (`netirc.cpp`, `0x4d8b40`)

The lobby is an ordinary IRC server: rooms are channels (topic, password, bans, "full"),
operators can kick and set passwords, and a raw IRC command can be typed (Evo 1 `0x4b0980`).
A hosted game is announced in the room; **joining sends `PRIVMSG <host> :^KNOCK`**
(`0x4e1430`), and the host answers through the game protocol. The client learns its public
address from the server's `USRIP` reply. Everything is logged to `irc.log` when enabled.

### 2.4 Direct IP, LAN, modem

- **Direct IP**: "Enter IP address to join: xxx.xxx.xxx.xxx:port" (`0x4ba3f0`). This works today
  without any server.
- **LAN**: a LAN game uses `lanPortNumber`, default **7647**.
- **Internet** games bind a port in `inetPortRangeLo`..`inetPortRangeHi`, default
  **6000-9999** (read with the other settings in section 7).
- **Modem**: dial-up through RAS ("Unable to dial modem", "Lost modem connection with ISP",
  `0x4de190`).

## 3. The session

### 3.1 Roles and limits

`CNetGame` mode: 0 none, 1 server, 2 client. The server holds up to **15 connections** and **15
players** (`0x4e81f0`, `0x4e8120`); a connection can carry several local players (split screen
on one machine). Only the server adds **bots** ("Add AI Bot", only in the lobby, `0x4e7fa0`),
and a bot is kicked to make room for a human.

### 3.2 Joining (`0x4e3a60`, packet 0x02)

The server refuses a join when the **protocol version is not 19** (0x13, in both games), when
it is not a server, when the game is under way and late joining is off (`allowLateJoin`,
default on), when the password is wrong, or when it is full. An accepted player gets the game
settings; a late joiner gets them through a separate "late game settings" packet
(`0x4e9da0`).

### 3.3 Lobby state

- **Game settings** (server to clients, acknowledged, resent after `2 * ping`, kept between 0.2
  and 5 s, `0x4eb810`): track, race type, laps, weather, allowed vehicle classes
  (`allowedVehicleClasses`), teams.
- **My state** (client to server, `0x4eb1d0`): ready, name, vehicle, colour, tires, suspension
  and axle ratio settings.
- **Teams**: on or off, server-controlled or chosen by players, random teams (`0x4edc20`).
- **Garage sync** (packets 0x30, 0x32): before the race the server requests and distributes
  every player's full garage (parts and setup), with acknowledgements, so that every machine
  simulates every vehicle with the same parts.
- **Content checks** (`0x4b5ca0`): every player must have the track and vehicle files, and the
  same copy ("Copy of %s is different than yours"). A missing track can be **downloaded from
  the host** (packets 0x24-0x27, 0x2E; "rx track download request", limited concurrent
  transfers, `0x4efda0`).
- `parts.txt` is checked too, so parts modifiers agree.

### 3.4 Launch and sync codes (`0x4e3410`, packets 0x0A, 0x0B)

The server moves everyone through numbered **sync points**: it sends a sync request with a
code; each client acknowledges with its own sync point; "All connections synced to code %d"
moves to the next phase (loading, grid order, start). A client with an invalid sync point is
disconnected. The grid order is computed by the server (`0x4ee140`). The **GO packet** (0x0E)
starts the race; a client that has not started when it arrives starts then.

## 4. During the race

### 4.1 The vehicle state packet (type 0x0F, `0x4eb550`)

For each local vehicle, to **every other connection** (clients included: the handler has no
relay path, so updates go peer to peer), at most every **0.25 s**, with the next send time moved
by a random jitter (`rand() & 0x3fff` around the interval). 52 bytes:

| Field | Encoding |
|---|---|
| player index | byte |
| position x, y, z | float |
| world velocity x, y, z | float |
| orientation: 3 angles | bytes, 1/256 turn (pi/128) |
| throttle, brake | bytes, value / 255 |
| steering | byte, pi/128 a step |
| gear | byte |
| sequence number | int, per player, incremented each send |
| flags | 4 bits light state (+1), 4 bits a second state (**not traced**) |
| mission value | float, only in Mission games (+0x1190) |

### 4.2 Receiving (`0x4e3a60` case 0x0F)

- An update older than the last one from that player (sequence number) is dropped.
- The remote vehicle's **velocity is replaced**, and its **throttle, brake (both axles),
  steering and gear** are set from the packet. **It is then simulated locally** with the full
  vehicle model until the next update.
- If the received position is within **100 ft** (squared distance 10,000) of the local copy,
  the target position and the three angles are stored for smoothing (4.3). Otherwise the
  position and orientation **snap** to the received ones.

### 4.3 Smoothing (`0x4eb810`, applied in `0x5578b0` and `0x557ec0`)

For a stored correction, the position error and the three angle errors are spread linearly over
**0.5 s**: each frame adds `error * frameTime / 0.5` to the vehicle's pending corrections
(position +0x2558, angles +0x2564), which the physics step adds to the body and clears
(`EVO2_PHYSICS.md` 9.4, 9.5). Corrections only run while a network game is active (`0x678324`).

### 4.4 Race state

The server is the authority for the race:

- **Checkpoints**: a client reports each checkpoint its local players pass (packet 0x1A),
  resending every 1 s until acknowledged (`0x4ecc10`).
- **Race progress**: the server sends every player's progress and finish state to all
  (0x1B), at least every 20 s and whenever it changes; clients acknowledge (0x1E).
- **Scores** (0x16-0x18): at the end the server requests each client's scores (laps, race time
  per local player) and sends the results (`0x4ec980`). "All trucks finished - ending game in 5
  seconds."
- **Keepalive**: a client outside the race sends a small packet (0x0C) every 1.5 s; pings are
  measured per connection (`updatePing`).
- **Kick, terminate, disconnect** (0x0D and others): with reasons ("You have been kicked", "The
  server has terminated the game", "network error").

### 4.5 Bomb Tag (`0x50afa0`, `0x4ed3a0`, packet 0x1D)

Race type "bombtag". The server gives the bomb to a random connected player other than the
current holder and runs a fuse (in 1/65536 s units). While it runs, every player's score changes
each second: **the holder +50 (+400 while more than 35 s of fuse remain), everyone else -10**
(**hypothesis**: the score is a penalty, lowest wins). At zero the bomb "blows" on the holder
(`blowTheBomb`) and is passed again. How a holder passes the bomb to another player is **not
traced** (likely contact).

"King of the Hill" is listed as a race type name but has no internal code name in either game:
it was cut.

### 4.6 Traffic

- Datagrams carry a 4-byte header; a payload over 541 bytes goes as a **big packet** in pieces
  (type 0x29 reassembles them), so datagrams stay under a 576-byte MTU. Large lobby data
  (garages, settings) is compressed (`codec.cpp`, an LZW coder).
- The network statistics screen counts packets, bytes and UDP header overhead (`0x4ed6e0`).
- **Estimate**: one vehicle update is about 56 bytes of payload plus 28 of UDP/IP, four times a
  second to each peer: about 340 B/s per peer. Eight players means seven peers, about 2.4 KB/s
  up per player, within a 33.6 kbit/s modem uplink. The 4 Hz rate fits that.
- `networkReliability` (percent, default 100) **drops that share of outgoing packets at
  random**: a built-in packet-loss simulator for testing.

## 5. Packet types (`0x4e3a60`)

| Type | Meaning |
|---|---|
| 0x02 | join request (protocol check, password, late join) |
| 0x03, 0x04 | join accept, join refuse **hypothesis** |
| 0x0A, 0x0B | sync request, sync reply |
| 0x0C | keepalive |
| 0x0D | disconnect or kick |
| 0x0E | GO (race start) |
| 0x0F | vehicle state (4.1) |
| 0x12 | game event to the mission or script layer (`0x519ac0`) **hypothesis** |
| 0x16, 0x17, 0x18 | score request, client score reply, race results |
| 0x1A | checkpoint |
| 0x1B, 0x1E | race progress, race progress acknowledgement |
| 0x1D | Bomb Tag: pass or blow |
| 0x24-0x27, 0x2E | track download (request, data, acknowledgements) |
| 0x28 | late game settings |
| 0x29 | big packet piece |
| 0x2A-0x2C, 0x31, 0x33 | compressed lobby data (settings, garages) **hypothesis** |
| 0x30, 0x32 | player garage data, garage request |
| 0x01, 0x05-0x09, 0x13-0x15, 0x19, 0x1C, 0x1F-0x23, 0x2D, 0x2F | present, **not named** |

## 6. Evo 1 against Evo 2

| | Evo 1 (`4x4LE.exe`) | Evo 2 |
|---|---|---|
| Protocol version | 19 | 19 |
| Vehicle packet | type 0x0F, 52 bytes, at most every 0.25 s (`0x4cfe50`, `0x5da047`) | the same |
| Byte scales | 1/255, pi/128 (`0x5d9233`, `0x5d9237`) | the same |
| Snap distance | 100 ft (`0x5d923b`) | the same |
| Smoothing | 0.5 s | the same |
| Lobby, GameSpy, IRC, master server | present | present, plus a `testIrc` setting |
| Bots, teams, late join, Bomb Tag, track download, garage sync | present | present |
| Missions | a few | many (the Evo 2 mission mode) |

**The network code is the same.** The two games list separate master files (`%s-backend.txt`),
and the content checks would refuse each other's tracks and vehicles, so they never met online
in practice even with one protocol number (**hypothesis**).

The preference for Evo 1 online that people remember is not explained by the network code of
this build. Two things could explain it, both **hypothesis**:

- **The handling** (`EVO2_PHYSICS.md` 10). A remote vehicle runs the local model for 0.25 s on
  stale pedals and steering, so the further it drifts from the sender's copy, the larger the
  corrections. Evo 2's 1.75 g fall and its rear-grip cut under hard steering at speed make a
  vehicle's path more sensitive to a late input than Evo 1's.
- **The original release.** Evo 1 shipped in 2000 (build 44, which the 4x4e project notes is
  incompatible with later builds). Its network code was not available for this analysis; it may
  have differed, and the 2001 build may already be the shared Evo 2 code.

## 7. Settings (`0x4e0940`)

| Key | Default | Meaning |
|---|---|---|
| `networkReliability` | 100 | percent of outgoing packets kept (4.6) |
| `enableLog` | | network and IRC logs |
| `postEnterLeaveMessages`, `chatClientListFormat` | | lobby chat |
| `allowedVehicleClasses` | | classes a host allows |
| `allowLateJoin` | 1 | |
| `showTestServers` | | list test servers from the master file |
| `lanPortNumber` | 7647 | LAN port (1024-65535) |
| `inetPortRangeLo`, `inetPortRangeHi` | 6000, 9999 | Internet port range |

## 8. For OpenMTM2

What to keep from the games, and what to change for a browser:

- **Keep the model.** Each machine owns its own trucks; the host owns the race (checkpoints,
  progress, results) and the lobby. Remote trucks are simulated locally from received inputs and
  velocity, with error blending and a snap distance. It suits a browser game: no lockstep, no
  rollback, tolerant of loss.
- **Raise the rate.** 4 Hz was for modems. 15-20 Hz of the same 52-byte state is about 1 KB/s
  per peer and makes the corrections small. Keep the sequence numbers and the random jitter.
- **Fixed step.** Evo integrated at the frame rate, so two machines never ran the same steps.
  OpenMTM2's simulation should run at a fixed rate in the worker for networked sessions; the
  corrections then only absorb latency, not integration differences.
- **Transport.** Browsers have no raw UDP: use **WebRTC data channels**, unreliable and
  unordered for vehicle state, reliable and ordered for lobby, race state and chat. Signalling
  needs a small WebSocket service (or a manual copy and paste of offers for LAN parties).
  The IRC lobby's role (rooms, knocks, chat) maps onto that signalling service.
- **Content checks** by file hash, as the games did by copy; offer the host's addon packs (the
  ZIP packs OpenMTM2 already reads) instead of raw track downloads.
- **Interoperating with the original games** is possible in principle (protocol 19 over UDP is
  documented above) but needs a native or Node bridge, since browsers cannot send UDP. Not
  recommended until the unnamed packet types are traced.

**A concise plan when networking starts:**

1. Fixed-step simulation in `sim-worker.js` for networked sessions (MTM2 and Evo models alike).
2. `src/net/`: a transport interface with a WebRTC implementation and a loopback one for tests.
3. Session protocol, modelled on section 3: join (version, password, late join), lobby state,
   garage sync, content hashes, sync points, GO.
4. Vehicle state at 15-20 Hz with sequence numbers; remote trucks driven by received inputs and
   velocity; blending over 0.5 s, snap at 100 ft (section 4).
5. Host-authoritative race state: checkpoints with resend until acknowledged, progress, results.
6. A packet-loss and latency simulator from the start (the games' `networkReliability`).
7. Later: bots on the host, teams, Bomb Tag (once its pass rule is traced), split screen.
