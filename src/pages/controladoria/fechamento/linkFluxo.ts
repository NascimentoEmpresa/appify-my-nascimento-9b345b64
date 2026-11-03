import type { BaseDespesa } from "../faturamento/regras";
import { FILTRO_SEM_VALOR } from "@/pages/financeiro/fluxo-caixa/filtrosMultiplos";

// SIS-2026-0781: "Ver todos os lançamentos" do detalhamento do Fechamento da Empresa abre o Fluxo de Caixa já com o recorte da célula:
// mesmo período (pela base escolhida no topo), mesma empresa, mesma classificação, os mesmos contratos e só saídas. O Fluxo lê estes
// parâmetros ao abrir (FluxoCaixaGestao.tsx) e mostra o total do Fechamento ao lado do total filtrado, para a conferência.
export const ROTA_FLUXO_CAIXA = "/app/financeiro/gestao-financeira/fluxo-caixa";

export interface RecorteFluxo {
  base: BaseDespesa;
  /** Meses do detalhe ("YYYY-MM"), seguidos — vale o primeiro e o último. */
  meses: string[];
  empresaId?: string | null;
  classificacaoIds: string[];
  /** Lançamentos sem classificação (a opção "Sem classificação" do filtro do Fluxo). */
  semClassificacao?: boolean;
  contratoIds: string[];
  /** Lançamentos sem contrato (a opção "Sem contrato" do filtro do Fluxo). */
  semContrato?: boolean;
  /** Valor que o Fechamento mostra para este recorte, para o Fluxo conferir. */
  valorEsperado?: number;
}

function ultimoDiaDoMes(anoMes: string): string {
  const [a, m] = anoMes.split("-").map(Number);
  return `${anoMes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
}

export function linkFluxoDoRecorte(r: RecorteFluxo): string {
  const q = new URLSearchParams();
  // Os meses futuros (projetados) só aparecem na visão Consolidado do Fluxo; as saídas são as únicas que o Fechamento conta.
  q.set("aba", "consolidado");
  q.set("tipo", "saida");
  q.set("origemTela", "fechamento");
  const meses = [...r.meses].sort();
  if (meses.length > 0) {
    const primeiro = meses[0];
    const ultimo = meses[meses.length - 1];
    if (r.base === "pagamento") {
      q.set("de", `${primeiro}-01`);
      q.set("ate", ultimoDiaDoMes(ultimo));
    } else {
      q.set("competenciaDe", primeiro);
      q.set("competenciaAte", ultimo);
    }
  }
  if (r.empresaId) q.set("empresa", r.empresaId);
  const classificacoes = [...(r.semClassificacao ? [FILTRO_SEM_VALOR] : []), ...r.classificacaoIds];
  if (classificacoes.length > 0) q.set("classificacao", classificacoes.join(","));
  const contratos = [...(r.semContrato ? [FILTRO_SEM_VALOR] : []), ...r.contratoIds];
  if (contratos.length > 0) q.set("contrato", contratos.join(","));
  if (r.valorEsperado !== undefined) q.set("esperado", r.valorEsperado.toFixed(2));
  return `${ROTA_FLUXO_CAIXA}?${q.toString()}`;
}
