import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// =====================================================================
// Bolinha do "Resumo dos Contratos" (13/11/2026, mig 20261115000800):
// acesa no item do setor — e por tabela no módulo Licitações — enquanto
// houver contrato pronto esperando o setor "Confirmar recebimento". Regra
// em src/lib/implantacao/notifConfirmacao.ts; a conta é do banco, numa
// chamada só, no mesmo formato do useAprovacoesNotif ({ rota: quantidade }).
// =====================================================================

export const CHAVE_CONFIRMACAO_NOTIF = "implantacao-confirmacao-notif";

export interface ImplantacaoConfirmacaoNotif {
  porRota: Record<string, number>;
}

const VAZIO: ImplantacaoConfirmacaoNotif = { porRota: {} };

type ClienteRpc = {
  rpc: (fn: "implantacao_confirmacao_pendente") => Promise<{ data: unknown; error: { message: string } | null }>;
};

export function useImplantacaoConfirmacaoNotif(): ImplantacaoConfirmacaoNotif {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: [CHAVE_CONFIRMACAO_NOTIF, user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<ImplantacaoConfirmacaoNotif> => {
      const { data, error } = await (supabase as unknown as ClienteRpc).rpc("implantacao_confirmacao_pendente");
      // Bolinha é aviso, não tela: falhou (ou a migration ainda não entrou), fica apagada.
      if (error) return VAZIO;
      return { porRota: (data ?? {}) as Record<string, number> };
    },
  });
  return data ?? VAZIO;
}
