/*
  The Drag Weekend (game/events/drag-event.js, hosted by app/drag-weekend.js): qualifying, then the bracket, each
  pairing driven, watched or simulated, then the final order. Drawn on the plain stage in both skins: the game has no
  art for it.
*/
import { el } from "../dom.js";
import { frame } from "../frame.js";
import { canSimulate, chooseLane, currentPairing, finalOrder, roundName, simulateOthers, simulatePairing, winOdds } from "../../game/events/drag-event.js";
import { LEFT, RIGHT, runPass, takePass } from "../../app/drag-weekend.js";
import { abandonTournament, takeDragWeekend } from "../../app/tournament.js";

const seconds = (value) => (value === null || value === undefined ? "" : value.toFixed(2));
const LANES = ["left", "right"];

export default async function mount(container, context, { pass = null } = {}) {
  const weekend = context.dragWeekend;
  const ui = await frame(container, context, { title: "Drag Weekend", bar: "none", regions: { main: [20, 62, 600, 404] } });
  const panel = ui.regions.main;
  if (!weekend) {
    // A weekend lives for the session: after a reload there is none to show.
    panel.append(el("p", {}, "No drag weekend is in progress. Start one from the Races screen, on a drag strip."));
    return { unmount: ui.unmount };
  }
  const { event } = weekend;
  takePass(weekend, pass);
  panel.classList.add("drag-event");
  const name = (driver) => (driver === null ? "" : event.drivers[driver].name);
  const leaveForRaces = () => context.router.go("race-select", { mode: "drag" }, { replace: true });
  const button = (label, onclick, cls = null) => el("button", { class: cls, "data-menu-sound": "STARTOFF", onclick }, label);
  const cancel = button("Cancel", () => {
    if (!window.confirm("Abandon the drag weekend?")) return;
    // Abandoning a tournament's drag event abandons the tournament.
    if (weekend.tournament) abandonTournament(context);
    context.dragWeekend = null;
    leaveForRaces();
  });

  /** What the last pass, simulation or bye came to. */
  const lastNote = () => {
    const last = event.last;
    if (!last) return event.phase === "bracket" ? `Qualifying is over. The baseline is ${seconds(event.baseline)} s.` : "";
    const round = roundName(event, last.round);
    const again = { "dead heat": "a dead heat", "double dq": "both trucks were disqualified", "rerun": "a disqualified truck hit the other", "no result": "neither truck set a time" }[last.outcome];
    if (again) return `${round}: ${again}. The pairing is run again.`;
    const w = last.winner, loser = last.drivers[1 - w];
    const how = last.dq[1 - w] ? `${name(loser)} was disqualified` : last.times[1 - w] === null ? `${name(loser)} set no time` : `${seconds(last.times[w])} to ${seconds(last.times[1 - w])}`;
    return `${round}: ${name(last.drivers[w])} beat ${name(loser)}${last.how === "simulated" ? " (simulated)" : ""}, ${how}.`;
  };

  /** The drivers in their order: seed, qualifying time, best pass, and where they stand. */
  const table = () => {
    const truckName = (file) => weekend.trucks.find((t) => t.file === file)?.name ?? file;
    const standing = (i) => (i === event.winner ? "Winner" : event.drivers[i].out !== null ? `Out: ${roundName(event, event.drivers[i].out)}` : "");
    return el("table", { class: "results drag-event-table" },
      el("thead", {}, el("tr", {}, ...["", "Driver", "Truck", "Seed", "Qualify", "Best", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, ...finalOrder(event).map((i, k) => {
        const d = event.drivers[i];
        return el("tr", { class: d.player ? "player" : null },
          ...[String(k + 1), d.name, truckName(d.truck), String(d.seed), d.qualify === null ? "no time" : seconds(d.qualify), seconds(d.best), standing(i)]
            .map((cell) => el("td", {}, cell)));
      })));
  };

  /** The bracket: a column a round, each pairing its two drivers with their seeds and times. */
  const bracket = () => {
    const now = currentPairing(event);
    const line = (entry, slot) => {
      const driver = entry.drivers[slot];
      const time = entry.how === "bye" ? "" : entry.dq[slot] ? "DQ" : seconds(entry.times[slot]);
      return el("div", { class: `drag-pair-line${entry.over && entry.winner === slot ? " won" : ""}${driver !== null && event.drivers[driver].player ? " player" : ""}` },
        el("span", {}, driver === null ? (entry.how === "bye" ? "bye" : "") : `${event.drivers[driver].seed}. ${name(driver)}`), el("span", {}, time));
    };
    const columns = event.bracket.map((entries, r) => el("div", { class: "drag-round" },
      el("h2", {}, roundName(event, r)),
      ...entries.map((entry, p) => el("div", { class: `drag-pair${now && now.round === r && now.pair === p ? " current" : ""}` }, line(entry, 0), line(entry, 1)))));
    return el("div", { class: "drag-bracket" }, ...columns);
  };

  const head = el("p", { class: "drag-event-head" });
  const note = el("p", { class: "drag-event-note" });
  const body = el("div", { class: "drag-event-body" });
  const actions = el("div", { class: "screen-actions drag-event-actions" });
  panel.append(head, note, body, actions);

  const show = () => {
    note.textContent = lastNote();
    if (event.phase === "qualifying") {
      head.textContent = `${event.strip.name}: qualifying, ${event.drivers.length} drivers`;
      body.replaceChildren(
        el("p", {}, "Run one pass alone, in the lane you like. Your elapsed time is your qualifying time, and the order is the seeding for the bracket."),
        el("p", { class: "muted" }, "A computer truck runs beside you: its time is the weekend's baseline, which the computer drivers' own times come from."));
      actions.replaceChildren(button("Qualify: left lane", () => runPass(context, LEFT), "primary"), button("Qualify: right lane", () => runPass(context, RIGHT), "primary"), cancel);
      return;
    }
    body.replaceChildren(table(), bracket());
    if (event.phase === "done") {
      head.textContent = `${event.strip.name}: ${name(event.winner)} wins the drag weekend`;
      // A tournament's drag event (app/tournament.js): its points go to the tournament, which shows what is next.
      actions.replaceChildren(weekend.tournament
        ? button("Continue tournament", async () => { await takeDragWeekend(context); context.router.go("tournament", {}, { replace: true }); }, "primary")
        : button("Continue", () => { context.dragWeekend = null; leaveForRaces(); }, "primary"));
      return;
    }
    const pairing = currentPairing(event);
    const [a, b] = pairing.drivers;
    const odds = winOdds(event);
    const lanes = pairing.lanes ? `, ${name(a)} in the ${LANES[pairing.lanes[0]]} lane` : "";
    head.textContent = `${event.strip.name}: ${roundName(event, pairing.round)}, ${name(a)} against ${name(b)}${lanes}`
      + (odds === null ? "" : ` (${Math.round(odds * 100)}% to ${Math.round((1 - odds) * 100)}%)`);
    const race = (lane) => () => { if (lane !== undefined) chooseLane(event, lane); runPass(context); };
    // The better seed picks the lane: a player who has the choice makes it here.
    const drive = pairing.lanes
      ? [button(pairing.hasPlayer ? `Race (${LANES[pairing.lanes[pairing.drivers.findIndex((i) => event.drivers[i].player)]]} lane)` : "Watch", race(), "primary")]
      : [button("Race: left lane", race(LEFT), "primary"), button("Race: right lane", race(RIGHT), "primary")];
    actions.replaceChildren(...[
      ...drive,
      canSimulate(event) ? button("Simulate", () => { simulatePairing(event); show(); }) : null,
      button("Run all others", () => { simulateOthers(event); show(); }),
      cancel,
    ].filter(Boolean));
  };
  show();
  return { unmount: ui.unmount };
}
