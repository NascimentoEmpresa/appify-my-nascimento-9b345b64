import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";

export type UsuarioOption = {
  id: string;
  display_name: string | null;
  email: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function useUsuariosLicitacao(options?: { enabled?: boolean }) {
  const { empresa } = useEmpresaAtiva();
  const empresaId = empresa?.id ?? null;

  return useQuery({
    queryKey: ["usuarios_licitacao", empresaId],
    // Até o EmpresaAtivaContext carregar as empresas reais, `empresa.id` é o id
    // mockado de empresasGrupo ("HAGG", "SN"…), que não é UUID — mandar isso na
    // RPC devolve 400 (invalid input syntax for type uuid). Mesma guarda do useGrade.
    enabled: !!empresaId && UUID_RE.test(empresaId) && (options?.enabled ?? true),
    staleTime: 60_000,
    queryFn: async (): Promise<UsuarioOption[]> => {
      const { data, error } = await supabase.rpc("list_usuarios_comercial_empresa", {
        _empresa_id: empresaId!,
      });
      if (error) throw error;
      return (data ?? []) as UsuarioOption[];
    },
  });
}
