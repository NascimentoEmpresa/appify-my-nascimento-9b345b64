// SST › Acidentes de Trabalho (SIS-2026-0889, mig 20261117220000) — o que a
// tela calcula: o que falta para concluir (a MESMA lista do banco,
// sst_acidente_pendencias), os filtros, os indicadores, a leitura da planilha
// que o SST usava e a exportação no mesmo formato dela, para o Power BI.
import * as XLSX from "xlsx";
import { dataDaCelula, fmtData, hojeIso } from "@/lib/sst/exameToxicologico";

export { fmtData, hojeIso };

export type TipoAcidente = "tipico" | "trajeto";
export const ROTULO_TIPO: Record<TipoAcidente, string> = { tipico: "Típico", trajeto: "Trajeto" };
/** As siglas da planilha do SST; "Empresa" 1 da Senior é a NASCIMENTO. */
export const EMPRESAS = ["NASCIMENTO", "SN", "NH", "CANAÃ"] as const;

export interface Acidente {
  id: number;
  empregado_id: number | null;
  /** false = linha importada cujo nome não casou com um colaborador só. */
  vinculado: boolean;
  nome: string;
  cargo: string | null;
  situacao_senior: string | null;
  desligado: boolean;
  empresa: string | null;
  contrato_id: string | null;
  contrato_nome: string | null;
  /** O contrato como a planilha escrevia. */
  contrato_texto: string | null;
  encarregado: string | null;
  data_acidente: string;
  tipo: TipoAcidente | null;
  descricao: string | null;
  houve_afastamento: boolean;
  dias_afastamento: number | null;
  encaminhado_inss: boolean;
  /** null = ainda não decidido. */
  cat_emitida: boolean | null;
  numero_cat: string | null;
  cat_motivo_sem: string | null;
  morte_invalidez: boolean;
  observacoes: string | null;
  afastamento_id: number | null;
  ctrl_afastamento_id: number | null;
  concluido: boolean;
  concluido_em: string | null;
  concluido_por: string | null;
  origem: "manual" | "planilha";
  created_at: string;
  documentos: number;
  cat_anexada: boolean;
}

export const contratoExibido = (a: Pick<Acidente, "contrato_nome" | "contrato_texto">): string | null =>
  a.contrato_nome ?? a.contrato_texto ?? null;

/**
 * O que falta para concluir — mesmos textos e mesma ordem de
 * sst_acidente_pendencias(). A tela mostra antes; o banco confere na hora.
 */
export function pendenciasParaConcluir(
  a: Pick<Acidente, "vinculado" | "contrato_id" | "contrato_texto" | "tipo" | "descricao" | "houve_afastamento" |
    "dias_afastamento" | "cat_emitida" | "numero_cat" | "cat_motivo_sem">,
  catAnexada: boolean,
): string[] {
  const vazio = (v: string | null | undefined) => !String(v ?? "").trim();
  const p: string[] = [];
  if (!a.vinculado) p.push("Ligar o registro a um colaborador");
  if (!a.contrato_id && vazio(a.contrato_texto)) p.push("Informar o contrato");
  if (!a.tipo) p.push("Informar o tipo (típico ou trajeto)");
  if (vazio(a.descricao)) p.push("Descrever o ocorrido");
  if (a.houve_afastamento && a.dias_afastamento == null) p.push("Informar os dias de afastamento");
  if (a.cat_emitida == null) p.push("Dizer se a CAT foi emitida");
  else if (a.cat_emitida) {
    if (vazio(a.numero_cat)) p.push("Informar o número da CAT");
    if (!catAnexada) p.push("Anexar o arquivo da CAT");
  } else if (vazio(a.cat_motivo_sem)) p.push("Informar o motivo de não ter emitido a CAT");
  return p;
}

const diasEntre = (de: string, ate: string): number =>
  Math.round((Date.parse(`${ate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${de.slice(0, 10)}T00:00:00Z`)) / 86400000);

/** Dias desde o último acidente registrado (o "DIAS SEM ACIDENTES" da planilha). */
export function diasSemAcidente(lista: Pick<Acidente, "data_acidente">[], hoje = hojeIso()): number | null {
  const ultimo = lista.reduce<string | null>((m, a) => (!m || a.data_acidente > m ? a.data_acidente : m), null);
  return ultimo ? Math.max(0, diasEntre(ultimo, hoje)) : null;
}

export type FiltroConcluida = "todas" | "sim" | "nao";
export interface FiltrosAcidente {
  de: string;
  ate: string;
  /** Nome exibido do contrato; "todos" = sem filtro. */
  contrato: string;
  colaborador: string;
  concluida: FiltroConcluida;
  soSemVinculo: boolean;
}
export const FILTROS_INICIAIS: FiltrosAcidente = { de: "", ate: "", contrato: "todos", colaborador: "", concluida: "todas", soSemVinculo: false };

const normalizar = (v: unknown): string =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

export function filtrarAcidentes(lista: Acidente[], f: FiltrosAcidente): Acidente[] {
  const q = normalizar(f.colaborador);
  return lista.filter((a) =>
    (!f.de || a.data_acidente >= f.de) &&
    (!f.ate || a.data_acidente <= f.ate) &&
    (f.contrato === "todos" || contratoExibido(a) === f.contrato) &&
    (!q || normalizar(a.nome).includes(q)) &&
    (f.concluida === "todas" || a.concluido === (f.concluida === "sim")) &&
    (!f.soSemVinculo || !a.vinculado));
}

export interface IndicadoresAcidente {
  total: number;
  comAfastamento: number;
  comInss: number;
  diasAfastamento: number;
  emAberto: number;
  semVinculo: number;
}

/** São poucos acidentes por ano: a soma no navegador é o suficiente. */
export const indicadores = (lista: Acidente[]): IndicadoresAcidente => ({
  total: lista.length,
  comAfastamento: lista.filter((a) => a.houve_afastamento).length,
  comInss: lista.filter((a) => a.encaminhado_inss).length,
  diasAfastamento: lista.reduce((s, a) => s + (a.dias_afastamento ?? 0), 0),
  emAberto: lista.filter((a) => !a.concluido).length,
  semVinculo: lista.filter((a) => !a.vinculado).length,
});

// =====================================================================
// A coluna "ACIDENTE" da planilha juntava duas respostas em três valores.
// "C/ AFASTAMENTO", sozinho, é COM INSS (contraponto de "C/ AFASTAMENTO S/ INSS").
// =====================================================================

export type AcidenteLegado = "S/ AFASTAMENTO" | "C/ AFASTAMENTO S/ INSS" | "C/ AFASTAMENTO";

export function afastamentoDoLegado(v: unknown): { houve_afastamento: boolean; encaminhado_inss: boolean } | null {
  const t = normalizar(v).replace(/\s+/g, "");
  if (/^S\/?AFAST/.test(t)) return { houve_afastamento: false, encaminhado_inss: false };
  if (/^C\/?AFAST\w*S\/?INSS$/.test(t)) return { houve_afastamento: true, encaminhado_inss: false };
  if (/^C\/?AFAST\w*(C\/?INSS)?$/.test(t)) return { houve_afastamento: true, encaminhado_inss: true };
  return null;
}

export const legadoDoAfastamento = (a: Pick<Acidente, "houve_afastamento" | "encaminhado_inss">): AcidenteLegado =>
  !a.houve_afastamento ? "S/ AFASTAMENTO" : a.encaminhado_inss ? "C/ AFASTAMENTO" : "C/ AFASTAMENTO S/ INSS";

/** "TÍPICO", "TIPICO" → típico; "-" ou vazio → não informado (null); outro texto → undefined. */
export function tipoDoTexto(v: unknown): TipoAcidente | null | undefined {
  const t = normalizar(v);
  if (!t || /^-+$/.test(t)) return null;
  if (/^TIPIC/.test(t)) return "tipico";
  if (/^TRAJET/.test(t)) return "trajeto";
  return undefined;
}

/** SIM / NÃO / X; vazio → null; outro texto → undefined. */
export function simNao(v: unknown): boolean | null | undefined {
  const t = normalizar(v);
  if (!t || /^-+$/.test(t)) return null;
  if (/^(S|SIM|X)$/.test(t)) return true;
  if (/^(N|NAO)$/.test(t)) return false;
  return undefined;
}

// =====================================================================
// A planilha ("PLANILHA DE ACIDENTES.xlsx", aba "Histórico de Acidentes"):
// título e totais no alto, cabeçalho na linha 13 — EMPRESA | CONTRATO |
// ACIDENTE | DATA DO ACIDENTE | TIPO DE ACIDENTE | Nº DE PESSOAS ENVOLVIDAS |
// NOME DOS ENVOLVIDOS | MOTIVO / CAUSA | CAT | Nº DA CAT | MORTE / INVALIDEZ |
// Coluna1 | Coluna2. As colunas sem nome conhecido viram observação.
// =====================================================================

export interface LinhaAcidente {
  linha: number;
  empresa: string | null;
  contrato: string | null;
  data_acidente: string;
  tipo: TipoAcidente | null;
  nome: string;
  descricao: string | null;
  houve_afastamento: boolean;
  encaminhado_inss: boolean;
  cat_emitida: boolean | null;
  numero_cat: string | null;
  morte_invalidez: boolean;
  observacoes: string | null;
  avisos: string[];
}
export interface LeituraAcidentes { aba: string; linhas: LinhaAcidente[]; ignoradas: { linha: number; nome: string; motivo: string }[] }

const CABECALHO: Record<string, RegExp> = {
  empresa: /^EMPRESA/, contrato: /^CONTRATO/, acidente: /^ACIDENTE$/, data: /^DATA/, tipo: /^TIPO/,
  pessoas: /PESSOAS/, nome: /^NOME/, motivo: /MOTIVO|CAUSA|DESCRI/, cat: /^CAT$/, numero: /^N.*CAT/, morte: /MORTE|INVALIDEZ/,
};
type Coluna = keyof typeof CABECALHO;

const texto = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const semTraco = (v: unknown): string | null => { const t = texto(v); return t && !/^-+$/.test(t) ? t : null; };

export function lerPlanilhaAcidentes(dados: ArrayBuffer | Uint8Array): LeituraAcidentes {
  const wb = XLSX.read(dados, { type: "array" });
  for (const nomeAba of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nomeAba], { header: 1, raw: true, defval: "" });
    const iCab = rows.slice(0, 30).findIndex((r) => {
      const n = r.map(normalizar);
      return n.some((c) => /^NOME/.test(c)) && n.some((c) => /^DATA/.test(c)) && n.some((c) => /CAT/.test(c));
    });
    if (iCab < 0) continue;

    const col = {} as Record<Coluna, number>;
    const extras: number[] = [];
    rows[iCab].forEach((c, i) => {
      const n = normalizar(c);
      const k = (Object.keys(CABECALHO) as Coluna[]).find((x) => col[x] == null && CABECALHO[x].test(n));
      if (k) col[k] = i; else extras.push(i);
    });
    const cel = (r: unknown[], k: Coluna) => (col[k] == null ? "" : r[col[k]]);

    const linhas: LinhaAcidente[] = [];
    const ignoradas: LeituraAcidentes["ignoradas"] = [];
    rows.slice(iCab + 1).forEach((r, k) => {
      const linha = iCab + k + 2;
      const nome = texto(cel(r, "nome"));
      if (!nome) return;
      const avisos: string[] = [];

      const data = dataDaCelula(cel(r, "data"));
      if (!data) { ignoradas.push({ linha, nome, motivo: data === null ? "sem data do acidente" : `data ilegível ("${texto(cel(r, "data"))}")` }); return; }
      if (data > hojeIso()) { ignoradas.push({ linha, nome, motivo: `data no futuro (${fmtData(data)})` }); return; }

      const afast = afastamentoDoLegado(cel(r, "acidente"));
      if (!afast) avisos.push(`"ACIDENTE" = "${texto(cel(r, "acidente"))}" não reconhecido: entra sem afastamento`);

      const tipo = tipoDoTexto(cel(r, "tipo"));
      if (tipo === undefined) avisos.push(`Tipo "${texto(cel(r, "tipo"))}" não reconhecido: fica em branco`);

      let cat = simNao(cel(r, "cat"));
      const numero = semTraco(cel(r, "numero"));
      if (cat === undefined) { avisos.push(`CAT "${texto(cel(r, "cat"))}" não reconhecida`); cat = null; }
      if (numero && cat !== true) { avisos.push("Tinha número de CAT: marcada como emitida"); cat = true; }
      if (cat === true && !numero) avisos.push("CAT marcada SIM sem número: entra em aberto");

      const pessoas = Number(texto(cel(r, "pessoas")));
      if (pessoas > 1) avisos.push(`${pessoas} pessoas na mesma linha: entra só "${nome}"`);

      const obs = extras.map((i) => semTraco(r[i])).filter(Boolean).join(" · ");
      linhas.push({
        linha, nome, data_acidente: data,
        empresa: semTraco(cel(r, "empresa"))?.toUpperCase() ?? null,
        contrato: semTraco(cel(r, "contrato")),
        tipo: tipo ?? null,
        descricao: semTraco(cel(r, "motivo")),
        houve_afastamento: afast?.houve_afastamento ?? false,
        encaminhado_inss: afast?.encaminhado_inss ?? false,
        cat_emitida: cat, numero_cat: numero,
        morte_invalidez: simNao(cel(r, "morte")) === true,
        observacoes: obs || null,
        avisos,
      });
    });
    if (linhas.length > 0 || ignoradas.length > 0) return { aba: nomeAba, linhas, ignoradas };
  }
  throw new Error('Nenhuma aba com as colunas "NOME DOS ENVOLVIDOS", "DATA DO ACIDENTE" e "CAT" foi encontrada.');
}

/** O que vai para sst_acidente_importar: a linha sem os avisos. */
export const linhasParaImportar = (l: LinhaAcidente[]) => l.map(({ avisos: _avisos, ...x }) => x);

// =====================================================================
// Exportação no formato da planilha antiga: mesmo nome de aba, título e
// totais nas mesmas células, cabeçalho na linha 13 e as mesmas colunas na
// mesma ordem — as novas vêm depois. Quem mantém o Power BI troca o arquivo.
// =====================================================================

export const ABA_EXPORTACAO = "Histórico de Acidentes";
export const COLUNAS_EXPORTACAO = [
  "EMPRESA", "CONTRATO", "ACIDENTE", "DATA DO ACIDENTE", "TIPO DE ACIDENTE", "Nº DE PESSOAS ENVOLVIDAS", "NOME DOS ENVOLVIDOS",
  "MOTIVO / CAUSA", "CAT", "Nº DA CAT", "MORTE / INVALIDEZ",
  "ENCARREGADO", "DIAS DE AFASTAMENTO", "ENCAMINHADO AO INSS", "CONCLUÍDO", "OBSERVAÇÕES",
] as const;

/** Data local (não UTC): o SheetJS grava pelo fuso do navegador, e UTC perderia um dia. */
const dataLocal = (iso: string): Date => { const [a, m, d] = iso.slice(0, 10).split("-").map(Number); return new Date(a, m - 1, d); };
const SIM_NAO = (v: boolean | null) => (v == null ? "" : v ? "SIM" : "NÃO");

export function planilhaExportacao(lista: Acidente[], hoje = hojeIso()): unknown[][] {
  const ordenada = [...lista].sort((a, b) => a.data_acidente.localeCompare(b.data_acidente) || a.id - b.id);
  const linhas = ordenada.map((a) => [
    a.empresa ?? "", contratoExibido(a) ?? "", legadoDoAfastamento(a), dataLocal(a.data_acidente),
    a.tipo ? ROTULO_TIPO[a.tipo].toUpperCase() : "-", 1, a.nome, a.descricao ?? "-", SIM_NAO(a.cat_emitida), a.numero_cat ?? "",
    a.morte_invalidez ? "SIM" : "",
    a.encarregado ?? "", a.dias_afastamento ?? "", SIM_NAO(a.encaminhado_inss), a.concluido ? "SIM" : "NÃO", a.observacoes ?? "",
  ]);
  return [
    ["PLANILHA DE CONTROLE DE ACIDENTES"], [],
    ["TOTAL DE ACIDENTES"], [], [lista.length], [],
    ["DIAS SEM ACIDENTES"], [], [diasSemAcidente(lista, hoje) ?? ""], [], [], [],
    [...COLUNAS_EXPORTACAO],
    ...linhas,
  ];
}

export function baixarPlanilhaAcidentes(lista: Acidente[], hoje = hojeIso()) {
  const ws = XLSX.utils.aoa_to_sheet(planilhaExportacao(lista, hoje), { cellDates: true, dateNF: "dd/mm/yyyy" });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, ABA_EXPORTACAO);
  XLSX.writeFile(wb, `PLANILHA DE ACIDENTES - ERP ${fmtData(hoje).replace(/\//g, "-")}.xlsx`);
}
