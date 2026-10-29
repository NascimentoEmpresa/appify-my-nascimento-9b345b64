// =====================================================================
// SIS-2026-0786 — CONTROLE DE PULL REQUESTS (migs 20261029004900 e 005000)
//
// Apoio da tela Sistemas › Controle de Pull Requests (PR). Filtro e
// paginação acontecem NO BANCO (RPC dev_github_controle_pr): a tela pede uma
// página por vez, nunca a tabela inteira. Aqui ficam só a tradução do filtro
// para os parâmetros da RPC, a formatação e o CSV.
//
// "Data e hora da aprovação" é o MERGE na main (mergeado_em) — decisão do
// Eduardo: é o momento em que a alteração foi para produção.
// =====================================================================

export interface PrControle {
  numero: number;
  titulo: string;
  url: string | null;
  autor_login: string | null;
  autor_avatar: string | null;
  /** Nome no ERP de quem criou a PR (DEV_GITHUB_USUARIO → profiles); sem vínculo, o login. */
  desenvolvedor: string;
  chamado: string | null;
  chamado_id: string | null;
  chamado_assunto: string | null;
  commits: number | null;
  adicoes: number | null;
  remocoes: number | null;
  arquivos: number | null;
  mergeado_em: string;
}

/** Uma página, como a RPC devolve. */
export interface PaginaControlePr {
  total: number;
  /** A página que veio de fato (a RPC corrige página além da última). */
  pagina: number;
  por_pagina: number;
  /** Todos os desenvolvedores que já tiveram PR, para o filtro (não só os da página). */
  desenvolvedores: string[];
  prs: PrControle[];
}

/** "com" = título com SIS-AAAA-NNNN; "sem" = [SEM-CHAMADO] ou título sem número. */
export type FiltroChamado = "todas" | "com" | "sem";

export interface FiltroControlePr {
  busca: string;
  desenvolvedor: string | null;
  /** AAAA-MM-DD, dia de Brasília do merge, inclusivo. Vazio = sem limite. */
  de: string;
  ate: string;
  chamado: FiltroChamado;
}

export const FILTRO_CONTROLE_PR_PADRAO: FiltroControlePr = { busca: "", desenvolvedor: null, de: "", ate: "", chamado: "todas" };

export const POR_PAGINA_CONTROLE_PR = 20;
/** Lote do Exportar CSV — o teto que a RPC aceita por chamada. */
export const LOTE_CSV_CONTROLE_PR = 500;

export const filtroVazio = (f: FiltroControlePr) =>
  !f.busca.trim() && !f.desenvolvedor && !f.de && !f.ate && f.chamado === "todas";

/** Parâmetros da RPC dev_github_controle_pr. Campo vazio vai como null (= sem filtro). */
export function parametrosRpc(f: FiltroControlePr, pagina: number, porPagina = POR_PAGINA_CONTROLE_PR) {
  return {
    _busca: f.busca.trim() || null,
    _desenvolvedor: f.desenvolvedor || null,
    _de: f.de || null,
    _ate: f.ate || null,
    _chamado: f.chamado,
    _pagina: Math.max(1, Math.floor(pagina) || 1),
    _por_pagina: porPagina,
  };
}

export const totalPaginas = (total: number, porPagina: number) => Math.max(1, Math.ceil(total / Math.max(1, porPagina)));

const dataHoraFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
export const fmtDataHoraBrasilia = (iso: string) => dataHoraFmt.format(new Date(iso));

export const linhasAlteradas = (p: PrControle) => (p.adicoes ?? 0) + (p.remocoes ?? 0);

const celulaCsv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** CSV para o Excel brasileiro: BOM (acentos), separador ";", tudo entre aspas. */
export function csvControlePr(prs: PrControle[]): string {
  const cab = ["Desenvolvedor", "Pull Request", "Chamado", "Assunto", "Commits", "Linhas adicionadas", "Linhas removidas", "Arquivos alterados", "Data e hora da aprovação (merge)"];
  const linhas = prs.map((p) => [
    p.desenvolvedor, `#${p.numero}`, p.chamado ?? "Sem chamado", p.chamado_assunto ?? p.titulo,
    p.commits ?? "", p.adicoes ?? "", p.remocoes ?? "", p.arquivos ?? "", fmtDataHoraBrasilia(p.mergeado_em),
  ]);
  return "﻿" + [cab, ...linhas].map((l) => l.map(celulaCsv).join(";")).join("\r\n");
}
