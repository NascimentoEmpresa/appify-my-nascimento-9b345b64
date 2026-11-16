// Jurídico / Patrimônio — aba "Parcelas": a baixa que vem das contas (13/11/2026).
//
// SINTOMA (Jurídico, 13/11/2026): "Os lançamentos dos financiamentos no malote
// não estão sendo registrados no sistema de Patrimônios." No TURIM a aba
// Parcelas parava na 20ª paga ("22 de 80"); da 21ª em diante tudo NAO PAGA,
// inclusive a 23ª, que a aba Contas / Obrigações mostrava como Pago. O mesmo
// no MURANO e no GREEN.
//
// CAUSA: não havia integração nenhuma. A aba Parcelas lê
// JUR_PATRIMONIO_PARCELAS, que é a foto da planilha ATIVO IMOBILIZADO
// importada em 09/2026 e nunca mais atualizada. Os pagamentos de lá para cá
// moram nas Contas / Obrigações (JUR_PATRIMONIO_OBRIGACOES), seja com a baixa
// manual (status = 'Pago'), seja pela despesa do Malote paga
// (malote_despesa_id → despesa_paga). As duas tabelas não têm vínculo entre si.
//
// CORREÇÃO: a situação da parcela passa a ser LIDA das contas na hora de
// desenhar, e não gravada de novo na tabela da planilha. É a mesma decisão da
// integração com o Malote (vinculoMalote.ts): quem sabe se o dinheiro saiu é
// o Malote, e copiar esse estado para uma segunda tabela é garantir que uma
// hora as duas discordem. Assim o pagamento que entra hoje já aparece, sem
// gatilho no Malote (módulo sensível a carga, ver a queda de 03/11) e sem
// rotina de sincronização.
//
// O CASAMENTO parcela da planilha ↔ conta do contrato:
//   • só conta de Financiamento/Consórcio do MESMO patrimônio, que esteja
//     paga (o chamador diz como: Malote ou baixa na conta);
//   • mesmo TIPO: parcela numerada só casa com parcela; reforço com reforço,
//     sinal com sinal… (o rótulo da planilha diz o tipo: "REFORÇO", "A) SINAL");
//   • mesmo MÊS de vencimento. Empate (duas contas no mês) desempata pelo
//     número da parcela e depois pelo valor mais próximo;
//   • se o mês não bate, aceita a do mesmo número com vencimento até 45 dias
//     de distância (carnê que vence dia 30 e conta lançada dia 1º);
//   • cada conta paga só dá baixa em UMA parcela.
// O que a planilha já trazia como PAGA continua PAGA — é histórico de antes do
// sistema. Nunca se inventa pagamento: sem conta paga, a parcela fica como
// estava.

import { ehContratoParcelado, tipoPelaDescricao, type TipoLancamento } from "./parcelas";

/** Linha da planilha (JUR_PATRIMONIO_PARCELAS), no recorte que o casamento usa. */
export interface ParcelaPlanilha {
  id: number | string;
  numero?: number | null;
  rotulo?: string | null;
  vencimento?: string | null;
  valor?: number | string | null;
  valor_pago?: number | string | null;
  situacao?: string | null;
}

/** Conta do contrato (JUR_PATRIMONIO_OBRIGACOES), no recorte que o casamento usa. */
export interface ContaDoContrato {
  id: number | string;
  categoria?: string | null;
  tipo_lancamento?: string | null;
  descricao?: string | null;
  parcela_numero?: number | null;
  vencimento?: string | null;
  valor?: number | string | null;
}

/** De onde veio a baixa que a tela mostra. */
export type OrigemBaixa = "planilha" | "malote" | "conta";

export type ParcelaComBaixa<P extends ParcelaPlanilha> = P & {
  /** null = em aberto. */
  baixa: OrigemBaixa | null;
  /** A conta que deu baixa, quando veio das Contas / Obrigações. */
  conta_id: number | string | null;
};

export const parcelaPagaNaPlanilha = (p: { situacao?: string | null }): boolean =>
  String(p.situacao ?? "").trim().toUpperCase().startsWith("PAG");

/** Tipo da linha da planilha: numerada é parcela; o resto, pelo rótulo. */
export function tipoDaParcelaPlanilha(p: ParcelaPlanilha): TipoLancamento {
  if (p.numero != null && String(p.numero) !== "") return "parcela";
  return tipoPelaDescricao(p.rotulo);
}

const tipoDaConta = (c: ContaDoContrato): TipoLancamento => {
  const t = String(c.tipo_lancamento ?? "").trim();
  return (t || tipoPelaDescricao(c.descricao)) as TipoLancamento;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const mes = (iso?: string | null) => String(iso ?? "").slice(0, 7);
const dias = (a?: string | null, b?: string | null): number => {
  const x = Date.parse(String(a ?? "").slice(0, 10)), y = Date.parse(String(b ?? "").slice(0, 10));
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / 86_400_000 : Infinity;
};

/** Distância até 45 dias para quando o mês não bate. */
const TOLERANCIA_DIAS = 45;

/**
 * Situação de cada parcela da planilha, com a baixa das contas pagas.
 *
 * `pagaPor` diz se a conta está paga e por onde ("malote" | "conta"), ou null
 * se não está. É o chamador que sabe: a tela tem o status do Malote em mãos.
 */
export function aplicarBaixaDasContas<P extends ParcelaPlanilha>(
  parcelas: P[],
  contas: ContaDoContrato[],
  pagaPor: (c: ContaDoContrato) => "malote" | "conta" | null,
): ParcelaComBaixa<P>[] {
  const pagas = contas
    .filter(c => ehContratoParcelado(c.categoria))
    .map(c => ({ c, por: pagaPor(c), tipo: tipoDaConta(c) }))
    .filter((x): x is { c: ContaDoContrato; por: "malote" | "conta"; tipo: TipoLancamento } => x.por != null);
  const usadas = new Set<number>();

  const escolher = (p: P): number => {
    const tipo = tipoDaParcelaPlanilha(p);
    const n = p.numero != null ? Number(p.numero) : null;
    const v = num(p.valor);
    const ordenar = (a: number, b: number) => {
      const ca = pagas[a].c, cb = pagas[b].c;
      const na = n != null && Number(ca.parcela_numero) === n ? 0 : 1;
      const nb = n != null && Number(cb.parcela_numero) === n ? 0 : 1;
      return na - nb || Math.abs(num(ca.valor) - v) - Math.abs(num(cb.valor) - v) || String(ca.id).localeCompare(String(cb.id));
    };
    const livres = pagas.map((_, i) => i).filter(i => !usadas.has(i) && pagas[i].tipo === tipo);
    const doMes = livres.filter(i => p.vencimento && mes(pagas[i].c.vencimento) === mes(p.vencimento)).sort(ordenar);
    if (doMes.length) return doMes[0];
    if (n == null) return -1;
    const perto = livres
      .filter(i => Number(pagas[i].c.parcela_numero) === n && dias(pagas[i].c.vencimento, p.vencimento) <= TOLERANCIA_DIAS)
      .sort(ordenar);
    return perto.length ? perto[0] : -1;
  };

  const resultado = parcelas.map(p => ({ ...p, baixa: null, conta_id: null }) as ParcelaComBaixa<P>);

  // 1ª passada: o que a planilha já dá como pago reserva a conta dele, para
  // essa conta não ir dar baixa em outra parcela do mesmo mês.
  resultado.forEach((p, k) => {
    if (!parcelaPagaNaPlanilha(p)) return;
    const i = escolher(parcelas[k]);
    if (i >= 0) usadas.add(i);
    p.baixa = "planilha";
  });

  // 2ª passada: as em aberto recebem a baixa das contas pagas.
  resultado.forEach((p, k) => {
    if (p.baixa) return;
    const i = escolher(parcelas[k]);
    if (i < 0) return;
    usadas.add(i);
    const { c, por } = pagas[i];
    p.baixa = por;
    p.conta_id = c.id;
    p.situacao = "PAGA";
    if (p.valor_pago == null || p.valor_pago === "") p.valor_pago = (c.valor ?? p.valor) as P["valor_pago"];
  });

  return resultado;
}

/** Resumo da aba (cartões do topo): mesma régua da tabela. */
export function resumoDasParcelas(ls: ParcelaComBaixa<ParcelaPlanilha>[]) {
  const pagas = ls.filter(x => x.baixa);
  return {
    pagas: pagas.length,
    total: ls.length,
    somaPagas: Math.round(pagas.reduce((s, x) => s + num(x.valor_pago ?? x.valor), 0) * 100) / 100,
    somaAberto: Math.round(ls.filter(x => !x.baixa).reduce((s, x) => s + num(x.valor), 0) * 100) / 100,
  };
}
