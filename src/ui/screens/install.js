/*
  First run: pick the MTM2 folder, check it, copy its archives into the browser.

  Where the page's own server also serves the player's game folder (tools/serve.mjs --game), the
  screen offers to install from there: a headset's browser has no folder of the player's PC to
  pick (docs/VR.md, "Running it on a headset").
*/
import { el } from "../dom.js";
import { pickInstallFolder } from "../../install/picker.js";
import { inspectSource } from "../../install/inspect-source.js";
import { requiredPodsMessage } from "../../install/required-pods.js";
import { hasServedGame, installEntry, mayServeGame, urlSource } from "../../install/url-source.js";
import { loadStrings } from "../../app/strings-store.js";
import { primeMenuAudio, startMenuAudio } from "../../app/menu-audio.js";

const MB = 1024 * 1024;

export default function mount(container, context, { requiredMissing = [] } = {}) {
  const status = el("p", { class: "muted" },
    "OpenMTM2 reads the tracks, trucks, art and sounds from your own Monster Truck Madness 2 "
    + "install. Pick the folder it is installed in (the one holding POD.INI). "
    + "Its archives are copied once into this browser's private storage; nothing is uploaded.");
  const detail = el("div");
  const pickButton = el("button", { class: "primary", onclick: () => install(pickInstallFolder) }, "Choose game folder");
  // The game folder beside the app, when this server has one.
  const served = new URL("game/", document.baseURI).href;
  const servedButton = el("button", { class: "primary", hidden: true, onclick: () => install(() => urlSource(served)) }, "Install from this server");
  const actions = el("div", { class: "screen-actions" }, servedButton, pickButton);
  (mayServeGame(location.hostname) ? hasServedGame(served) : Promise.resolve(false)).then((yes) => {
    if (!yes) return;
    servedButton.hidden = false;
    pickButton.classList.remove("primary");
    if (!busy) show("This server offers a Monster Truck Madness 2 folder. Install from it, or pick a folder on this device. "
      + "The archives are copied once into this browser's private storage.");
  });

  container.append(
    el("section", { class: "screen" },
      el("h1", { class: "screen-title" }, "Install"),
      el("div", { class: "screen-panel" }, status, detail, actions),
    ),
  );

  let busy = false;
  // The stored install lacks archives OpenMTM2 needs (app/main.js): it is to be picked again.
  if (requiredMissing.length) show(requiredPodsMessage(requiredMissing), "error");

  /** Install from the source `open` gives: the picked folder, or the served one. */
  async function install(open) {
    if (busy) return;
    primeMenuAudio(context);
    busy = true;
    pickButton.disabled = servedButton.disabled = true;
    try {
      const source = await open();
      if (!source) return;
      show(`Checking ${source.name || "the folder"}…`);
      const result = await inspectSource(source);
      if (!result.files?.length || (!result.ok && !result.missing?.length)) {
        show(result.message, "error");
        return;
      }
      await confirmAndCopy(result);
    } catch (err) {
      show(`Could not read the folder: ${err.message}`, "error");
    } finally {
      busy = false;
      pickButton.disabled = servedButton.disabled = false;
    }
  }

  async function confirmAndCopy(result) {
    const needed = result.totalBytes;
    const estimate = await navigator.storage.estimate?.().catch(() => null);
    const free = estimate ? estimate.quota - estimate.usage : Infinity;
    detail.replaceChildren(
      el("p", { class: result.ok ? "" : "error" }, result.message),
      el("p", { class: "muted" },
        `${result.files.length} archives, ${(needed / MB).toFixed(0)} MB to copy.`),
    );
    if (free < needed * 1.1) {
      show(`The browser offers ${(free / MB).toFixed(0)} MB of storage, not enough for the game's `
        + `${(needed / MB).toFixed(0)} MB.`, "error");
      return;
    }
    await navigator.storage.persist?.().catch(() => false);

    const bar = el("span");
    const label = el("p", { class: "muted" }, "Copying…");
    detail.append(el("div", { class: "progress" }, bar), label);
    const off = context.assets.on("install-progress", ({ copied, total, name }) => {
      bar.style.width = `${((copied / total) * 100).toFixed(1)}%`;
      label.textContent = `Copying ${name}: ${(copied / MB).toFixed(0)} of ${(total / MB).toFixed(0)} MB`;
    });
    try {
      await context.assets.call("install", {
        // A served archive goes to the worker as its address: the worker downloads it.
        files: result.files.map(({ name, file }) => ({ name, file: installEntry(file) })),
        podIni: result.podIni,
        exeVersion: result.exeVersion ?? null,
        // Community Patch 3's loose WeatherArt folder (worker/weather-art.js).
        weatherArt: (result.weatherArt ?? []).map(({ name, file }) => ({ name, file: installEntry(file) })),
      });
      context.exeVersion = result.exeVersion ?? null;
    } finally {
      off();
    }
    await loadStrings(context);
    startMenuAudio(context);
    await context.router.go("start", {}, { replace: true });
    // With the game in, a copy of the app is all a start without the server needs.
    context.offlineNote?.check();
  }

  function show(message, kind = "muted") {
    status.className = kind;
    status.textContent = message;
  }
}
