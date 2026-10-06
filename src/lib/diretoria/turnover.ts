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
  ano: number; mes: number | null; de: string; ate: string; fator_projecao: number; efetivo_medio: number;
  mensal: MesTurnover[]; por_empresa: EmpresaTurnover[]; por_contrato: ContratoTurnover[];
  causas: { causa: string; n: number }[]; contratos: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "1050 - UFRGS - LIMPEZA GERAL - 047/2022" → "UFRGS - LIMPEZA GERAL - 047/2022" (o código da filial só polui o gráfico). */
export const nomeContrato = (c: string) => c.replace(/^\s*\d+\s*-\s*/, "");

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
