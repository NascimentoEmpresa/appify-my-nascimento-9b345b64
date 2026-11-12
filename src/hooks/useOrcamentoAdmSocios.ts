import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ConfigPessoa, PessoaOrcamento, TipoOrcamento } from "@/pages/malote/orcamento-adm-socios/regras";

// SIS-2026-0858: Orçamento ADM e Sócios por integrante (migration 20261111120000). Só a configuração é gravada (aba, classificação de origem e
// contratos de cada pessoa); o saldo da classificação é calculado ao vivo em regras.ts.
const KEY_LINHAS = "orcamento_adm_socios_integrante";
const KEY_PESSOAS = "orcamento_adm_socios_pessoas";

export interface IntegranteDb { userId: string; tipo: TipoOrcamento; config: ConfigPessoa }

interface LinhaDb { user_id: string; tipo: TipoOrcamento; classificacao_malote_id: string | null; contrato_ids: string[] | null }

/** Quem aparece na lista: usuários ativos do ERP e o(s) setor(es) do Gerenciamento de Acesso (RPC, porque user_setor tem RLS própria). */
export function usePessoasOrcamento() {
  return useQuery({
    queryKey: [KEY_PESSOAS],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PessoaOrcamento[]> => {
      const { data, error } = await (supabase as any).rpc("orcamento_adm_socios_pessoas");
      if (error) throw error;
      return ((data ?? []) as { user_id: string; nome: string; setores: string[] | null }[]).map((p) => ({
        userId: p.user_id, nome: p.nome, setores: p.setores ?? [],
      }));
    },
  });
}

export function useIntegrantesOrcamento() {
  return useQuery({
    queryKey: [KEY_LINHAS],
    queryFn: async (): Promise<IntegranteDb[]> => {
      const { data, error } = await (supabase as any).from(KEY_LINHAS).select("user_id, tipo, classificacao_malote_id, contrato_ids");
      if (error) throw error;
      return ((data ?? []) as LinhaDb[]).map((l) => ({
        userId: l.user_id, tipo: l.tipo, config: { classificacaoId: l.classificacao_malote_id, contratoIds: l.contrato_ids ?? [] },
      }));
    },
  });
}

/** "Salvar distribuição": grava as pessoas informadas (aba + configuração) e apaga a linha de quem voltou ao Administrativo sem configuração. */
export function useSalvarIntegrantesOrcamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ gravar, apagar }: { gravar: IntegranteDb[]; apagar: string[] }) => {
      if (apagar.length > 0) {
        const { error } = await (supabase as any).from(KEY_LINHAS).delete().in("user_id", apagar);
        if (error) throw error;
      }
      if (gravar.length > 0) {
        const { error } = await (supabase as any).from(KEY_LINHAS).upsert(
          gravar.map((g) => ({ user_id: g.userId, tipo: g.tipo, classificacao_malote_id: g.config.classificacaoId, contrato_ids: g.config.contratoIds })),
          { onConflict: "user_id" },
        );
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY_LINHAS] }),
  });
}
