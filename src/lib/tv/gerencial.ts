// =====================================================================
// TVs GERENCIAIS POR DIRETORIA (12/10/2026, mig 20261012000001) — SIS-2026-0635
//
// Pedido do chamado: "fazer as telas para TVs conforme os anexos" — o
// documento "Indicadores das TVs — Separação por Diretoria e Áreas
// Transversais" (13 TVs). Os números vêm de tvg_painel_dados (banco); aqui
// ficam as regras da APRESENTAÇÃO que o documento manda (Parte IV), com
// teste em src/test/tvs-gerenciais.test.ts:
//   · semáforo pela meta e pelo limite de atenção, no sentido do indicador;
//   · "exibir prioritariamente indicadores fora da meta" e "ordenação pelo
//     impacto absoluto, não somente o percentual";
//   · o formato de cada indicador: resultado, meta, afetado, causa e
//     responsável ("Glosas: R$ 80 mil — 3 contratos — maior causa: posto
//     descoberto — responsável: Operação").
// =====================================================================

export type Unidade = "qtd" | "pct" | "brl" | "dias";
export type Sentido = "menor" | "maior";
export type Fonte = "auto" | "manual" | "espelho" | "soma";
export type Situacao = "vermelho" | "amarelo" | "verde" | "neutro" | "sem_dado";

export interface LinhaDetalhe { nome: string; valor: number | null; rotulo?: string | null }

export interface ResultadoIndicador {
  valor: number | string | null;
  afetado?: string | null; causa?: string | null; impacto?: number | string | null; base?: string | null;
  detalhe?: LinhaDetalhe[] | null; erro?: string | null; origem?: string | null;
  referencia?: string | null; atualizado_em?: string | null; observacao?: string | null;
}

export interface IndicadorGerencial {
  codigo: string; nome: string; identificar: string; regra: string | null; fonte: Fonte; unidade: Unidade; sentido: Sentido;
  meta: number | string | null; alerta: number | string | null; periodicidade: "diaria" | "semanal" | "mensal";
  responsavel: string | null; pai: string | null; na_tv: boolean; ordem: number;
  parametro: number | string | null; parametro_rotulo: string | null; espelho_de: string | null;
  resultado: ResultadoIndicador;
}

export interface PainelGerencial {
  painel: { slug: string; titulo: string; diretoria: string; pergunta: string } | null;
  indicadores: IndicadorGerencial[];
  gerado_em?: string;
}

/** As 13 TVs do documento — slug (= relatorio do item da playlist), cor e ícone. */
export const PAINEIS_GERENCIAIS: { slug: string; titulo: string; diretoria: string; cor: string; icone: string }[] = [
  { slug: "ger-operacional", titulo: "Gerência Operacional", diretoria: "Diretor Operacional", cor: "#1d4ed8", icone: "Briefcase" },
  { slug: "ger-licitacoes", titulo: "Licitações", diretoria: "Diretor Operacional", cor: "#0e7490", icone: "Gavel" },
  { slug: "ger-supply", titulo: "Supply", diretoria: "Diretor Operacional", cor: "#b45309", icone: "Package" },
  { slug: "ger-frota", titulo: "Frota e Patrimônio", diretoria: "Diretor Operacional", cor: "#475569", icone: "Truck" },
  { slug: "ger-recrutamento", titulo: "Recrutamento e Seleção", diretoria: "Diretora Administrativa", cor: "#4338ca", icone: "UserPlus" },
  { slug: "ger-rh", titulo: "RH e Departamento Pessoal", diretoria: "Diretora Administrativa", cor: "#7c3aed", icone: "Users" },
  { slug: "ger-sst", titulo: "SST", diretoria: "Diretora Administrativa", cor: "#15803d", icone: "HardHat" },
  { slug: "ger-treinamento", titulo: "Treinamento", diretoria: "Diretora Administrativa", cor: "#f26522", icone: "GraduationCap" },
  { slug: "ger-financeiro", titulo: "Financeiro", diretoria: "Diretora Administrativa", cor: "#047857", icone: "Wallet" },
  { slug: "ger-juridico", titulo: "Jurídico", diretoria: "Diretora Administrativa", cor: "#9f1239", icone: "Scale" },
  { slug: "ger-controladoria", titulo: "Controladoria", diretoria: "Áreas Transversais", cor: "#0f766e", icone: "Calculator" },
  { slug: "ger-ti", titulo: "TI / ERP", diretoria: "Áreas Transversais", cor: "#334155", icone: "Server" },
  { slug: "ger-presidencia", titulo: "Presidência", diretoria: "Presidência", cor: "#111827", icone: "Crown" },
];
export const ehPainelGerencial = (slug: string | null | undefined) => !!slug && slug.startsWith("ger-");
export const painelGerencial = (slug: string | null | undefined) => PAINEIS_GERENCIAIS.find((p) => p.slug === slug) ?? null;

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Semáforo. Sentido "menor" (quanto menor, melhor): até a meta = verde; até o
 * limite de atenção = amarelo; acima = vermelho. "maior": o espelho. Sem meta
 * = neutro (só acompanhamento). Sem valor = sem dado.
 */
export function situacao(i: Pick<IndicadorGerencial, "meta" | "alerta" | "sentido"> & { resultado: Pick<ResultadoIndicador, "valor"> }): Situacao {
  const v = num(i.resultado?.valor);
  if (v == null) return "sem_dado";
  const meta = num(i.meta);
  if (meta == null) return "neutro";
  const alerta = num(i.alerta);
  if (i.sentido === "maior") {
    if (v >= meta) return "verde";
    return alerta != null && v >= alerta ? "amarelo" : "vermelho";
  }
  if (v <= meta) return "verde";
  return alerta != null && v <= alerta ? "amarelo" : "vermelho";
}

const PESO: Record<Situacao, number> = { vermelho: 0, amarelo: 1, sem_dado: 2, neutro: 3, verde: 4 };

/** Quanto o indicador está fora da meta, em valor absoluto (0 se dentro ou sem meta). */
export function desvio(i: Pick<IndicadorGerencial, "meta" | "sentido"> & { resultado: Pick<ResultadoIndicador, "valor"> }): number {
  const v = num(i.resultado?.valor), meta = num(i.meta);
  if (v == null || meta == null) return 0;
  return Math.max(0, i.sentido === "maior" ? meta - v : v - meta);
}

/**
 * A ordem da TV: fora da meta primeiro (vermelho, amarelo), depois sem dado,
 * acompanhamento e os que estão bem. Dentro do grupo, pelo IMPACTO ABSOLUTO
 * (R$ em jogo, quando o cálculo/lançamento informa) e então pelo desvio da
 * meta — e só então pela ordem do documento.
 */
export function ordenarParaTv<T extends IndicadorGerencial>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    const s = PESO[situacao(a)] - PESO[situacao(b)];
    if (s) return s;
    const ia = Math.abs(num(a.resultado?.impacto) ?? 0), ib = Math.abs(num(b.resultado?.impacto) ?? 0);
    if (ia !== ib) return ib - ia;
    const da = desvio(a), db = desvio(b);
    if (da !== db) return db - da;
    return a.ordem - b.ordem;
  });
}

/** Só os que vão para a TV (os subindicadores ficam no detalhe do sistema). */
export const indicadoresDaTv = (p: PainelGerencial | null | undefined) => ordenarParaTv((p?.indicadores ?? []).filter((i) => i.na_tv));

/** Subindicadores de um consolidado (pai) ou do painel (sem pai e fora da TV). */
export const subindicadores = (p: PainelGerencial | null | undefined, pai: string | null) =>
  (p?.indicadores ?? []).filter((i) => !i.na_tv && (pai ? i.pai === pai : !i.pai));

/** Número curto para a TV: R$ 1,2 mi / R$ 80 mil / 12,5% / 138. */
export function formatarValor(v: number | string | null | undefined, unidade: Unidade, curto = true): string {
  const n = num(v);
  if (n == null) return "—";
  if (unidade === "pct") return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (unidade === "dias") return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} d`;
  if (unidade === "brl") {
    const a = Math.abs(n);
    if (curto && a >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
    if (curto && a >= 10_000) return `R$ ${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
    const casas = a >= 1000 || Number.isInteger(n) ? 0 : 2; // mínimo explícito: navegador de TV antigo recusa máximo < mínimo padrão
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
  }
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/** "Meta ≤ 0" / "Meta ≥ 95%" / "Sem meta" — o texto da comparação com a meta. */
export function textoMeta(i: Pick<IndicadorGerencial, "meta" | "sentido" | "unidade">): string {
  const meta = num(i.meta);
  if (meta == null) return "Sem meta · acompanhamento";
  return `Meta ${i.sentido === "maior" ? "≥" : "≤"} ${formatarValor(meta, i.unidade)}`;
}

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  vermelho: "Fora da meta", amarelo: "Atenção", verde: "Na meta", neutro: "Acompanhar", sem_dado: "Sem dado",
};
export const COR_SITUACAO: Record<Situacao, string> = {
  vermelho: "#dc2626", amarelo: "#d97706", verde: "#16a34a", neutro: "#2563eb", sem_dado: "#71717a",
};

export const ROTULO_FONTE: Record<Fonte, string> = {
  auto: "Calculado do ERP", manual: "Lançamento", espelho: "Espelho de outra TV", soma: "Consolidado (soma)",
};
export const ROTULO_PERIODICIDADE = { diaria: "Diária", semanal: "Semanal", mensal: "Mensal" } as const;

/** Lançamento manual em atraso pela periodicidade (a mesma tolerância do ctl_nao_atualizados). */
export function lancamentoAtrasado(i: Pick<IndicadorGerencial, "fonte" | "periodicidade"> & { resultado: Pick<ResultadoIndicador, "atualizado_em"> }, agora = new Date()): boolean {
  if (i.fonte !== "manual") return false;
  if (!i.resultado?.atualizado_em) return true;
  const tol = i.periodicidade === "diaria" ? 2 : i.periodicidade === "semanal" ? 8 : 35;
  return agora.getTime() - new Date(i.resultado.atualizado_em).getTime() > tol * 86_400_000;
}

/** O resumo da TV numa linha, no formato "adequado" do documento. */
export function frase(i: IndicadorGerencial): string {
  const partes = [`${i.nome}: ${formatarValor(i.resultado?.valor, i.unidade)}`];
  if (i.resultado?.afetado) partes.push(i.resultado.afetado);
  if (i.resultado?.causa) partes.push(`maior causa: ${i.resultado.causa}`);
  if (i.responsavel) partes.push(`responsável: ${i.responsavel}`);
  return partes.join(" — ");
}

/** Contagem por situação (o placar do topo da TV). */
export function placar(itens: IndicadorGerencial[]): Record<Situacao, number> {
  const p: Record<Situacao, number> = { vermelho: 0, amarelo: 0, verde: 0, neutro: 0, sem_dado: 0 };
  for (const i of itens) p[situacao(i)]++;
  return p;
}

/**
 * As páginas da TV: 1 com os indicadores (até 8) e até 2 "por contrato" com o
 * detalhamento dos fora da meta que têm detalhe (o documento: "detalhes no
 * sistema"; na TV só o essencial de quem está vermelho).
 */
export function paginasGerencial(p: PainelGerencial): { chave: string; titulo: string }[] {
  const ps = [{ chave: "ger-resumo", titulo: "Indicadores" }];
  const comDetalhe = indicadoresDaTv(p).filter((i) => (situacao(i) === "vermelho" || situacao(i) === "amarelo") && (i.resultado?.detalhe ?? []).length > 0);
  if (comDetalhe.length) ps.push({ chave: "ger-detalhe-1", titulo: "Onde agir" });
  if (comDetalhe.length > 2) ps.push({ chave: "ger-detalhe-2", titulo: "Onde agir (2)" });
  return ps;
}

/** Os indicadores de cada página de detalhe (2 por página). */
export function detalhesDaPagina(p: PainelGerencial, chave: string): IndicadorGerencial[] {
  const comDetalhe = indicadoresDaTv(p).filter((i) => (situacao(i) === "vermelho" || situacao(i) === "amarelo") && (i.resultado?.detalhe ?? []).length > 0);
  return chave === "ger-detalhe-2" ? comDetalhe.slice(2, 4) : comDetalhe.slice(0, 2);
}
