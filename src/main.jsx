import React from "react";
import ReactDOM from "react-dom/client";
import { init } from "@tma.js/sdk-react";
import App from "./App.jsx";
import { initAudio } from "./audio/engine.js";
import "./index.css";

// init() wires up the SDK's internal event bridge to Telegram. It's safe
// to call even outside Telegram (e.g. while developing in a normal
// browser tab) - it just won't have a real client on the other end.
try {
  init();
} catch (err) {
  console.warn("Telegram Mini Apps SDK: not running inside Telegram, continuing in browser-preview mode.", err);
}

// Audio engine: settings, autoplay unlock, button-tap + sheet sounds.
initAudio();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
