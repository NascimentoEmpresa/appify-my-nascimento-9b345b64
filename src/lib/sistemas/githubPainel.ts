// =====================================================================
// PAINEL DO DESENVOLVEDOR › GITHUB (mig 20261007000022)
//
// Contas do dashboard "estilo GitHub" sobre o cache de PRs e commits que a
// Edge dev-github-sync mantém: contadores, calendário de contribuições,
// ranking por pessoa, semana a semana, horário dos commits, tempo até o
// merge e quem mais mexe no banco (migrations adicionadas nas PRs).
// =====================================================================

export interface PrGithub {
  numero: number; titulo: string; url: string | null; estado: "open" | "closed" | "merged" | string; rascunho: boolean;
  autor_login: string | null; autor_avatar: string | null; branch_origem: string | null; branch_destino: string | null;
  chamado: string | null; criado_em: string; atualizado_em: string; fechado_em: string | null;
  mergeado_em: string | null; mergeado_por: string | null;
  commits: number | null; adicoes: number | null; remocoes: number | null; arquivos: number | null;
  migrations: number | null; linhas_sql: number | null; migrations_lista: string[] | null;
}
/** [sha7, pr, login, nome, data, 1ª linha da mensagem] — compacto, vem da RPC. */
export type CommitBruto = [string, number | null, string | null, string | null, string, string];
export interface CommitGithub { sha: string; pr: number | null; login: string | null; nome: string | null; autor: string; data: string; mensagem: string }

export interface PainelGithubBruto {
  sync: { ultima_em: string | null; ultima_por: string | null; ultimo_erro: string | null } | null;
  pendentes: number; prs: PrGithub[]; commits: CommitBruto[];
}
export interface PainelGithub { sync: PainelGithubBruto["sync"]; pendentes: number; prs: PrGithub[]; commits: CommitGithub[] }

export const ehBot = (autor: string | null | undefined) => /\[bot\]$|^github-actions|^dependabot/i.test(autor ?? "");

/** Quem fez o commit: o login do GitHub; sem login (e-mail não vinculado), o nome do git. */
export const autorDoCommit = (login: string | null, nome: string | null) => login || nome || "desconhecido";

export function normalizarPainel(b: PainelGithubBruto): PainelGithub {
  return {
    sync: b.sync, pendentes: b.pendentes ?? 0, prs: b.prs ?? [],
    commits: (b.commits ?? []).map(([sha, pr, login, nome, data, mensagem]) => ({
      sha, pr, login, nome, autor: autorDoCommit(login, nome), data, mensagem,
    })),
  };
}

// ---- Filtro ------------------------------------------------------------------

export interface FiltroGithub { dias: number | null; autor: string | null; semBots: boolean }
export const FILTRO_GITHUB_PADRAO: FiltroGithub = { dias: null, autor: null, semBots: true };

export function filtrarPainel(p: PainelGithub, f: FiltroGithub, agora = new Date()): PainelGithub {
  const desde = f.dias ? agora.getTime() - f.dias * 86_400_000 : -Infinity;
  const ok = (autor: string | null) => (!f.autor || autor === f.autor) && !(f.semBots && ehBot(autor));
  return {
    ...p,
    prs: p.prs.filter((x) => new Date(x.criado_em).getTime() >= desde && ok(x.autor_login)),
    commits: p.commits.filter((c) => new Date(c.data).getTime() >= desde && ok(c.autor)),
  };
}

// ---- Contadores --------------------------------------------------------------

const soma = (xs: (number | null | undefined)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
export function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b), m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}
const horasEntre = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;

export interface ContadoresGithub {
  commits: number; prs: number; mergeadas: number; abertas: number; fechadasSemMerge: number; rascunhos: number;
  adicoes: number; remocoes: number; arquivos: number; migrations: number; linhasSql: number;
  contribuidores: number; comChamado: number; semChamado: number;
  medianaHorasAteMerge: number | null; diasComCommit: number; mediaCommitsPorPr: number | null;
}

export function contadores(p: PainelGithub): ContadoresGithub {
  const merg = p.prs.filter((x) => x.estado === "merged");
  const tempos = merg.filter((x) => x.mergeado_em).map((x) => horasEntre(x.criado_em, x.mergeado_em!));
  const autores = new Set([...p.commits.map((c) => c.autor), ...p.prs.map((x) => x.autor_login ?? "")].filter(Boolean));
  const detalhadas = p.prs.filter((x) => x.commits != null);
  return {
    commits: p.commits.length, prs: p.prs.length, mergeadas: merg.length,
    abertas: p.prs.filter((x) => x.estado === "open").length,
    fechadasSemMerge: p.prs.filter((x) => x.estado === "closed").length,
    rascunhos: p.prs.filter((x) => x.rascunho && x.estado === "open").length,
    adicoes: soma(p.prs.map((x) => x.adicoes)), remocoes: soma(p.prs.map((x) => x.remocoes)),
    arquivos: soma(p.prs.map((x) => x.arquivos)), migrations: soma(p.prs.map((x) => x.migrations)),
    linhasSql: soma(p.prs.map((x) => x.linhas_sql)),
    contribuidores: autores.size,
    comChamado: p.prs.filter((x) => x.chamado).length,
    semChamado: p.prs.filter((x) => !x.chamado).length,
    medianaHorasAteMerge: mediana(tempos),
    diasComCommit: new Set(p.commits.map((c) => diaLocal(c.data))).size,
    mediaCommitsPorPr: detalhadas.length ? soma(detalhadas.map((x) => x.commits)) / detalhadas.length : null,
  };
}

// ---- Calendário de contribuições -----------------------------------------------

/** YYYY-MM-DD no fuso do navegador (o calendário do GitHub também é local). */
export function diaLocal(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface CelulaCalendario { dia: string; n: number; nivel: 0 | 1 | 2 | 3 | 4; futuro: boolean }

/** 53 semanas terminando na semana de `hoje`, colunas = semanas, linhas = Dom..Sáb. */
export function calendario(commits: CommitGithub[], hoje = new Date()): CelulaCalendario[][] {
  const porDia = new Map<string, number>();
  for (const c of commits) { const k = diaLocal(c.data); porDia.set(k, (porDia.get(k) ?? 0) + 1); }
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const inicio = new Date(fim); inicio.setDate(fim.getDate() - fim.getDay() - 52 * 7);
  const valores = [...porDia.values()].filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p: number) => valores[Math.min(valores.length - 1, Math.floor(p * valores.length))] ?? 1;
  const cortes = [q(0.25), q(0.5), q(0.75)];
  const nivel = (n: number): CelulaCalendario["nivel"] => (n <= 0 ? 0 : n <= cortes[0] ? 1 : n <= cortes[1] ? 2 : n <= cortes[2] ? 3 : 4);
  const semanas: CelulaCalendario[][] = [];
  for (let w = 0; w < 53; w++) {
    const col: CelulaCalendario[] = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(inicio); dt.setDate(inicio.getDate() + w * 7 + d);
      const k = diaLocal(dt), n = porDia.get(k) ?? 0;
      col.push({ dia: k, n, nivel: nivel(n), futuro: dt > fim });
    }
    semanas.push(col);
  }
  return semanas;
}

/** Sequência de dias com commit: a atual (até hoje ou ontem) e a maior. */
export function sequencias(commits: CommitGithub[], hoje = new Date()): { atual: number; maior: number } {
  const dias = new Set(commits.map((c) => diaLocal(c.data)));
  const ordem = [...dias].sort();
  let maior = 0, run = 0, ant: string | null = null;
  for (const d of ordem) {
    run = ant && diaLocal(new Date(new Date(`${ant}T12:00:00`).getTime() + 86_400_000)) === d ? run + 1 : 1;
    maior = Math.max(maior, run); ant = d;
  }
  let atual = 0;
  const cur = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 12);
  if (!dias.has(diaLocal(cur))) cur.setDate(cur.getDate() - 1);
  while (dias.has(diaLocal(cur))) { atual++; cur.setDate(cur.getDate() - 1); }
  return { atual, maior };
}

// ---- Por pessoa ------------------------------------------------------------------

export interface LinhaAutor {
  autor: string; avatar: string | null; commits: number; prs: number; mergeadas: number; abertas: number;
  adicoes: number; remocoes: number; arquivos: number; migrations: number; linhasSql: number;
  primeiro: string | null; ultimo: string | null; diasAtivos: number; sequenciaMaior: number; bot: boolean;
}

export function porAutor(p: PainelGithub): LinhaAutor[] {
  const m = new Map<string, LinhaAutor>();
  const get = (a: string) => {
    if (!m.has(a)) m.set(a, { autor: a, avatar: null, commits: 0, prs: 0, mergeadas: 0, abertas: 0, adicoes: 0, remocoes: 0, arquivos: 0, migrations: 0, linhasSql: 0, primeiro: null, ultimo: null, diasAtivos: 0, sequenciaMaior: 0, bot: ehBot(a) });
    return m.get(a)!;
  };
  const porAutorCommits = new Map<string, CommitGithub[]>();
  for (const c of p.commits) {
    const l = get(c.autor); l.commits++;
    if (!l.primeiro || c.data < l.primeiro) l.primeiro = c.data;
    if (!l.ultimo || c.data > l.ultimo) l.ultimo = c.data;
    (porAutorCommits.get(c.autor) ?? porAutorCommits.set(c.autor, []).get(c.autor)!).push(c);
  }
  for (const x of p.prs) {
    const l = get(x.autor_login ?? "desconhecido");
    l.avatar ??= x.autor_avatar;
    l.prs++; if (x.estado === "merged") l.mergeadas++; if (x.estado === "open") l.abertas++;
    l.adicoes += x.adicoes ?? 0; l.remocoes += x.remocoes ?? 0; l.arquivos += x.arquivos ?? 0;
    l.migrations += x.migrations ?? 0; l.linhasSql += x.linhas_sql ?? 0;
  }
  for (const [a, cs] of porAutorCommits) {
    const l = m.get(a)!;
    l.diasAtivos = new Set(cs.map((c) => diaLocal(c.data))).size;
    l.sequenciaMaior = sequencias(cs).maior;
  }
  return [...m.values()].sort((a, b) => b.commits - a.commits || b.prs - a.prs);
}

// ---- Semana a semana ---------------------------------------------------------------

/** Segunda-feira da semana (YYYY-MM-DD, local). */
export function inicioSemana(iso: string): string {
  const d = new Date(iso); const dia = (d.getDay() + 6) % 7;
  return diaLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() - dia));
}

/** Commits por semana empilhados pelos `top` autores (resto em "outros"). */
export function semanal(commits: CommitGithub[], semanas = 26, top = 5, hoje = new Date()) {
  const ranking = new Map<string, number>();
  for (const c of commits) ranking.set(c.autor, (ranking.get(c.autor) ?? 0) + 1);
  const principais = [...ranking.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([a]) => a);
  const linhas = new Map<string, Record<string, number | string>>();
  const ultima = inicioSemana(diaLocal(hoje) + "T12:00:00");
  for (let i = semanas - 1; i >= 0; i--) {
    const d = new Date(`${ultima}T12:00:00`); d.setDate(d.getDate() - i * 7);
    const k = diaLocal(d);
    linhas.set(k, { semana: k, ...Object.fromEntries([...principais, "outros"].map((a) => [a, 0])) });
  }
  for (const c of commits) {
    const l = linhas.get(inicioSemana(c.data));
    if (!l) continue;
    const k = principais.includes(c.autor) ? c.autor : "outros";
    l[k] = (l[k] as number) + 1;
  }
  return { series: [...principais, ...(ranking.size > top ? ["outros"] : [])], dados: [...linhas.values()] };
}

/** 7 × 24: commits por dia da semana e hora (fuso local). */
export function punchcard(commits: CommitGithub[]): number[][] {
  const g = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const c of commits) { const d = new Date(c.data); g[d.getDay()][d.getHours()]++; }
  return g;
}

/** PRs por branch de origem (eduardo, joao, pablo…). */
export function porBranch(prs: PrGithub[]) {
  const m = new Map<string, { branch: string; prs: number; mergeadas: number }>();
  for (const x of prs) {
    const b = x.branch_origem ?? "?";
    const l = m.get(b) ?? { branch: b, prs: 0, mergeadas: 0 };
    l.prs++; if (x.estado === "merged") l.mergeadas++;
    m.set(b, l);
  }
  return [...m.values()].sort((a, b) => b.prs - a.prs);
}

/** PRs abertas e mergeadas por mês (criação). */
export function mensalPrs(prs: PrGithub[]) {
  const m = new Map<string, { mes: string; abertas: number; mergeadas: number; migrations: number }>();
  for (const x of prs) {
    const k = x.criado_em.slice(0, 7);
    const l = m.get(k) ?? { mes: k, abertas: 0, mergeadas: 0, migrations: 0 };
    l.abertas++; if (x.estado === "merged") l.mergeadas++; l.migrations += x.migrations ?? 0;
    m.set(k, l);
  }
  return [...m.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

export const fmtHoras = (h: number | null | undefined) =>
  h == null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` : `${(h / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d`;
export const fmtN = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pt-BR"));
