/**
 * Campos do checklist de Implantação que já existem na Capa de Edital, Grade
 * de Licitações ou Planilha de Custo e, por isso, chegam prontos pro usuário
 * apenas conferir e confirmar no topo da tela.
 *
 * A lista original de 11 itens veio da SIS-2026-0559. Em 13/10/2026, a planilha
 * "Ajustes_para_Desenvolvedor" acrescentou os campos vindos da Planilha de
 * Custo e os campos Data da homologação, Data captação, Posição, Status, Fase,
 * prazo de treinamentos e EPIs.
 *
 * O vínculo com o checklist é o `row_index` de `checklist_items` — NÃO o texto
 * do item, que tem erro de digitação em várias linhas e muda se a planilha for
 * reimportada. Os números abaixo foram conferidos um a um contra o banco.
 *
 * Arquivo sem React de propósito: é o que dá pra testar em `src/test/`.
 */

/** Uma linha de `implantacao_origem_contrato(uuid)` (migration 20260930000275). */
export interface OrigemContrato {
  data_inicio: string | null;
  locais_postos: string | null;
  escalas_postos: string | null;
  prazo_envio_treinamentos: string | null;
  epis_especificados: string | null;
  insalubridade_periculosidade: string | null;
  data_homologacao: string | null;
  abertura: string | null;
  data_captacao: string | null;
  edital: string | null;
  horario: string | null;
  cidade: string | null;
  objeto: string | null;
  empresa: string | null;
  responsavel: string | null;
  posicao: string | null;
  uf: string | null;
  status: string | null;
  fase: string | null;
  valor_global: string | null;
  qtd_postos: number | null;
}

export type FonteOrigem = "capa" | "grade" | "planilha";
export type FormatoOrigem = "texto" | "data" | "moeda" | "inteiro";

export interface CampoOrigem {
  /** `checklist_items.row_index` — a chave de `checklist_respostas`. */
  rowIndex: number;
  /** Coluna correspondente no retorno do RPC. */
  chave: keyof OrigemContrato;
  /** Rótulo curto pro bloco. O texto integral do item vem de `checklist_items`. */
  rotulo: string;
  fonte: FonteOrigem;
  formato: FormatoOrigem;
}

export const CAMPOS_ORIGEM: readonly CampoOrigem[] = [
  { rowIndex: 3,  chave: "locais_postos",                rotulo: "Locais de cada posto de trabalho (Endereço)", fonte: "planilha", formato: "texto" },
  { rowIndex: 4,  chave: "escalas_postos",               rotulo: "Escala de horário de postos",                 fonte: "planilha", formato: "texto" },
  { rowIndex: 25, chave: "prazo_envio_treinamentos",     rotulo: "Prazo envio treinamentos",                   fonte: "capa",     formato: "data"  },
  { rowIndex: 27, chave: "epis_especificados",           rotulo: "EPIs especificados",                         fonte: "capa",     formato: "texto" },
  { rowIndex: 28, chave: "insalubridade_periculosidade", rotulo: "Insalubridade/periculosidade",               fonte: "planilha", formato: "texto" },
  { rowIndex: 31, chave: "data_inicio",  rotulo: "Data de início do contrato",      fonte: "capa",  formato: "data"    },
  { rowIndex: 48, chave: "data_homologacao", rotulo: "Data da homologação",         fonte: "capa",  formato: "data"    },
  { rowIndex: 49, chave: "abertura",     rotulo: "Data de abertura",                fonte: "capa",  formato: "data"    },
  { rowIndex: 50, chave: "data_captacao", rotulo: "Data captação",                  fonte: "grade", formato: "data"    },
  { rowIndex: 51, chave: "edital",       rotulo: "EDITAL",                          fonte: "grade", formato: "texto"   },
  { rowIndex: 52, chave: "horario",      rotulo: "Horário",                         fonte: "grade", formato: "texto"   },
  { rowIndex: 53, chave: "cidade",       rotulo: "Cidade",                          fonte: "grade", formato: "texto"   },
  { rowIndex: 54, chave: "objeto",       rotulo: "Objeto",                          fonte: "capa",  formato: "texto"   },
  { rowIndex: 55, chave: "empresa",      rotulo: "Empresa",                         fonte: "capa",  formato: "texto"   },
  { rowIndex: 56, chave: "responsavel",  rotulo: "Responsável",                     fonte: "capa",  formato: "texto"   },
  { rowIndex: 57, chave: "posicao",      rotulo: "Posição",                         fonte: "grade", formato: "texto"   },
  { rowIndex: 58, chave: "uf",           rotulo: "UF",                              fonte: "capa",  formato: "texto"   },
  { rowIndex: 59, chave: "status",       rotulo: "Status",                          fonte: "capa",  formato: "texto"   },
  { rowIndex: 60, chave: "fase",         rotulo: "Fase",                            fonte: "grade", formato: "texto"   },
  { rowIndex: 61, chave: "valor_global", rotulo: "Valor global",                    fonte: "capa",  formato: "moeda"   },
  { rowIndex: 62, chave: "qtd_postos",   rotulo: "Nº pessoas (Quantidade de postos)", fonte: "capa", formato: "inteiro" },
] as const;

/** Os `row_index` que saíram da grade de setores e viraram bloco no topo. */
export const ROW_INDEX_NO_TOPO: ReadonlySet<number> = new Set(
  CAMPOS_ORIGEM.map((c) => c.rowIndex)
);

export const ROTULO_FONTE: Record<FonteOrigem, string> = {
  capa: "Capa de Edital",
  grade: "Grade de Licitações",
  planilha: "Planilha de Custo",
};

/**
 * `null`, string vazia e `0` contam como "sem dado".
 *
 * O zero é intencional: `qtd_postos = 0` não é um contrato com zero postos, é
 * capa não preenchida — confirmar isso gravaria "0" como resposta do checklist.
 */
export function semDado(valor: string | number | null | undefined): boolean {
  if (valor === null || valor === undefined) return true;
  if (typeof valor === "number") return !Number.isFinite(valor) || valor === 0;
  return valor.trim() === "";
}

/**
 * "1265688.12" → "R$ 1.265.688,12".
 *
 * `capa_edital.valor_estimado` e `grade.valor_global` são TEXT no banco, não
 * numeric — o que chega pode ser qualquer coisa. Se não der pra ler como
 * número, devolve o texto original em vez de "R$ NaN".
 */
export function formatarMoeda(valor: string | null | undefined): string {
  if (semDado(valor)) return "";
  const bruto = String(valor).trim();
  const n = Number(bruto);
  if (!Number.isFinite(n)) return bruto;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Datas do módulo, que vêm em três formatos diferentes:
 *
 *   "2026-03-02"                 → "02/03/2026"   (date puro)
 *   "2026-07-06T00:00:00+00:00"  → "06/07/2026"   (timestamptz)
 *   "2026-01-28 08H30"           → "28/01/2026 08H30"
 *
 * O terceiro é o caso de `abertura`, que é TEXT LIVRE com a hora grudada em
 * formato humano ("08H30", "09h", "08H"). Não dá pra jogar num `new Date()`:
 * o que não casar com ISO volta como está, sem inventar data.
 */
export function formatarData(valor: string | null | undefined): string {
  if (semDado(valor)) return "";
  const bruto = String(valor).trim();

  const m = bruto.match(/^(\d{4})-(\d{2})-(\d{2})(?:([T ])(.*))?$/);
  if (!m) return bruto;

  const [, ano, mes, dia, separador, resto] = m;
  const data = `${dia}/${mes}/${ano}`;

  // "T" é timestamp de máquina — a hora ali é ruído (sempre 00:00:00+00).
  // Espaço é a hora escrita à mão na Capa, que o pessoal quer ver.
  if (separador === " " && resto?.trim()) return `${data} ${resto.trim()}`;
  return data;
}

export function formatarInteiro(valor: number | null | undefined): string {
  if (semDado(valor)) return "";
  return String(valor);
}

/** Valor já formatado de um campo. String vazia quando a origem não tem o dado. */
export function valorFormatado(campo: CampoOrigem, origem: OrigemContrato | null): string {
  if (!origem) return "";
  const bruto = origem[campo.chave];
  switch (campo.formato) {
    case "moeda":
      return formatarMoeda(bruto as string | null);
    case "data":
      return formatarData(bruto as string | null);
    case "inteiro":
      return formatarInteiro(bruto as number | null);
    default:
      return semDado(bruto as string | null) ? "" : String(bruto).trim();
  }
}
