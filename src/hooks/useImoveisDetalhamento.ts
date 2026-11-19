import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LancamentoImovel } from "@/pages/juridico/patrimonio/imoveisRegras";

// SIS-2026-0911: vínculo lançamento do Fluxo de Caixa → imóvel (Patrimônios) e leitura dos gastos por imóvel.
// O vínculo guarda só a chave do lançamento e o imóvel; valor, data e contrato vêm sempre das views do Fluxo (RPC juridico_imoveis_lancamentos).
const CHAVE = ["imoveis_detalhamento"];

export const ORIGENS_VINCULAVEIS = ["malote", "debito_automatico", "importacao_historica", "unificado"] as const;
export type OrigemVinculavel = (typeof ORIGENS_VINCULAVEIS)[number];
export const ehVinculavel = (origem: string): origem is OrigemVinculavel => (ORIGENS_VINCULAVEIS as readonly string[]).includes(origem);

/** Saídas vinculadas a imóveis no período (datas AAAA-MM-DD; sem datas = tudo). */
export function useLancamentosImoveis(ini: string, fim: string) {
  return useQuery({
    queryKey: [...CHAVE, "lancamentos", ini, fim],
    staleTime: 60_000,
    queryFn: async (): Promise<LancamentoImovel[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("juridico_imoveis_lancamentos", { p_ini: ini || null, p_fim: fim || null });
      if (error) throw error;
      return ((data ?? []) as LancamentoImovel[]).map((l) => ({ ...l, valor: Number(l.valor) || 0 }));
    },
  });
}

export interface PatrimonioOpcao { id: number; descricao: string; classificacao: string | null; codigo: string | null }

/** Imóveis do cadastro de Patrimônios, para escolher o destino do vínculo. Lista vazia para quem não tem acesso a Patrimônios. */
export function usePatrimoniosParaVinculo(ativo = true) {
  return useQuery({
    queryKey: [...CHAVE, "opcoes"],
    enabled: ativo,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PatrimonioOpcao[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("JUR_PATRIMONIOS").select("id, descricao, classificacao, codigo, tipo").not("tipo", "in", '("Veículo","Equipamento")').order("descricao");
      if (error) throw error;
      return (data ?? []) as PatrimonioOpcao[];
    },
  });
}

export interface LinhaVinculavel { origem: string; despesa_id: string; numero_parcela: number | null }

/** Liga as linhas ao imóvel (ou, com patrimonioId nulo, tira o vínculo). Devolve quantas foram gravadas. */
export function useVincularPatrimonio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ linhas, patrimonioId }: { linhas: LinhaVinculavel[]; patrimonioId: number | null }): Promise<number> => {
      const validas = linhas.filter((l) => ehVinculavel(l.origem));
      if (validas.length === 0) return 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tabela = (supabase as any).from("financeiro_fluxo_caixa_patrimonio");
      if (patrimonioId == null) {
        for (const l of validas) {
          const { error } = await (supabase as any).from("financeiro_fluxo_caixa_patrimonio").delete().eq("origem", l.origem).eq("despesa_id", l.despesa_id).eq("parcela", l.numero_parcela ?? 0);
          if (error) throw error;
        }
        return validas.length;
      }
      const registros = validas.map((l) => ({ origem: l.origem, despesa_id: l.despesa_id, parcela: l.numero_parcela ?? 0, patrimonio_id: patrimonioId, updated_at: new Date().toISOString() }));
      for (let i = 0; i < registros.length; i += 200) {
        const { error } = await tabela.upsert(registros.slice(i, i + 200), { onConflict: "origem,despesa_id,parcela" });
        if (error) throw error;
      }
      return registros.length;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}
