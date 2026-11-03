// RH › Solicitações de Demissão — o CONTROLE DA RESCISÃO (19/10/2026).
//
// A tela do RH passou a ser a "PLANILHA DE RESCISÃO Geral 2026" que o RH
// mantinha no Excel: uma linha por desligamento, com homologação, datas
// (aviso, último dia, demissão, pagamento), tipo de desligamento, programadas
// (rescisão e vales), malote, envio/retorno da documentação e o status da
// rescisão. As respostas do Pablo que moldaram isto estão no cabeçalho da
// migration 20261019000030 (tabela RH_RESCISAO).
//
// Duas fontes viram uma lista só:
//   · a solicitação do ERP (SISTEMA_SOLICITACOES_DEMISSAO) + a sua linha em
//     RH_RESCISAO, que desde 22/10/2026 nasce NO BANCO quando o RH libera a
//     demissão (gatilho trg_demissao_cria_rescisao, mig 20261022000400 —
//     antes nascia na primeira edição, e até lá a tela inventava a linha);
//   · a linha IMPORTADA da planilha (origem = 'planilha'), sem solicitação.
//
// E desde 22/10/2026 a tela é a PLANILHA (Recursos Humanos › Rescisões),
// editável na célula, com os 10 status da lista suspensa do Excel — o kanban
// do módulo próprio de 21/10 saiu ("tem que parecer a planilha só que melhor").
//
// O que a solicitação já sabe (aviso, última data trabalhada, motivo) entra
// como SUGESTÃO até o RH gravar — e a sugestão segue a régua que a própria
// planilha usa (conferido nas 1.074 linhas com as duas datas, 19/10/2026):
//   · demissão = último dia + 7 no "sem justa - trabalhado" (os 7 dias de
//     redução do aviso, 375 de 389); nos outros tipos, o próprio último dia;
//   · pagamento = demissão + 5 (1.067 de 1.074).
// Tudo aqui é puro, sem banco — é o que o teste (demissaoRescisao.test.ts) cobre.

import * as XLSX from "xlsx";
import type { SolicitacaoDemissao } from "@/lib/demissao/solicitacao";

export const TABELA_RESCISAO = "RH_RESCISAO";

// ── Opções (as mesmas listas dos CHECKs da migration) ────────────────
export const HOMOLOGACOES = ["Não", "Sim", "Aguardando carta", "Carta não homo", "Realizado"] as const;

/**
 * A coluna STATUS da planilha — a mesma lista suspensa do Excel (22/10/2026,
 * mig 20261022000400; antes eram 5 e "pendência", "recalcular", "guia
 * pendente", "fazer VA" e "urgente" sumiam dentro de "Por fazer"). Na ordem
 * do trabalho: o que falta fazer, o que está travado, o que está feito.
 */
export const STATUS_RESCISAO = [
  "Rescisão por fazer", "Rescisão urgente por fazer", "Recalcular", "Guia pendente", "Pendência",
  "Fazer VA", "Rescisão feita", "Encaminhado ao INSS", "Rescisão OK", "Rescisão e documentos OK",
] as const;
export type StatusRescisao = (typeof STATUS_RESCISAO)[number];

/** O status da linha que acabou de chegar do ERP (o que a planilha escrevia na linha nova). */
export const STATUS_PADRAO: StatusRescisao = "Rescisão por fazer";

/**
 * Concluída = "Rescisão OK" (rescisão paga) ou "Rescisão e documentos OK"
 * (paga e sem documento faltando) — as duas que o RH usa como fim da linha.
 */
export const STATUS_CONCLUIDOS: readonly StatusRescisao[] = ["Rescisão OK", "Rescisão e documentos OK"];
export const rescisaoConcluida = (s: string | null | undefined): boolean =>
  (STATUS_CONCLUIDOS as readonly string[]).includes(s ?? STATUS_PADRAO);

export const TIPO_SJ_TRABALHADO = "Sem justa causa - trabalhado";
export const TIPOS_DESLIGAMENTO = [
  TIPO_SJ_TRABALHADO,
  "Sem justa causa - indenizado",
  "Pedido de demissão",
  "Pedido de demissão (vai cumprir aviso)",
  "Término de contrato",
  "Término de contrato - jovem aprendiz",
  "Término de contrato - estágio",
  "Término antecipado pelo empregado",
  "Término antecipado pela empresa",
  "Acordo por lei",
  "Justa causa",
  "Abandono de emprego",
  "Rescisão por morte",
  "Rescisão indireta",
  "Rescisão complementar",
] as const;
export type TipoDesligamento = (typeof TIPOS_DESLIGAMENTO)[number];

export const MEIOS_ENVIO = ["ZapSign", "Impresso", "E-mail", "WhatsApp", "Discord", "Outro"] as const;
export const MEIOS_RETORNO = ["ZapSign", "Físico", "E-mail", "Outro"] as const;

/** Empresa (código em EMPREGADOS."Empresa") → a sigla que a planilha usa. */
export const SIGLA_EMPRESA: Record<string, string> = { "1": "HAGG", "2": "SN", "3": "CANAA", "5": "NH" };
export const siglaEmpresa = (codigo: unknown): string | null =>
  codigo == null || codigo === "" ? null : SIGLA_EMPRESA[String(codigo)] ?? String(codigo);

/** Cor do selo do status da rescisão — a régua da coluna STATUS da planilha. */
export function corStatusRescisao(s: string | null | undefined): string {
  switch (s ?? STATUS_PADRAO) {
    case "Rescisão por fazer": return "bg-amber-100 text-amber-900 border-amber-300";
    case "Rescisão urgente por fazer": return "bg-red-600 text-white border-red-700";
    case "Recalcular": return "bg-orange-100 text-orange-800 border-orange-300";
    case "Guia pendente": return "bg-yellow-100 text-yellow-900 border-yellow-300";
    case "Pendência": return "bg-rose-100 text-rose-800 border-rose-300";
    case "Fazer VA": return "bg-lime-100 text-lime-900 border-lime-300";
    case "Rescisão feita": return "bg-sky-100 text-sky-800 border-sky-300";
    case "Encaminhado ao INSS": return "bg-violet-100 text-violet-800 border-violet-300";
    case "Rescisão OK": return "bg-emerald-100 text-emerald-800 border-emerald-300";
    case "Rescisão e documentos OK": return "bg-green-600 text-white border-green-700";
    default: return "bg-muted text-muted-foreground";
  }
}

// ── A linha gravada ──────────────────────────────────────────────────
/** erp = solicitação do ERP · planilha = importada · manual = lançada direto no módulo Rescisões (mig 20261021000030). */
export type OrigemRescisao = "erp" | "planilha" | "manual";

/** A linha da planilha como estava no Excel: cabeçalho → texto/número (datas em dd/mm/aaaa). */
export type LinhaOriginal = Record<string, string | number>;

export interface RescisaoRH {
  id: number;
  solicitacao_id: number | null;
  origem: OrigemRescisao;
  planilha_chave: string | null;
  empresa: string | null;
  matricula: string | null;
  colaborador_nome: string | null;
  contrato: string | null;
  data_recebimento: string | null;
  solicitado_por: string | null;
  homologacao: string | null;
  sst_ok: boolean | null;
  data_aviso: string | null;
  data_ultimo_dia: string | null;
  data_demissao: string | null;
  data_pagamento: string | null;
  tipo_desligamento: string | null;
  rescisao_programada: boolean;
  vales_programados: boolean;
  malote_data: string | null;
  malote_obs: string | null;
  envio_meio: string | null;
  envio_data: string | null;
  envio_obs: string | null;
  retorno_meio: string | null;
  retorno_data: string | null;
  retorno_obs: string | null;
  status_rescisao: string | null;
  observacao: string | null;
  // Mig 20261021000030 (módulo Rescisões) — opcionais: linha lida antes dela não traz.
  pontos_ajustados?: string | null;
  data_admissao?: string | null;
  planilha_original?: LinhaOriginal | null;
  planilha_aba?: string | null;
  status_desde?: string | null;
  atualizado_por: string | null;
  criado_em: string | null;
  atualizado_em: string | null;
}

/** Os campos que o RH edita na tela (e a importação preenche). */
export const CAMPOS_EDITAVEIS = [
  "homologacao", "data_aviso", "data_ultimo_dia", "data_demissao", "data_pagamento",
  "tipo_desligamento", "rescisao_programada", "vales_programados",
  "malote_data", "malote_obs", "envio_meio", "envio_data", "envio_obs",
  "retorno_meio", "retorno_data", "retorno_obs", "status_rescisao", "observacao",
  "pontos_ajustados", "data_admissao",
] as const;
export type CampoEditavel = (typeof CAMPOS_EDITAVEIS)[number];
export type EdicaoRescisao = { [K in CampoEditavel]-?: Exclude<RescisaoRH[K], undefined> };

/** Identificação de uma rescisão lançada à mão (sem solicitação do ERP) — a linha nova da planilha. */
export const CAMPOS_IDENTIFICACAO = ["empresa", "matricula", "colaborador_nome", "contrato", "data_recebimento", "solicitado_por"] as const;
export type IdentificacaoRescisao = { [K in (typeof CAMPOS_IDENTIFICACAO)[number]]: string | null };

// ── Datas ────────────────────────────────────────────────────────────
/** "2026-10-19" + n dias, sem fuso no meio. */
export function somarDias(iso: string | null | undefined, dias: number): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export const DIAS_REDUCAO_AVISO_TRABALHADO = 7;
export const DIAS_ATE_PAGAMENTO = 5;

/** Data da demissão a partir do último dia — a régua da planilha (ver o cabeçalho). */
export function sugerirDataDemissao(ultimoDia: string | null | undefined, tipo: string | null | undefined): string | null {
  if (!ultimoDia) return null;
  return tipo === TIPO_SJ_TRABALHADO ? somarDias(ultimoDia, DIAS_REDUCAO_AVISO_TRABALHADO) : ultimoDia.slice(0, 10);
}

export const sugerirDataPagamento = (demissao: string | null | undefined): string | null =>
  somarDias(demissao, DIAS_ATE_PAGAMENTO);

/**
 * O tipo de desligamento que a solicitação do encarregado indica — motivo +
 * modelo do aviso. Null quando não dá pra dizer (o RH escolhe).
 */
export function tipoPelaSolicitacao(
  s: Pick<SolicitacaoDemissao, "motivo_solicitacao" | "modelo_aviso"> | null | undefined,
): TipoDesligamento | null {
  if (!s) return null;
  const motivo = String(s.motivo_solicitacao ?? "");
  const aviso = String(s.modelo_aviso ?? "");
  if (motivo.startsWith("Pedido de demissão")) return aviso === "Aviso Prévio Trabalhado" ? "Pedido de demissão (vai cumprir aviso)" : "Pedido de demissão";
  if (motivo === "Desligamento sem justa causa") {
    if (aviso === "Aviso Prévio Trabalhado") return TIPO_SJ_TRABALHADO;
    if (aviso === "Aviso Prévio Indenizado") return "Sem justa causa - indenizado";
    return null;
  }
  if (motivo === "Desligamento por justa causa") return "Justa causa";
  if (motivo === "Término de contrato de experiência") return "Término de contrato";
  if (motivo === "Abandono de emprego") return "Abandono de emprego";
  return null;
}

// ── Normalização de texto da planilha ────────────────────────────────
export const semAcento = (s: unknown): string =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** Nome para comparar: sem acento, sem a anotação entre parênteses que a planilha põe no nome. */
export const nomeParaComparar = (s: unknown): string => semAcento(String(s ?? "").replace(/\(.*?\)/g, " "));

/** As 41 escritas da planilha → a lista fixa. Null quando não reconhece. */
export function normalizarTipoDesligamento(texto: unknown): TipoDesligamento | null {
  const t = semAcento(texto);
  if (!t) return null;
  if (/COMPLEMENTAR|ESTORNO/.test(t)) return "Rescisão complementar";
  if (/MORTE|FALECIMENTO/.test(t)) return "Rescisão por morte";
  if (/INDIRETA/.test(t)) return "Rescisão indireta";
  if (/ABANDONO/.test(t)) return "Abandono de emprego";
  if (/ACORDO/.test(t)) return "Acordo por lei";
  if (/SEM JUSTA/.test(t)) return /INDENIZ/.test(t) ? "Sem justa causa - indenizado" : TIPO_SJ_TRABALHADO;
  if (/JUSTA CAUSA/.test(t)) return "Justa causa";
  if (/ANTECIPADO/.test(t)) return /EMPRESA/.test(t) ? "Término antecipado pela empresa" : "Término antecipado pelo empregado";
  if (/TERMINO|FIM DO CONTRATO/.test(t)) {
    if (/APRENDIZ/.test(t)) return "Término de contrato - jovem aprendiz";
    if (/ESTAGI/.test(t)) return "Término de contrato - estágio";
    return "Término de contrato";
  }
  if (/PEDIDO/.test(t)) return /CUMPRI/.test(t) ? "Pedido de demissão (vai cumprir aviso)" : "Pedido de demissão";
  if (/INDENIZADO/.test(t)) return "Sem justa causa - indenizado";
  return null;
}

export function normalizarHomologacao(texto: unknown): (typeof HOMOLOGACOES)[number] | null {
  const t = semAcento(texto);
  if (!t) return null;
  if (t.includes("AGUARDANDO")) return "Aguardando carta";
  if (t.includes("REALIZAD")) return "Realizado";
  // "SIM/FEZ CARTA" é sim (houve homologação); "CARTA NÃO HOMO" é a carta.
  if (t.startsWith("SIM")) return "Sim";
  if (t.includes("CARTA")) return "Carta não homo";
  if (t.startsWith("NAO")) return "Não";
  return null;
}

/** O STATUS do Excel → a lista. Mesma régua de rh_rescisao_status_da_planilha (mig 20261022000400). */
export function normalizarStatusRescisao(texto: unknown): StatusRescisao | null {
  const t = semAcento(texto);
  if (!t) return null;
  if (t.includes("INSS")) return "Encaminhado ao INSS";
  if (t.includes("URGENTE")) return "Rescisão urgente por fazer";
  if (t.includes("POR FAZER")) return "Rescisão por fazer";
  if (t.includes("RECALC")) return "Recalcular";
  if (t.includes("GUIA")) return "Guia pendente";
  if (t.includes("PENDENC")) return "Pendência";
  if (/(^| )VA( |$)/.test(t)) return "Fazer VA";
  if (t.includes("DOCUMENTOS")) return "Rescisão e documentos OK";
  if (t.includes("FEITA")) return "Rescisão feita";
  if (t.includes("OK")) return "Rescisão OK";
  return null;
}

/**
 * A primeira data escrita no texto ("ENVIADO ZAPSIGN - 09/01/2026",
 * "malote 20/11/24", "MALOTE 26/07"). Sem ano, usa o de `anoPadrao`.
 */
export function dataNoTexto(texto: unknown, anoPadrao?: number): string | null {
  const m = String(texto ?? "").match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const dia = Number(m[1]), mes = Number(m[2]);
  let ano = m[3] ? Number(m[3]) : anoPadrao;
  if (!ano) return null;
  if (ano < 100) ano += 2000;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** O meio de envio/retorno escrito no texto da planilha (com os erros de digitação dela). */
export function meioNoTexto(texto: unknown, lado: "envio" | "retorno"): string | null {
  const t = semAcento(texto);
  if (!t) return null;
  if (/ZAP ?S|ZAPIS|ZAPSI/.test(t)) return "ZapSign";
  if (/E-?MAIL/.test(t)) return "E-mail";
  if (/WHATS/.test(t)) return lado === "envio" ? "WhatsApp" : "Outro";
  if (/DISCORD/.test(t)) return lado === "envio" ? "Discord" : "Outro";
  if (/FISIC/.test(t)) return lado === "envio" ? "Impresso" : "Físico";
  if (/I[MN]+PRESS|ENTREGUE/.test(t)) return lado === "envio" ? "Impresso" : "Físico";
  return "Outro";
}

// ── A planilha ───────────────────────────────────────────────────────
export interface LinhaPlanilhaRescisao {
  chave: string;
  empresa: string | null;
  matricula: string | null;
  colaborador_nome: string;
  contrato: string | null;
  data_recebimento: string | null;
  solicitado_por: string | null;
  homologacao: string | null;
  sst_ok: boolean | null;
  data_aviso: string | null;
  data_ultimo_dia: string | null;
  data_demissao: string | null;
  data_pagamento: string | null;
  tipo_desligamento: string | null;
  rescisao_programada: boolean;
  vales_programados: boolean;
  malote_data: string | null;
  malote_obs: string | null;
  envio_meio: string | null;
  envio_data: string | null;
  envio_obs: string | null;
  retorno_meio: string | null;
  retorno_data: string | null;
  retorno_obs: string | null;
  status_rescisao: string | null;
  observacao: string | null;
  pontos_ajustados: string | null;
  data_admissao: string | null;
  /** A linha como estava no Excel ("importa como estão"). */
  planilha_original: LinhaOriginal;
  planilha_aba: string;
}

/** Célula de data do Excel (Date, número serial ou texto dd/mm/aaaa) → ISO. */
export function dataDaCelula(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(+v)) return null;
    // XLSX entrega a data à meia-noite LOCAL; ler os campos locais evita o
    // dia anterior em UTC-3.
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number") {
    // Serial gravado a partir de meia-noite local vem com resto de fuso
    // (45993,99… ou 45994,12…): perto de um dia inteiro, arredonda pra ele.
    const frac = v - Math.floor(v);
    const p = XLSX.SSF.parse_date_code(frac < 0.25 || frac > 0.75 ? Math.round(v) : Math.floor(v));
    return p ? `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}` : null;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return dataNoTexto(s);
}

const textoOuNull = (v: unknown): string | null => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s && s.toUpperCase() !== "(VAZIO)" ? s : null;
};

/** Chave que torna a importação repetível — a mesma linha nunca entra duas vezes. */
export const chavePlanilha = (l: Pick<LinhaPlanilhaRescisao, "empresa" | "matricula" | "colaborador_nome" | "data_demissao" | "data_pagamento">): string =>
  [semAcento(l.empresa), semAcento(l.matricula), nomeParaComparar(l.colaborador_nome), l.data_demissao ?? "", l.data_pagamento ?? ""].join("|");

/** Acha a coluna pelo cabeçalho (a planilha tem espaços sobrando e o "STATUS." com ponto). */
function indiceDaColuna(cabecalho: unknown[], ...nomes: string[]): number {
  const cab = cabecalho.map((c) => semAcento(c).replace(/[.?]/g, "").trim());
  for (const n of nomes) {
    const i = cab.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

/** Cabeçalhos de data da planilha — no original eles vão como dd/mm/aaaa, não como o número serial do Excel. */
const CABECALHOS_DATA = new Set(["RECEBIDO", "AVISO", "ULTIMO DIA", "DEMISSAO", "PAGAMENTO", "ADMISSAO"]);

/**
 * A linha "como está" (21/10/2026, "importa todas as informações da planilha
 * como estão"): cada coluna com o cabeçalho e o valor do Excel, sem
 * normalizar nada. Vazio fica de fora; datas viram dd/mm/aaaa.
 */
function linhaOriginal(cab: unknown[], r: unknown[], colRecebido: number): LinhaOriginal {
  const out: LinhaOriginal = {};
  cab.forEach((c, i) => {
    const v = r[i];
    // "(vazio)" é o rótulo da tabela dinâmica de onde a aba HOMOLOGAÇÃO saiu — é vazio mesmo.
    if (typeof v !== "number" && textoOuNull(v) == null) return;
    const titulo = i === colRecebido ? "RECEBIDO" : String(c ?? "").replace(/\s+/g, " ").trim();
    if (!titulo) return;
    const chave = semAcento(titulo).replace(/[.?]/g, "").trim();
    if (CABECALHOS_DATA.has(chave) && typeof v === "number") {
      const iso = dataDaCelula(v);
      out[titulo] = iso ? iso.split("-").reverse().join("/") : v;
    } else {
      out[titulo] = typeof v === "number" ? v : String(v).trim();
    }
  });
  return out;
}

/**
 * Lê TODAS as abas de rescisão (as que têm FUNCIONARIO e PAGAMENTO no
 * cabeçalho): a RESCISÕES de 2026 e a HOMOLOGAÇÃO, das homologações de
 * 2024/2025 (21/10/2026 — antes só a primeira entrava). Na RESCISÕES a
 * coluna A, sem título, é a data em que o pedido chegou. Uma linha repetida
 * (mesma chave) entra uma vez só, mesmo vindo de abas diferentes.
 * `avisos` explica o que foi ignorado, para a tela mostrar antes de gravar.
 */
export function lerPlanilhaRescisao(buffer: ArrayBuffer | Uint8Array): {
  linhas: LinhaPlanilhaRescisao[]; avisos: string[]; aba: string | null; abas: { aba: string; linhas: number }[];
} {
  // Datas como número serial (cellDates: false): o Date que a XLSX monta
  // carrega o fuso histórico e caía no dia anterior (02/12 virava 01/12).
  const wb = XLSX.read(buffer, { type: "array", cellDates: false });
  const avisos: string[] = [];
  const linhas: LinhaPlanilhaRescisao[] = [];
  const abas: { aba: string; linhas: number }[] = [];
  const vistas = new Set<string>();
  let semNome = 0, repetidas = 0, tiposNaoReconhecidos = 0;
  for (const aba of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[aba], { header: 1, raw: true, defval: null });
    const iCab = rows.findIndex((r) => indiceDaColuna(r ?? [], "FUNCIONARIO") >= 0 && indiceDaColuna(r ?? [], "PAGAMENTO") >= 0);
    if (iCab < 0) continue;
    const cab = rows[iCab];
    const antes = linhas.length;
    const col = {
      empresa: indiceDaColuna(cab, "EMPRESA"),
      mat: indiceDaColuna(cab, "MAT", "MATRICULA"),
      nome: indiceDaColuna(cab, "FUNCIONARIO"),
      contrato: indiceDaColuna(cab, "CONTRATO"),
      homolog: indiceDaColuna(cab, "HOMOLOGACAO"),
      sst: indiceDaColuna(cab, "PLANILHA SST"),
      aviso: indiceDaColuna(cab, "AVISO"),
      solicitado: indiceDaColuna(cab, "SOLICITADO POR"),
      ultimo: indiceDaColuna(cab, "ULTIMO DIA"),
      demissao: indiceDaColuna(cab, "DEMISSAO"),
      pagamento: indiceDaColuna(cab, "PAGAMENTO"),
      tipo: indiceDaColuna(cab, "TIPO DE DESL", "TIPO DE DESLIGAMENTO"),
      programadas: indiceDaColuna(cab, "PROGRAMADAS"),
      malote: indiceDaColuna(cab, "MALOTE"),
      envio: indiceDaColuna(cab, "ENVIO DA DOCUMENTACAO"),
      retorno: indiceDaColuna(cab, "RETORNO DA DOCUMENTACAO"),
      status: indiceDaColuna(cab, "STATUS"),
      obs: indiceDaColuna(cab, "OBSERVACAO"),
      pontos: indiceDaColuna(cab, "PONTOS AJUSTADOS"),
      admissao: indiceDaColuna(cab, "ADMISSAO"),
    };
    // A coluna da data de chegada só existe se o cabeçalho deixou a A vazia.
    const colRecebido = cab[0] == null || String(cab[0]).trim() === "" ? 0 : -1;
    const pega = (r: unknown[], i: number) => (i >= 0 ? r[i] : null);

    for (const r of rows.slice(iCab + 1)) {
      if (!r) continue;
      const nome = textoOuNull(pega(r, col.nome));
      if (!nome) { if (r.some((c) => c != null && String(c).trim() !== "")) semNome++; continue; }

      const demissao = dataDaCelula(pega(r, col.demissao));
      const pagamento = dataDaCelula(pega(r, col.pagamento));
      const ano = Number((pagamento ?? demissao ?? "").slice(0, 4)) || undefined;
      const tipoTexto = textoOuNull(pega(r, col.tipo));
      const tipo = normalizarTipoDesligamento(tipoTexto);
      if (tipoTexto && !tipo) tiposNaoReconhecidos++;
      const programadas = semAcento(pega(r, col.programadas));
      const malote = textoOuNull(pega(r, col.malote));
      const envio = textoOuNull(pega(r, col.envio));
      const retorno = textoOuNull(pega(r, col.retorno));
      const sst = semAcento(pega(r, col.sst));
      const obs = [textoOuNull(pega(r, col.obs)), tipoTexto && !tipo ? `Tipo na planilha: ${tipoTexto}` : null]
        .filter(Boolean).join(" · ") || null;

      const linha: LinhaPlanilhaRescisao = {
        chave: "",
        empresa: textoOuNull(pega(r, col.empresa)),
        matricula: textoOuNull(pega(r, col.mat)),
        colaborador_nome: nome,
        contrato: textoOuNull(pega(r, col.contrato)),
        data_recebimento: colRecebido === 0 ? dataDaCelula(r[0]) : null,
        solicitado_por: textoOuNull(pega(r, col.solicitado)),
        homologacao: normalizarHomologacao(pega(r, col.homolog)),
        sst_ok: sst ? sst === "OK" : null,
        data_aviso: dataDaCelula(pega(r, col.aviso)),
        data_ultimo_dia: dataDaCelula(pega(r, col.ultimo)),
        data_demissao: demissao,
        data_pagamento: pagamento,
        tipo_desligamento: tipo,
        // "RESCISÃO E VALES OK" é o único valor que a planilha usa: as duas juntas.
        rescisao_programada: programadas.includes("RESCIS") && programadas.includes("OK"),
        vales_programados: programadas.includes("VALE") && programadas.includes("OK"),
        malote_data: dataNoTexto(malote, ano),
        malote_obs: malote,
        envio_meio: meioNoTexto(envio, "envio"),
        envio_data: dataNoTexto(envio, ano),
        envio_obs: envio,
        retorno_meio: meioNoTexto(retorno, "retorno"),
        retorno_data: dataNoTexto(retorno, ano),
        retorno_obs: retorno,
        status_rescisao: normalizarStatusRescisao(pega(r, col.status)),
        observacao: obs,
        pontos_ajustados: textoOuNull(pega(r, col.pontos)),
        data_admissao: dataDaCelula(pega(r, col.admissao)),
        planilha_original: linhaOriginal(cab, r, colRecebido),
        planilha_aba: aba,
      };
      linha.chave = chavePlanilha(linha);
      if (vistas.has(linha.chave)) { repetidas++; continue; }
      vistas.add(linha.chave);
      linhas.push(linha);
    }
    abas.push({ aba, linhas: linhas.length - antes });
  }
  if (!abas.length) return { linhas: [], avisos: ["Não achei a aba das rescisões (cabeçalho com FUNCIONARIO e PAGAMENTO)."], aba: null, abas };
  if (semNome) avisos.push(`${semNome} linha(s) sem o nome do funcionário foram ignoradas.`);
  if (repetidas) avisos.push(`${repetidas} linha(s) repetidas (mesma empresa, matrícula, nome e datas) entraram uma vez só.`);
  if (tiposNaoReconhecidos) avisos.push(`${tiposNaoReconhecidos} tipo(s) de desligamento não reconhecidos ficaram em branco no filtro — o texto original fica na observação e na linha original.`);
  return { linhas, avisos, aba: abas[0].aba, abas };
}

// ── Importação: casar com a solicitação do ERP ───────────────────────
export interface VinculoEmpregado { empresa: string | null; matricula: string | null }

/**
 * Para cada linha da planilha, a solicitação do ERP que é o MESMO
 * desligamento — primeiro por empresa + matrícula (via EMPREGADOS), na falta
 * pelo nome. Entre várias do mesmo colaborador, a de data mais próxima da
 * chegada. Cada solicitação casa com uma linha só (a rescisão complementar
 * da mesma pessoa fica como linha própria).
 */
export function casarComSolicitacoes(
  linhas: LinhaPlanilhaRescisao[],
  solicitacoes: Pick<SolicitacaoDemissao, "id" | "colaborador_id" | "colaborador_nome" | "data_solicitacao" | "criado_em" | "status">[],
  empregados: Map<number, VinculoEmpregado>,
  jaVinculadas: ReadonlySet<number> = new Set(),
): Map<string, number> {
  const validas = solicitacoes.filter((s) => s.status !== "Cancelada" && s.status !== "Reprovada" && !jaVinculadas.has(s.id));
  const porMatricula = new Map<string, typeof validas>();
  const porNome = new Map<string, typeof validas>();
  for (const s of validas) {
    const e = s.colaborador_id != null ? empregados.get(s.colaborador_id) : undefined;
    if (e?.empresa && e.matricula) {
      const k = `${semAcento(e.empresa)}|${semAcento(e.matricula)}`;
      porMatricula.set(k, [...(porMatricula.get(k) ?? []), s]);
    }
    const n = nomeParaComparar(s.colaborador_nome);
    if (n) porNome.set(n, [...(porNome.get(n) ?? []), s]);
  }
  const usadas = new Set<number>();
  const resultado = new Map<string, number>();
  const distancia = (s: (typeof validas)[number], ref: string | null) => {
    const d = (s.data_solicitacao ?? s.criado_em ?? "").slice(0, 10);
    if (!ref || !d) return Number.MAX_SAFE_INTEGER;
    return Math.abs(Date.parse(d) - Date.parse(ref));
  };
  for (const l of linhas) {
    const k = `${semAcento(l.empresa)}|${semAcento(l.matricula)}`;
    const candidatas = (l.empresa && l.matricula ? porMatricula.get(k) : undefined) ?? porNome.get(nomeParaComparar(l.colaborador_nome)) ?? [];
    const ref = l.data_recebimento ?? l.data_aviso ?? l.data_demissao;
    const escolhida = candidatas.filter((s) => !usadas.has(s.id)).sort((a, b) => distancia(a, ref) - distancia(b, ref))[0];
    if (escolhida) { usadas.add(escolhida.id); resultado.set(l.chave, escolhida.id); }
  }
  return resultado;
}

/**
 * O que gravar de uma linha da planilha sobre uma RH_RESCISAO que já existe:
 * só os campos VAZIOS. O que o RH já lançou no sistema não é sobrescrito
 * pela planilha. Null quando não há nada a completar.
 */
export function completarVazios(atual: Partial<RescisaoRH>, nova: LinhaPlanilhaRescisao): Partial<RescisaoRH> | null {
  const patch: Partial<RescisaoRH> = {};
  for (const c of CAMPOS_EDITAVEIS) {
    const v = nova[c];
    const a = atual[c];
    if (typeof v === "boolean") { if (v && !a) (patch as Record<string, unknown>)[c] = true; continue; }
    if (v != null && v !== "" && (a == null || a === "")) (patch as Record<string, unknown>)[c] = v;
  }
  // Status: a linha do ERP nasce "Rescisão por fazer" (gatilho da mig
  // 20261022000400) — isso é o padrão, não uma decisão do RH. Se a planilha
  // diz outra coisa (ela é a história do que já foi feito), vale a planilha.
  if (nova.status_rescisao && atual.status_rescisao === STATUS_PADRAO && nova.status_rescisao !== STATUS_PADRAO) {
    patch.status_rescisao = nova.status_rescisao;
  }
  // A linha original entra uma vez — importada antes da mig 20261021000030, ganha agora.
  if (!atual.planilha_original && nova.planilha_original && Object.keys(nova.planilha_original).length) {
    patch.planilha_original = nova.planilha_original;
    patch.planilha_aba = nova.planilha_aba ?? null;
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * Reimportar ATUALIZA (28/10/2026). Pedido do Pablo: "alguns status de
 * rescisões já cadastradas estão desatualizados no sistema e a planilha tem o
 * valor certo". Com completarVazios a planilha só preenchia o vazio — e o
 * status só saía do "Rescisão por fazer" — então o RH marcava "RESCISÃO OK"
 * no Excel, reimportava, e o sistema continuava em "Rescisão feita".
 *
 * Aqui a planilha vence em tudo que ela PREENCHE: status, datas, tipo,
 * homologação, malote, envio/retorno. O que ela deixa vazio não apaga o que
 * está no sistema, e as programadas só passam a OK (um "não" no Excel não
 * desfaz o OK lançado aqui). Observação e pontos ajustados continuam só
 * completando: é onde o RH escreve no sistema, e a observação da planilha
 * carrega o "Tipo na planilha: …" do importador. A troca de status fica no
 * RH_RESCISAO_HISTORICO pelo gatilho, como qualquer outra.
 */
const SO_COMPLETAM: ReadonlySet<CampoEditavel> = new Set(["observacao", "pontos_ajustados"]);

export interface MudancaCampo { campo: string; de: unknown; para: unknown }

// O jsonb devolve as chaves em outra ordem (por tamanho): comparar o
// JSON.stringify inteiro dava "mudou" em toda linha e regravava a planilha toda.
const mesmaLinhaOriginal = (a: LinhaOriginal | null | undefined, b: LinhaOriginal): boolean => {
  if (!a) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && kb.every((k) => a[k] === b[k]);
};

export function atualizarPelaPlanilha(
  atual: Partial<RescisaoRH>, nova: LinhaPlanilhaRescisao,
): { patch: Partial<RescisaoRH>; mudancas: MudancaCampo[] } | null {
  const patch: Record<string, unknown> = {};
  const mudancas: MudancaCampo[] = [];
  const muda = (campo: string, de: unknown, para: unknown) => { patch[campo] = para; mudancas.push({ campo, de: de ?? null, para }); };
  for (const c of CAMPOS_EDITAVEIS) {
    const v = nova[c];
    const a = atual[c];
    if (typeof v === "boolean") { if (v && !a) muda(c, a, true); continue; }
    if (v == null || v === "") continue;
    const vazio = a == null || a === "";
    if (SO_COMPLETAM.has(c) ? vazio : String(a ?? "").slice(0, c.startsWith("data_") ? 10 : undefined) !== v) muda(c, a, v);
  }
  // A chave e a linha original acompanham a planilha de agora — sem entrar no
  // relatório (não é dado que o RH vê mudar).
  if (atual.planilha_chave !== nova.chave) patch.planilha_chave = nova.chave;
  if (nova.planilha_original && Object.keys(nova.planilha_original).length
      && !mesmaLinhaOriginal(atual.planilha_original, nova.planilha_original)) {
    patch.planilha_original = nova.planilha_original;
    patch.planilha_aba = nova.planilha_aba ?? null;
  }
  return Object.keys(patch).length ? { patch: patch as Partial<RescisaoRH>, mudancas } : null;
}

/** Empresa|matrícula|nome — a pessoa, sem as datas (as três primeiras partes da planilha_chave). */
export const pessoaDaChave = (chave: string): string => chave.split("|").slice(0, 3).join("|");

/**
 * Para cada linha da planilha, a RH_RESCISAO que já é ela (28/10/2026).
 * Primeiro pela planilha_chave inteira. Mas a chave leva as datas de demissão
 * e pagamento: o RH corrige uma data no Excel e a linha "virava outra" —
 * entrava DE NOVO, duplicada. Então, sem a chave exata, casa pela pessoa
 * (empresa + matrícula + nome) entre as já importadas que sobraram, pela data
 * de demissão (ou pagamento) mais próxima. Duas candidatas empatadas (ou sem
 * data para desempatar) = ambígua: não grava, a tela mostra — melhor deixar
 * de fora do que atualizar a rescisão errada ou duplicar.
 */
export function casarComExistentes(
  linhas: LinhaPlanilhaRescisao[], rescisoes: Pick<RescisaoRH, "id" | "planilha_chave" | "data_demissao" | "data_pagamento">[],
): { casadas: Map<string, number>; ambiguas: LinhaPlanilhaRescisao[] } {
  const porChave = new Map(rescisoes.filter((r) => r.planilha_chave).map((r) => [r.planilha_chave!, r.id]));
  const casadas = new Map<string, number>();
  const usadas = new Set<number>();
  for (const l of linhas) {
    const id = porChave.get(l.chave);
    if (id != null) { casadas.set(l.chave, id); usadas.add(id); }
  }
  const porPessoa = new Map<string, typeof rescisoes>();
  for (const r of rescisoes) {
    if (!r.planilha_chave || usadas.has(r.id)) continue;
    const p = pessoaDaChave(r.planilha_chave);
    porPessoa.set(p, [...(porPessoa.get(p) ?? []), r]);
  }
  const dataDe = (r: (typeof rescisoes)[number]) => {
    const [, , , dem, pag] = r.planilha_chave!.split("|");
    return (r.data_demissao ?? dem ?? "").slice(0, 10) || (r.data_pagamento ?? pag ?? "").slice(0, 10) || null;
  };
  const ambiguas: LinhaPlanilhaRescisao[] = [];
  for (const l of linhas) {
    if (casadas.has(l.chave)) continue;
    const candidatas = (porPessoa.get(pessoaDaChave(l.chave)) ?? []).filter((r) => !usadas.has(r.id));
    if (!candidatas.length) continue;
    const ref = l.data_demissao ?? l.data_pagamento;
    const dist = (r: (typeof rescisoes)[number]) => {
      const d = dataDe(r);
      return ref && d ? Math.abs(Date.parse(d) - Date.parse(ref)) : Number.MAX_SAFE_INTEGER;
    };
    const ordem = [...candidatas].sort((a, b) => dist(a) - dist(b));
    if (ordem.length > 1 && dist(ordem[0]) === dist(ordem[1])) { ambiguas.push(l); continue; }
    casadas.set(l.chave, ordem[0].id);
    usadas.add(ordem[0].id);
  }
  return { casadas, ambiguas };
}

// ── A linha da tela ──────────────────────────────────────────────────
export interface LinhaRescisao {
  chave: string;
  solicitacao: SolicitacaoDemissao | null;
  rescisao: RescisaoRH | null;
  origem: OrigemRescisao;
  empresa: string | null;
  matricula: string | null;
  nome: string;
  contrato: string | null;
  recebido: string | null;
  solicitadoPor: string | null;
  statusFluxo: string | null;
  homologacao: string | null;
  sstOk: boolean | null;
  aviso: string | null;
  ultimoDia: string | null;
  demissao: string | null;
  pagamento: string | null;
  tipo: string | null;
  /** Quais valores acima são sugestão (ainda não gravados pelo RH). */
  sugerido: { aviso: boolean; ultimoDia: boolean; demissao: boolean; pagamento: boolean; tipo: boolean };
  rescisaoProgramada: boolean;
  valesProgramados: boolean;
  maloteData: string | null;
  maloteObs: string | null;
  envioMeio: string | null;
  envioData: string | null;
  envioObs: string | null;
  retornoMeio: string | null;
  retornoData: string | null;
  retornoObs: string | null;
  statusRescisao: string | null;
  observacao: string | null;
  pontosAjustados: string | null;
  admissao: string | null;
  /** Desde quando está na coluna do kanban (null = não se sabe, ex.: importada). */
  statusDesde: string | null;
  planilhaOriginal: LinhaOriginal | null;
  planilhaAba: string | null;
}

/** Os status do fluxo em que o SST já resolveu o ASO (a "PLANILHA SST OK"). */
const STATUS_SST_RESOLVIDO = ["Agendamento concluído", "ASO válido", "Concluída"];

export function montarLinhaRescisao(
  s: SolicitacaoDemissao | null,
  r: RescisaoRH | null,
  empregado?: VinculoEmpregado | null,
): LinhaRescisao {
  const aviso = r?.data_aviso ?? s?.data_aviso ?? null;
  const ultimoDia = r?.data_ultimo_dia ?? s?.rh_ultima_data_trabalhada ?? null;
  const tipo = r?.tipo_desligamento ?? tipoPelaSolicitacao(s);
  const demissao = r?.data_demissao ?? sugerirDataDemissao(ultimoDia, tipo);
  const pagamento = r?.data_pagamento ?? sugerirDataPagamento(demissao);
  return {
    chave: s ? `s:${s.id}` : `r:${r?.id}`,
    solicitacao: s,
    rescisao: r,
    origem: s ? "erp" : (r?.origem === "manual" ? "manual" : "planilha"),
    empresa: r?.empresa ?? siglaEmpresa(empregado?.empresa) ?? null,
    matricula: r?.matricula ?? empregado?.matricula ?? null,
    // A linha gravada é a planilha (desde a mig 20261022000400 ela nasce com
    // os dados da solicitação): o que o RH corrigiu nela vale; a solicitação
    // só cobre o que estiver vazio.
    nome: r?.colaborador_nome ?? s?.colaborador_nome ?? "—",
    contrato: r?.contrato ?? s?.contrato ?? null,
    recebido: r?.data_recebimento ?? s?.data_solicitacao ?? s?.criado_em?.slice(0, 10) ?? null,
    solicitadoPor: r?.solicitado_por ?? (s ? (s.solicitante_nome ?? "ERP") : null),
    statusFluxo: s?.status ?? null,
    homologacao: r?.homologacao ?? null,
    sstOk: s ? STATUS_SST_RESOLVIDO.includes(s.status) : (r?.sst_ok ?? null),
    aviso,
    ultimoDia,
    demissao,
    pagamento,
    tipo,
    sugerido: {
      aviso: !r?.data_aviso && !!aviso,
      ultimoDia: !r?.data_ultimo_dia && !!ultimoDia,
      demissao: !r?.data_demissao && !!demissao,
      pagamento: !r?.data_pagamento && !!pagamento,
      tipo: !r?.tipo_desligamento && !!tipo,
    },
    rescisaoProgramada: !!r?.rescisao_programada,
    valesProgramados: !!r?.vales_programados,
    maloteData: r?.malote_data ?? null,
    maloteObs: r?.malote_obs ?? null,
    envioMeio: r?.envio_meio ?? null,
    envioData: r?.envio_data ?? null,
    envioObs: r?.envio_obs ?? null,
    retornoMeio: r?.retorno_meio ?? null,
    retornoData: r?.retorno_data ?? null,
    retornoObs: r?.retorno_obs ?? null,
    // Sem nada lançado ainda, a rescisão está "por fazer" — é o que a
    // planilha escrevia na linha nova.
    statusRescisao: r?.status_rescisao ?? STATUS_PADRAO,
    observacao: r?.observacao ?? null,
    pontosAjustados: r?.pontos_ajustados ?? null,
    admissao: r?.data_admissao ?? s?.colaborador_admissao?.slice(0, 10) ?? null,
    // Solicitação sem ficha: está "por fazer" desde que chegou ao RH.
    statusDesde: r ? (r.status_desde ?? null) : (s?.rh_em ?? s?.criado_em ?? null),
    planilhaOriginal: r?.planilha_original ?? null,
    planilhaAba: r?.planilha_aba ?? null,
  };
}

/**
 * Rescisões (+ a solicitação de cada uma) → a lista da tela, uma linha por
 * desligamento. Desde 22/10/2026 (mig 20261022000400) quem manda é a LINHA
 * GRAVADA: ela nasce quando o RH libera a demissão, então solicitação ainda
 * em Pendente RH (ou sem linha) não é rescisão e não aparece. A solicitação
 * só completa a linha (status do fluxo, link, empresa/matrícula na falta).
 */
export function montarLinhasRescisao(
  solicitacoes: SolicitacaoDemissao[],
  rescisoes: RescisaoRH[],
  empregados: Map<number, VinculoEmpregado> = new Map(),
): LinhaRescisao[] {
  const porId = new Map(solicitacoes.map((s) => [s.id, s]));
  return rescisoes.map((r) => {
    const s = r.solicitacao_id != null ? porId.get(r.solicitacao_id) ?? null : null;
    return montarLinhaRescisao(s, r, s?.colaborador_id != null ? empregados.get(s.colaborador_id) : null);
  });
}

/** Demissão cancelada depois que a rescisão já estava na planilha — o RH precisa ver para desfazer. */
export const demissaoCancelada = (l: Pick<LinhaRescisao, "statusFluxo">): boolean =>
  l.statusFluxo === "Cancelada" || l.statusFluxo === "Cancelamento solicitado";

/** A lista suspensa da coluna PROGRAMADAS da planilha. */
export const OPCOES_PROGRAMADAS = ["Rescisão OK", "Vales OK", "Rescisão e vales OK"] as const;

/** "Rescisão e vales OK" — o texto da coluna PROGRAMADAS da planilha. */
export function textoProgramadas(l: Pick<LinhaRescisao, "rescisaoProgramada" | "valesProgramados">): string {
  if (l.rescisaoProgramada && l.valesProgramados) return "Rescisão e vales OK";
  if (l.rescisaoProgramada) return "Rescisão OK";
  if (l.valesProgramados) return "Vales OK";
  return "";
}

/** O que gravar quando escolhem um valor na coluna PROGRAMADAS ("" = nenhum). */
export function patchProgramadas(texto: string): Pick<RescisaoRH, "rescisao_programada" | "vales_programados"> {
  const t = semAcento(texto);
  return { rescisao_programada: t.includes("RESCIS"), vales_programados: t.includes("VALE") };
}

/**
 * A célula de MALOTE / ENVIO / RETORNO é texto livre, como no Excel
 * ("ENVIADO ZAPSIGN - 09/01/2026"). Ao gravar, a data e o meio escritos nela
 * viram campo (para filtro e alerta) e o texto fica como está.
 */
export function patchTextoDocumento(
  coluna: "malote" | "envio" | "retorno", texto: string, anoPadrao: number = new Date().getFullYear(),
): Partial<RescisaoRH> {
  const t = texto.replace(/\s+/g, " ").trim() || null;
  const data = dataNoTexto(t, anoPadrao);
  if (coluna === "malote") return { malote_obs: t, malote_data: data };
  return { [`${coluna}_obs`]: t, [`${coluna}_data`]: data, [`${coluna}_meio`]: t ? meioNoTexto(t, coluna) : null } as Partial<RescisaoRH>;
}

/** O texto da célula de documento: o que foi escrito, ou "meio - data" das linhas antigas. */
export function textoDocumento(meio: string | null, data: string | null, obs: string | null): string {
  if (obs) return obs;
  return [meio, data ? data.slice(0, 10).split("-").reverse().join("/") : null].filter(Boolean).join(" - ");
}

// ── Filtro e ordem ───────────────────────────────────────────────────
export interface FiltroRescisao {
  /** As abas da tela: em aberto (tudo menos as duas concluídas) ou concluídas. */
  situacao?: "" | "abertas" | "concluidas";
  busca?: string;
  empresa?: string;
  statusRescisao?: string;
  homologacao?: string;
  tipo?: string;
  origem?: "" | OrigemRescisao;
  /** "2026-10" — mês da data escolhida em `campoMes`. */
  mes?: string;
  campoMes?: "pagamento" | "demissao" | "recebido";
  /** Só o que falta: sem as duas programadas marcadas. */
  soNaoProgramadas?: boolean;
  /** PLANILHA SST: "ok" = OK, "pendente" = Não ou vazio. */
  sst?: "" | "ok" | "pendente";
  /** Só as de pagamento vencido ainda sem a rescisão feita (ver `pagamentoAtrasado`). */
  soAtrasadas?: boolean;
  /** Só as com documentação enviada e ainda sem retorno. */
  soSemRetorno?: boolean;
}

/** Hoje em ISO (data local), para as comparações com as datas da planilha. */
export function hojeIso(agora: Date = new Date()): string {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
}

/** Os status em que a rescisão ainda não foi calculada — é o que pode atrasar o pagamento. */
export const STATUS_SEM_RESCISAO: readonly StatusRescisao[] = ["Rescisão por fazer", "Rescisão urgente por fazer", "Recalcular"];

/** Pagamento já vencido (ou vencendo hoje) e a rescisão ainda por fazer. */
export function pagamentoAtrasado(l: Pick<LinhaRescisao, "pagamento" | "statusRescisao">, hoje: string = hojeIso()): boolean {
  return !!l.pagamento && l.pagamento <= hoje && (STATUS_SEM_RESCISAO as readonly string[]).includes(l.statusRescisao ?? STATUS_PADRAO);
}

/** Dias inteiros desde `desde` (ISO) até hoje; null sem data. */
export function diasDesde(desde: string | null | undefined, agora: Date = new Date()): number | null {
  if (!desde) return null;
  const t = Date.parse(desde.length <= 10 ? `${desde}T00:00:00` : desde);
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((agora.getTime() - t) / 86_400_000));
}

/** Documentação que saiu e ainda não voltou assinada. */
export const semRetorno = (l: Pick<LinhaRescisao, "envioMeio" | "envioData" | "envioObs" | "retornoMeio" | "retornoData" | "retornoObs">): boolean =>
  !!(l.envioMeio || l.envioData || l.envioObs) && !(l.retornoMeio || l.retornoData || l.retornoObs);

export function filtrarRescisoes(linhas: LinhaRescisao[], f: FiltroRescisao, hoje: string = hojeIso()): LinhaRescisao[] {
  const q = semAcento(f.busca);
  return linhas.filter((l) => {
    if (f.situacao === "abertas" && rescisaoConcluida(l.statusRescisao)) return false;
    if (f.situacao === "concluidas" && !rescisaoConcluida(l.statusRescisao)) return false;
    if (f.empresa && l.empresa !== f.empresa) return false;
    if (f.statusRescisao && l.statusRescisao !== f.statusRescisao) return false;
    if (f.homologacao && l.homologacao !== f.homologacao) return false;
    if (f.tipo && l.tipo !== f.tipo) return false;
    if (f.origem && l.origem !== f.origem) return false;
    if (f.soNaoProgramadas && l.rescisaoProgramada && l.valesProgramados) return false;
    if (f.sst === "ok" && l.sstOk !== true) return false;
    if (f.sst === "pendente" && l.sstOk === true) return false;
    if (f.soAtrasadas && !pagamentoAtrasado(l, hoje)) return false;
    if (f.soSemRetorno && !semRetorno(l)) return false;
    if (f.mes) {
      const d = l[f.campoMes ?? "pagamento"];
      if (!d || d.slice(0, 7) !== f.mes) return false;
    }
    if (!q) return true;
    return [l.nome, l.matricula, l.contrato, l.solicitadoPor, l.solicitacao ? String(l.solicitacao.id) : null, l.observacao]
      .some((v) => semAcento(v).includes(q));
  });
}

/** O RESUMO da planilha (COUNTIF por status). */
export function resumoPorStatus(linhas: Pick<LinhaRescisao, "statusRescisao">[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(STATUS_RESCISAO.map((s) => [s, 0]));
  for (const l of linhas) {
    const s = l.statusRescisao ?? STATUS_PADRAO;
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

/**
 * O que gravar ao mudar uma célula da planilha. Datas: mudar o último dia
 * ou o tipo recalcula demissão e pagamento pela régua SE eles ainda
 * estavam batendo com a régua (data digitada à mão não é atropelada).
 */
export function patchDaCelula(l: LinhaRescisao, patch: Partial<RescisaoRH>): Partial<RescisaoRH> {
  const out = { ...patch };
  if ("data_ultimo_dia" in patch || "tipo_desligamento" in patch) {
    const ultimo = "data_ultimo_dia" in patch ? patch.data_ultimo_dia ?? null : l.ultimoDia;
    const tipo = "tipo_desligamento" in patch ? patch.tipo_desligamento ?? null : l.tipo;
    const demAntes = sugerirDataDemissao(l.ultimoDia, l.tipo);
    if (!l.demissao || l.demissao === demAntes) {
      const dem = sugerirDataDemissao(ultimo, tipo);
      if (dem) {
        out.data_demissao = dem;
        if (!l.pagamento || l.pagamento === sugerirDataPagamento(l.demissao)) out.data_pagamento = sugerirDataPagamento(dem);
      }
    }
  } else if ("data_demissao" in patch && (!l.pagamento || l.pagamento === sugerirDataPagamento(l.demissao))) {
    out.data_pagamento = sugerirDataPagamento(patch.data_demissao) ?? l.pagamento;
  }
  return out;
}

/** Validação da rescisão lançada à mão: nome é o mínimo (a planilha também só exigia isso). */
export function erroIdentificacao(i: IdentificacaoRescisao): string | null {
  if (!i.colaborador_nome?.trim()) return "Informe o nome do funcionário.";
  if (i.empresa && !Object.values(SIGLA_EMPRESA).includes(i.empresa.trim().toUpperCase())) return "Empresa: use HAGG, SN, CANAA ou NH.";
  return null;
}

export type OrdemRescisao = "pagamento" | "demissao" | "recebido" | "nome";

/** Datas: mais recente primeiro, sem data no fim. Nome: A→Z. */
export function ordenarRescisoes(linhas: LinhaRescisao[], ordem: OrdemRescisao): LinhaRescisao[] {
  const copia = [...linhas];
  if (ordem === "nome") return copia.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return copia.sort((a, b) => {
    const da = a[ordem] ?? "", db = b[ordem] ?? "";
    if (da === db) return a.nome.localeCompare(b.nome, "pt-BR");
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? 1 : -1;
  });
}

/** O formulário de edição começa com o que a linha mostra (sugestões incluídas). */
export function edicaoInicial(l: LinhaRescisao): EdicaoRescisao {
  return {
    homologacao: l.homologacao,
    data_aviso: l.aviso,
    data_ultimo_dia: l.ultimoDia,
    data_demissao: l.demissao,
    data_pagamento: l.pagamento,
    tipo_desligamento: l.tipo,
    rescisao_programada: l.rescisaoProgramada,
    vales_programados: l.valesProgramados,
    malote_data: l.maloteData,
    malote_obs: l.maloteObs,
    envio_meio: l.envioMeio,
    envio_data: l.envioData,
    envio_obs: l.envioObs,
    retorno_meio: l.retornoMeio,
    retorno_data: l.retornoData,
    retorno_obs: l.retornoObs,
    status_rescisao: l.statusRescisao,
    observacao: l.observacao,
    pontos_ajustados: l.pontosAjustados,
    data_admissao: l.admissao,
  };
}

/** Texto vazio vira null antes de gravar (o CHECK do banco não aceita ""). */
export function limparEdicao(e: EdicaoRescisao): EdicaoRescisao {
  const out = { ...e } as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) if (typeof v === "string") out[k] = v.trim() || null;
  return out as EdicaoRescisao;
}

/** Erro de coerência das datas, ou null. */
export function erroDatasRescisao(e: Pick<EdicaoRescisao, "data_aviso" | "data_ultimo_dia" | "data_demissao" | "data_pagamento">): string | null {
  if (e.data_aviso && e.data_ultimo_dia && e.data_ultimo_dia < e.data_aviso) return "O último dia não pode ser antes do aviso.";
  if (e.data_ultimo_dia && e.data_demissao && e.data_demissao < e.data_ultimo_dia) return "A demissão não pode ser antes do último dia.";
  if (e.data_demissao && e.data_pagamento && e.data_pagamento < e.data_demissao) return "O pagamento não pode ser antes da demissão.";
  return null;
}

// ── Exportar (no layout da planilha do RH) ───────────────────────────
const dataExcel = (iso: string | null | undefined): Date | string => {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d);
};
const comData = (texto: string | null, iso: string | null): string =>
  [texto, iso ? iso.slice(0, 10).split("-").reverse().join("/") : null].filter(Boolean).join(" - ");

/** As colunas na ordem da planilha de rescisão, mais o # e o status do fluxo do ERP no fim. */
export function planilhaDasRescisoes(linhas: LinhaRescisao[]): XLSX.WorkBook {
  const dados = linhas.map((l) => ({
    "Recebido": dataExcel(l.recebido),
    "Empresa": l.empresa ?? "",
    "Mat": l.matricula ?? "",
    "Funcionário": l.nome,
    "Contrato": l.contrato ?? "",
    "Homologação": l.homologacao ?? "",
    "Planilha SST": l.sstOk == null ? "" : l.sstOk ? "OK" : "Não",
    "Aviso": dataExcel(l.aviso),
    "Solicitado por": l.solicitadoPor ?? "",
    "Último dia": dataExcel(l.ultimoDia),
    "Demissão": dataExcel(l.demissao),
    "Pagamento": dataExcel(l.pagamento),
    "Tipo de desligamento": l.tipo ?? "",
    "Programadas": textoProgramadas(l),
    "Malote": l.maloteObs || comData("Malote", l.maloteData),
    "Envio da documentação": l.envioObs || comData(l.envioMeio, l.envioData),
    "Retorno da documentação": l.retornoObs || comData(l.retornoMeio, l.retornoData),
    "Status": l.statusRescisao ?? "",
    "Observação": l.observacao ?? "",
    "Pontos ajustados?": l.pontosAjustados ?? "",
    "Admissão": dataExcel(l.admissao),
    "Solicitação ERP": l.solicitacao ? `#${l.solicitacao.id}` : "",
    "Status no ERP": l.statusFluxo ?? "",
  }));
  const ws = XLSX.utils.json_to_sheet(dados, { cellDates: true, dateNF: "dd/mm/yyyy" });
  ws["!autofilter"] = { ref: ws["!ref"] ?? "A1" };
  ws["!cols"] = [10, 8, 8, 34, 26, 16, 10, 10, 18, 10, 10, 10, 30, 20, 26, 28, 28, 22, 30, 12, 10, 12, 22].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "RESCISÕES");
  // A aba RESUMO da planilha (contagem por status).
  const resumo = resumoPorStatus(linhas);
  const wsResumo = XLSX.utils.aoa_to_sheet([["RESUMO DE STATUS", ""], ...Object.entries(resumo), ["TOTAL", linhas.length]]);
  wsResumo["!cols"] = [{ wch: 28 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, "RESUMO");
  return wb;
}
