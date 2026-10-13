/* The Start screen follows its four switches. Demo and Manual remain visible but deferred. */
import { el } from "../dom.js";
import { frame } from "../frame.js";
import { goDemo } from "../../app/flow.js";

export default async function mount(container, context) {
  const ui = await frame(container, context, {
    title: "OpenMTM2", plainTitle: true, backdrop: "START", bar: "start", scene: "start",
    regions: { main: [24, 120, 592, 260] }, modernRegions: { main: [24, 398, 592, 40] },
  });
  if (ui.classic) {
    ui.regions.main.remove();
  } else {
    ui.regions.main.append(el("div", { class: "screen-actions menu start-actions" },
      el("button", { onclick: () => window.open("https://mtm2.com/", "_blank", "noopener") }, "Web Page"),
      el("button", { "data-menu-sound": "STARTOFF", onclick: () => goDemo(context) }, "Monster Demo"),
      el("button", { disabled: true, title: "Not implemented yet" }, "Monster Manual"),
      el("button", { class: "primary", "data-menu-sound": "STARTOFF", onclick: () => context.router.go("drivers") }, "Driver Check-in")));
    ui.regions.main.after(photoCredit());
  }
  return { unmount: ui.unmount };
}

/** The credit CC BY-SA 2.0 asks for beside the modern skin's background photo (assets/start-background.webp). */
function photoCredit() {
  const link = (href, text) => el("a", { href, target: "_blank", rel: "noopener" }, text);
  return el("p", { class: "stage-credit" },
    "Photo: ", link("https://www.flickr.com/photos/fortes/222692658/", "Untitled"),
    " by ", link("https://www.flickr.com/photos/fortes/", "Filipe Fortes"),
    ", modified, ", link("https://creativecommons.org/licenses/by-sa/2.0/", "CC BY-SA 2.0"));
}
