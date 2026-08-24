import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

// Ushlanmagan xatolar konsolda ko'rinib tursin — ilova jimgina
// to'xtab qolmasin (oq ekran muammosini aniqlash uchun kerak).
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (e) => {
    console.error("💥 Ushlanmagan promise xatosi:", e.reason);
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
