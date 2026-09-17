// SIS-2026-0427: port 1:1 de processador_ufrgs.py / processador_samu.py /
// processador_sms.py / processador_tj.py — cruza a base Excel de
// funcionários com o(s) PDF(s) de VA/VT/ponto e gera a planilha final no
// mesmo layout de colunas do app Python, por tomador.

const ExcelJS = require("exceljs");
const { limparTexto, extrairVA, extrairVT, extrairDiasTrabalhadosSamu, extrairDiasTrabalhadosSms } = require("./extratores");
const { lerColunasPorCabecalho, carregarPrimeiraAba } = require("./lerExcel");
const { encontrarMelhorMatchExcel, encontrarMelhorMatchPdf } = require("./nomes");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatarData(v) {
  if (v instanceof Date) return `${pad2(v.getDate())}/${pad2(v.getMonth() + 1)}/${v.getFullYear()}`;
  if (typeof v === "string") {
    const m = v.match(/(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
    if (m) {
      const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${pad2(m[1])}/${pad2(m[2])}/${ano}`;
    }
  }
  return v ?? "";
}

async function construirWorkbookSaida(colunas, linhas) {
  const workbook = new ExcelJS.Workbook();
  const aba = workbook.addWorksheet("Planilha");
  aba.addRow(colunas);
  for (const linha of linhas) aba.addRow(colunas.map((c) => linha[c] ?? ""));
  return workbook.xlsx.writeBuffer();
}

// ── TJ ────────────────────────────────────────────────────────────────────
async function gerarPlanilhaTj({ bufferBase, bufferPdf, periodo, valorUnitario, tipoBeneficio = "VA" }) {
  const todasLinhas = await carregarPrimeiraAba(bufferBase);
  const { nome: colNome, admissao: colAdmissao, cargo: colCargo } = lerColunasPorCabecalho(
    todasLinhas,
    [
      { campo: "nome", chaves: ["NOME"], padrao: 0 },
      { campo: "admissao", chaves: ["ADMISS"], padrao: 1 },
      { campo: "cargo", chaves: ["CARGO", "FUNCAO"], padrao: 2 },
    ],
    { palavrasLixo: ["NOME", "RELATORIO", "COLABORADOR"] },
  );

  const extraidos = tipoBeneficio === "VA" ? await extrairVA(bufferPdf) : await extrairVT(bufferPdf);
  const chaveValor = tipoBeneficio === "VA" ? "valorVA" : "valorVT";
  const listaNomesPdf = extraidos.map((e) => e.nomeLimpo);

  const linhasSaida = [];
  for (let i = 0; i < colNome.length; i++) {
    const nomeLimpo = limparTexto(colNome[i]);
    const matchPdf = encontrarMelhorMatchPdf(nomeLimpo, listaNomesPdf);
    const registro = extraidos.find((e) => e.nomeLimpo === matchPdf);
    const valorPago = registro ? registro[chaveValor] : 0;
    if (!(valorPago > 0)) continue;
    linhasSaida.push({
      Nome: colNome[i],
      "Data de Admissão": formatarData(colAdmissao[i]),
      Cargo: colCargo[i],
      Período: periodo,
      "Total de dias": Math.round(valorPago / valorUnitario),
      "Valor Un": valorUnitario,
      "Valor do Vale pago": valorPago,
    });
  }
  linhasSaida.forEach((l, i) => (l["Nº"] = i + 1));

  return construirWorkbookSaida(
    ["Nº", "Nome", "Data de Admissão", "Cargo", "Período", "Total de dias", "Valor Un", "Valor do Vale pago"],
    linhasSaida,
  );
}

// ── SAMU ──────────────────────────────────────────────────────────────────
async function gerarPlanilhaSamu({ bufferBase, bufferPonto, valorUnitario24h, tipoBeneficio = "VA" }) {
  const todasLinhas = await carregarPrimeiraAba(bufferBase);
  const { nome: colNome, carga: colCarga, admissao: colAdmissao } = lerColunasPorCabecalho(
    todasLinhas,
    [
      { campo: "nome", chaves: ["NOME"], padrao: 1 },
      { campo: "carga", chaves: ["CARGA", "HORARIA"], padrao: 3 },
      { campo: "admissao", chaves: ["ADMISS"], padrao: 6 },
    ],
    {
      skiprows: 8,
      palavrasLixo: ["RELATORIO", "EMPRESA", "CNPJ", "PERIODO", "EMISSAO", "NOME", "COLABORADOR", "DATA", "FUNCAO", "CPF"],
    },
  );
  if (colNome.length === 0) throw new Error("A base de Excel ficou vazia após a limpeza.");

  const ponto = await extrairDiasTrabalhadosSamu(bufferPonto);
  if (ponto.length === 0) throw new Error("Não foi possível extrair os dias trabalhados do PDF de Ponto.");
  const listaNomesPdf = ponto.map((p) => p.nomeLimpo);

  const nomeUnidade = tipoBeneficio === "VA" ? "Valor Alimentação" : "Valor Transporte";
  const linhasSaida = [];
  for (let i = 0; i < colNome.length; i++) {
    const nomeLimpo = limparTexto(colNome[i]);
    const matchPdf = encontrarMelhorMatchPdf(nomeLimpo, listaNomesPdf);
    const registro = ponto.find((p) => p.nomeLimpo === matchPdf);
    const diasTrabalhados = registro ? registro.diasTrabalhados : 0;
    if (!(diasTrabalhados > 0)) continue;

    const eh12h = /12/.test(String(colCarga[i] ?? ""));
    const valorUnidade = eh12h ? valorUnitario24h / 2 : valorUnitario24h;
    linhasSaida.push({
      Nome: colNome[i],
      "Data de Admissão": formatarData(colAdmissao[i]),
      "Carga horaria diária": colCarga[i],
      "Total de dias": diasTrabalhados,
      [nomeUnidade]: valorUnidade,
      "Valor do Vale pago": diasTrabalhados * valorUnidade,
    });
  }
  linhasSaida.forEach((l, i) => (l["Nº"] = i + 1));

  return construirWorkbookSaida(
    ["Nº", "Nome", "Data de Admissão", "Carga horaria diária", "Total de dias", nomeUnidade, "Valor do Vale pago"],
    linhasSaida,
  );
}

// ── SMS ───────────────────────────────────────────────────────────────────
async function gerarPlanilhaSms({ bufferBase, bufferPonto, valorUnitario24h, tipoBeneficio = "VA" }) {
  const todasLinhas = await carregarPrimeiraAba(bufferBase);
  const { nome: colNome, admissao: colAdmissao, cargo: colCargo } = lerColunasPorCabecalho(
    todasLinhas,
    [
      { campo: "nome", chaves: ["NOME"], padrao: 0 },
      { campo: "admissao", chaves: ["ADMISS"], padrao: 1 },
      { campo: "cargo", chaves: ["CARGO", "FUNCAO"], padrao: 2 },
    ],
    { palavrasLixo: ["NOME", "COLABORADOR"] },
  );

  const ponto = await extrairDiasTrabalhadosSms(bufferPonto);
  if (ponto.length === 0) throw new Error("PDF de Ponto vazio ou não foi possível ler os dias.");
  const listaNomesPdf = ponto.map((p) => p.nomeLimpo);

  const nomeUnidade = tipoBeneficio === "VA" ? "Valor Alimentação" : "Valor Transporte";
  const linhasSaida = [];
  for (let i = 0; i < colNome.length; i++) {
    const nomeLimpo = limparTexto(colNome[i]);
    const matchPdf = encontrarMelhorMatchPdf(nomeLimpo, listaNomesPdf);
    const registro = ponto.find((p) => p.nomeLimpo === matchPdf);
    const diasTrabalhados = registro ? registro.diasTrabalhados : 0;
    if (!(diasTrabalhados > 0)) continue;

    const eh12h = /12/.test(String(colCargo[i] ?? ""));
    const valorUnidade = eh12h ? valorUnitario24h / 2 : valorUnitario24h;
    linhasSaida.push({
      Nome: colNome[i],
      "Data de Admissão": formatarData(colAdmissao[i]),
      "Carga horaria diária": colCargo[i],
      "Total de dias": diasTrabalhados,
      [nomeUnidade]: valorUnidade,
      "Valor do Vale pago": diasTrabalhados * valorUnidade,
    });
  }
  linhasSaida.forEach((l, i) => (l["Nº"] = i + 1));

  return construirWorkbookSaida(
    ["Nº", "Nome", "Data de Admissão", "Carga horaria diária", "Total de dias", nomeUnidade, "Valor do Vale pago"],
    linhasSaida,
  );
}

// ── UFRGS (também cobre o contexto "Jardinagem") ──────────────────────────
async function gerarPlanilhaUfrgs({ bufferBase, bufferPdfVa, bufferPdfVt }) {
  const todasLinhas = await carregarPrimeiraAba(bufferBase);
  const { nome: colNome, cargo: colCargo } = lerColunasPorCabecalho(
    todasLinhas,
    [
      { campo: "nome", chaves: ["NOME"], padrao: 0 },
      { campo: "cargo", chaves: ["CARGO", "FUNCAO"], padrao: 2 },
    ],
    { palavrasLixo: ["NOME", "COLABORADOR"] },
  );

  const base = colNome
    .map((nome, i) => ({ nomeOriginal: nome, nomeLimpo: limparTexto(nome), cargo: colCargo[i] }))
    .filter((b) => b.nomeLimpo !== "");
  const listaNomesExcel = [...new Set(base.map((b) => b.nomeLimpo))];
  const baseIndex = new Map(base.map((b) => [b.nomeLimpo, b]));

  const va = await extrairVA(bufferPdfVa);
  const vt = await extrairVT(bufferPdfVt);

  function agruparPorMatchExcel(lista, chaveValor) {
    const agrupado = new Map();
    for (const item of lista) {
      const match = encontrarMelhorMatchExcel(item.nomeLimpo, listaNomesExcel) || item.nomeLimpo;
      const atual = agrupado.get(match);
      if (atual) atual.valor += item[chaveValor];
      else agrupado.set(match, { matchExcel: match, valor: item[chaveValor], nomePdf: item.nome });
    }
    return agrupado;
  }

  const vaPorMatch = agruparPorMatchExcel(va, "valorVA");
  const vtPorMatch = agruparPorMatchExcel(vt, "valorVT");

  const todasAsChaves = new Set([...vaPorMatch.keys(), ...vtPorMatch.keys()]);
  const linhasSaida = [];
  let somaVa = 0;
  let somaVt = 0;
  for (const matchExcel of todasAsChaves) {
    const va_ = vaPorMatch.get(matchExcel);
    const vt_ = vtPorMatch.get(matchExcel);
    const valorVa = va_ ? va_.valor : 0;
    const valorVt = vt_ ? vt_.valor : 0;
    somaVa += valorVa;
    somaVt += valorVt;

    const registroBase = baseIndex.get(matchExcel);
    const nomeExibicao = registroBase ? registroBase.nomeOriginal : (va_ ? va_.nomePdf : vt_.nomePdf);
    const cargoExibicao = registroBase ? registroBase.cargo ?? "" : "";
    const obs = registroBase ? "" : "Possível demissão / Não consta na base";

    linhasSaida.push({
      Nome: nomeExibicao,
      Cargo: cargoExibicao,
      Local: "UFRGS",
      VA: valorVa,
      VT: valorVt,
      Líquidos: "",
      Salário: "",
      Extrato: "",
      FGTS: "",
      Ponto: "",
      Marcação: "",
      Efetividade: "",
      OBS: obs,
    });
  }
  linhasSaida.sort((a, b) => String(a.Nome).localeCompare(String(b.Nome), "pt-BR"));

  return construirWorkbookSaida(
    ["Nome", "Cargo", "Local", "VA", "VT", "Líquidos", "Salário", "Extrato", "FGTS", "Ponto", "Marcação", "Efetividade", "OBS"],
    linhasSaida,
  );
}

module.exports = { gerarPlanilhaTj, gerarPlanilhaSamu, gerarPlanilhaSms, gerarPlanilhaUfrgs };
