import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type UsuarioOption = {
  id: string;
  display_name: string | null;
  email: string | null;
};

// SIS-2026-0309: sem `empresaId` (ou com `todasEmpresas: true`) lê quem tem
// Setor "Licitações" em TODAS as empresas do grupo — a RPC trata
// `_empresa_id` nulo como "sem filtro" (migration 20260930000162). Filtra
// por Setor (user_setor), não por role: já é o critério que a própria tela
// de Gestão de Usuários usa pra mostrar "quem é da licitação" — role
// 'comercial' e has_screen_access foram tentados antes e devolviam gente
// errada (ver comentário da migration).
export function useUsuariosLicitacao(options?: { enabled?: boolean; empresaId?: string | null; todasEmpresas?: boolean }) {
  const empresaId = options?.todasEmpresas ? null : options?.empresaId ?? null;

  return useQuery({
    queryKey: ["usuarios_licitacao", empresaId ?? "todas"],
    enabled: options?.enabled ?? true,
    staleTime: 60_000,
    queryFn: async (): Promise<UsuarioOption[]> => {
      const { data, error } = await (supabase as any).rpc("list_usuarios_comercial_empresa", {
        _empresa_id: empresaId,
      });
      if (error) throw error;
      return (data ?? []) as UsuarioOption[];
    },
  });
}
