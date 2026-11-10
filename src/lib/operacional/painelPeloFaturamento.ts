// =====================================================================
// Painel Executivo PELO FATURAMENTO DA EMPRESA (09/11/2026)
//
// Pablo, com Controladoria › Faturamento da Empresa ao lado: "bater esses
// valores, o lucro bruto deveria ser > 1.474.598,83 · vincula os valores do
// painel executivo com o faturamento-empresa". O painel lia o DRE gerencial
// (tvg_dre_mv), que é outra base: jan/26 dava receita de R$ 3,5 mi contra
// R$ 6,8 mi de líquido no Faturamento.
//
// Agora receita, lucro, margem, evolução e contratos por situação usam a MESMA
// conta da tela de Faturamento (src/pages/controladoria/FaturamentoEmpresa.tsx):
//   · receita = Valor Líquido das notas válidas da competência
//     (agruparFaturamento);
//   · custo   = saídas do Fluxo de Caixa com contrato no mês (Despesas da
//     tela: custosPorContratoMes + totalCustos), só de contratos conhecidos;
//   · lucro   = líquido − custo; margem = lucro ÷ líquido (lucroBruto).
// O filtro de empresa, a base e o código da nota são os da leitura
// compartilhada das telas de Faturamento: o que a pessoa escolheu lá vale aqui.
// =====================================================================
import { agruparFaturamento, lucroBruto, type NfFaturamento } from "@/pages/controladoria/faturamento/regras";
import type { ContratoSituacao, DadosPainelExecutivo, DetalheSituacao, LinhaDre } from "./painelExecutivo";

/** Receita mínima do contrato no mês para entrar na rosca (mesmo piso de antes). */
export const PISO_SITUACAO = 10_000;

export interface EntradaFaturamento {
  nfs: NfFaturamento[];
  /** Custo total por "contratoId|YYYY-MM" (Despesas da tela de Faturamento). */
  custoPorContratoMes: Map<string, number>;
  /** Contratos do recorte (empresa escolhida): id → nome. Os outros não contam. */
  contratos: Map<string, string>;
  /** Contratos não encerrados, para dizer o que ficou fora da rosca. */
  ativos: number;
}

const arred = (n: number) => Math.round(n * 100) / 100;

function mesAnterior(c: string): string {
  const [a, m] = c.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

/** As 12 competências que terminam em `c`, da mais antiga para a mais nova. */
export function dozeMeses(c: string): string[] {
  const out = [c];
  while (out.length < 12) out.unshift(mesAnterior(out[0]));
  return out;
}

interface Mes { liquido: number; custo: number; notas: number }

function porMes(e: EntradaFaturamento): Map<string, Mes> {
  const mapa = new Map<string, Mes>();
  const pega = (mes: string) => mapa.get(mes) ?? (mapa.set(mes, { liquido: 0, custo: 0, notas: 0 }), mapa.get(mes)!);
  const nfs = e.nfs.filter((n) => e.contratos.has(n.contrato_id));
  for (const [mes, t] of agruparFaturamento(nfs, (n) => n.competencia.slice(0, 7))) {
    const m = pega(mes);
    m.liquido += t.liquido;
    m.notas += t.notas;
  }
  for (const [chave, v] of e.custoPorContratoMes) {
    const [id, mes] = chave.split("|");
    if (e.contratos.has(id)) pega(mes).custo += v;
  }
  return mapa;
}

function linha(m: Mes | undefined): LinhaDre | null {
  if (!m || (m.notas === 0 && m.custo === 0)) return null;
  const r = lucroBruto(m.liquido, m.custo);
  return { receita: arred(m.liquido), custo: arred(m.custo), lucro: arred(r.lucro), margem: r.margem == null ? 0 : arred(r.margem * 100) };
}

function situacaoDoMes(e: EntradaFaturamento, mes: string) {
  const liquido = new Map<string, number>();
  const nfs = e.nfs.filter((n) => e.contratos.has(n.contrato_id) && n.competencia.startsWith(mes));
  for (const [id, t] of agruparFaturamento(nfs, (n) => n.contrato_id)) liquido.set(id, t.liquido);
  const contratos: DetalheSituacao["contratos"] = { saudavel: [], atencao: [], critico: [] };
  let abaixo = 0;
  for (const [id, rec] of liquido) {
    if (rec <= 0) continue;
    if (rec < PISO_SITUACAO) { abaixo++; continue; }
    const margem = arred(((rec - (e.custoPorContratoMes.get(`${id}|${mes}`) ?? 0)) / rec) * 100);
    const chave = margem >= 10 ? "saudavel" : margem >= 0 ? "atencao" : "critico";
    contratos[chave]!.push({ nome: e.contratos.get(id) ?? id, receita: arred(rec), margem } satisfies ContratoSituacao);
  }
  for (const l of Object.values(contratos)) l!.sort((a, b) => a.margem - b.margem);
  return {
    situacao: { saudavel: contratos.saudavel!.length, atencao: contratos.atencao!.length, critico: contratos.critico!.length },
    detalhe: { contratos, abaixo_piso: abaixo, ativos: e.ativos } satisfies DetalheSituacao,
  };
}

/**
 * Troca nos dados da RPC tudo o que vem do DRE pela conta do Faturamento da
 * Empresa. O resto (competências, notas recebidas/a receber/vencidas) segue
 * como a RPC devolveu.
 */
export function painelPeloFaturamento(d: DadosPainelExecutivo, e: EntradaFaturamento): DadosPainelExecutivo {
  const meses = porMes(e);
  const ant = mesAnterior(d.competencia);
  const comNota = [...meses.entries()].filter(([, m]) => m.notas > 0).map(([mes]) => mes).sort();
  const atual = linha(meses.get(d.competencia));
  const s = atual ? situacaoDoMes(e, d.competencia) : null;
  const sAnt = linha(meses.get(ant)) ? situacaoDoMes(e, ant) : null;
  return {
    ...d,
    ultima_dre: comNota[comNota.length - 1] ?? null,
    dre: atual,
    dre_anterior: linha(meses.get(ant)),
    serie: dozeMeses(d.competencia).flatMap((mes) => {
      const l = linha(meses.get(mes));
      return l ? [{ competencia: mes, receita: l.receita, lucro: l.lucro }] : [];
    }),
    situacao: s?.situacao ?? null,
    situacao_detalhe: s?.detalhe ?? null,
    critico_anterior: sAnt?.situacao.critico ?? null,
  };
}
