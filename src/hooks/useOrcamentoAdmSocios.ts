import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LinhaOrcamento, TipoOrcamento } from "@/pages/malote/orcamento-adm-socios/regras";

// SIS-2026-0702: configuração do novo Orçamento Administrativo / Sócios (tabela orcamento_adm_socios_linha). Só a configuração é gravada;
// valor orçado, saldo e utilizado são calculados ao vivo em regras.ts.
const KEY = "orcamento_adm_socios_linha";

interface LinhaDb {
  classificacao_administrativa_id: string;
  descricao: string;
  modo: "percentual" | "manual";
  percentual: number | string;
  origem_classificacao_ids: string[];
  valor_manual: number | string;
  distribuicao_empresas: Record<string, number> | null;
}

export function useLinhasOrcamentoAdmSocios(tipo: TipoOrcamento) {
  return useQuery({
    queryKey: [KEY, tipo],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from(KEY)
        .select("classificacao_administrativa_id, descricao, modo, percentual, origem_classificacao_ids, valor_manual, distribuicao_empresas")
        .eq("tipo", tipo)
        .order("created_at");
      if (error) throw error;
      return ((data ?? []) as LinhaDb[]).map<LinhaOrcamento>((l) => ({
        classificacaoAdministrativaId: l.classificacao_administrativa_id,
        descricao: l.descricao ?? "",
        modo: l.modo,
        percentual: Number(l.percentual) || 0,
        origemIds: l.origem_classificacao_ids ?? [],
        valorManual: Number(l.valor_manual) || 0,
        distribuicao: l.distribuicao_empresas ?? {},
      }));
    },
  });
}

/** "Salvar distribuição": grava as linhas da aba e remove as que o usuário tirou da lista. */
export function useSalvarOrcamentoAdmSocios(tipo: TipoOrcamento) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linhas: LinhaOrcamento[]) => {
      const tabela = (supabase as any).from(KEY);
      const { data: existentes, error: erroLer } = await (supabase as any).from(KEY).select("classificacao_administrativa_id").eq("tipo", tipo);
      if (erroLer) throw erroLer;
      const mantidas = new Set(linhas.map((l) => l.classificacaoAdministrativaId));
      const remover = ((existentes ?? []) as { classificacao_administrativa_id: string }[])
        .map((e) => e.classificacao_administrativa_id)
        .filter((id) => !mantidas.has(id));
      if (remover.length > 0) {
        const { error } = await (supabase as any).from(KEY).delete().eq("tipo", tipo).in("classificacao_administrativa_id", remover);
        if (error) throw error;
      }
      if (linhas.length > 0) {
        const { error } = await tabela.upsert(
          linhas.map((l) => ({
            tipo,
            classificacao_administrativa_id: l.classificacaoAdministrativaId,
            descricao: l.descricao,
            modo: l.modo,
            percentual: l.percentual,
            origem_classificacao_ids: l.origemIds,
            valor_manual: l.valorManual,
            distribuicao_empresas: l.distribuicao,
          })),
          { onConflict: "tipo,classificacao_administrativa_id" },
        );
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, tipo] }),
  });
}
