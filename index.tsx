import "@fontsource/archivo/400.css";
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/archivo/800.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

if (
  import.meta.env.PROD &&
  new URLSearchParams(globalThis.location.search).get("gridWorkerProbe") === "1"
) {
  const probe = import("./features/slice/processing/gridProcessingBrowserProbe")
    .then(({ runGridProcessingBrowserProbe }) => runGridProcessingBrowserProbe())
    .then(
      (evidence) => Object.freeze({ state: "completed", evidence }),
      () => Object.freeze({ state: "failed" }),
    );
  Object.defineProperty(globalThis, "__spriteBoyGridProcessingProbe", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: probe,
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
