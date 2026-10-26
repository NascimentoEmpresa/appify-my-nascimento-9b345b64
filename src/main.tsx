import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { instalarMonitorDeQueda } from "@/lib/monitorDeQueda";
import { instalarInsertComDefault } from "@/lib/insertComDefault";
import { instalarEnvioUnico } from "@/lib/envioUnico";
import { supabase } from "@/integrations/supabase/client";

// Antes do React: o monitor precisa ver as PRIMEIRAS chamadas ao Supabase
// (sessão, perfil, permissões), que é onde a queda aparece primeiro.
instalarMonitorDeQueda();
// Insert/upsert em lista: chave ausente usa o DEFAULT, não NULL (ver o arquivo).
instalarInsertComDefault(supabase);
// Clique repetido em "enviar": o mesmo insert em poucos segundos sai uma vez só.
instalarEnvioUnico(supabase);

createRoot(document.getElementById("root")!).render(<App />);
