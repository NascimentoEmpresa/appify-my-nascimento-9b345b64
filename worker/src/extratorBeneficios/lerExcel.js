// SIS-2026-0427: port de `ler_colunas_por_cabecalho` (extratores.py) —
// acha cada coluna de interesse pelo texto do cabeçalho (ignora acento/
// caixa), com fallback pra posição fixa quando não reconhece nenhum
// cabeçalho, pra base de funcionário com layout variável não quebrar em
// silêncio.

const ExcelJS = require("exceljs");
const { limparTexto } = require("./extratores");

async function carregarPrimeiraAba(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (e) {
    throw new Error(`Não foi possível abrir a Base de Funcionários como .xlsx (${e.message}). Envie de novo pela tela do ERP, que regrava a planilha antes de subir.`);
  }
  // 06/11/2026: alguns .xlsx gerados por outros sistemas carregam sem erro e
  // sem nenhuma aba visível para o ExcelJS — `worksheets[0]` vinha undefined e
  // o job morria com "Cannot read properties of undefined (reading 'eachRow')"
  // (PREF POA SMS, 21/09). A tela agora regrava a base como .xlsx limpo antes
  // de subir (src/lib/extratorBeneficios/normalizarBase.ts); isto aqui é a
  // mensagem legível para o que ainda escapar (job antigo, upload direto).
  let aba = workbook.worksheets[0];
  if (!aba) workbook.eachSheet((s) => { if (!aba) aba = s; });
  if (!aba) {
    throw new Error("A Base de Funcionários não tem nenhuma aba legível. Envie de novo pela tela do ERP (ela regrava a planilha) ou salve o arquivo como .xlsx no Excel antes de enviar.");
  }
  const linhas = [];
  aba.eachRow({ includeEmpty: true }, (row) => {
    const valores = [];
    for (let i = 1; i <= aba.columnCount; i++) {
      const cell = row.getCell(i);
      // Célula de data de verdade (Excel) vira "dd/mm/aaaa" — String(Date) dava
      // "Mon Aug 04 2025 …" e a Data de Admissão saía ilegível (10/11/2026).
      // ExcelJS entrega a data em UTC.
      const v = cell.value;
      if (v instanceof Date && !Number.isNaN(v.getTime())) {
        const p = (n) => String(n).padStart(2, "0");
        valores.push(`${p(v.getUTCDate())}/${p(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`);
        continue;
      }
      valores.push(v == null ? null : String(v.text ?? v).trim());
    }
    linhas.push(valores);
  });
  return linhas;
}

/**
 * mapeamento: [{campo, chaves: string[], padrao: number}], 1º item é a
 * âncora (Nome) — usada pra descartar linha vazia/metadado.
 */
function lerColunasPorCabecalho(todasLinhas, mapeamento, { skiprows = 0, palavrasLixo = ["NOME"] } = {}) {
  let linhas = todasLinhas.slice(skiprows).filter((l) => l.some((v) => v != null && v !== ""));
  const [campoNome, , idxNomePadrao] = [mapeamento[0].campo, mapeamento[0].chaves, mapeamento[0].padrao];

  linhas = linhas.filter((l) => l[idxNomePadrao] != null && l[idxNomePadrao] !== "");
  if (linhas.length === 0) {
    const vazio = {};
    for (const { campo } of mapeamento) vazio[campo] = [];
    return vazio;
  }

  const linha0 = linhas[0];
  const temCabecalho = linha0.some((v) => typeof v === "string" && palavrasLixo.some((p) => v.toUpperCase().includes(p)));

  let indices;
  let dados;
  if (temCabecalho) {
    const cabecalho = linha0.map((v) => limparTexto(v ?? ""));
    indices = {};
    for (const { campo, chaves, padrao } of mapeamento) {
      const idx = cabecalho.findIndex((h) => chaves.some((chave) => h.includes(limparTexto(chave))));
      indices[campo] = idx >= 0 ? idx : padrao;
    }
    dados = linhas.slice(1);
  } else {
    indices = {};
    for (const { campo, padrao } of mapeamento) indices[campo] = padrao;
    dados = linhas;
  }

  const idxNome = indices[campoNome];
  dados = dados.filter((l) => {
    const v = l[idxNome];
    return !(typeof v === "string" && palavrasLixo.some((p) => v.toUpperCase().includes(p)));
  });

  const resultado = {};
  for (const { campo } of mapeamento) {
    const idx = indices[campo];
    resultado[campo] = dados.map((l) => l[idx] ?? "");
  }
  return resultado;
}

module.exports = { carregarPrimeiraAba, lerColunasPorCabecalho };
