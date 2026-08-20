import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { tvDebugAtivo, initTvDebug } from "./lib/tvDebug";
import { TvDebugOverlay } from "./components/debug/TvDebugOverlay";

// Console de tela pra TV sem DevTools — só liga com ?debug=1. Instala os
// captadores antes do render pra pegar erros de montagem (ex.: painel TV).
if (tvDebugAtivo()) initTvDebug();

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <TvDebugOverlay />
  </>,
);
