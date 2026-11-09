// =====================================================================
// Operacional › Indicadores › PAINEL EXECUTIVO (09/11/2026)
//
// Regra que governa este arquivo: número ruim (ou bom) na tela só se for
// verdadeiro. Card sem fonte, ou competência depois do fim do DRE, fica SEM
// número. Nunca zero no lugar de "não sei".
// As contas ficam na RPC ope_painel_executivo; aqui só a leitura delas.
// =====================================================================

export interface LinhaDre {
  receita: number;
  custo: number;
  lucro: number;
  margem: number;
}

export interface DadosPainelExecutivo {
  competencia: string;
  ultima_dre: string | null;
  competencias: string[];
  dre: LinhaDre | null;
  dre_anterior: LinhaDre | null;
  nf: {
    qtd: number;
    recebido: number;
    recebido_ant: number;
    saldo: number;
    saldo_ant: number;
    vencido_90: number;
    vencido_90_ant: number;
  };
  serie: { competencia: string; receita: number; lucro: number }[];
  situacao: { saudavel: number; atencao: number; critico: number } | null;
  /** Mig 20261109003100; ausente enquanto a migration não entrou. */
  situacao_detalhe?: DetalheSituacao | null;
  critico_anterior: number | null;
}

export interface ContratoSituacao {
  nome: string;
  receita: number;
  margem: number;
}

export interface DetalheSituacao {
  contratos: Partial<Record<"saudavel" | "atencao" | "critico", ContratoSituacao[]>>;
  abaixo_piso: number;
  ativos: number;
}

/** Explica a diferença entre os contratos da rosca e os ativos; null sem o detalhe. */
export function textoForaDaRosca(total: number, d: DetalheSituacao | null | undefined): string | null {
  if (!d) return null;
  const semReceita = Math.max(0, d.ativos - total - d.abaixo_piso);
  return `${total} de ${d.ativos} contratos não encerrados. Fora da conta: ${d.abaixo_piso} com receita abaixo de R$ 10 mil e ${semReceita} sem receita no DRE desta competência (estimativa: ativos menos classificados).`;
}

export type Medida = "real" | "parcial" | "sem_fonte";
export type SentidoVariacao = "melhor" | "pior" | "neutro";

export interface Variacao {
  texto: string;
  seta: "sobe" | "desce" | "igual";
  sentido: SentidoVariacao;
}

export interface CardIndicador {
  chave: string;
  titulo: string;
  medida: Medida;
  valor: string | null;
  aviso: string | null;
  variacao: Variacao | null;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** "2026-05" → "Mai/2026". */
export function rotuloCompetencia(c: string): string {
  const [a, m] = c.split("-");
  return `${MESES_LONGOS[Number(m) - 1]}/${a}`;
}

/** "2026-05" → "mai/26", para o eixo do gráfico. */
export function rotuloEixo(c: string): string {
  const [a, m] = c.split("-");
  return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
}

export const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ");

export const fmtPct = (v: number, casas = 2) =>
  `${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

/** Eixo do gráfico: 12500000 → "12,5M". */
export function fmtCompacto(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  if (a >= 1e3) return `${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}k`;
  return v.toLocaleString("pt-BR");
}

function montarVariacao(delta: number, texto: string, maiorEhMelhor: boolean): Variacao {
  if (delta === 0) return { texto, seta: "igual", sentido: "neutro" };
  return { texto, seta: delta > 0 ? "sobe" : "desce", sentido: delta > 0 === maiorEhMelhor ? "melhor" : "pior" };
}

const sinal = (v: number) => (v > 0 ? "+" : "");

/**
 * Variação percentual. Sem base (anterior nulo ou zero) não há percentual a
 * mostrar: dividir por zero viraria "+Infinity%".
 */
export function variacaoPct(atual: number | null | undefined, anterior: number | null | undefined, maiorEhMelhor: boolean): Variacao | null {
  if (atual == null || anterior == null || anterior === 0) return null;
  const delta = ((atual - anterior) / Math.abs(anterior)) * 100;
  const arred = Math.round(delta * 10) / 10;
  return montarVariacao(arred, `${sinal(arred)}${arred.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`, maiorEhMelhor);
}

/** Variação em pontos percentuais (margem). */
export function variacaoPP(atual: number | null | undefined, anterior: number | null | undefined): Variacao | null {
  if (atual == null || anterior == null) return null;
  const arred = Math.round((atual - anterior) * 10) / 10;
  return montarVariacao(arred, `${sinal(arred)}${arred.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p.`, true);
}

/** Variação em quantidade: contrato crítico a mais é pior. */
export function variacaoQtd(atual: number | null | undefined, anterior: number | null | undefined): Variacao | null {
  if (atual == null || anterior == null) return null;
  const delta = atual - anterior;
  return montarVariacao(delta, `${sinal(delta)}${delta}`, false);
}

/** Frase que aparece onde o DRE não alcança a competência escolhida. */
export function avisoSemDre(d: Pick<DadosPainelExecutivo, "ultima_dre">): string {
  return d.ultima_dre ? `DRE disponível até ${rotuloCompetencia(d.ultima_dre)}` : "DRE sem competência carregada";
}

export function montarCards(d: DadosPainelExecutivo): CardIndicador[] {
  const semDre = d.dre ? null : avisoSemDre(d);
  const temNf = d.nf.qtd > 0;
  const semNf = temNf ? null : "Nenhuma NF concluída até esta competência";
  const estimado = "Só vê o que foi baixado na NF";

  return [
    {
      chave: "receita", titulo: "Receita (DRE)", medida: "real",
      valor: d.dre ? fmtBRL(d.dre.receita) : null, aviso: semDre,
      variacao: variacaoPct(d.dre?.receita, d.dre_anterior?.receita, true),
    },
    {
      chave: "lucro", titulo: "Lucro Bruto", medida: "real",
      valor: d.dre ? fmtBRL(d.dre.lucro) : null, aviso: semDre,
      variacao: variacaoPct(d.dre?.lucro, d.dre_anterior?.lucro, true),
    },
    {
      chave: "margem", titulo: "Margem Bruta", medida: "real",
      valor: d.dre ? fmtPct(d.dre.margem) : null, aviso: semDre,
      variacao: variacaoPP(d.dre?.margem, d.dre_anterior?.margem),
    },
    {
      // Não existe data-limite de faturamento no ERP: o checklist só tem
      // limite de entrega de documentos, que é outra coisa.
      chave: "no_prazo", titulo: "% Faturado no Prazo", medida: "sem_fonte",
      valor: null, aviso: "O ERP não registra o prazo de faturamento", variacao: null,
    },
    {
      chave: "recebido", titulo: "Valor Recebido", medida: "parcial",
      valor: temNf ? fmtBRL(d.nf.recebido) : null, aviso: semNf ?? estimado,
      variacao: temNf ? variacaoPct(d.nf.recebido, d.nf.recebido_ant, true) : null,
    },
    {
      chave: "saldo", titulo: "Saldo a Receber", medida: "parcial",
      valor: temNf ? fmtBRL(d.nf.saldo) : null, aviso: semNf ?? "NFs sem baixa no fim da competência",
      variacao: temNf ? variacaoPct(d.nf.saldo, d.nf.saldo_ant, false) : null,
    },
    {
      chave: "vencido", titulo: "Saldo Vencido > 90 dias", medida: "parcial",
      valor: temNf ? fmtBRL(d.nf.vencido_90) : null, aviso: semNf ?? "Vencimento estimado: emissão + 30 dias",
      variacao: temNf ? variacaoPct(d.nf.vencido_90, d.nf.vencido_90_ant, false) : null,
    },
    {
      chave: "criticos", titulo: "Contratos Críticos", medida: "parcial",
      valor: d.situacao ? String(d.situacao.critico) : null, aviso: semDre ?? "Margem negativa; só pela margem",
      variacao: variacaoQtd(d.situacao?.critico, d.critico_anterior),
    },
  ];
}

export interface FatiaSituacao {
  chave: "saudavel" | "atencao" | "critico";
  nome: string;
  qtd: number;
  pct: number;
}

/** Fatias da rosca, com o percentual sobre os contratos classificados. */
export function fatiasSituacao(s: DadosPainelExecutivo["situacao"]): { total: number; fatias: FatiaSituacao[] } {
  const base = s ?? { saudavel: 0, atencao: 0, critico: 0 };
  const total = base.saudavel + base.atencao + base.critico;
  const fatia = (chave: FatiaSituacao["chave"], nome: string): FatiaSituacao => ({
    chave, nome, qtd: base[chave], pct: total > 0 ? Math.round((base[chave] / total) * 1000) / 10 : 0,
  });
  return { total, fatias: [fatia("saudavel", "Saudável"), fatia("atencao", "Atenção"), fatia("critico", "Crítico")] };
}
