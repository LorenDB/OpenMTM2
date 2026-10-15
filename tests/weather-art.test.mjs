import test from "node:test";
import assert from "node:assert/strict";
import { loadWeatherArt, weatherArtSize } from "../src/worker/weather-art.js";
import { WEATHER_ART_STEMS, findWeatherArt } from "../src/install/inspect-source.js";

const picture = (source) => ({ width: 1024, height: 1024, rgba: new Uint8ClampedArray(4), source });

test("HD weather: the install's WeatherArt first, then the port's copy; off, neither", async () => {
  const install = async (stem) => (stem === "NITESKY" ? picture("install") : null);
  const bundled = async () => picture("bundled");
  assert.equal((await loadWeatherArt("nitesky", { install, bundled })).source, "install");
  assert.equal((await loadWeatherArt("DUSKSKY", { install, bundled })).source, "bundled");
  assert.equal(await loadWeatherArt("DUSKSKY", { on: false, install, bundled }), null);
});

test("HD weather art is square, a power of two, 32 to 2048", () => {
  assert.ok(weatherArtSize(2048, 2048));
  assert.ok(weatherArtSize(32, 32));
  assert.ok(!weatherArtSize(4096, 4096));
  assert.ok(!weatherArtSize(1024, 512));
  assert.ok(!weatherArtSize(1000, 1000));
});

test("the WeatherArt folder is found in any case: listed, or probed for the known skies", async () => {
  const files = new Map([["WEATHERART/NITESKY.PNG", { size: 1 }], ["WEATHERART/DUSKSKY.PNG", { size: 1 }], ["ART/OTHER.PNG", { size: 1 }]]);
  const listing = { getFile: async (p) => files.get(p.toUpperCase()) ?? null, list: async () => [...files.keys()] };
  assert.deepEqual((await findWeatherArt(listing)).map((f) => f.name).sort(), ["DUSKSKY.PNG", "NITESKY.PNG"]);
  const probing = { getFile: async (p) => files.get(p.toUpperCase()) ?? null };
  assert.deepEqual((await findWeatherArt(probing)).map((f) => f.name).sort(), ["DUSKSKY.PNG", "NITESKY.PNG"]);
  assert.deepEqual([...WEATHER_ART_STEMS], ["CCLOUDS", "CLOUDY2", "DUSKSKY", "NITESKY"]);
});
