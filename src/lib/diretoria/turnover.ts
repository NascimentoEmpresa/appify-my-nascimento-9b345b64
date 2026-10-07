// =====================================================================
// Diretoria › Relatórios › Turn-over — contas do painel (mig 20261006000003)
//
// Pedido (06/10/2026): o Turn-over "tem que ficar assim", no formato do
// Power BI "TURNOVER GRUPO NASCIMENTO" — páginas Resumo e Analistas (a de
// Valores das rescisões depende das verbas da Senior, fica para depois).
// A RPC dir_turnover_painel devolve contagens e efetivos; as porcentagens,
// metas e projeções saem daqui, para o teste cobrir as regras:
//   · mês: demissões ÷ efetivo no fim do mês; ano: SOMA das taxas mensais
//     (é assim que o Power BI chega nos 32,7% de jan–jul/2026);
//   · metas: 41% no ano, 41 ÷ 12 = 3,42% no mês;
//   · Analistas: aviso trabalhado até 23%, indenizado até 5%, demissão até
//     100% do efetivo; limite em quantidade = efetivo × % arredondado para
//     cima; projeção = acumulado × fator (dias do ano ÷ dias decorridos).
// =====================================================================

export const META_ANUAL = 41;
export const META_MENSAL = Math.round((META_ANUAL / 12) * 100) / 100;
export const LIMITES = { trabalhado: 23, indenizado: 5, demissao: 100 } as const;
export type TipoLimite = keyof typeof LIMITES;

export interface MesTurnover { mes: string; efetivo: number; demissoes: number; taxa: number | null }
export interface EmpresaTurnover { empresa: string; efetivo_medio: number; demissoes: number; taxa: number | null }
export interface ContratoTurnover {
  contrato: string; empresa: string; efetivo_medio: number; efetivo_atual: number;
  /** Demissões dentro do recorte de tipo de desligamento. */
  demissoes: number;
  /** Todas as demissões (a página Analistas não usa o recorte). */
  demissoes_todas: number;
  aviso_trabalhado: number; aviso_indenizado: number;
}
export interface PainelTurnover {
  ano: number; mes: number | null;
  /** Meses que entraram na conta (mig 20261007000003) — 1 a 12, em ordem. */
  meses: number[];
  de: string; ate: string; fator_projecao: number; efetivo_medio: number;
  mensal: MesTurnover[]; por_empresa: EmpresaTurnover[]; por_contrato: ContratoTurnover[];
  causas: { causa: string; n: number }[]; contratos: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "1050 - UFRGS - LIMPEZA GERAL - 047/2022" → "UFRGS - LIMPEZA GERAL - 047/2022" (o código da filial só polui o gráfico). */
export const nomeContrato = (c: string) => c.replace(/^\s*\d+\s*-\s*/, "");

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/**
 * Texto do filtro de meses (07/10/2026, "deixar selecionável os meses — ver
 * mais de um ou só um"). null/vazio = ano inteiro; um mês = nome por extenso;
 * meses seguidos = "Mar a jul"; soltos = "Jan, mar, jul" (até 4) ou "N meses".
 */
export function rotuloMeses(meses: number[] | null | undefined): string {
  const m = [...new Set(meses ?? [])].filter((x) => x >= 1 && x <= 12).sort((a, b) => a - b);
  if (m.length === 0 || m.length === 12) return "Ano inteiro";
  if (m.length === 1) return MESES_LONGOS[m[0] - 1];
  const seguidos = m.every((x, i) => i === 0 || x === m[i - 1] + 1);
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  if (seguidos) return `${cap(MESES_CURTOS[m[0] - 1])} a ${MESES_CURTOS[m[m.length - 1] - 1]}`;
  if (m.length <= 4) return cap(m.map((x) => MESES_CURTOS[x - 1]).join(", "));
  return `${m.length} meses`;
}

/** Turnover do ano (soma das taxas mensais) e a projeção para o ano inteiro. */
export function turnoverDoAno(p: Pick<PainelTurnover, "mensal" | "fator_projecao">) {
  const taxa = r2(p.mensal.reduce((s, m) => s + (m.taxa ?? 0), 0));
  const demissoes = p.mensal.reduce((s, m) => s + m.demissoes, 0);
  return { taxa, demissoes, projecao: r2(taxa * (p.fator_projecao || 1)), acimaDaMeta: taxa > META_ANUAL };
}

/** Os 12 meses do ano — os que ainda não chegaram vêm sem taxa (só a meta aparece). */
export function dozeMeses(p: Pick<PainelTurnover, "ano" | "mensal">): MesTurnover[] {
  return Array.from({ length: 12 }, (_, i) => {
    const mes = `${p.ano}-${String(i + 1).padStart(2, "0")}`;
    return p.mensal.find((m) => m.mes === mes) ?? { mes, efetivo: 0, demissoes: 0, taxa: null };
  });
}

/** Turnover por contrato: em relação ao efetivo do grupo e ao do próprio contrato. */
export function turnoverPorContrato(p: Pick<PainelTurnover, "por_contrato" | "efetivo_medio">) {
  return p.por_contrato
    .filter((c) => c.demissoes > 0)
    .map((c) => ({
      contrato: c.contrato, nome: nomeContrato(c.contrato), demissoes: c.demissoes,
      grupo: p.efetivo_medio > 0 ? r2((c.demissoes * 100) / p.efetivo_medio) : null,
      proprio: c.efetivo_medio > 0 ? r2((c.demissoes * 100) / c.efetivo_medio) : null,
    }));
}

/** Quantidade máxima no ano para um contrato: efetivo × limite, para cima. */
export const limiteQuantidade = (efetivo: number, tipo: TipoLimite) => Math.ceil((efetivo * LIMITES[tipo]) / 100);

const qtdDe = (c: ContratoTurnover, tipo: TipoLimite) =>
  tipo === "trabalhado" ? c.aviso_trabalhado : tipo === "indenizado" ? c.aviso_indenizado : c.demissoes_todas;

export interface LinhaAnalista {
  contrato: string; nome: string; efetivo: number; qtd: number; limite: number;
  pct: number; projecao: number; estourou: boolean; vaiEstourar: boolean;
}

/** Página Analistas: % atual e projetado de cada contrato frente ao limite. */
export function analistas(p: Pick<PainelTurnover, "por_contrato" | "fator_projecao">, tipo: TipoLimite): LinhaAnalista[] {
  return p.por_contrato
    .filter((c) => c.efetivo_atual > 0)
    .map((c) => {
      const qtd = qtdDe(c, tipo);
      const pct = r2((qtd * 100) / c.efetivo_atual);
      const projecao = r2(pct * (p.fator_projecao || 1));
      return {
        contrato: c.contrato, nome: nomeContrato(c.contrato), efetivo: c.efetivo_atual, qtd,
        limite: limiteQuantidade(c.efetivo_atual, tipo), pct, projecao,
        estourou: pct > LIMITES[tipo], vaiEstourar: projecao > LIMITES[tipo],
      };
    })
    .sort((a, b) => b.pct - a.pct || b.qtd - a.qtd || a.nome.localeCompare(b.nome));
}

/** Total do grupo (os três mostradores do topo da página Analistas). */
export function totalAnalistas(p: Pick<PainelTurnover, "por_contrato" | "fator_projecao">, tipo: TipoLimite) {
  const efetivo = p.por_contrato.reduce((s, c) => s + c.efetivo_atual, 0);
  const qtd = p.por_contrato.reduce((s, c) => s + qtdDe(c, tipo), 0);
  const pct = efetivo > 0 ? r2((qtd * 100) / efetivo) : 0;
  return { efetivo, qtd, pct, projecao: r2(pct * (p.fator_projecao || 1)), limite: LIMITES[tipo] };
}

// ---- Aba "Turnover em Valores" — por enquanto em quantidades (mig 20261007000006) ----
// A Senior manda as verbas e o holerite com o valor vazio; até isso mudar, a
// aba mostra quantas rescisões, de que perfil e com quais verbas de férias.

export interface RescisoesTurnover {
  ano: number; meses: number[]; total: number;
  tempo_medio_dias: number | null; tempo_mediano_dias: number | null;
  por_faixa: { ordem: number; faixa: string; n: number }[];
  por_mes: { mes: string; n: number }[];
  por_empresa: { empresa: string; n: number }[];
  por_causa: { causa: string; n: number }[];
  por_contrato: { contrato: string; n: number; ate_3m: number; tempo_medio_dias: number | null }[];
  avisos: { modelo: string; n: number }[];
  verbas: { codigo: number; verba: string; n: number }[];
}

/** Tempo de casa legível: 45 → "45 dias"; 170 → "5 meses"; 391 → "1 ano"; 453 → "1 ano e 2 meses". */
export function tempoDeCasa(dias: number | null | undefined): string {
  if (dias == null || !Number.isFinite(dias)) return "—";
  const d = Math.round(dias);
  if (d < 60) return `${d} dia${d === 1 ? "" : "s"}`;
  const mesesTot = Math.floor(d / 30.4375);
  const anos = Math.floor(mesesTot / 12), meses = mesesTot % 12;
  const a = anos ? `${anos} ano${anos > 1 ? "s" : ""}` : "";
  const m = meses ? `${meses} ${meses > 1 ? "meses" : "mês"}` : "";
  return [a, m].filter(Boolean).join(" e ") || "1 ano";
}

/** % de uma parte sobre o total, 1 casa (0 quando não há total). */
export const pctDe = (parte: number, total: number) => (total > 0 ? Math.round((parte * 1000) / total) / 10 : 0);
