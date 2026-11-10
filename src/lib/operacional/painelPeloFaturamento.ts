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
//
// 10/11/2026 — Pablo: "valor recebido de abril tinha que ser 7.247.842,20,
// valor a receber 11.091,94". A RPC contava o que foi PAGO dentro do mês
// (qualquer nota, de qualquer competência: abr/26 dava 7.836.613,77) e o
// saldo de TODAS as notas em aberto no fim do mês (5.838.084,75). O
// Faturamento da Empresa olha as notas DA COMPETÊNCIA: Recebido = soma do
// valor pago delas, A Receber = aReceberDaNf (já sem conta vinculada e
// descontos pós-emissão). Agora Recebido, Saldo a Receber e Vencido > 90
// saem da mesma agruparFaturamento; a parte "nf" da RPC é ignorada.
// =====================================================================
import { aReceberDaNf, agruparFaturamento, lucroBruto, notaValidaNoFaturamento, type NfFaturamento } from "@/pages/controladoria/faturamento/regras";
import type { ContratoSituacao, DadosPainelExecutivo, DetalheSituacao, FaturadoNoPrazo, LinhaDre } from "./painelExecutivo";

/** Nota do Faturamento com a data de emissão (para o vencimento estimado). */
export type NfComEmissao = NfFaturamento & { data_emissao?: string | null };

/** A NF não guarda vencimento: emissão + 30 dias (mesma premissa da RPC). */
export const DIAS_VENCIMENTO = 30;
export const DIAS_VENCIDO = 90;

/** Receita mínima do contrato no mês para entrar na rosca (mesmo piso de antes). */
export const PISO_SITUACAO = 10_000;

export interface EntradaFaturamento {
  nfs: NfComEmissao[];
  /** Custo total por "contratoId|YYYY-MM" (Despesas da tela de Faturamento). */
  custoPorContratoMes: Map<string, number>;
  /** Contratos do recorte (empresa escolhida): id → nome. Os outros não contam. */
  contratos: Map<string, string>;
  /** Contratos não encerrados, para dizer o que ficou fora da rosca. */
  ativos: number;
  /** Data de referência do "vencido" e do prazo (hoje); fixa nos testes. */
  hoje?: Date;
  /** Checklist de Faturamento; null/ausente = sem acesso ou sem dado. */
  checklist?: EntradaChecklist | null;
}

// ---------------------------------------------------------------------
// % FATURADO NO PRAZO (10/11/2026). O único prazo de faturamento que o ERP
// guarda é o do Financeiro › Checklist de Faturamento: dia-limite por
// contrato (CHECKLIST_FATURAMENTO_CONTRATO_CONFIG.dia_limite_padrao, dia do
// mês SEGUINTE à competência; exceção em ..._COMP_LIMITE) e a hora do
// "Concluir e baixar" (..._ENVIO.baixado_em). Mesma regra de
// calcularPrazoChecklist/situacaoPrazoChecklist (useChecklistFaturamento.ts),
// repetida aqui para o cálculo não depender do cliente Supabase.
// Conta só contrato com prazo: enviado até o prazo = no prazo; enviado depois,
// ou prazo vencido sem envio = fora; prazo ainda não chegou e sem envio =
// fica de fora (ainda pode sair no prazo). O checklist entrou em 30/09/2026:
// competência sem nada a medir fica sem número, nunca 0%.
// ---------------------------------------------------------------------
export interface EntradaChecklist {
  /** contrato_id → dia-limite padrão e 1ª competência ("YYYY-MM-DD" ou null). */
  configs: Map<string, { dia: number | null; inicio: string | null }>;
  /** "contrato|YYYY-MM" → data-limite da exceção ("YYYY-MM-DD"). */
  excecoes: Map<string, string>;
  /** "contrato|YYYY-MM" → baixado_em (ISO). */
  envios: Map<string, string>;
}

/** Prazo do checklist: dia `dia` do mês seguinte à competência, 23:59:59 (hora local). */
export function prazoChecklist(competencia: string, dia: number): Date {
  const [a, m] = competencia.split("-").map(Number);
  return new Date(a, m, dia, 23, 59, 59);
}

export function faturadoNoPrazo(
  competencia: string, contratos: Iterable<string>, ck: EntradaChecklist | null | undefined, hoje: Date,
): FaturadoNoPrazo | null {
  if (!ck) return null;
  let total = 0;
  let noPrazo = 0;
  for (const id of contratos) {
    const cfg = ck.configs.get(id);
    const excecao = ck.excecoes.get(`${id}|${competencia}`);
    if (!excecao && !cfg?.dia) continue;
    if (cfg?.inicio && cfg.inicio.slice(0, 7) > competencia) continue;
    const prazo = excecao ? new Date(`${excecao.slice(0, 10)}T23:59:59`) : prazoChecklist(competencia, cfg!.dia!);
    const envio = ck.envios.get(`${id}|${competencia}`);
    if (envio) {
      total++;
      if (new Date(envio).getTime() <= prazo.getTime()) noPrazo++;
    } else if (prazo.getTime() < hoje.getTime()) {
      total++;
    }
  }
  if (total === 0) return null;
  return { no_prazo: noPrazo, total, pct: arred((noPrazo / total) * 100) };
}

/** Último dia da competência "YYYY-MM" (quando a nota não tem emissão). */
function fimDaCompetencia(c: string): Date {
  const [a, m] = c.split("-").map(Number);
  return new Date(a, m, 0);
}

/**
 * Do A Receber da nota (aReceberDaNf), o que em `hoje` está vencido há mais
 * de 90 dias. Vencimento = emissão + 30 dias.
 */
export function vencidoMais90(n: NfComEmissao, hoje: Date): number {
  const saldo = aReceberDaNf(n);
  if (saldo <= 0) return 0;
  const emissao = n.data_emissao ? new Date(`${n.data_emissao.slice(0, 10)}T00:00:00`) : fimDaCompetencia(n.competencia.slice(0, 7));
  emissao.setDate(emissao.getDate() + DIAS_VENCIMENTO + DIAS_VENCIDO);
  return emissao.getTime() < hoje.getTime() ? saldo : 0;
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

interface Mes { liquido: number; custo: number; notas: number; recebido: number; aReceber: number; vencido90: number }

function porMes(e: EntradaFaturamento): Map<string, Mes> {
  const mapa = new Map<string, Mes>();
  const pega = (mes: string) =>
    mapa.get(mes) ?? (mapa.set(mes, { liquido: 0, custo: 0, notas: 0, recebido: 0, aReceber: 0, vencido90: 0 }), mapa.get(mes)!);
  const nfs = e.nfs.filter((n) => e.contratos.has(n.contrato_id));
  for (const [mes, t] of agruparFaturamento(nfs, (n) => n.competencia.slice(0, 7))) {
    const m = pega(mes);
    m.liquido += t.liquido;
    m.notas += t.notas;
    m.recebido += t.recebido;
    m.aReceber += t.aReceber;
  }
  const hoje = e.hoje ?? new Date();
  for (const n of nfs) {
    if (notaValidaNoFaturamento(n)) pega(n.competencia.slice(0, 7)).vencido90 += vencidoMais90(n, hoje);
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
 * Troca nos dados da RPC tudo o que vem do DRE e das notas pela conta do
 * Faturamento da Empresa. Da RPC só fica a lista de competências.
 */
export function painelPeloFaturamento(d: DadosPainelExecutivo, e: EntradaFaturamento): DadosPainelExecutivo {
  const meses = porMes(e);
  const ant = mesAnterior(d.competencia);
  const hoje = e.hoje ?? new Date();
  const mAtual = meses.get(d.competencia);
  const mAnt = meses.get(ant);
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
    nf: {
      qtd: mAtual?.notas ?? 0,
      recebido: arred(mAtual?.recebido ?? 0),
      recebido_ant: arred(mAnt?.recebido ?? 0),
      saldo: arred(mAtual?.aReceber ?? 0),
      saldo_ant: arred(mAnt?.aReceber ?? 0),
      vencido_90: arred(mAtual?.vencido90 ?? 0),
      vencido_90_ant: arred(mAnt?.vencido90 ?? 0),
    },
    no_prazo: faturadoNoPrazo(d.competencia, e.contratos.keys(), e.checklist, hoje),
    no_prazo_anterior: faturadoNoPrazo(ant, e.contratos.keys(), e.checklist, hoje),
  };
}
