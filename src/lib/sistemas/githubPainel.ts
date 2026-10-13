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
/** [sha7, pr, login, nome, data, 1ª linha da mensagem, merge?] — compacto, vem da RPC.
 *  Desde a mig 20261009000002 inclui a história da main (merges e commits
 *  do Lovable, que não passam por PR) — o mesmo total que o GitHub mostra. */
export type CommitBruto = [string, number | null, string | null, string | null, string, string, boolean?];
export interface CommitGithub { sha: string; pr: number | null; login: string | null; nome: string | null; autor: string; data: string; mensagem: string; merge: boolean }

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
    commits: (b.commits ?? []).map(([sha, pr, login, nome, data, mensagem, merge]) => ({
      sha, pr, login, nome, autor: autorDoCommit(login, nome), data, mensagem, merge: merge === true,
    })),
  };
}

// ---- Filtro ------------------------------------------------------------------

export interface FiltroGithub { dias: number | null; autor: string | null; semBots: boolean }
// semBots começa desligado: o Lovable (gpt-engineer-app[bot]) é ~1/4 dos
// commits da main, e escondê-lo de saída deixava o total longe do GitHub.
export const FILTRO_GITHUB_PADRAO: FiltroGithub = { dias: null, autor: null, semBots: false };

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
  commits: number; commitsMerge: number; commitsBot: number; prs: number; mergeadas: number; abertas: number; fechadasSemMerge: number; rascunhos: number;
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
    commitsMerge: p.commits.filter((c) => c.merge).length,
    commitsBot: p.commits.filter((c) => ehBot(c.autor)).length,
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

// ---- Mês a mês (relatório, 09/10/2026) -----------------------------------------
// Commits contam pelo mês do commit; PRs pelo mês em que foram abertas;
// tempo até o merge pelo mês do merge. Meses sem nada no meio do período
// aparecem zerados (o gráfico não "pula" mês).

export const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloMes = (mes: string) => `${MESES_CURTOS[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
const mesLocal = (iso: string) => diaLocal(iso).slice(0, 7);

/** Todos os meses de `ini` a `fim` (YYYY-MM), inclusive. */
export function mesesEntre(ini: string, fim: string): string[] {
  const r: string[] = [];
  let [a, m] = ini.split("-").map(Number);
  const [af, mf] = fim.split("-").map(Number);
  while (a < af || (a === af && m <= mf)) { r.push(`${a}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; a++; } }
  return r;
}

export interface LinhaMes {
  mes: string; rotulo: string;
  commits: number; commitsMerge: number; commitsBot: number; commitsPessoas: number; commitsAcumulados: number;
  diasAtivos: number; contribuidores: number;
  prs: number; mergeadas: number; fechadasSemMerge: number; comChamado: number; semChamado: number;
  adicoes: number; remocoes: number; arquivos: number; migrations: number; linhasSql: number;
  medianaHorasAteMerge: number | null;
}

export function mensal(p: PainelGithub): LinhaMes[] {
  const meses = [...p.commits.map((c) => mesLocal(c.data)), ...p.prs.map((x) => mesLocal(x.criado_em))].sort();
  if (!meses.length) return [];
  const linhas = new Map<string, LinhaMes & { _dias: Set<string>; _autores: Set<string>; _tempos: number[] }>();
  for (const mes of mesesEntre(meses[0], meses[meses.length - 1])) {
    linhas.set(mes, {
      mes, rotulo: rotuloMes(mes), commits: 0, commitsMerge: 0, commitsBot: 0, commitsPessoas: 0, commitsAcumulados: 0,
      diasAtivos: 0, contribuidores: 0, prs: 0, mergeadas: 0, fechadasSemMerge: 0, comChamado: 0, semChamado: 0,
      adicoes: 0, remocoes: 0, arquivos: 0, migrations: 0, linhasSql: 0, medianaHorasAteMerge: null,
      _dias: new Set(), _autores: new Set(), _tempos: [],
    });
  }
  for (const c of p.commits) {
    const l = linhas.get(mesLocal(c.data))!;
    l.commits++;
    if (c.merge) l.commitsMerge++;
    if (ehBot(c.autor)) l.commitsBot++;
    if (!c.merge && !ehBot(c.autor)) l.commitsPessoas++;
    l._dias.add(diaLocal(c.data)); l._autores.add(c.autor);
  }
  for (const x of p.prs) {
    const l = linhas.get(mesLocal(x.criado_em))!;
    l.prs++;
    if (x.estado === "merged") l.mergeadas++;
    if (x.estado === "closed") l.fechadasSemMerge++;
    if (x.chamado) l.comChamado++; else l.semChamado++;
    l.adicoes += x.adicoes ?? 0; l.remocoes += x.remocoes ?? 0; l.arquivos += x.arquivos ?? 0;
    l.migrations += x.migrations ?? 0; l.linhasSql += x.linhas_sql ?? 0;
    if (x.mergeado_em) linhas.get(mesLocal(x.mergeado_em))?._tempos.push(horasEntre(x.criado_em, x.mergeado_em));
  }
  let acc = 0;
  return [...linhas.values()].map(({ _dias, _autores, _tempos, ...l }) => {
    acc += l.commits;
    return { ...l, commitsAcumulados: acc, diasAtivos: _dias.size, contribuidores: _autores.size, medianaHorasAteMerge: mediana(_tempos) };
  });
}

/** Commits por mês empilhados por pessoa (todas, em ordem alfabética). */
export function mensalPorAutor(commits: CommitGithub[]) {
  const autores = [...new Set(commits.map((c) => c.autor))].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  const meses = commits.map((c) => mesLocal(c.data)).sort();
  if (!meses.length) return { autores, dados: [] as Record<string, number | string>[] };
  const linhas = new Map(mesesEntre(meses[0], meses[meses.length - 1]).map((m) => [m, { mes: m, rotulo: rotuloMes(m), ...Object.fromEntries(autores.map((a) => [a, 0])) } as Record<string, number | string>]));
  for (const c of commits) { const l = linhas.get(mesLocal(c.data))!; l[c.autor] = (l[c.autor] as number) + 1; }
  return { autores, dados: [...linhas.values()] };
}

/** Tamanho das PRs (linhas adicionadas + removidas), só as já detalhadas. */
export const FAIXAS_TAMANHO = [
  { faixa: "Mínima", ate: 10 }, { faixa: "Pequena", ate: 100 }, { faixa: "Média", ate: 500 },
  { faixa: "Grande", ate: 2000 }, { faixa: "Muito grande", ate: Infinity },
] as const;
export function tamanhoPrs(prs: PrGithub[]) {
  const r = FAIXAS_TAMANHO.map((f, i) => ({
    faixa: f.faixa, dica: i === 0 ? `até ${f.ate} linhas` : f.ate === Infinity ? `mais de ${FAIXAS_TAMANHO[i - 1].ate}` : `${FAIXAS_TAMANHO[i - 1].ate + 1} a ${f.ate}`, prs: 0,
  }));
  for (const x of prs) {
    if (x.adicoes == null && x.remocoes == null) continue;
    const n = (x.adicoes ?? 0) + (x.remocoes ?? 0);
    r[FAIXAS_TAMANHO.findIndex((f) => n <= f.ate)].prs++;
  }
  return r;
}

/** De onde vêm os commits: chamado, sem chamado, merge, Lovable/bots, outros. */
export function tiposCommit(commits: CommitGithub[]) {
  const t = { "Com chamado (SIS-…)": 0, "Sem chamado": 0, "Merge": 0, "Bots (Lovable etc.)": 0, "Outros": 0 };
  for (const c of commits) {
    if (c.merge) t["Merge"]++;
    else if (ehBot(c.autor)) t["Bots (Lovable etc.)"]++;
    else if (/SIS-\d{4}-\d+/i.test(c.mensagem)) t["Com chamado (SIS-…)"]++;
    else if (/SEM-CHAMADO/i.test(c.mensagem)) t["Sem chamado"]++;
    else t["Outros"]++;
  }
  return Object.entries(t).map(([tipo, n]) => ({ tipo, n })).filter((x) => x.n > 0);
}

export const fmtHoras = (h: number | null | undefined) =>
  h == null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` : `${(h / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d`;
export const fmtN = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pt-BR"));
