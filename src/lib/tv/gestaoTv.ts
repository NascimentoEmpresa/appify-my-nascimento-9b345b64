// =====================================================================
// TVs de GESTÃO — Financeiro, Controladoria e Presidência (11/11/2026,
// mig 20261111230000).
//
//   · Financeiro  = a conta do Controle de Faturamento (tv_financeiro_dados);
//   · Controladoria = a do Faturamento da Empresa (tv_controladoria_dados);
//   · Presidência = o que as TVs Operacional, Controladoria, Financeiro e RH
//     já calculam (tv_presidencia_dados) — nenhuma conta nova aqui.
// Regra das TVs (Pablo): "ruim" só quando é verdadeiro.
// =====================================================================

import { linhasDaTv, type DadosOpeContratosTv } from "@/lib/tv/opeContratosTv";
import { acimaDoOrcamento, desvioTotal, type DadosRhSalariosTv } from "@/lib/tv/rhSalariosTv";
import type { LinhaContrato } from "@/lib/operacional/indicadoresContratos";

export interface DadosFinPainelTv {
  competencia: string;
  kpis: {
    vigentes: number; executavel: number; executado: number; faturado: number; liquido: number; recebido: number;
    conta_vinculada: number; nao_emitido: number; excesso: number; lancadas: number; parciais: number; pendentes: number; sem_dados: number;
  } | null;
  evolucao: { mes: string; executavel: number; faturado: number; recebido: number }[];
  pendentes: { contrato: string; cliente: string | null; status: string; executavel: number; faturado: number; nao_emitido: number }[];
  inadimplencia: { valor: number; notas: number; mais_de_90: number } | null;
  gerado_em?: string;
}

export interface ContratoLucro { contrato: string; liquido: number; lucro: number; margem: number }
export interface DadosCtlPainelTv {
  competencia: string;
  kpis: {
    bruto: number | null; liquido: number | null; recebido: number | null; a_receber: number | null; conta_vinculada: number | null;
    despesas: number | null; lucro: number | null; margem: number | null; notas: number | null; contratos: number | null;
  } | null;
  evolucao: { mes: string; liquido: number; despesas: number; lucro: number }[];
  melhores: ContratoLucro[];
  piores: ContratoLucro[];
  gerado_em?: string;
}

export interface DadosPrePainelTv {
  operacional: DadosOpeContratosTv;
  controladoria: DadosCtlPainelTv;
  financeiro: DadosFinPainelTv;
  rh: DadosRhSalariosTv;
  gerado_em?: string;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloMesTv = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
export const brlTv = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
/** "R$ 1,2 mi" / "R$ 350 mil" para caber no card. */
export function brlCurto(v: number | null | undefined): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return brlTv(v);
}

export type TomGestao = "bom" | "atencao" | "critico" | "neutro";

/** % recebido do faturado no Controle de Faturamento. */
export const pctRecebido = (k: DadosFinPainelTv["kpis"]) => (k && k.faturado > 0 ? Math.round((k.recebido / k.faturado) * 1000) / 10 : null);

/** Não emitido: até 2% do executável é ruído de lançamento; até 10%, atenção. */
export function tomNaoEmitido(k: DadosFinPainelTv["kpis"]): TomGestao {
  if (!k || !(k.executavel > 0)) return "neutro";
  const p = (k.nao_emitido / k.executavel) * 100;
  return p <= 2 ? "bom" : p <= 10 ? "atencao" : "critico";
}

/** Margem: negativa é crítica; abaixo de 10% (o mínimo usado nos Indicadores por Contrato), atenção. */
export const tomMargem = (m: number | null | undefined): TomGestao => (m == null ? "neutro" : m < 0 ? "critico" : m < 10 ? "atencao" : "bom");

/** "Contrato vermelho": dois ou mais indicadores críticos nos Indicadores por Contrato. */
export const ehContratoVermelho = (l: LinhaContrato) => l.criticos >= 2;

export interface ResumoPresidencia {
  margem: number | null; lucro: number | null; liquido: number | null;
  piores: ContratoLucro[];
  vermelhos: LinhaContrato[];
  postos: { contratados: number; cobertos: number; contratos: number };
  glosas: { valor: number; qtd: number };
  retencoes: number | null;
  salarios: { desvio: number | null; acima: number; total: number };
  notasPendentes: { contratos: number; valor: number } | null;
  inadimplencia: DadosFinPainelTv["inadimplencia"];
  insatisfeitos: { contrato: string; qtd: number }[];
}

/** O que a Presidência mostra, tirado das outras TVs. */
export function resumoPresidencia(d: DadosPrePainelTv): ResumoPresidencia {
  const linhas = d.operacional?.contratos ? linhasDaTv(d.operacional) : [];
  const ativos = (d.operacional?.contratos ?? []).filter((c) => !c.encerrado);
  const postosC = ativos.filter((c) => (c.postos?.contratados ?? 0) > 0);
  const fk = d.financeiro?.kpis ?? null;
  return {
    margem: d.controladoria?.kpis?.margem ?? null,
    lucro: d.controladoria?.kpis?.lucro ?? null,
    liquido: d.controladoria?.kpis?.liquido ?? null,
    piores: (d.controladoria?.piores ?? []).filter((c) => c.lucro < 0 || c.margem < 10).slice(0, 5),
    vermelhos: linhas.filter(ehContratoVermelho),
    postos: {
      contratados: postosC.reduce((a, c) => a + (c.postos?.contratados ?? 0), 0),
      cobertos: postosC.reduce((a, c) => a + Math.min(c.postos?.cobertos ?? 0, c.postos?.contratados ?? 0), 0),
      contratos: postosC.filter((c) => (c.postos?.cobertos ?? 0) < (c.postos?.contratados ?? 0)).length,
    },
    glosas: { valor: ativos.reduce((a, c) => a + (c.glosas?.valor ?? 0), 0), qtd: ativos.reduce((a, c) => a + (c.glosas?.qtd ?? 0), 0) },
    retencoes: fk ? fk.conta_vinculada : null,
    salarios: { desvio: d.rh ? desvioTotal(d.rh) : null, acima: d.rh ? acimaDoOrcamento(d.rh) : 0, total: d.rh?.contratos?.length ?? 0 },
    notasPendentes: fk ? { contratos: fk.pendentes + fk.parciais, valor: fk.nao_emitido } : null,
    inadimplencia: d.financeiro?.inadimplencia ?? null,
    insatisfeitos: ativos.filter((c) => (c.reclamacoes?.qtd ?? 0) > 0)
      .map((c) => ({ contrato: c.nome, qtd: c.reclamacoes.qtd })).sort((a, b) => b.qtd - a.qtd).slice(0, 5),
  };
}
