// Filtros da Gestão de Advertências (Jurídico › Advertências, 06/11/2026).
//
// Antes a tela só tinha "Filtros · Contratos" + a busca. Pedido: filtrar por
// mês (do Ocorrido, ou da Solicitada), tipo, grau, contrato, solicitante,
// função do colaborador e exceção fora do prazo — valendo para os números do
// topo, as contagens das abas, a lista e o Dashboard.
//
// Tudo no front: a tela já carrega a tabela inteira
// (SISTEMA_SOLICITACOES_ADVERTENCIA) numa consulta só. Regra pura aqui, a
// tela só desenha.

export type BaseDoMes = "ocorrido" | "solicitada";
export type FiltroExcecao = "todas" | "sim" | "nao";

export interface LinhaAdvFiltro {
  data_ocorrido?: string | null;
  created_at?: string | null;
  tipo_advertencia?: string | null;
  grau?: string | null;
  contrato?: string | null;
  solicitante_nome?: string | null;
  colaborador_cargo?: string | null;
  excecao?: boolean | null;
}

export interface FiltrosAdv {
  /** De que data sai o mês: "Ocorrido" (padrão) ou "Solicitada". */
  baseMes: BaseDoMes;
  /** Meses "AAAA-MM". Vazio = todos (vale para as listas abaixo também). */
  meses: string[];
  tipos: string[];
  graus: string[];
  contratos: string[];
  solicitantes: string[];
  cargos: string[];
  excecao: FiltroExcecao;
}

/** Campos multi-valor — os que viram dropdown com checkbox. */
export type CampoMulti = "meses" | "tipos" | "graus" | "contratos" | "solicitantes" | "cargos";

export const FILTROS_VAZIOS: FiltrosAdv = {
  baseMes: "ocorrido", meses: [], tipos: [], graus: [], contratos: [], solicitantes: [], cargos: [], excecao: "todas",
};

const txt = (v: unknown) => String(v ?? "").trim();

/**
 * Mês "AAAA-MM" de uma data do banco. `data_ocorrido` é date ("2026-11-04");
 * `created_at` é timestamptz — aí vale o mês no fuso de quem olha (uma
 * solicitação de 31/10 às 22h em Brasília é "UTC 01/11" e tem que cair em
 * outubro, que é o que o card mostra). Aceita também "DD/MM/AAAA".
 */
export function mesDaData(v: string | null | undefined): string {
  const s = txt(v);
  if (!s) return "";
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return `${br[3]}-${br[2]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
  const d = new Date(s);
  if (isNaN(+d)) return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function mesDaLinha(l: LinhaAdvFiltro, base: BaseDoMes): string {
  return mesDaData(base === "solicitada" ? l.created_at : l.data_ocorrido);
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "2026-11" → "nov/2026". */
export function rotuloMes(chave: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(chave);
  if (!m) return chave || "—";
  return `${MESES[Number(m[2]) - 1] ?? m[2]}/${m[1]}`;
}

/** Valor da linha para cada campo multi (já aparado). */
export function valorDoCampo(l: LinhaAdvFiltro, campo: CampoMulti, base: BaseDoMes): string {
  switch (campo) {
    case "meses": return mesDaLinha(l, base);
    case "tipos": return txt(l.tipo_advertencia);
    case "graus": return txt(l.grau);
    case "contratos": return txt(l.contrato);
    case "solicitantes": return txt(l.solicitante_nome);
    case "cargos": return txt(l.colaborador_cargo);
  }
}

const CAMPOS: CampoMulti[] = ["meses", "tipos", "graus", "contratos", "solicitantes", "cargos"];

/** A linha passa em todos os filtros? Campo vazio deixa passar tudo. */
export function passaNosFiltros(l: LinhaAdvFiltro, f: FiltrosAdv): boolean {
  for (const c of CAMPOS) {
    const sel = f[c];
    if (sel.length && !sel.includes(valorDoCampo(l, c, f.baseMes))) return false;
  }
  if (f.excecao === "sim" && !l.excecao) return false;
  if (f.excecao === "nao" && l.excecao) return false;
  return true;
}

export function filtrarAdvertencias<T extends LinhaAdvFiltro>(linhas: T[], f: FiltrosAdv): T[] {
  return temFiltro(f) ? linhas.filter(l => passaNosFiltros(l, f)) : linhas;
}

/**
 * Filtros sem um campo — para contar as opções de um dropdown no recorte dos
 * OUTROS filtros (marcar "nov/2026" mostra quantas Escritas tem em novembro).
 */
export function semCampo(f: FiltrosAdv, campo: CampoMulti | "excecao"): FiltrosAdv {
  return campo === "excecao" ? { ...f, excecao: "todas" } : { ...f, [campo]: [] };
}

export function temFiltro(f: FiltrosAdv): boolean {
  return CAMPOS.some(c => f[c].length > 0) || f.excecao !== "todas";
}

export interface ChipFiltro { campo: CampoMulti | "excecao"; valor: string; rotulo: string }

const NOME_CAMPO: Record<CampoMulti, string> = {
  meses: "Mês", tipos: "Tipo", graus: "Grau", contratos: "Contrato", solicitantes: "Solicitante", cargos: "Função",
};

/** Um chip por valor marcado, na ordem dos filtros na tela. */
export function chipsDosFiltros(f: FiltrosAdv): ChipFiltro[] {
  const chips: ChipFiltro[] = [];
  for (const c of CAMPOS) {
    for (const v of f[c]) {
      const nome = c === "meses" ? `Mês (${f.baseMes === "solicitada" ? "solicitada" : "ocorrido"})` : NOME_CAMPO[c];
      chips.push({ campo: c, valor: v, rotulo: `${nome}: ${c === "meses" ? rotuloMes(v) : v}` });
    }
  }
  if (f.excecao !== "todas") {
    chips.push({ campo: "excecao", valor: f.excecao, rotulo: f.excecao === "sim" ? "Só exceções fora do prazo" : "Sem exceção de prazo" });
  }
  return chips;
}

/** Tira o chip clicado. */
export function removerChip(f: FiltrosAdv, chip: ChipFiltro): FiltrosAdv {
  if (chip.campo === "excecao") return { ...f, excecao: "todas" };
  return { ...f, [chip.campo]: f[chip.campo].filter(v => v !== chip.valor) };
}
