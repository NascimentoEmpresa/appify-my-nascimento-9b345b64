import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// =====================================================================
// Login vinculado a colaborador DEMITIDO não usa o ERP (mig 20261006160000).
//
// A barreira de verdade está no banco: has_screen_access nega tudo para quem
// erp_login_bloqueado() — então nenhum dado de tela vaza mesmo que este hook
// falhe. Aqui é só a experiência: em vez de um ERP vazio e cheio de "sem
// acesso", a pessoa vê que o acesso foi encerrado e o caminho para o Portal
// do Colaborador (/colaborador), que tem sessão própria por CPF.
//
// Erro na RPC (banco sem a migration, rede) = NÃO bloqueia: travar todo
// mundo por falha de consulta seria pior que o problema.
// =====================================================================

export interface EstadoLoginErp {
  bloqueado: boolean;
  nome: string | null;
  situacao: string | null;
}

export function useLoginErpBloqueado(userId: string | null | undefined, ativo: boolean) {
  return useQuery({
    queryKey: ["login-erp-bloqueado", userId],
    enabled: ativo && !!userId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async (): Promise<EstadoLoginErp> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("meu_login_erp_bloqueado");
      if (error || !data) return { bloqueado: false, nome: null, situacao: null };
      return {
        bloqueado: !!data.bloqueado,
        nome: data.nome ?? null,
        situacao: data.situacao ?? null,
      };
    },
  });
}
