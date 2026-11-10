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
import { distribuirCentavos, type ItemRateio, type ParteGuia, type TipoRateio } from "@/lib/rh/rateioDespesas";

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

// ---- Guia do FGTS com consignado: uma classificação por parte (10/11/2026) ----
// Pablo: "tá rateando o FGTS e consignado como se fosse só um, mas são duas
// classificações diferentes". A guia é UM pagamento (uma despesa no Malote),
// mas cada parte vai na SUA classificação: as linhas do rateio passam a ser
// parte × contrato, cada uma com o classificacao_id da parte — o mesmo
// desenho de Malote › Ratear Classificação (a coluna já existia na linha).

/** Classificação do Malote sugerida por parte da guia (nome no catálogo). */
export const CLASSIFICACAO_SUGERIDA_PARTE: Record<ParteGuia, string> = {
  fgts: "FGTS MENSAL",
  consignado: "CONSIGNADO",
};

/**
 * Divide o valor de cada contrato entre as partes, na proporção do que cada
 * parte pôs nele (porParte). O valor do item manda — se foi ajustado à mão,
 * a divisão segue a proporção — e a soma das partes fecha o item no centavo.
 * Contrato sem porParte (não deveria acontecer numa guia com partes) fica
 * inteiro na primeira parte.
 */
export function itensPorParte(
  itens: ItemOrigem[],
  porParte: Map<string | null, Partial<Record<ParteGuia, number>>>,
  partes: ParteGuia[],
): (ItemOrigem & { parte: ParteGuia })[] {
  const out: (ItemOrigem & { parte: ParteGuia })[] = [];
  for (const parte of partes) {
    for (const i of itens) {
      const pesos = partes.map((p) => porParte.get(i.contrato_id)?.[p] ?? 0);
      const valores = pesos.some((x) => x > 0) ? distribuirCentavos(i.valor, pesos) : partes.map((_, k) => (k === 0 ? i.valor : 0));
      const v = valores[partes.indexOf(parte)];
      if (centavos(v) > 0) out.push({ contrato_id: i.contrato_id, valor: v, parte });
    }
  }
  return out;
}

/** Como linhasDoRateioParaMalote, com a classificação da parte em cada linha. */
export function linhasPorParteParaMalote(
  itens: (ItemOrigem & { parte: ParteGuia })[],
  classificacaoDaParte: Partial<Record<ParteGuia, string>>,
  opcoes: { empresaDoContrato: Map<string, string>; empresaPadrao: string | null; fornecedorId: string | null },
): RateioLinha[] {
  const comValor = itens.filter((i) => centavos(i.valor) > 0);
  const linhas = linhasDoRateioParaMalote(comValor, opcoes);
  return linhas.map((l, k) => ({ ...l, classificacao_id: classificacaoDaParte[comValor[k].parte] || null }));
}
