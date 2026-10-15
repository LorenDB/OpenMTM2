/*
  Tournaments (game/events/tournament.js, hosted by app/tournament.js), as Monster Truck Madness 1
  has them: pick one, see its events, race them in order, and the points add up. Also the editor:
  a tournament of the player's own, kept with their data, opened from and saved as a `.TRN`.
  Drawn on the plain stage in both skins.
*/
import { el } from "../dom.js";
import { frame } from "../frame.js";
import { DRAG_FIELDS, MAX_EVENTS, MAX_LAPS, MAX_TOURNAMENTS, currentEvent, standings, startProblem } from "../../game/events/tournament.js";
import {
  abandonTournament, beginTournament, enterHall, listTournaments, restoreTournament, runEvent, saveOwnTournaments, tournamentFromText, tournamentText,
} from "../../app/tournament.js";
import { raceTypeName } from "../../game/menu-data.js";
import { ordinal } from "../../game/race-setup.js";

const eligible = (track) => !track.freeRoamOnly && !track.noTournament && ["circuit", "rally", "drag"].includes(track.raceType);

export default async function mount(container, context) {
  const ui = await frame(container, context, { title: "Tournament", bar: "none", regions: { main: [20, 62, 600, 404] } });
  const panel = ui.regions.main;
  panel.classList.add("drag-event", "tournament");
  const catalog = await context.assets.call("catalog");
  const tracks = catalog.tracks.filter((item) => context.settings.showHiddenTracks || !item.hidden);
  const trucks = catalog.trucks.filter((item) => !item.hidden);
  const button = (label, onclick, cls = null) => el("button", { class: cls, "data-menu-sound": "STARTOFF", onclick }, label);
  const head = el("h2", {}), body = el("div", { class: "tournament-body" }), actions = el("div", { class: "screen-actions" });
  panel.append(head, body, actions);
  const eventLine = (e) => `${e.name}: ${context.t(raceTypeName(e.raceType ?? "unsupported"))}${e.raceType === "circuit" ? `, ${e.laps} ${e.laps === 1 ? "lap" : "laps"}` : ""}${e.problem ? ` (${e.problem})` : ""}`;

  await restoreTournament(context, { tracks, trucks });
  let tournaments = await listTournaments(context, tracks);
  let picked = tournaments[0] ?? null;

  /** A tournament under way, or over: the standings by event, and what is next. */
  function showRun() {
    const { run } = context.tournament;
    const order = standings(run);
    const next = currentEvent(run);
    head.textContent = run.done ? `${run.name}: points totals` : `${run.name}: event ${run.current + 1} of ${run.events.length}, ${next.name}`;
    body.replaceChildren(
      el("table", { class: "results drag-event-table" },
        el("thead", {}, el("tr", {}, el("th", {}, "Place"), el("th", {}, "Truck (Driver)"),
          ...run.events.map((e, i) => el("th", { title: eventLine(e), class: i === run.current && !run.done ? "tournament-next" : null }, String(i + 1))), el("th", {}, "Points"))),
        el("tbody", {}, ...order.map(({ driver, points }, place) => {
          const d = run.drivers[driver];
          return el("tr", { class: d.player ? "player" : null }, el("td", {}, ordinal(place + 1)),
            el("td", {}, `${trucks.find((t) => t.file === d.truck)?.name ?? d.truck} (${d.name})`),
            ...run.events.map((e) => el("td", {}, e.points ? String(e.points[driver]) : e.skipped ? "-" : "")), el("td", {}, String(points)));
        }))),
      el("ol", { class: "tournament-events" }, ...run.events.map((e, i) => el("li", { class: i === run.current && !run.done ? "tournament-next" : null },
        `${eventLine(e)}${e.points ? " (run)" : e.skipped ? " (passed over)" : ""}`))));
    const abandon = button(run.done ? "Close" : "Abandon", async () => {
      if (!run.done && !window.confirm("Abandon the tournament?")) return;
      await abandonTournament(context);
      show();
    });
    if (run.done) enterHall(context).then((rank) => { if (rank && context.tournament?.run === run) head.textContent = `${run.name}: points totals. Hall of Fame: ${ordinal(rank)}.`; }).catch(() => {});
    actions.replaceChildren(...(run.done ? [abandon] : [
      abandon,
      button(context.dragWeekend?.tournament ? "Resume the drag event" : `Race: ${next.name}`, async () => {
        try { await runEvent(context); } catch (error) { window.alert(error.message); }
      }, "primary tournament-race"),
    ]));
  }

  /** The editor: a copy of a tournament, or a new one, put among the player's own when saved. */
  function showEditor(original) {
    const draft = { name: original?.name ?? "Untitled Tournament", description: original?.description ?? "", events: (original?.events ?? []).map((e) => ({ ...e })), stock: false, source: null };
    const name = el("input", { type: "text", value: draft.name, maxlength: 60, "aria-label": "Tournament name" });
    const description = el("textarea", { rows: 3, "aria-label": "Description" }, draft.description);
    const list = el("select", { size: 8, "aria-label": "Events" });
    const available = el("select", { size: 8, "aria-label": "Available tracks" }, ...tracks.filter(eligible).map((t) => el("option", { value: t.file }, `${t.name} (${context.t(raceTypeName(t.raceType))})`)));
    const laps = el("input", { type: "number", min: 1, max: MAX_LAPS, value: 3, class: "race-length", "aria-label": "Laps" });
    for (const field of [name, description, laps]) field.addEventListener("keydown", (event) => event.stopPropagation());
    const draw = () => {
      const at = list.selectedIndex;
      list.replaceChildren(...draft.events.map((e, i) => el("option", { value: i }, `${i + 1}. ${eventLine(e)}`)));
      list.selectedIndex = Math.min(at, draft.events.length - 1);
    };
    const add = () => {
      const track = tracks.find((t) => t.file === available.value);
      if (!track) return;
      if (draft.events.length >= MAX_EVENTS) { window.alert("The maximum number of events has already been added to this tournament."); return; }
      draft.events.push({ file: track.file, name: track.name, raceType: track.raceType, problem: null,
        laps: track.raceType === "circuit" ? Math.max(1, Math.min(MAX_LAPS, Math.trunc(Number(laps.value)) || track.defaultLaps)) : 0 });
      draw();
    };
    const move = (by) => {
      const i = list.selectedIndex, j = i + by;
      if (i < 0 || j < 0 || j >= draft.events.length) return;
      [draft.events[i], draft.events[j]] = [draft.events[j], draft.events[i]];
      draw();
      list.selectedIndex = j;
    };
    available.addEventListener("dblclick", add);
    head.textContent = original?.stock === false ? `Editing ${original.name}` : "A new tournament";
    body.replaceChildren(
      el("div", { class: "form-row" }, el("label", {}, "Name ", name)),
      el("div", { class: "form-row" }, el("label", {}, "Description ", description)),
      el("div", { class: "opponent-lists" },
        el("label", {}, "Available tracks", available),
        el("div", { class: "opponent-moves" }, el("label", {}, "Laps ", laps), button("Add >", add), button("< Remove", () => { if (list.selectedIndex >= 0) { draft.events.splice(list.selectedIndex, 1); draw(); } }),
          button("Up", () => move(-1)), button("Down", () => move(1))),
        el("label", {}, "Events", list)));
    draw();
    actions.replaceChildren(
      button("Save", async () => {
        Object.assign(draft, { name: name.value.trim() || "Untitled Tournament", description: description.value });
        draft.hasDrag = draft.events.some((e) => e.raceType === "drag");
        const others = tournaments.filter((t) => t !== original || original.stock);
        if (others.length >= MAX_TOURNAMENTS) { window.alert("Unable to create a new tournament because too many tournaments exist. Please delete an existing tournament before adding a new tournament."); return; }
        tournaments = [...others, draft];
        await saveOwnTournaments(context, tournaments);
        picked = draft;
        show();
      }, "primary"),
      button("Cancel", () => show()));
  }

  /** No tournament under way: the list, the picked one's events, and the field. */
  function showList() {
    head.textContent = "Tournaments";
    const select = el("select", { size: 6, "aria-label": "Tournaments" }, ...tournaments.map((t, i) => el("option", { value: i, selected: t === picked }, `${t.name}${t.stock ? "" : " (yours)"}`)));
    const size = el("select", { "aria-label": "Trucks" });
    const detail = el("div", { class: "tournament-detail" });
    const note = el("p", { class: "muted" });
    const start = button("Race!", async () => {
      try {
        await beginTournament(context, picked, { tracks, trucks, size: Number(size.value), difficulty: context.settings.difficulty ?? 1, weather: 0 });
        show();
      } catch (error) { note.textContent = error.message; }
    }, "primary tournament-race");
    const edit = button("Edit", () => showEditor(picked?.stock ? { ...picked, name: `${picked.name} 2` } : picked));
    const remove = button("Delete", async () => {
      if (!picked) return;
      if (picked.stock) { window.alert("This is a factory-default tournament and cannot be deleted."); return; }
      if (!window.confirm("Are you sure you wish to delete the currently selected tournament? This operation cannot be undone.")) return;
      tournaments = tournaments.filter((t) => t !== picked);
      await saveOwnTournaments(context, tournaments);
      picked = tournaments[0] ?? null;
      show();
    });
    const saveAs = button("Save as .TRN", () => {
      if (!picked) return;
      const link = el("a", { href: URL.createObjectURL(new Blob([tournamentText(picked)], { type: "text/plain" })), download: `${picked.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim() || "tournament"}.trn` });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
    const open = el("input", { type: "file", accept: ".trn,.TRN,text/plain", hidden: true });
    open.addEventListener("change", async () => {
      const file = open.files?.[0];
      if (!file) return;
      const read = tournamentFromText(new Uint8Array(await file.arrayBuffer()), tracks);
      if (!read) { window.alert(`${file.name} is not a tournament file.`); return; }
      if (tournaments.length >= MAX_TOURNAMENTS) { window.alert("Unable to create a new tournament because too many tournaments exist."); return; }
      tournaments = [...tournaments, read];
      await saveOwnTournaments(context, tournaments);
      picked = read;
      show();
    });
    const pick = () => {
      picked = tournaments[Number(select.value)] ?? null;
      const sizes = picked?.hasDrag ? DRAG_FIELDS : [1, 2, 3, 4, 5, 6, 7, 8];
      const wanted = Math.min(8, (context.settings.defaultOpponents ?? 3) + 1);
      const chosen = sizes.includes(wanted) ? wanted : sizes.reduce((best, n) => (Math.abs(n - wanted) < Math.abs(best - wanted) ? n : best), sizes[0]);
      size.replaceChildren(...sizes.map((n) => el("option", { value: n, selected: n === chosen }, `${n} ${n === 1 ? "truck" : "trucks"}`)));
      detail.replaceChildren(...(picked ? [
        el("p", {}, picked.description || "The events, listed in race order:"),
        el("ol", { class: "tournament-events" }, ...picked.events.map((e) => el("li", { class: e.problem ? "error" : null }, eventLine(e)))),
      ] : [el("p", {}, "No tournament is installed. Make one with New, or open a .TRN.")]));
      const problem = picked ? startProblem(picked, Number(size.value)) : "Pick a tournament.";
      note.textContent = problem ?? (picked.hasDrag ? "A tournament with a drag race takes 2, 4 or 8 trucks." : "");
      start.disabled = !!problem;
      // The factory tournaments stay: only the player's own can be deleted.
      remove.disabled = !picked || !!picked.stock;
    };
    select.addEventListener("change", pick);
    size.addEventListener("change", () => { const problem = startProblem(picked, Number(size.value)); note.textContent = problem ?? ""; start.disabled = !!problem; });
    body.replaceChildren(el("div", { class: "tournament-pick" }, select, detail), el("div", { class: "form-row" }, el("label", {}, "Field ", size)), note, open);
    pick();
    actions.replaceChildren(edit, button("New", () => showEditor(null)), remove, button("Open .TRN", () => open.click()), saveAs, start);
  }

  function show() {
    if (context.tournament) showRun(); else showList();
  }
  show();
  return { unmount: ui.unmount };
}
