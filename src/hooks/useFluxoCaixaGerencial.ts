import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizarFluxo, type FluxoGerencialRpc } from "@/pages/financeiro/fluxo-caixa-gerencial/regras";

// SIS-2026-0871: totais do Fluxo de Caixa calculados no servidor (financeiro_fluxo_gerencial) — o Fluxo tem ~25 mil linhas e somar no navegador é o que
// derrubou a API em 03/11/2026 (ver useFluxoCaixaMalote.ts). A função confere o acesso à tela no servidor.
export function useFluxoCaixaGerencial(f: { ini: string; fim: string; empresaId: string; contratoId: string }) {
  return useQuery({
    queryKey: ["fluxo_caixa_gerencial", f.ini, f.fim, f.empresaId, f.contratoId],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<FluxoGerencialRpc> => {
      const cliente = supabase as unknown as { rpc: (nome: string, args: object) => Promise<{ data: unknown; error: { message: string } | null }> };
      const { data, error } = await cliente.rpc("financeiro_fluxo_gerencial", {
        p_ini: f.ini, p_fim: f.fim, p_empresa: f.empresaId || null, p_contrato: f.contratoId || null,
      });
      if (error) throw error;
      return normalizarFluxo(data);
    },
  });
}
