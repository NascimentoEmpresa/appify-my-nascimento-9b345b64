// =====================================================================
// Operacional › Indicadores › 5. KAIZEN E EFETIVIDADE (09/11/2026)
// Iniciativas de melhoria contínua (tabela OPE_KAIZEN_INICIATIVA, mig
// 20261109003300). Tudo o que a tela mostra é contado aqui, das linhas.
// =====================================================================

export type StatusKaizen = "Planejada" | "Em andamento" | "Concluída" | "Cancelada";
export const STATUS_KAIZEN: StatusKaizen[] = ["Planejada", "Em andamento", "Concluída", "Cancelada"];

export interface Iniciativa {
  id: number;
  titulo: string;
  area: string;
  descricao: string | null;
  data_inicio: string;
  prazo: string | null;
  status: StatusKaizen;
  resultado: string | null;
  economia: number | null;
  concluida_em: string | null;
}

export interface ResumoKaizen {
  total: number;
  concluidas: number;
  andamento: number;
  mensurados: number;
  /** Soma da economia mensal das concluídas com economia informada. */
  economia: number;
  /** Concluídas com prazo e entregues até o prazo, sobre as concluídas com prazo. */
  noPrazo: number | null;
  atrasadas: number;
  porArea: { area: string; total: number; concluidas: number; economia: number }[];
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function resumirKaizen(lista: Iniciativa[], hojeIso: string): ResumoKaizen {
  const validas = lista.filter((i) => i.status !== "Cancelada");
  const concl = validas.filter((i) => i.status === "Concluída");
  const comPrazo = concl.filter((i) => i.prazo && i.concluida_em);
  const areas = new Map<string, { area: string; total: number; concluidas: number; economia: number }>();
  for (const i of validas) {
    const a = areas.get(i.area) ?? { area: i.area, total: 0, concluidas: 0, economia: 0 };
    a.total++;
    if (i.status === "Concluída") { a.concluidas++; a.economia += Number(i.economia) || 0; }
    areas.set(i.area, a);
  }
  return {
    total: validas.length,
    concluidas: concl.length,
    andamento: validas.filter((i) => i.status === "Em andamento").length,
    mensurados: validas.filter((i) => (i.resultado ?? "").trim() !== "").length,
    economia: Math.round(concl.reduce((s, i) => s + (Number(i.economia) || 0), 0) * 100) / 100,
    noPrazo: pct(comPrazo.filter((i) => i.concluida_em! <= i.prazo!).length, comPrazo.length),
    atrasadas: validas.filter((i) => i.status !== "Concluída" && i.prazo && i.prazo < hojeIso.slice(0, 10)).length,
    porArea: [...areas.values()].sort((a, b) => b.total - a.total),
  };
}

/** % sobre o total, para os subtítulos dos cards. */
export const sobreTotal = (n: number, total: number) => pct(n, total);
