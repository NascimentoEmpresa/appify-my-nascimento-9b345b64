// =====================================================================
// RH › Rateio de Despesas → linhas de rateio do Malote. Usado pelos dois
// caminhos (19/10/2026):
//   · "Enviar ao Malote" no RH (EnviarRateioMalote.tsx, mig 20261016000020);
//   · "Importar rateio" no Malote › Criar Despesa (mig 20261019000003).
// Uma regra só, para os dois não divergirem.
//
// O que manda é o VALOR (centavos) — é o que o Malote confere com o total
// da despesa. O percentual é derivado do valor e distribuído pelo maior
// resto em 4 casas, para a soma dar exatamente 100% (arredondar cada linha
// sozinha dava 99,9999% ou 100,0001% com 40 contratos).
// =====================================================================
import type { RateioLinha } from "@/hooks/useMaloteDespesa";
import { distribuirCentavos, type ItemRateio, type TipoRateio } from "@/lib/rh/rateioDespesas";

/** Classificação do Malote sugerida por tipo (nome no catálogo; quem lança pode trocar). */
export const CLASSIFICACAO_SUGERIDA: Partial<Record<TipoRateio, string>> = {
  jusbrasil: "SISTEMAS",
  senior: "SISTEMAS",
  fgts: "FGTS MENSAL",
  seguro: "SEGURO DE VIDA - OPERACIONAL",
  gratificacao_pcd: "GRATIFICAÇÃO PCD",
  mensalidade_seeac: "SINDICATO",
};

type ItemOrigem = Pick<ItemRateio, "contrato_id" | "valor">;

const centavos = (n: number) => Math.round((Number(n) || 0) * 100);

/**
 * Percentuais (0–100, 4 casas) proporcionais aos valores, somando
 * exatamente 100 quando há algum valor positivo.
 */
export function percentuaisQueFecham(valores: number[]): number[] {
  // distribuirCentavos trabalha em centésimos: 100,00 × 100 = 10.000,00 →
  // 1.000.000 unidades de 0,0001%.
  return distribuirCentavos(10000, valores.map((v) => Math.max(0, centavos(v)))).map(
    (x) => Math.round(x * 100) / 10000,
  );
}

/** Empresa que leva mais valor no rateio — sugestão de empresa pagadora. */
export function empresaQueMaisLeva(itens: ItemOrigem[], empresaDoContrato: Map<string, string>): string | null {
  const soma = new Map<string, number>();
  itens.forEach((i) => {
    const e = i.contrato_id ? empresaDoContrato.get(i.contrato_id) : null;
    if (e && i.valor > 0) soma.set(e, (soma.get(e) ?? 0) + i.valor);
  });
  return [...soma.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Itens do rateio do RH → linhas do RateioGrid do Malote.
 * - linha com valor 0 fica de fora;
 * - empresa = a do contrato; contrato desconhecido do Malote (ou "Sem
 *   contrato") vai para `empresaPadrao`, sem contrato;
 * - o mesmo fornecedor em todas as linhas (obrigatório no painel).
 */
export function linhasDoRateioParaMalote(
  itens: ItemOrigem[],
  opcoes: { empresaDoContrato: Map<string, string>; empresaPadrao: string | null; fornecedorId: string | null },
): RateioLinha[] {
  const comValor = itens.filter((i) => centavos(i.valor) > 0);
  const pcts = percentuaisQueFecham(comValor.map((i) => i.valor));
  return comValor.map((i, k) => {
    const empresaContrato = i.contrato_id ? opcoes.empresaDoContrato.get(i.contrato_id) : undefined;
    return {
      empresa_id: empresaContrato ?? opcoes.empresaPadrao ?? null,
      contrato_id: empresaContrato ? i.contrato_id : null,
      fornecedor_id: opcoes.fornecedorId || null,
      integrante_empregado_id: null,
      percentual: pcts[k],
      valor: centavos(i.valor) / 100,
      ordem: k,
    };
  });
}
