// When each boot sound fires, in ms from the moment the boot animation
// starts (same clock as the CSS letter animations and the canvas meteor -
// see FX in components/bootFx.js). The reveal sound isn't listed here: it
// plays when the explosion starts fading (which also waits for the data).
export const BOOT_SOUNDS = [
  { t: 0, name: "bootFall" },
  // Letters land at ~1000ms + 110ms per letter.
  { t: 1000, name: "bootThunk", options: { index: 0 } },
  { t: 1110, name: "bootThunk", options: { index: 1 } },
  { t: 1220, name: "bootThunk", options: { index: 2 } },
  { t: 1330, name: "bootThunk", options: { index: 3 } },
  { t: 1300, name: "bootShimmer" },
  { t: 2050, name: "bootMeteor", options: { duration: 0.9 } },
  { t: 2950, name: "bootImpact" },
].sort((a, b) => a.t - b.t);
