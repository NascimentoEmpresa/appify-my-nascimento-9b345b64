// =====================================================================
// SIS-2026-0786 — CONTROLE DE PULL REQUESTS (mig 20261029004900)
//
// Contas da tela Sistemas › Controle de Pull Requests (PR): filtro,
// paginação e CSV sobre a lista que a RPC dev_github_controle_pr devolve
// (só PRs mergeadas na main, mais novas primeiro).
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

export interface ControlePrBruto { prs: PrControle[] | null }

/** "com" = título com SIS-AAAA-NNNN; "sem" = [SEM-CHAMADO] ou título sem número. */
export type FiltroChamado = "todas" | "com" | "sem";

export interface FiltroControlePr {
  busca: string;
  desenvolvedor: string | null;
  /** AAAA-MM-DD, dia de Brasília, inclusivo. */
  de: string;
  ate: string;
  chamado: FiltroChamado;
}

export const FILTRO_CONTROLE_PR_PADRAO: FiltroControlePr = { busca: "", desenvolvedor: null, de: "", ate: "", chamado: "todas" };

export const POR_PAGINA_CONTROLE_PR = 20;

const FUSO = "America/Sao_Paulo";
const diaFmt = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });
const dataHoraFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});

/** Dia (AAAA-MM-DD) em Brasília: merge às 22h do dia 29 em UTC-3 ainda é dia 29. */
export const diaBrasilia = (iso: string) => diaFmt.format(new Date(iso));

export const fmtDataHoraBrasilia = (iso: string) => dataHoraFmt.format(new Date(iso));

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

export const linhasAlteradas = (p: PrControle) => (p.adicoes ?? 0) + (p.remocoes ?? 0);

export function filtrarControlePr(prs: PrControle[], f: FiltroControlePr): PrControle[] {
  const termo = semAcento(f.busca.trim().replace(/^#/, ""));
  return prs.filter((p) => {
    if (f.desenvolvedor && p.desenvolvedor !== f.desenvolvedor) return false;
    if (f.chamado === "com" && !p.chamado) return false;
    if (f.chamado === "sem" && p.chamado) return false;
    if (f.de || f.ate) {
      const dia = diaBrasilia(p.mergeado_em);
      if (f.de && dia < f.de) return false;
      if (f.ate && dia > f.ate) return false;
    }
    if (termo) {
      const alvo = semAcento([p.numero, p.titulo, p.chamado, p.chamado_assunto, p.desenvolvedor, p.autor_login].filter(Boolean).join(" "));
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
}

/** Desenvolvedores distintos, em ordem alfabética, para o filtro. */
export const desenvolvedoresDe = (prs: PrControle[]) =>
  [...new Set(prs.map((p) => p.desenvolvedor))].sort((a, b) => a.localeCompare(b, "pt-BR"));

export function paginar<T>(itens: T[], pagina: number, porPagina = POR_PAGINA_CONTROLE_PR) {
  const totalPaginas = Math.max(1, Math.ceil(itens.length / porPagina));
  const atual = Math.min(Math.max(1, pagina), totalPaginas);
  const inicio = (atual - 1) * porPagina;
  return { pagina: atual, totalPaginas, itens: itens.slice(inicio, inicio + porPagina), de: itens.length ? inicio + 1 : 0, ate: Math.min(inicio + porPagina, itens.length) };
}

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
