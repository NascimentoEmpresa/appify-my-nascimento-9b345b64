// Organograma › Tarefas por Função (SIS-2026-0771, mig 20261106001000): o que a
// tela calcula. As datas de cada período nascem no banco (tarefa_periodo); aqui
// fica como a tarefa se classifica para quem lê, os números do acompanhamento e
// a leitura da planilha do Gerador de POPs. Teste em src/test/organograma-tarefas.test.ts.

export type Periodicidade = "diaria" | "semanal" | "quinzenal" | "mensal";
export const PERIODICIDADES: { valor: Periodicidade; rotulo: string }[] = [
  { valor: "diaria", rotulo: "Diária" }, { valor: "semanal", rotulo: "Semanal" },
  { valor: "quinzenal", rotulo: "Quinzenal" }, { valor: "mensal", rotulo: "Mensal" },
];
export const rotuloPeriodicidade = (p: string): string => PERIODICIDADES.find((x) => x.valor === p)?.rotulo ?? p;
export const DIAS_SEMANA = [
  { valor: 1, rotulo: "Segunda" }, { valor: 2, rotulo: "Terça" }, { valor: 3, rotulo: "Quarta" }, { valor: 4, rotulo: "Quinta" }, { valor: 5, rotulo: "Sexta" },
];

export type StatusTarefa = "pendente" | "concluida" | "nao_aplicavel" | "cancelada";
export type Situacao = "vencida" | "hoje" | "proxima" | "resolvida";

export interface TarefaItem {
  id: string;
  titulo: string;
  descricao?: string | null;
  setor?: string | null;
  area?: string | null;
  processo?: string | null;
  periodicidade: Periodicidade;
  criticidade?: string | null;
  link?: string | null;
  periodo_inicio?: string;
  vencimento: string;
  status: StatusTarefa;
  observacao?: string | null;
  concluida_em?: string | null;
  responsavel_nome?: string | null;
  no_id?: string | null;
  user_id?: string;
}

export const hojeLocal = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * A resposta da RPC, sempre no mesmo formato. O contador e o lembrete rodam em
 * TODA tela do ERP: resposta fora do esperado aqui derrubava o sistema inteiro
 * (PR #1147: a API de teste responde [], e as 352 telas caíram em "a is not iterable").
 */
export function normalizarTarefas<T extends object = object>(resposta: unknown): T & { hoje: string; itens: TarefaItem[] } {
  const r = (resposta && typeof resposta === "object" && !Array.isArray(resposta) ? resposta : {}) as T & { hoje?: unknown; itens?: unknown };
  return { ...r, hoje: typeof r.hoje === "string" ? r.hoje : hojeLocal(), itens: Array.isArray(r.itens) ? (r.itens as TarefaItem[]) : [] };
}

export function situacaoDaTarefa(t: Pick<TarefaItem, "status" | "vencimento">, hoje: string): Situacao {
  if (t.status !== "pendente") return "resolvida";
  const v = t.vencimento.slice(0, 10);
  return v < hoje ? "vencida" : v === hoje ? "hoje" : "proxima";
}

export const diasDeAtraso = (vencimento: string, hoje: string): number =>
  Math.max(0, Math.round((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${vencimento.slice(0, 10)}T00:00:00Z`)) / 86400000));

/** Foi resolvida depois do prazo? "Concluída" no prazo e atrasada não pesam igual para quem acompanha. */
export const resolvidaComAtraso = (t: Pick<TarefaItem, "status" | "vencimento" | "concluida_em">): boolean =>
  t.status === "concluida" && !!t.concluida_em && t.concluida_em.slice(0, 10) > t.vencimento.slice(0, 10);

export function separarTarefas<T extends Pick<TarefaItem, "status" | "vencimento">>(itens: T[], hoje: string): Record<Situacao, T[]> {
  const out: Record<Situacao, T[]> = { vencida: [], hoje: [], proxima: [], resolvida: [] };
  for (const t of itens) out[situacaoDaTarefa(t, hoje)].push(t);
  return out;
}

export const fmtData = (iso?: string | null): string => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

export interface ResumoPessoa {
  chave: string;
  nome: string;
  vencidas: number;
  hoje: number;
  proximas: number;
  concluidas: number;
  /** Concluídas no prazo sobre o que já venceu ou foi resolvido. null = nada para medir. */
  noPrazo: number | null;
  itens: TarefaItem[];
}

export function resumirPorPessoa(itens: TarefaItem[], hoje: string): ResumoPessoa[] {
  const mapa = new Map<string, TarefaItem[]>();
  for (const t of itens) {
    const k = t.user_id ?? t.no_id ?? t.responsavel_nome ?? "?";
    mapa.set(k, [...(mapa.get(k) ?? []), t]);
  }
  return [...mapa.entries()].map(([chave, lista]) => {
    const s = separarTarefas(lista, hoje);
    const concluidas = lista.filter((t) => t.status === "concluida");
    const noPrazo = concluidas.filter((t) => !resolvidaComAtraso(t)).length;
    const base = concluidas.length + s.vencida.length;
    return {
      chave, nome: lista[0].responsavel_nome ?? "Sem nome",
      vencidas: s.vencida.length, hoje: s.hoje.length, proximas: s.proxima.length, concluidas: concluidas.length,
      noPrazo: base ? Math.round((noPrazo / base) * 100) : null, itens: lista,
    };
  }).sort((a, b) => b.vencidas - a.vencidas || b.hoje - a.hoje || a.nome.localeCompare(b.nome, "pt-BR"));
}

// ── Planilha do Gerador de POPs ───────────────────────────────────────────
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** "Diário", "DIARIA", "Semanal", "Quinzenal", "Mensal". O resto (anual, sob demanda) não vira checklist. */
export function periodicidadeDoTexto(texto: unknown): Periodicidade | null {
  const t = semAcento(String(texto ?? ""));
  if (/^diari/.test(t) || t === "dia") return "diaria";
  if (/^semana/.test(t)) return "semanal";
  if (/^quinzen/.test(t)) return "quinzenal";
  if (/^mens/.test(t)) return "mensal";
  return null;
}

export interface LinhaPop {
  titulo: string;
  area: string | null;
  setor: string | null;
  periodicidade: Periodicidade;
  cargos: string[];
  criticidade: string | null;
  descricao: string | null;
}
export interface LeituraPlanilha { linhas: LinhaPop[]; ignoradas: { atividade: string; motivo: string }[] }

/**
 * Mesmo layout do Gerador de POPs (duas linhas de cabeçalho): 1 área, 2 setor,
 * 3 atividade, 4 periodicidade, 5 responsável, 10 criticidade, 15 descrição.
 * O responsável é o cargo; mais de um cargo vem separado por "/", "," ou ";".
 */
export function lerPlanilhaPops(rows: unknown[][]): LeituraPlanilha {
  const out: LeituraPlanilha = { linhas: [], ignoradas: [] };
  const txt = (v: unknown) => String(v ?? "").trim();
  for (const r of rows.slice(2)) {
    const atividade = txt(r[3]);
    if (!atividade) continue;
    const periodicidade = periodicidadeDoTexto(r[4]);
    if (!periodicidade) { out.ignoradas.push({ atividade, motivo: `periodicidade "${txt(r[4]) || "vazia"}" não vira checklist` }); continue; }
    const cargos = txt(r[5]).split(/[/,;]/).map((c) => c.trim()).filter(Boolean);
    if (!cargos.length) { out.ignoradas.push({ atividade, motivo: "sem responsável" }); continue; }
    out.linhas.push({
      titulo: atividade, area: txt(r[1]) || null, setor: txt(r[2]) || null, periodicidade, cargos,
      criticidade: txt(r[10]) || null, descricao: txt(r[15]) || null,
    });
  }
  return out;
}
