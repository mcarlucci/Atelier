import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme, getThemePreference } from "./format";
import "./styles.css";
import "./ui/theme.css";

applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => getThemePreference() === "system" && applyTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
