/**
 * Consumo de estoque por contrato na Lucratividade (SIS-2026-0769) — regras.
 *
 * Coluna INFORMATIVA: quanto de material saiu do estoque para o contrato no
 * mês. Não entra no Total de Custos nem no Lucro Bruto.
 *
 * Por que não soma, mesmo sendo custo de verdade: hoje a compra do material já
 * é lançada no contrato. Medido em 09/11/2026, de setembro em diante, a grande
 * maioria das compras de MATERIAL DE LIMPEZA, UNIFORMES e EPI'S do malote foi
 * lançada direto num contrato real, e só uma fração no contrato ADMINISTRATIVO
 * de estoque, que fica fora das despesas. Somar a saída por cima disso cobraria
 * o mesmo material duas vezes. Os números da medição estão no chamado
 * SIS-2026-0769, não aqui: este repositório é público.
 *
 * O setor está passando a lançar a compra como estoque; quando isso valer, é
 * trocar `SOMA_NO_CUSTO` para true e ajustar o rótulo — a consulta já serve.
 */

/** Uma linha de sup_rel_consumo_custo_por_contrato. */
export interface LinhaConsumoEstoque {
  competencia: string;
  contrato_id: string;
  valor: number | string;
  unidades: number | string;
  unidades_sem_valor: number | string;
}

export interface ConsumoDoContrato {
  valor: number;
  unidades: number;
  unidadesSemValor: number;
}

/**
 * Enquanto a compra de material continuar sendo lançada direto no contrato,
 * esta coluna é só informativa. Uma constante, e não um texto espalhado pela
 * tela, para o dia da virada ser um lugar só.
 */
export const SOMA_NO_CUSTO = false;

/** `2026-09` → { inicio: "2026-09-01", fim: "2026-09-30" }. Fim inclusivo, que é o que a RPC espera. */
export function intervaloDoMes(mes: string): { inicio: string; fim: string } {
  const [ano, m] = mes.split("-").map(Number);
  // Dia 0 do mês seguinte = último dia deste mês, e o Date resolve virada de
  // ano e fevereiro bissexto sem tabela.
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

/** Indexa por contrato_id. A RPC já agrupa por competência × contrato. */
export function consumoPorContrato(linhas: LinhaConsumoEstoque[]): Map<string, ConsumoDoContrato> {
  const mapa = new Map<string, ConsumoDoContrato>();
  for (const l of linhas) {
    if (!l.contrato_id) continue;
    const atual = mapa.get(l.contrato_id) ?? { valor: 0, unidades: 0, unidadesSemValor: 0 };
    atual.valor += Number(l.valor) || 0;
    atual.unidades += Number(l.unidades) || 0;
    atual.unidadesSemValor += Number(l.unidades_sem_valor) || 0;
    mapa.set(l.contrato_id, atual);
  }
  return mapa;
}

/**
 * Quantas unidades do mês saíram sem preço. A tela avisa quando passa de zero:
 * sem isso, o contrato apareceria recebendo material de graça — e em setembro e
 * outubro de 2026 isso valia para uma parcela não desprezível das saídas.
 */
export function unidadesSemPreco(linhas: LinhaConsumoEstoque[]): number {
  let n = 0;
  for (const l of linhas) n += Number(l.unidades_sem_valor) || 0;
  return n;
}

/** Total do mês, para o rodapé da tabela. */
export function totalConsumo(mapa: Map<string, ConsumoDoContrato>): number {
  let t = 0;
  for (const c of mapa.values()) t += c.valor;
  return t;
}
