// =====================================================================
// Relatórios na TV — regras da apresentação (08/10/2026, mig 20261008000004)
//
// Pedido do Pablo: "colocar TODOS os relatórios do módulo Relatórios nas
// TVs, adaptados pra lá (o layout da TV pode cortar), e melhorar completamente
// os que já existem — tá muito seco e feio". Referência de qualidade:
// carmed.vercel.app (fundo claro, faixa de cor sólida no topo, cartões
// brancos arredondados com sombra, selos de cor, números grandes).
//
// Duas decisões que valem para todos:
//   · PALCO FIXO: tudo é desenhado num quadro de 1920×1080 que encolhe para
//     caber na tela (com margem de segurança contra o overscan da TV) — nada
//     corta, em qualquer resolução ou proporção;
//   · PÁGINAS: um relatório não espreme tudo numa tela só; ele vira 1 a 3
//     páginas que se revezam dentro do tempo do item na playlist.
// Aqui ficam as contas (com teste); o desenho mora em src/pages/tv/relatorio/.
// =====================================================================

import { sistemaPorSlug, type RelatorioDados } from "@/pages/relatorios/sistemas";
import type { PainelTurnover } from "@/lib/diretoria/turnover";
import type { PainelVagas } from "@/lib/relatorios/vagasPainel";

/** A cor da faixa de cada relatório: a dos Relatórios; Geral e Vagas têm a sua. */
export function corDoRelatorioTv(slug: string | null | undefined): string {
  if (slug === "geral") return "#1e3a8a";
  if (slug === "vagas") return "#4338ca";
  return sistemaPorSlug(slug ?? "")?.cor ?? "#1e3a8a";
}

/** O palco: o tamanho em que tudo é desenhado. */
export const PALCO = { largura: 1920, altura: 1080 } as const;
/** Margem de segurança (cada lado) contra o corte das bordas (overscan) da TV. */
export const MARGEM_SEGURA = 0.025;

/** Quanto o palco encolhe para caber na tela, com a margem de segurança. */
export function escalaDoPalco(largura: number, altura: number, margem = MARGEM_SEGURA): number {
  if (!largura || !altura) return 1;
  const util = 1 - margem * 2;
  return Math.min((largura * util) / PALCO.largura, (altura * util) / PALCO.altura);
}

/** Tempo de cada página: o tempo do item dividido pelas páginas, no mínimo 8 s. */
export function tempoDaPaginaMs(duracaoSeg: number, paginas: number): number {
  const n = Math.max(1, paginas);
  return Math.max(8, Math.floor((duracaoSeg || 30) / n)) * 1000;
}

/** Tempo recomendado para o item ver todas as páginas com calma (15 s cada, no mínimo 30 s). */
export const duracaoRecomendada = (paginas: number) => Math.max(30, paginas * 15);

// ---- O que a TV recebe (tv_relatorio) ou a prévia monta --------------------

export type DadosRelTv =
  | (RelatorioDados & { tipo: "sistema"; slug: string; contrato: string | null; gerado_em?: string })
  | { tipo: "geral"; sistemas: SistemaGeral[]; periodo: { de: string; ate: string }; contrato: string | null; gerado_em?: string }
  | { tipo: "vagas"; painel: PainelVagas; periodo: { de: string; ate: string }; contrato: string | null; gerado_em?: string }
  | { tipo: "turnover"; painel: PainelTurnover; filial: string | null; contrato: string | null; gerado_em?: string };

export type SistemaGeral = Pick<RelatorioDados, "titulo" | "kpis" | "rotulo_item" | "mensal"> & { slug: string };

/** As páginas de cada relatório — só as que têm o que mostrar. */
export function paginasDoRelatorio(d: DadosRelTv): { chave: string; titulo: string }[] {
  switch (d.tipo) {
    case "geral":
      return [{ chave: "geral", titulo: "Todos os sistemas" }];
    case "vagas":
      return [
        { chave: "vagas-resumo", titulo: "Resumo" },
        { chave: "vagas-andamento", titulo: "Em andamento" },
        { chave: "vagas-contratos", titulo: "Por contrato" },
      ];
    case "turnover": {
      const ps = [{ chave: "turnover-resumo", titulo: "Resumo do ano" }];
      if (d.painel.por_contrato.some((c) => c.demissoes > 0)) ps.push({ chave: "turnover-contratos", titulo: "Por contrato" });
      if (d.painel.por_contrato.some((c) => c.efetivo_atual > 0)) ps.push({ chave: "turnover-limites", titulo: "Limites" });
      return ps;
    }
    default: {
      const ps = [{ chave: "sistema-resumo", titulo: "Resumo" }];
      if (rankingsParaTv(d.rankings).length || d.por_status.length > 1) ps.push({ chave: "sistema-detalhe", titulo: "Destaques" });
      return ps;
    }
  }
}

// ---- Privacidade: TV fica em área comum ----------------------------------------
// A TV fica no corredor, na recepção, no refeitório. Nada que identifique
// PESSOA vai para ela: a lista "mais recentes" dos Relatórios (quem foi
// demitido, quem levou advertência) fica de fora, e ranking por pessoa
// ("Quem perguntou", solicitante, colaborador) também. Só números somados
// por contrato, cargo, motivo, status.
const RANKING_DE_PESSOA = /\b(quem|colaborador(es)?|solicitante|nome|pessoa|funcion[aá]rio|encarregado|analista|respons[aá]vel)\b/i;

/** Os rankings que podem ir para a TV (sem os por pessoa), com itens. */
export function rankingsParaTv(rankings: RelatorioDados["rankings"]): RelatorioDados["rankings"] {
  return rankings.filter((r) => r.itens.length > 0 && !RANKING_DE_PESSOA.test(r.titulo));
}

/** "uniforme" → "Uniforme", "em_andamento" → "Em andamento" (rótulos crus das RPCs). */
export function rotuloTv(s: string | null | undefined): string {
  const t = (s ?? "").replace(/_/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "—";
}

// ---- Contas de apoio -----------------------------------------------------------

/**
 * Qual série do mês a mês vai de LINHA no eixo da direita: a que a RPC marca
 * (taxa) ou a que é tão maior que as outras que esmagaria as barras (ex.:
 * ativos × admitidos/desligados no Colaboradores).
 */
export function serieDaDireita(series: RelatorioDados["mensal"]["series"], dados: Record<string, unknown>[]): string | null {
  const marcada = series.find((s) => s.eixo === "direita");
  if (marcada) return marcada.chave;
  if (series.length < 2) return null;
  const max = (k: string) => Math.max(0, ...dados.map((d) => Number(d[k]) || 0));
  const maxs = series.map((s) => ({ k: s.chave, m: max(s.chave) })).sort((a, b) => b.m - a.m);
  return maxs[0].m > 0 && maxs[0].m >= 4 * Math.max(1, maxs[1].m) ? maxs[0].k : null;
}

/**
 * Tira os meses vazios do COMEÇO (o histórico do ERP começa em ago/2026 em
 * vários sistemas: 12 meses de barras zeradas só espremem o gráfico). Fica
 * pelo menos `minimo` meses; mês vazio no meio continua (é informação).
 */
export function semMesesVaziosNoInicio<T extends object>(dados: T[], chaves: string[], minimo = 3): T[] {
  let i = 0;
  while (i < dados.length - minimo && chaves.every((k) => !Number((dados[i] as Record<string, unknown>)[k]))) i++;
  return dados.slice(i);
}

/** Por status, somado em três grupos (o anel da página Resumo). */
export function statusEmGrupos(porStatus: RelatorioDados["por_status"]) {
  const g = { aberto: 0, concluido: 0, recusado: 0 };
  for (const s of porStatus) g[s.grupo] = (g[s.grupo] ?? 0) + s.n;
  return { ...g, total: g.aberto + g.concluido + g.recusado };
}

/** Os N maiores, e quanto sobrou fora deles ("+ 12 outros"). */
export function maiores<T extends { n: number }>(itens: T[], n: number): { itens: T[]; resto: number } {
  const ord = [...itens].sort((a, b) => b.n - a.n);
  return { itens: ord.slice(0, n), resto: ord.slice(n).reduce((s, i) => s + i.n, 0) };
}

/** "1050 - UFRGS - LIMPEZA GERAL - 047/2022" → "UFRGS - LIMPEZA GERAL - 047/2022". */
export const semCodigo = (s: string) => s.replace(/^\s*\d+\s*-\s*/, "");

/** Turn-over é por ano: os meses do ano corrente que caem no período — a MESMA conta do tv_relatorio. */
export function mesesTurnoverTv(de: string, ate: string): { ano: number; meses: number[] } {
  const fim = new Date(`${ate}T12:00:00`);
  const ini = new Date(`${de}T12:00:00`);
  const ano = fim.getFullYear();
  const inicioMes = new Date(ini.getFullYear(), ini.getMonth(), 1).getTime();
  const meses: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const t = new Date(ano, m - 1, 1, 12).getTime();
    if (t >= inicioMes && t <= fim.getTime()) meses.push(m);
  }
  return { ano, meses };
}

/** Variação em texto curto: +12% / −8% / null. */
export function textoVariacao(v: number | null | undefined): { texto: string; sobe: boolean } | null {
  if (v == null || !Number.isFinite(v) || v === 0) return null;
  const r = Math.round(v * 10) / 10;
  return { texto: `${r > 0 ? "+" : "−"}${Math.abs(r).toLocaleString("pt-BR")}%`, sobe: r > 0 };
}

/** Mistura duas cores #rrggbb (t = 0 → a, 1 → b). Cor inválida volta como veio. */
export function misturarCor(a: string, b: string, t: number): string {
  const p = (h: string) => (/^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);
  const x = p(a), y = p(b);
  if (!x || !y) return a;
  const k = Math.min(1, Math.max(0, t));
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, "0")).join("")}`;
}

/** Números curtos para caber no palco: 12.345 → "12,3 mil". */
export function numeroCurto(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 100_000) return `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}
