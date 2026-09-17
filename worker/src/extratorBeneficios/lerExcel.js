// SIS-2026-0427: port de `ler_colunas_por_cabecalho` (extratores.py) —
// acha cada coluna de interesse pelo texto do cabeçalho (ignora acento/
// caixa), com fallback pra posição fixa quando não reconhece nenhum
// cabeçalho, pra base de funcionário com layout variável não quebrar em
// silêncio.

const ExcelJS = require("exceljs");
const { limparTexto } = require("./extratores");

async function carregarPrimeiraAba(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const aba = workbook.worksheets[0];
  const linhas = [];
  aba.eachRow({ includeEmpty: true }, (row) => {
    const valores = [];
    for (let i = 1; i <= aba.columnCount; i++) {
      const cell = row.getCell(i);
      valores.push(cell.value == null ? null : String(cell.value.text ?? cell.value).trim());
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
