import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Lista de setores da empresa pra dropdown — união da tabela SETORES
 * (catálogo oficial, quando existir) com os valores reais em uso na
 * EMPREGADOS (Setor_ERP), pra nunca faltar um setor que só existe como
 * texto livre no cadastro de alguém. Nunca deve virar campo de texto livre
 * na tela — sempre esses valores num dropdown.
 */
export function useSetoresEmpresa() {
  return useQuery({
    queryKey: ["setores-empresa"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const doCatalogo: string[] = [];
      const st = await (supabase as any).from("SETORES").select("*").limit(2000);
      if (!st.error && Array.isArray(st.data)) {
        const pick = (row: any) => {
          for (const k of Object.keys(row)) if (/setor|nome|descri/i.test(k) && typeof row[k] === "string" && row[k].trim()) return row[k].trim();
          return "";
        };
        doCatalogo.push(...st.data.map(pick).filter(Boolean));
      }

      const doEmpregados: string[] = [];
      const emp = await (supabase as any).rpc("listar_setores_empregados");
      if (!emp.error && Array.isArray(emp.data)) {
        doEmpregados.push(...emp.data.map((r: any) => String(r.setor ?? "").trim()).filter(Boolean));
      }

      return [...new Set(["PADRAO", ...doCatalogo, ...doEmpregados])].sort((a, b) => a.localeCompare(b, "pt-BR"));
    },
  });
}
