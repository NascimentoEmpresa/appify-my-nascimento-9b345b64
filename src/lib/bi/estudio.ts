// Estúdio de BI — o que as telas compartilham: tipos, paleta, formatos e as
// regras de "que gráfico cabe nesse resultado".
//
// A forma de um widget é `tipo` + `config`; o dado vem do SQL gravado nele,
// executado no banco por bi_widget_dados / bi_executar_sql (migration
// 20260930000106). Aqui não tem acesso a dado — só tradução de resultado em
// gráfico.

export type TipoWidget =
  | "kpi" | "barras" | "barras_h" | "barras_empilhadas" | "linha" | "area"
  | "pizza" | "rosca" | "dispersao" | "tabela";

export type FormatoNumero = "numero" | "moeda" | "percentual" | "inteiro";

export interface SerieConfig { coluna: string; rotulo?: string; cor?: string }

export interface WidgetConfig {
  x?: string;
  series?: SerieConfig[];
  formato?: FormatoNumero;
  casas?: number;
  mostrar_rotulos?: boolean;
  mostrar_legenda?: boolean;
  empilhar?: boolean;
  /** kpi: coluna do número, opcional coluna do período anterior pra variação */
  kpi?: { coluna?: string; comparar_coluna?: string; sufixo?: string; prefixo?: string };
  /** dispersao: coluna Y (o X vem de `x`); opcional tamanho e rótulo do ponto */
  y?: string;
  rotulo_ponto?: string;
  /** tabela: colunas a mostrar (vazio = todas) e formatos por coluna */
  colunas?: string[];
  formatos?: Record<string, FormatoNumero>;
  /** cor única (1 série) — override da paleta */
  cor?: string;
}

export interface FiltroPainel {
  chave: string;
  rotulo: string;
  tipo: "texto" | "data" | "numero" | "lista";
  padrao?: string | null;
  opcoes?: string[];
}

export interface Painel {
  id: number;
  nome: string;
  descricao: string | null;
  dono_id: string;
  dono_nome: string | null;
  publico: boolean;
  filtros: FiltroPainel[];
  config: { tema?: "claro" | "escuro"; atualizar_a_cada_seg?: number };
  criado_em: string;
  atualizado_em: string;
}

export interface Widget {
  id: number;
  painel_id: number;
  titulo: string;
  subtitulo: string | null;
  tipo: TipoWidget;
  sql: string;
  config: WidgetConfig;
  largura: number;
  altura: number;
  ordem: number;
  criado_por_ia: boolean;
}

/** O que bi_rodar devolve. */
export interface ResultadoSql {
  colunas: { nome: string; tipo: "string" | "number" | "boolean" | "null" | "object" | "array" }[];
  linhas: Record<string, unknown>[];
  total: number;
  truncado: boolean;
  ms: number;
}

/** Widget ainda sem id — o que a IA devolve ou o editor monta antes de salvar. */
export type WidgetRascunho = Omit<Widget, "id" | "painel_id" | "ordem"> & {
  explicacao?: string | null;
  ok?: boolean;
  erro?: string | null;
  amostra?: ResultadoSql | null;
};

export const TIPOS_WIDGET: { valor: TipoWidget; rotulo: string; dica: string }[] = [
  { valor: "kpi", rotulo: "Número (KPI)", dica: "Um número-resumo, com variação opcional" },
  { valor: "barras", rotulo: "Barras", dica: "Comparar categorias" },
  { valor: "barras_h", rotulo: "Barras horizontais", dica: "Categorias com nome longo ou ranking" },
  { valor: "barras_empilhadas", rotulo: "Barras empilhadas", dica: "Composição por categoria" },
  { valor: "linha", rotulo: "Linha", dica: "Evolução no tempo" },
  { valor: "area", rotulo: "Área", dica: "Evolução no tempo, com volume" },
  { valor: "pizza", rotulo: "Pizza", dica: "Partes de um todo (poucas fatias)" },
  { valor: "rosca", rotulo: "Rosca", dica: "Partes de um todo, com o total no meio" },
  { valor: "dispersao", rotulo: "Dispersão", dica: "Relação entre dois números" },
  { valor: "tabela", rotulo: "Tabela", dica: "Detalhe linha a linha" },
];

export const LARGURAS = [3, 4, 6, 8, 12] as const;
export const ALTURAS = [1, 2, 3, 4] as const;

/**
 * Paleta categórica — a instância validada do skill de dataviz (8 matizes em
 * ordem FIXA; a 9ª série vira "Outros", nunca uma cor inventada). Texto nunca
 * usa a cor da série: valor, rótulo e legenda ficam em tinta de texto.
 */
export const PALETA = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
export const PALETA_ESCURA = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const COR_POSITIVO = "#0ca30c";
export const COR_NEGATIVO = "#d03b3b";
export const MAX_SERIES = 8;

export const corDaSerie = (i: number, escuro = false, override?: string) =>
  override || (escuro ? PALETA_ESCURA : PALETA)[i % MAX_SERIES];

// ── Formatação ──────────────────────────────────────────────────────────
const nf = (casas: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export function formatarValor(v: unknown, formato: FormatoNumero = "numero", casas?: number): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (Number.isNaN(n)) return String(v);
  switch (formato) {
    case "moeda": return "R$ " + nf(casas ?? 2).format(n);
    case "percentual": return nf(casas ?? 1).format(n) + "%";
    case "inteiro": return nf(0).format(n);
    default: return nf(casas ?? (Number.isInteger(n) ? 0 : 2)).format(n);
  }
}

/** Compacto para eixo: 1,2 mil · 3,4 mi. */
export function formatarCurto(v: unknown, formato: FormatoNumero = "numero"): string {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return String(v ?? "");
  const abs = Math.abs(n);
  const pre = formato === "moeda" ? "R$ " : "";
  const suf = formato === "percentual" ? "%" : "";
  if (abs >= 1e9) return pre + nf(1).format(n / 1e9) + " bi" + suf;
  if (abs >= 1e6) return pre + nf(1).format(n / 1e6) + " mi" + suf;
  if (abs >= 1e3) return pre + nf(1).format(n / 1e3) + " mil" + suf;
  return pre + nf(abs < 10 && !Number.isInteger(n) ? 1 : 0).format(n) + suf;
}

/** "2026-03" → "mar/26"; "2026-03-15" → "15/03/26"; resto, como veio. */
export function formatarRotuloX(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const s = String(v);
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  let m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${meses[Number(m[2]) - 1]}/${m[1].slice(2)}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
  return s.length > 28 ? s.slice(0, 26) + "…" : s;
}

// ── Inferência: dado um resultado, o que dá pra sugerir ──────────────────
export function colunasNumericas(r: ResultadoSql | null | undefined): string[] {
  if (!r?.colunas?.length) return [];
  return r.colunas.filter(c => c.tipo === "number").map(c => c.nome);
}
export function colunasTexto(r: ResultadoSql | null | undefined): string[] {
  if (!r?.colunas?.length) return [];
  return r.colunas.filter(c => c.tipo !== "number").map(c => c.nome);
}

/** Config sugerida quando o analista muda o SQL e ainda não mapeou nada. */
export function sugerirConfig(tipo: TipoWidget, r: ResultadoSql | null | undefined, atual: WidgetConfig = {}): WidgetConfig {
  const nums = colunasNumericas(r);
  const txts = colunasTexto(r);
  const cols = (r?.colunas ?? []).map(c => c.nome);
  const temX = atual.x && cols.includes(atual.x);
  const seriesValidas = (atual.series ?? []).filter(s => cols.includes(s.coluna));
  const base: WidgetConfig = { ...atual };
  if (tipo === "kpi") {
    const col = atual.kpi?.coluna && cols.includes(atual.kpi.coluna) ? atual.kpi.coluna : nums[0] ?? cols[0];
    return { ...base, kpi: { ...(atual.kpi ?? {}), coluna: col } };
  }
  if (tipo === "tabela") return base;
  if (tipo === "dispersao") {
    return { ...base, x: temX ? atual.x : nums[0], y: atual.y && cols.includes(atual.y) ? atual.y : nums[1] ?? nums[0] };
  }
  return {
    ...base,
    x: temX ? atual.x : (txts[0] ?? cols[0]),
    series: seriesValidas.length ? seriesValidas : nums.slice(0, tipo === "pizza" || tipo === "rosca" ? 1 : MAX_SERIES).map(c => ({ coluna: c, rotulo: c })),
  };
}

/** Valores dos filtros do painel → params do SQL (vazio vira NULL no banco). */
export function paramsDosFiltros(filtros: FiltroPainel[], valores: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of filtros) out[f.chave] = valores[f.chave] ?? f.padrao ?? null;
  return out;
}

/** CSV de um resultado — o botão "Exportar" de cada widget. */
export function resultadoParaCsv(r: ResultadoSql): string {
  const cols = r.colunas.map(c => c.nome);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(";"), ...r.linhas.map(l => cols.map(c => esc(l[c])).join(";"))].join("\n");
}
