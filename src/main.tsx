import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { instalarMonitorDeQueda } from "@/lib/monitorDeQueda";

// Antes do React: o monitor precisa ver as PRIMEIRAS chamadas ao Supabase
// (sessão, perfil, permissões), que é onde a queda aparece primeiro.
instalarMonitorDeQueda();

createRoot(document.getElementById("root")!).render(<App />);
