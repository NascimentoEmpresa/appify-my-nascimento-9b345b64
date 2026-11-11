/**
 * Consumo de estoque por contrato no mês (SIS-2026-0769).
 *
 * Lê sup_rel_consumo_custo_por_contrato, criada em 20261109004000. A RPC é
 * SECURITY DEFINER e gateada por has_screen_access(..., 'lucratividade-contratos',
 * 'visualizar') — quem abre a Lucratividade enxerga; quem não abre recebe lista
 * vazia, não erro.
 *
 * Desde 20261110200000 conta TODA saída com contrato conhecido, inclusive a
 * cujo contrato foi recuperado dos exports do sistema antigo: o preço sempre
 * veio do cadastro do item aqui dentro, da planilha vem só o destino. Isso é o
 * que faz este número ser igual ao "Valor total" do quadro por contrato em
 * Suprimentos → Saídas por Contrato, no mesmo período — exigência da CEO em
 * 10/11/2026. As duas consultas somam a mesma expressão; mexer numa sem a
 * outra quebra a igualdade.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  consumoPorContrato,
  intervaloDoMes,
  unidadesSemPreco,
  type ConsumoDoContrato,
  type LinhaConsumoEstoque,
} from "./consumoEstoque";

// types.ts é gerado fora do CI e não conhece a RPC nova. Mesmo padrão dos
// outros hooks de RPC recente do projeto.
const sb = supabase as any;

export interface ConsumoEstoqueMes {
  porContrato: Map<string, ConsumoDoContrato>;
  unidadesSemPreco: number;
}

// SIS-2026-0769 (11/11/2026): intervalo de meses. O primeiro dia do mes inicial
// ate o ultimo dia do mes final — com os dois iguais, e o mesmo mes de antes.
// A RPC ja soma por contrato, entao nao importa quantos meses entram.
export function useConsumoEstoqueContrato(mesInicio: string, mesFim: string) {
  return useQuery({
    queryKey: ["consumo-estoque-contrato", mesInicio, mesFim],
    queryFn: async (): Promise<ConsumoEstoqueMes> => {
      const inicio = intervaloDoMes(mesInicio).inicio;
      const fim = intervaloDoMes(mesFim).fim;
      const { data, error } = await sb.rpc("sup_rel_consumo_custo_por_contrato", {
        p_inicio: inicio,
        p_fim: fim,
      });
      if (error) throw error;
      const linhas = (data ?? []) as LinhaConsumoEstoque[];
      return { porContrato: consumoPorContrato(linhas), unidadesSemPreco: unidadesSemPreco(linhas) };
    },
    enabled: Boolean(mesInicio && mesFim),
  });
}
