import { useEffect, useMemo, useRef } from "react";
import { play } from "../audio/engine.js";

/**
 * Thin wrapper around window.Telegram.WebApp.
 *
 * Why not call the @tma.js/sdk-react hooks directly here? That package's
 * API reshuffles fairly often between major versions. The `telegram-web-app.js`
 * script tag in index.html is the one surface Telegram guarantees stays
 * stable, so runtime calls (haptics, theme, the user object) go through it
 * directly, while main.jsx still does the official SDK init(). When we
 * revisit this together we can migrate individual calls to `useSignal` /
 * `hapticFeedback` / `mainButton` from @tma.js/sdk-react one at a time.
 *
 * `accentColor` is the id from SettingsSheet's color drawer ("red" default,
 * "blue", "yellow", "green", "blackgold") - kept in sync here so Telegram's
 * OWN chrome (header bar, and the blank backdrop shown for an instant
 * before our CSS paints) matches whichever one the player picked, instead
 * of always being the old hardcoded red.
 */
const ACCENT_INK = {
  red: "#170707",
  blue: "#060f1c",
  yellow: "#1c1608",
  green: "#071a0f",
  blackgold: "#050505",
};

export function useTelegram(accentColor = "red", backButton) {
  const webApp = useMemo(() => (typeof window !== "undefined" ? window.Telegram?.WebApp : undefined), []);

  useEffect(() => {
    if (!webApp) return;
    webApp.ready();
    webApp.expand();

    // expand() only maximizes the WebView to Telegram's normal "tall but
    // still inset" size - there's still a visible margin/rounded window
    // above and below it (Telegram's own chrome peeking through), which
    // is what made the Ride game's fullscreen canvas look cut off no
    // matter what our own CSS did. requestFullscreen() (Bot API 8.0+)
    // asks for the real edge-to-edge size instead. Older clients just
    // don't have the method - no-op, falls back to expand()'s sizing.
    try {
      webApp.requestFullscreen?.();
    } catch {
      /* unsupported client version - ignore */
    }

    // Without this, Telegram intercepts vertical swipes inside the Mini
    // App for its own gestures (minimize/close) instead of letting them
    // scroll our content - on a long list (Leaderboard, a big
    // constellation, ...) that shows up as "scrolling doesn't work" even
    // though the CSS/overflow setup underneath is completely fine.
    // Bot API 7.7+; older clients just don't have the method.
    try {
      webApp.disableVerticalSwipes?.();
    } catch {
      /* unsupported client version - ignore */
    }
  }, [webApp]);

  useEffect(() => {
    if (!webApp) return;
    const hex = ACCENT_INK[accentColor] || ACCENT_INK.red;
    try {
      webApp.setHeaderColor(hex);
      webApp.setBackgroundColor(hex);
    } catch {
      /* unsupported client version - ignore */
    }
  }, [webApp, accentColor]);

  // CSS `100dvh` tracks the OS browser's own address-bar collapse, but
  // Telegram Mini Apps run inside Telegram's own webview, which resizes
  // the visible area on ITS terms (keyboard, Telegram's UI chrome,
  // fullscreen toggles) - that doesn't always line up with a real
  // browser resize/dvh recompute, especially on Android. Telegram exposes
  // the real number via webApp.viewportStableHeight, kept live through
  // the 'viewportChanged' event - mirror it into a --tg-vh CSS var so
  // anything that needs the TRUE visible height can use
  // var(--tg-vh, 100dvh) instead of relying on dvh alone. Also nudge a
  // plain window resize so anything (like the game canvas) that only
  // listens for that event still picks it up.
  useEffect(() => {
    function applyViewportHeight() {
      const height = webApp?.viewportStableHeight || webApp?.viewportHeight || window.innerHeight;
      document.documentElement.style.setProperty("--tg-vh", `${height}px`);
      window.dispatchEvent(new Event("resize"));
    }

    applyViewportHeight();

    if (webApp?.onEvent) {
      webApp.onEvent("viewportChanged", applyViewportHeight);
      return () => webApp.offEvent?.("viewportChanged", applyViewportHeight);
    }

    // Not running inside Telegram (e.g. local dev in a regular browser) -
    // window resize is the closest equivalent.
    window.addEventListener("resize", applyViewportHeight);
    return () => window.removeEventListener("resize", applyViewportHeight);
  }, [webApp]);

  // In fullscreen mode there's no more native Telegram header bar - the
  // close (✕) / menu controls float directly on top of our own content
  // instead, and the device's own notch/status bar is now inside our
  // canvas too. safeAreaInset = the device's hardware safe area (notch,
  // home indicator - env(safe-area-inset-*) already covers most of this,
  // but not every client fills that in reliably inside a WebView).
  // contentSafeAreaInset = the EXTRA space Telegram itself wants reserved
  // so its floating controls don't sit on top of our UI. Mirror both into
  // CSS vars; index.css adds them on top of env(safe-area-inset-*).
  useEffect(() => {
    function applyInsets() {
      const safe = webApp?.safeAreaInset || {};
      const content = webApp?.contentSafeAreaInset || {};
      const root = document.documentElement.style;
      root.setProperty("--tg-safe-top", `${safe.top || 0}px`);
      root.setProperty("--tg-safe-bottom", `${safe.bottom || 0}px`);
      root.setProperty("--tg-safe-left", `${safe.left || 0}px`);
      root.setProperty("--tg-safe-right", `${safe.right || 0}px`);
      root.setProperty("--tg-content-safe-top", `${content.top || 0}px`);
      root.setProperty("--tg-content-safe-bottom", `${content.bottom || 0}px`);
      root.setProperty("--tg-content-safe-left", `${content.left || 0}px`);
      root.setProperty("--tg-content-safe-right", `${content.right || 0}px`);
    }

    applyInsets();

    if (webApp?.onEvent) {
      webApp.onEvent("safeAreaChanged", applyInsets);
      webApp.onEvent("contentSafeAreaChanged", applyInsets);
      webApp.onEvent("fullscreenChanged", applyInsets);
      return () => {
        webApp.offEvent?.("safeAreaChanged", applyInsets);
        webApp.offEvent?.("contentSafeAreaChanged", applyInsets);
        webApp.offEvent?.("fullscreenChanged", applyInsets);
      };
    }
  }, [webApp]);

  // Telegram's hardware/gesture back button closes the whole Mini App
  // UNLESS the app is showing Telegram's own BackButton widget (with a
  // click handler attached) - then that back press fires here instead.
  // `backButton` is `{ visible, onBack }` from App.jsx, recomputed every
  // render from whatever's "on top" right now (an open sheet, a chat
  // conversation, a non-Home tab) so this always reflects the current
  // screen instead of the one that was active when the effect first ran.
  const onBackRef = useRef(backButton?.onBack);
  onBackRef.current = backButton?.onBack;

  useEffect(() => {
    const backButtonApi = webApp?.BackButton;
    if (!backButtonApi) return;

    function handleClick() {
      onBackRef.current?.();
    }
    backButtonApi.onClick(handleClick);
    return () => backButtonApi.offClick?.(handleClick);
  }, [webApp]);

  useEffect(() => {
    const backButtonApi = webApp?.BackButton;
    if (!backButtonApi) return;
    if (backButton?.visible) backButtonApi.show();
    else backButtonApi.hide();
  }, [webApp, backButton?.visible]);

  const user = webApp?.initDataUnsafe?.user ?? null;

  function haptic(style = "light") {
    try {
      webApp?.HapticFeedback?.impactOccurred(style);
    } catch {
      /* not running inside Telegram - ignore */
    }
  }

  // `type` is "success" | "error" | "warning". Every notify() also plays
  // the matching sound (coin ping / buzz / blip) unless the caller plays a
  // more specific one itself and passes { sound: false }.
  function notify(type = "success", { sound = true } = {}) {
    if (sound) play(type);
    try {
      webApp?.HapticFeedback?.notificationOccurred(type);
    } catch {
      /* not running inside Telegram - ignore */
    }
  }

  return {
    webApp,
    user,
    isTelegram: Boolean(webApp),
    colorScheme: webApp?.colorScheme ?? "dark",
    haptic,
    notify,
  };
}
