// =====================================================================
// Painel do Desenvolvedor › GitHub — contas do painel (mig 20261007000015)
//
// Pedido (07/10/2026): "quantas PRs um dev lançou, quantos commits, podendo
// ver dos outros, quantas linhas de código foram alteradas". A Edge
// github-painel-sync guarda as PRs e as semanas de commit no banco; tudo que
// é agrupamento sai daqui (com teste em src/test/sistemas-github-painel.test.ts).
//   · Commits por dev = soma dos commits das PRs dele (o que ele entregou por
//     PR). As semanas de commit da main (GITHUB_COMMITS_SEMANA) entram como
//     série à parte quando o GitHub termina de calcular a estatística.
//   · Linhas = adições/remoções somadas das PRs (o diff que cada PR trouxe).
// =====================================================================

export interface PrGithub {
  numero: number; titulo: string | null; estado: "OPEN" | "MERGED" | "CLOSED" | string; autor: string; branch: string | null;
  criado_em: string; mergeado_em: string | null; fechado_em: string | null;
  adicoes: number; remocoes: number; arquivos: number; commits: number;
}
export interface SemanaCommits { autor: string; semana: string; commits: number; adicoes: number; remocoes: number }
export interface DevGithub { login: string; nome: string; ativo: boolean }

export const PERIODOS_GH = [
  { valor: 30, rotulo: "Últimos 30 dias" }, { valor: 90, rotulo: "Últimos 90 dias" },
  { valor: 180, rotulo: "Últimos 6 meses" }, { valor: 365, rotulo: "Últimos 12 meses" }, { valor: 0, rotulo: "Desde o início" },
] as const;

/** Cores fixas por dev, na ordem em que aparecem no ranking (nunca recicladas por posição de filtro). */
export const CORES_DEV = ["#2563eb", "#ea580c", "#7c3aed", "#16a34a", "#0891b2", "#db2777"];  // ordem validada (scripts/validate_palette, claro e escuro)
export const COR_OUTROS = "#94a3b8";

export const nomeDev = (login: string, devs: DevGithub[]) => devs.find((d) => d.login === login)?.nome || login;

/** PRs criadas nos últimos N dias (0 = todas). */
export function noPeriodo<T extends { criado_em: string }>(lista: T[], dias: number, agora: Date = new Date()): T[] {
  if (!dias) return lista;
  const corte = agora.getTime() - dias * 86_400_000;
  return lista.filter((p) => new Date(p.criado_em).getTime() >= corte);
}

const mediana = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface LinhaDev {
  login: string; nome: string; prs: number; mergeadas: number; abertas: number; fechadas: number;
  commits: number; adicoes: number; remocoes: number; arquivos: number;
  linhasPorPr: number; horasAteMerge: number | null;
}

/** Ranking por dev (quem mais abriu PR primeiro). */
export function porDev(prs: PrGithub[], devs: DevGithub[]): LinhaDev[] {
  const g = new Map<string, PrGithub[]>();
  prs.forEach((p) => g.set(p.autor, [...(g.get(p.autor) ?? []), p]));
  return [...g.entries()].map(([login, l]) => {
    const adicoes = l.reduce((s, p) => s + p.adicoes, 0), remocoes = l.reduce((s, p) => s + p.remocoes, 0);
    const horas = l.filter((p) => p.mergeado_em).map((p) => (new Date(p.mergeado_em!).getTime() - new Date(p.criado_em).getTime()) / 3_600_000);
    const med = mediana(horas);
    return {
      login, nome: nomeDev(login, devs), prs: l.length,
      mergeadas: l.filter((p) => p.estado === "MERGED").length, abertas: l.filter((p) => p.estado === "OPEN").length,
      fechadas: l.filter((p) => p.estado === "CLOSED").length,
      commits: l.reduce((s, p) => s + p.commits, 0), adicoes, remocoes, arquivos: l.reduce((s, p) => s + p.arquivos, 0),
      linhasPorPr: l.length ? Math.round((adicoes + remocoes) / l.length) : 0,
      horasAteMerge: med == null ? null : Math.round(med * 10) / 10,
    };
  }).sort((a, b) => b.prs - a.prs || a.nome.localeCompare(b.nome));
}

/** Totais do recorte (todos os devs somados). */
export function totais(prs: PrGithub[]) {
  const horas = prs.filter((p) => p.mergeado_em).map((p) => (new Date(p.mergeado_em!).getTime() - new Date(p.criado_em).getTime()) / 3_600_000);
  const med = mediana(horas);
  return {
    prs: prs.length, mergeadas: prs.filter((p) => p.estado === "MERGED").length, abertas: prs.filter((p) => p.estado === "OPEN").length,
    commits: prs.reduce((s, p) => s + p.commits, 0), adicoes: prs.reduce((s, p) => s + p.adicoes, 0),
    remocoes: prs.reduce((s, p) => s + p.remocoes, 0), arquivos: prs.reduce((s, p) => s + p.arquivos, 0),
    horasAteMerge: med == null ? null : Math.round(med * 10) / 10,
  };
}

/**
 * Série por período (mês "2026-09" ou semana "2026-09-28", segunda-feira) com
 * uma chave por dev — para o gráfico de barras agrupadas. Períodos sem PR
 * entram zerados para o eixo não "pular".
 */
export function serie(prs: PrGithub[], logins: string[], valor: (p: PrGithub) => number, por: "mes" | "semana"): Record<string, number | string>[] {
  const chave = (iso: string) => {
    const d = new Date(iso);
    if (por === "mes") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const seg = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
    return seg.toISOString().slice(0, 10);
  };
  const mapa = new Map<string, Record<string, number | string>>();
  prs.forEach((p) => {
    const k = chave(p.criado_em);
    const linha = mapa.get(k) ?? { periodo: k, ...Object.fromEntries(logins.map((l) => [l, 0])) };
    if (logins.includes(p.autor)) linha[p.autor] = (linha[p.autor] as number) + valor(p);
    mapa.set(k, linha);
  });
  const chaves = [...mapa.keys()].sort();
  if (!chaves.length) return [];
  // preenche os buracos
  const out: Record<string, number | string>[] = [];
  let atual = chaves[0];
  const proximo = (k: string) => {
    if (por === "mes") { const [a, m] = k.split("-").map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`; }
    const d = new Date(`${k}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10);
  };
  while (atual <= chaves[chaves.length - 1]) {
    out.push(mapa.get(atual) ?? { periodo: atual, ...Object.fromEntries(logins.map((l) => [l, 0])) });
    atual = proximo(atual);
  }
  return out;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "2026-09" → "set/26"; "2026-09-28" → "28/09". */
export const rotuloPeriodoGh = (k: string) => {
  const p = k.split("-");
  return p.length === 2 ? `${MESES[Number(p[1]) - 1]}/${p[0].slice(2)}` : `${p[2]}/${p[1]}`;
};

/** "3.130" / "12,4 mil" / "1,2 mi" — linhas de código cabem num cartão. */
export function fmtLinhas(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return n.toLocaleString("pt-BR");
}

/** Horas até o merge em texto: "45 min", "6,5 h", "2,3 dias". */
export function fmtHoras(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
  return `${(h / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
}
