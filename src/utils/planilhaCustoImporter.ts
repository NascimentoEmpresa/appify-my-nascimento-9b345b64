/**
 * Importador de Planilha de Custo
 * Porta a lógica VBA de correspondência por palavras-chave para TypeScript.
 * Usa SheetJS (xlsx) para ler arquivos .xlsx / .xls / .ods.
 */
import * as XLSX from "xlsx";

export interface PlanilhaCustoImportada {
  salario: number;
  insalubridade: number;
  periculosidade: number;
  lideranca: number;
  adicional_noturno_reduzido: number;
  adicional_noturno: number;
  adicional_extra: number;
  dsr: number;
  decimo_terceiro: number;
  adicional_ferias: number;
  incidencia_enc_41: number;
  inss: number;
  salario_educacao: number;
  rat_fap: number;
  sesi: number;
  senai: number;
  sebrae: number;
  incra: number;
  fgts: number;
  seguro_acidente_trabalho: number;
  transporte: number;
  transporte_desconto: number;
  aux_alimentacao: number;
  aux_alimentacao_desconto: number;
  aux_refeicao: number;
  beneficio_familiar: number;
  aux_lanche: number;
  seguro_vida: number;
  abono_indenizatorio: number;
  aux_educacao: number;
  cesta_basica: number;
  assistencia_medica: number;
  hospedagem: number;
  odontologico: number;
  manutencao_profissional: number;
  cafe: number;
  almoco: number;
  janta: number;
  ceia: number;
  funeral: number;
  assiduidade: number;
  beneficio_trabalhador: number;
  patronal: number;
  fundo_assistencial: number;
  fundo_profissional: number;
  natalidade: number;
  deducoes: number;
  aviso_indenizado: number;
  incidencia_fgts: number;
  multa_rescisoria: number;
  aviso_trabalhado: number;
  incidencia_aviso_trabalhado: number;
  multa_aviso_indenizado: number;
  contratualidade: number;
  sub_ferias: number;
  sub_ausencias_legais: number;
  sub_paternidade: number;
  sub_acidente_trabalho: number;
  sub_maternidade: number;
  sub_doenca: number;
  sub_repouso: number;
  incidencia_maternidade: number;
  incidencia_enc_reposicao: number;
  incidencia_enc_reposicao_2: number;
  incidencia_enc_reposicao_3: number;
  incidencia_enc_reposicao_4: number;
  uniforme: number;
  epi: number;
  epc: number;
  materiais: number;
  equipamentos: number;
  relogio_digital: number;
  ponto_eletronico: number;
  outros_insumos: number;
  custos_indiretos: number;
  lucro: number;
  cofins: number;
  pis: number;
  irpj_csll: number;
  iss: number;
  total_por_empregado: number;
  sheetNames: string[];
}

// ─── Normalizadores ────────────────────────────────────────────────────────────

function norm(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

function toNum(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  let s = String(v)
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/%/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function isValidNum(v: unknown): boolean {
  if (v == null || String(v).includes("%")) return false;
  return toNum(v) > 0;
}

// ─── Estrutura de dados da aba ─────────────────────────────────────────────────

interface Cell {
  label: string; // texto normalizado da célula
  raw: string;   // texto original
  row: number;
  col: number;
}

interface Sheet {
  cells: Cell[];      // todas as células com conteúdo
  valCol: number;     // coluna de valores (índice 0-based)
  raw: unknown[][];   // dados brutos [linha][col]
}

function parseSheet(ws: XLSX.WorkSheet): Sheet {
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    raw: true,
  });

  const cells: Cell[] = [];
  for (let r = 0; r < aoa.length; r++) {
    for (let c = 0; c < (aoa[r] as unknown[]).length; c++) {
      const v = (aoa[r] as unknown[])[c];
      if (v == null || v === "") continue;
      cells.push({ label: norm(v), raw: String(v), row: r, col: c });
    }
  }

  const valCol = findValCol(cells, aoa);
  return { cells, valCol, raw: aoa };
}

function findValCol(cells: Cell[], aoa: unknown[][]): number {
  let custoUnitCol = -1;
  let result = -1;

  for (const c of cells) {
    if (custoUnitCol === -1 && c.label.includes("CUSTO UNIT")) {
      custoUnitCol = c.col;
    }
    if (result === -1 && (c.label.includes("R$ TOTAL") || c.label.includes("VALOR"))) {
      if (c.label.includes("VALOR DO") || c.label.includes("VALOR DA") || c.label.includes("DO VALOR")) continue;
      if (c.label.includes("VALOR UNIT")) {
        result = custoUnitCol >= 0 ? custoUnitCol : c.col;
      } else {
        result = c.col;
      }
      return result;
    }
  }
  return result;
}

function getRowVal(sheet: Sheet, row: number): number {
  if (sheet.valCol < 0) return 0;
  const rowData = sheet.raw[row] as unknown[];
  if (!rowData) return 0;
  const v = rowData[sheet.valCol];
  return isValidNum(v) ? toNum(v) : 0;
}

// ─── Matchers core ────────────────────────────────────────────────────────────

function hasAll(label: string, words: string[]): boolean {
  return words.every((w) => label.includes(norm(w)));
}

function hasAny(label: string, words: string[]): boolean {
  return words.some((w) => label.includes(norm(w)));
}

function hasNone(label: string, words: string[]): boolean {
  return words.every((w) => !label.includes(norm(w)));
}

// AND: todas as palavras, sem nenhuma exclusão → retorna primeiro valor > 0
function findAND(sheet: Sheet, inclui: string[], exclui: string[] = []): number {
  for (const c of sheet.cells) {
    if (hasAll(c.label, inclui) && hasNone(c.label, exclui)) {
      const v = getRowVal(sheet, c.row);
      if (v > 0) return v;
    }
  }
  return 0;
}

// OR: pelo menos uma palavra, sem nenhuma exclusão → retorna primeiro valor > 0
function findOR(sheet: Sheet, inclui: string[], exclui: string[] = []): number {
  for (const c of sheet.cells) {
    if (hasAny(c.label, inclui) && hasNone(c.label, exclui)) {
      const v = getRowVal(sheet, c.row);
      if (v > 0) return v;
    }
  }
  return 0;
}

// OR + soma
function sumOR(sheet: Sheet, inclui: string[], exclui: string[] = []): number {
  let total = 0;
  for (const c of sheet.cells) {
    if (hasAny(c.label, inclui) && hasNone(c.label, exclui)) {
      total += getRowVal(sheet, c.row);
    }
  }
  return total;
}

// AND + soma
function sumAND(sheet: Sheet, inclui: string[], exclui: string[] = []): number {
  let total = 0;
  for (const c of sheet.cells) {
    if (hasAll(c.label, inclui) && hasNone(c.label, exclui)) {
      total += getRowVal(sheet, c.row);
    }
  }
  return total;
}

// AND + OR: todas de inclui E pelo menos uma de orWords
function findAND_OR(sheet: Sheet, andW: string[], orW: string[], exclui: string[] = []): number {
  for (const c of sheet.cells) {
    if (hasAll(c.label, andW) && hasAny(c.label, orW) && hasNone(c.label, exclui)) {
      const v = getRowVal(sheet, c.row);
      if (v > 0) return v;
    }
  }
  return 0;
}

// Palavra exata (rodeada de espaços)
function findWord(sheet: Sheet, word: string): number {
  const w = norm(word);
  for (const c of sheet.cells) {
    const padded = ` ${c.label} `;
    if (padded.includes(` ${w} `)) {
      const v = getRowVal(sheet, c.row);
      if (v > 0) return v;
    }
  }
  return 0;
}

// Soma de múltiplos termos OR individuais (ex: IRPJ + CSLL)
function sumTerms(sheet: Sheet, words: string[]): number {
  let total = 0;
  for (const w of words) {
    total += findWord(sheet, w);
  }
  return total;
}

// ─── Extrator principal ────────────────────────────────────────────────────────

function extractFields(sheet: Sheet): Omit<PlanilhaCustoImportada, "sheetNames"> {
  const s = sheet;

  // Remuneração
  const salario = findAND(s, ["SALARIO"], ["REDUZIDA", "13", "EDUCACAO"]) ||
    findAND(s, ["SALARIO"], ["BASE", "MENSAL", "REDUZIDA"]);
  const insalubridade = findAND(s, ["INSALUBRIDADE"], ["SALARIO"]);
  const periculosidade = findAND(s, ["PERICULOSIDADE"], ["INSALUBRIDADE"]);
  const lideranca = findOR(s, ["LIDERANCA", "SUPERVISOR"], ["GRATIFICACAO"]) ||
    findAND(s, ["ADICIONAL", "LIDERANCA"], []);
  const adicional_noturno_reduzido = findAND(s, ["NOTURNA", "REDUZIDA"], ["VALOR"]);
  const adicional_noturno = findOR(s, ["NOTURNA", "NOTURNO"], ["REDUZIDA", "VALOR"]);
  const adicional_extra = findAND(s, ["ADICIONAL", "EXTRA"], []);
  const dsr = findAND(s, ["SEMANAL", "REMUNERADO"], []);

  // Encargos
  const decimo_terceiro = findAND(s, ["13", "SALARIO"], []);
  const adicional_ferias = findAND(s, ["ADICIONAL", "FERIAS"], []);
  const incidencia_enc_41 = findAND(s, ["INCIDENCIA", "SUBMODULO", "4.1"], []) ||
    findAND_OR(s, ["INCIDENCIA", "SUBMODULO"], ["FERIAS", "13"], ["AVISO"]);
  const inss = findAND(s, ["INSS"], ["INCIDE", "13", "BASE"]);
  const salario_educacao = findAND(s, ["SALARIO", "EDUCACAO"], []);
  const rat_fap = findOR(s, ["RAT", "FAP"], [
    "CONTRATUAL", "ADMINISTRATIVO", "ACIDENTE", "GRATIFICACAO", "GLOBAL", "CALCULO",
  ]);
  const sesi = findOR(s, ["SESI", "SESC"], []);
  const senai = findOR(s, ["SENAI", "SENAC"], []);
  const sebrae = findAND(s, ["SEBRAE"], []);
  const incra = findAND(s, ["INCRA"], []);
  const fgts = findAND(s, ["FGTS"], ["INCIDE", "13", "BASE"]);
  const seguro_acidente_trabalho = findAND(s, ["ACIDENTE", "TRABALHO"], [
    "CALCULO", "AUSENCIA", "ART", "RAT",
  ]);

  // Benefícios
  const transporte = sumAND(s, ["TRANSPORTE"], ["PLATAFORMA", "MOTORISTA", "CUSTO", "DEDUCAO"]);
  const transporte_desconto = findAND(s, ["DEDUCAO", "VT"], []) || findAND(s, ["DEDUCAO", "TRANSPORTE"], []);
  const aux_alimentacao = sumOR(s, ["ALIMENTACAO", "AUXILIO ALIMENTACAO"], [
    "REFEICAO", "DEDUCAO", "DESCONTO", "EFETIVO",
  ]);
  const aux_alimentacao_desconto = findAND(s, ["ALIMENTACAO", "DESCONTO"], []);
  const aux_refeicao = findAND_OR(s, ["REFEICAO"], ["AUXILIO", "VALE"], ["ALIMENTACAO"]) ||
    findOR(s, ["AUXILIO REFEICAO", "VALE REFEICAO"], []);
  const beneficio_familiar = findAND(s, ["BENEFICIO", "FAMILIAR"], []);
  const aux_lanche = findAND(s, ["LANCHE"], []);
  const seguro_vida = findAND(s, ["SEGURO", "VIDA"], []);
  const abono_indenizatorio = findAND(s, ["ABONO", "INDENIZATORIO"], []);
  const aux_educacao = findAND(s, ["AUXILIO", "EDUCACAO"], []);
  const cesta_basica = findAND(s, ["CESTA", "BASICA"], ["ALIMENTACAO"]);
  const assistencia_medica = findOR(s, ["ASSISTENCIA MEDICA", "AUXILIO SAUDE", "PLANO DE SAUDE"], []);
  const hospedagem = findAND(s, ["HOSPEDAGEM"], []);
  const odontologico = findAND(s, ["CONTRIBUICAO", "MEDICO", "ODONTOLOGICO"], []) ||
    findOR(s, ["ODONTOLOGICO", "DENTAL"], ["CONTRIBUICAO PATRONAL"]);
  const manutencao_profissional = findAND(s, ["CONTRIBUICAO", "MANUTENCAO", "PROFISSIONAL"], []);
  const cafe = findAND(s, ["CAFE"], []);
  const almoco = sumAND(s, ["ALMOCO"], []);
  const janta = findAND(s, ["JANTA"], []);
  const ceia = findAND(s, ["CEIA"], []);
  const funeral = findOR(s, ["FUNERAL", "FUNERARIO"], []);
  const assiduidade = findAND(s, ["ASSIDUIDADE"], ["ALIMENTACAO"]);
  const beneficio_trabalhador = findAND(s, ["BENEFICIO", "TRABALHADOR"], []);
  const patronal = findAND(s, ["ASSISTENCIAL", "PATRONAL"], []) ||
    findAND(s, ["CONTRIBUICAO", "PATRONAL"], []);
  const fundo_assistencial = findAND(s, ["FUNDO", "ASSISTENCIAL"], []);
  const fundo_profissional = findAND_OR(s, ["FUNDO"], ["CAPACITACAO", "PROFISSIONAL"], ["MANUTENCAO"]);
  const natalidade = findAND(s, ["NATALIDADE"], []);
  const deducoes = findOR(s, ["DEDUCAO", "DESCONTO LEGAL"], ["AUXILIO"]);

  // Rescisão
  const aviso_indenizado = findAND(s, ["AVISO", "INDENIZADO"], ["BASE"]);
  const incidencia_fgts = findAND_OR(s, ["INDENIZADO"], ["INDENIZADO", "API"], ["ART", "AVISO INDENIZADO BASE"]);
  const multa_rescisoria = findAND(s, ["MULTA"], ["INDENIZADO", "BASE", "API"]);
  const aviso_trabalhado = findAND_OR(s, ["AVISO"], ["TRABALHADO", "TRABALHANDO"], []);
  const incidencia_aviso_trabalhado = findAND_OR(s, ["INCIDENCIA"], ["TRABALHADO", "APT"], []);
  const multa_aviso_indenizado = findAND_OR(s, ["MULTA"], ["API", "INDENIZACAO", "INDENIZADO"], ["BASE"]);
  const contratualidade = findAND(s, ["CONTRATUALIDADE"], []);

  // Reposição
  const sub_ferias = findOR(s, ["SUBSTITUTO", "COBERTURA"], ["AUSENCIAS", "PATERNIDADE", "MATERNIDADE", "DOENCA", "REPOUSO", "FGTS", "ACIDENTE"]) ||
    findAND(s, ["FERIAS", "COBERTURA"], []);
  const sub_ausencias_legais = findAND_OR(s, ["AUSENCIAS", "LEGAIS"], ["SUBSTITUTO", "COBERTURA"], []);
  const sub_paternidade = findAND_OR(s, ["PATERNIDADE"], ["SUBSTITUTO", "COBERTURA"], []);
  const sub_acidente_trabalho = findAND_OR(s, ["ACIDENTE", "TRABALHO"], ["SUBSTITUTO", "COBERTURA"], ["RAT"]);
  const sub_maternidade = findAND_OR(s, ["MATERNIDADE"], ["SUBSTITUTO", "COBERTURA"], []);
  const sub_doenca = findAND_OR(s, ["DOENCA"], ["SUBSTITUTO", "COBERTURA"], []);
  const sub_repouso = findAND_OR(s, ["INTERVALO", "REPOUSO"], ["SUBSTITUTO", "COBERTURA"], ["DEDUCAO"]);
  const incidencia_maternidade = findAND(s, ["INCIDENCIA", "SUBMODULO", "MATERNIDADE"], []);
  const incidencia_enc_reposicao = findAND_OR(s, ["INCIDENCIA", "ENCARGOS"], ["D-01-INCIDENCIA", "SUBMODULO"], []);
  const incidencia_enc_reposicao_2 = findAND(s, ["INCIDENCIA", "CUSTO", "REPOSICAO"], ["AUSENTE"]);
  const incidencia_enc_reposicao_3 = findAND(s, ["INCIDENCIA", "ENCARGOS", "SUBMODULO", "4.2"], ["AVISO"]);
  const incidencia_enc_reposicao_4 = findAND_OR(s, ["INCIDENCIA"], ["13º", "13 SALARIO"], []);

  // Insumos
  const uniforme = findOR(s, ["UNIFORME", "UNIFORMES"], ["MATERIAIS/"]);
  const epi = sumOR(s, ["EPI", "EPIS", "INDIVIDUAL", "INDIVIDUAIS"], ["UNIFORME", "SEMENTE"]);
  const epc = sumOR(s, ["EPC", "EPCS", "COLETIVO", "COLETIVOS"], ["UNIFORME", "RECEPCIONISTA"]);
  const materiais = findOR(s, ["MATERIAIS", "MATERIAL"], ["CARRINHO", "EQUIPAMENTOS", "INSUMOS"]);
  const equipamentos = findOR(s, ["EQUIPAMENTO", "EQUIPAMENTOS"], ["COLETIVOS", "INDIVIDUAL", "MATERIAIS"]);
  const relogio_digital = findAND(s, ["RELOGIO", "DIGITAL"], []);
  const ponto_eletronico = findAND(s, ["PONTO", "ELETRONICO"], []);
  const outros_insumos = findOR(s, ["OUTROS", "DEMAIS INSUMOS"], [
    "BENEFICIO", "ALIMENTACAO", "EQUIPAMENTOS", "MATERIAIS",
  ]);

  // Custos indiretos
  const custos_indiretos = findOR(s, ["CUSTOS INDIRETOS", "DESPESAS ADMINISTRATIVAS"], ["CALCULO"]);
  const lucro = findOR(s, ["LUCRO"], ["CALCULO"]);
  const cofins = findAND(s, ["COFINS"], []);
  const pis = findWord(s, "PIS");
  const irpj_csll = sumTerms(s, ["IRPJ", "CSLL"]);
  const iss = findAND(s, ["ISS"], ["PROFISSIONAL", "DEMISSOES"]);

  // Total por empregado
  const total_por_empregado =
    findAND_OR(s, ["TOTAL"], ["POSTO", "VALOR", "EMPREGADO", "PRECO"], [
      "CALCULO", "REMUNERACAO", "PERCENTUAL",
    ]) || findAND(s, ["TOTAL", "EMPREGADO"], []);

  return {
    salario, insalubridade, periculosidade, lideranca,
    adicional_noturno_reduzido, adicional_noturno, adicional_extra, dsr,
    decimo_terceiro, adicional_ferias, incidencia_enc_41, inss,
    salario_educacao, rat_fap, sesi, senai, sebrae, incra, fgts,
    seguro_acidente_trabalho,
    transporte, transporte_desconto, aux_alimentacao, aux_alimentacao_desconto, aux_refeicao,
    beneficio_familiar, aux_lanche, seguro_vida, abono_indenizatorio,
    aux_educacao, cesta_basica, assistencia_medica, hospedagem,
    odontologico, manutencao_profissional, cafe, almoco, janta, ceia,
    funeral, assiduidade, beneficio_trabalhador, patronal,
    fundo_assistencial, fundo_profissional, natalidade, deducoes,
    aviso_indenizado, incidencia_fgts, multa_rescisoria, aviso_trabalhado,
    incidencia_aviso_trabalhado, multa_aviso_indenizado, contratualidade,
    sub_ferias, sub_ausencias_legais, sub_paternidade, sub_acidente_trabalho,
    sub_maternidade, sub_doenca, sub_repouso, incidencia_maternidade,
    incidencia_enc_reposicao, incidencia_enc_reposicao_2,
    incidencia_enc_reposicao_3, incidencia_enc_reposicao_4,
    uniforme, epi, epc, materiais, equipamentos, relogio_digital,
    ponto_eletronico, outros_insumos,
    custos_indiretos, lucro, cofins, pis, irpj_csll, iss,
    total_por_empregado,
  };
}

// ─── API pública ───────────────────────────────────────────────────────────────

export async function importarPlanilha(
  file: File,
  sheetName?: string,
): Promise<PlanilhaCustoImportada> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });

  const sheetNames = wb.SheetNames;
  const target = sheetName ?? sheetNames[0];
  const ws = wb.Sheets[target];
  if (!ws) throw new Error(`Aba "${target}" não encontrada`);

  const sheet = parseSheet(ws);
  const fields = extractFields(sheet);

  return { ...fields, sheetNames };
}
