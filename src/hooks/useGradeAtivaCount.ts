import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const FASES_ATIVAS = ["À Iniciar", "Iniciado", "Em Andamento"];

// SIS-2026-0309: `todasEmpresas` conta a grade ativa de TODAS as empresas
// do grupo — mesmo padrão de useGrade/useCapaEdital.
export function useGradeAtivaCount(empresaId: string | null, opts?: { todasEmpresas?: boolean }) {
  const todasEmpresas = opts?.todasEmpresas ?? false;
  return useQuery({
    queryKey: todasEmpresas ? ["grade_ativa_count", "todas"] : ["grade_ativa_count", empresaId],
    enabled: todasEmpresas || !!empresaId,
    queryFn: async () => {
      let q = (supabase as any).from("grade").select("id", { count: "exact", head: true }).in("fase", FASES_ATIVAS);
      if (!todasEmpresas) q = q.eq("empresa_id", empresaId!);
      const { count, error } = await q;
      if (error) throw error;
      return count as number;
    },
    staleTime: 60_000,
  });
}
