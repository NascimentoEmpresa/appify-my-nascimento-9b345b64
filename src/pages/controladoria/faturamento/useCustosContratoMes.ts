import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LinhaFluxoCusto } from "./regras";

// SIS-2026-0556: custos do mês para a Lucratividade. Em vez de baixar o Fluxo
// de Caixa inteiro (6 views, ~20 mil linhas, ~16 MB), pede a cada view só as
// SAÍDAS do mês com contrato, só as 5 colunas necessárias — algumas centenas
// de linhas. Paginado em blocos de 1000 (limite do PostgREST) com desempate.
const TAMANHO_PAGINA = 1000;
const FONTES: { view: string; ordem: string[] }[] = [
  { view: "v_malote_pagamento_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_debito_automatico_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_cartao_fatura_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_aplicacao_financeira_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_aplicacao_financeira_resgate_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_fluxo_caixa_importado_fluxo_caixa", ordem: ["despesa_id", "linha_id"] },
];

function proximoMes(anoMes: string): string {
  const [a, m] = anoMes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
}

async function buscarView(view: string, ordem: string[], mes: string): Promise<LinhaFluxoCusto[]> {
  const linhas: LinhaFluxoCusto[] = [];
  for (let pagina = 0; ; pagina++) {
    let q = (supabase as any)
      .from(view)
      .select("tipo, data_pagamento, contrato_id, classificacao_nome, valor")
      .eq("tipo", "saida")
      .not("contrato_id", "is", null)
      .gte("data_pagamento", `${mes}-01`)
      .lt("data_pagamento", proximoMes(mes));
    for (const col of ordem) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(pagina * TAMANHO_PAGINA, (pagina + 1) * TAMANHO_PAGINA - 1);
    if (error) throw error;
    linhas.push(...((data ?? []) as LinhaFluxoCusto[]));
    if (!data || data.length < TAMANHO_PAGINA) break;
  }
  return linhas;
}

export function useCustosContratoMes(mes: string) {
  return useQuery({
    queryKey: ["lucratividade_custos_mes", mes],
    staleTime: 120_000,
    queryFn: async () => {
      const partes = await Promise.all(
        FONTES.map((f) =>
          buscarView(f.view, f.ordem, mes)
            // linha_id ainda não existe na view da importação (migration 20261006000002).
            .catch((e: any) => (e?.code === "42703" && f.view.includes("importado") ? buscarView(f.view, ["despesa_id"], mes) : Promise.reject(e)))
            // View ainda não criada no ambiente: não derruba a tela.
            .catch((e: any) => {
              if (e?.code === "PGRST205" || e?.code === "42P01") return [] as LinhaFluxoCusto[];
              throw e;
            })
        )
      );
      return partes.flat();
    },
  });
}
