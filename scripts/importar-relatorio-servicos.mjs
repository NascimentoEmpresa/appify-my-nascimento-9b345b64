// SIS-2026-0540: importa o Relatório de Serviços (planilha oficial do
// Financeiro) pra `nf_emissao`, substituindo por completo o que está lá
// hoje (decisão confirmada: as ~1075 linhas atuais entraram manualmente
// pela tela, em boa parte teste, e a tentativa de migração anterior nunca
// existiu de fato neste repositório — só o importador antigo, removido em
// 7eb5a606, que alimentava uma tabela diferente e já extinta).
//
// Planilha: aba "Relatório de serviços", cabeçalho na linha 7 (Excel,
// 1-indexed), dados a partir da linha 8. Colunas confirmadas por posição
// (a planilha tem cabeçalho de texto, mas linhas de resumo acima variam,
// então usamos posição fixa, igual documentado no plano do chamado).
//
// Idempotente por rodada: sem --apagar-tudo/--somente-novas, é dry-run puro
// (não escreve nada). Com --apagar-tudo, apaga TODAS as linhas de
// nf_emissao (cascade cuida de nf_emissao_item/nf_emissao_anexo) e insere
// as novas — uso original, pra quando a tabela tem lixo/teste misturado.
//
// SIS-2026-0540 (rodada 2, achado real): planilha voltou a ser atualizada
// por fora do sistema (pessoal manteve o hábito antigo). Como as linhas já
// importadas continuam limpas (conferido: nenhuma edição manual desde a
// 1ª importação), apagar tudo de novo é desnecessário e arriscado sem
// necessidade — --somente-novas insere só as linhas da planilha que ainda
// não existem no banco, comparando pela chave natural (numero_nf +
// contrato_id resolvido + competência + variação — é o que distingue duas
// linhas reais com o mesmo nº de nota, ex. 2 variações/postos na mesma NF).
// Não faz UPDATE em linha já existente (se o VALOR de uma nota já
// importada mudou na planilha, isso não é pego por este modo — só chegada
// de nota nova).
//
// Uso:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/importar-relatorio-servicos.mjs "planilha.xlsx" [--apagar-tudo|--somente-novas]

import XLSX from "xlsx";
import fs from "fs";

const URL_SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ARQUIVO = process.argv[2];
const APAGAR_TUDO = process.argv.includes("--apagar-tudo");
const SOMENTE_NOVAS = process.argv.includes("--somente-novas");
// nf_emissao_guard_enviada bloqueia DELETE de notas enviada/concluida sob
// a service_role key (auth.uid() vem nulo) — o usuário já limpou a tabela
// manualmente no SQL Editor (trigger desligada/religada). Com essa flag,
// pula o DELETE do script e só insere.
const SEM_DELETE = process.argv.includes("--sem-delete");

if (!URL_SB || !KEY || !ARQUIVO) {
  console.error("Uso: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/importar-relatorio-servicos.mjs <planilha.xlsx> [--apagar-tudo]");
  process.exit(1);
}

const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const api = async (caminho, init = {}) => {
  const r = await fetch(URL_SB + "/rest/v1/" + caminho, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const corpo = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${caminho}: ${corpo}`);
  return corpo ? JSON.parse(corpo) : null;
};

// ── Conversões (mesmo padrão de scripts/importar-patrimonios-planilha.mjs) ──
// Achado real (Ruan): "Variação" vazia em algumas linhas puxou uma data
// tipo "Wed Sep 02 2026 00:00:28 GMT-0300 (Horário Padrão de Brasília)" em
// vez de ficar em branco. Causa: a célula tá vazia mas formatada como data
// na planilha — com `cellDates: true` (linha de leitura do workbook), o
// SheetJS devolve um objeto Date (época/artefato) pra ela em vez de null,
// e `texto()` fazia `String(dateObject)`, que é exatamente essa string
// feia. Nenhuma coluna que passa por `texto()` é legitimamente uma data
// (datas de verdade usam a função `data()` abaixo) — tratar Date como
// vazio aqui resolve pra "Variação" e qualquer outra coluna futura com o
// mesmo problema.
const texto = (v) => {
  if (v instanceof Date) return null;
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const numero = (v) => {
  if (v === "" || v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const data = (v) => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 60000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// ── Match de contrato (portado de src/lib/contratoMatch.ts — mesma lógica) ──
function normalizarContrato(txt) {
  return String(txt ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]/g, "");
}
function numeroFinalContrato(txtNormalizado) {
  const m = txtNormalizado.match(/(\d+)$/);
  return m ? m[1] : "";
}
function encontrarContrato(candidatos, alvo) {
  const chaveAlvo = normalizarContrato(alvo);
  const exato = candidatos.find((c) => normalizarContrato(c.nome) === chaveAlvo);
  if (exato) return { match: exato, tipo: "exato" };
  const numAlvo = numeroFinalContrato(chaveAlvo);
  if (numAlvo) {
    const mesmoNumero = candidatos.filter((c) => numeroFinalContrato(normalizarContrato(c.nome)) === numAlvo);
    if (mesmoNumero.length === 1) return { match: mesmoNumero[0], tipo: "numero_unico" };
  }
  return { match: null, tipo: "sem_match" };
}

// Achado real (dry-run SIS-2026-0540, revisão do usuário): a coluna
// "Empresa" da planilha às vezes não é a empresa DO CONTRATO — o contrato
// existe, só que sob outra empresa do grupo (ex. "IPAM - 012/2022" e
// "SECRETARIA DA CULTURA POA..." vieram como HAGG na planilha, mas o
// contrato real está cadastrado em SN). Quando o match restrito à empresa
// da planilha falha, tenta de novo contra TODOS os contratos — se achar,
// usa a empresa REAL do contrato (fonte de verdade), não a da planilha.
function encontrarContratoComFallback(contratosDaEmpresa, todosContratos, alvo) {
  const restrito = encontrarContrato(contratosDaEmpresa, alvo);
  if (restrito.match) return restrito;
  const geral = encontrarContrato(todosContratos, alvo);
  if (geral.match) return { ...geral, tipo: geral.tipo + "_outra_empresa" };
  return { match: null, tipo: "sem_match" };
}

// Casos confirmados manualmente com o usuário durante a revisão do
// sem-match (não são fuzzy-matcháveis — nome de contrato genuinamente
// diferente do texto da planilha): "SERVIÇO EMERGENCIAL - SENILTON" (SN)
// liga no contrato guarda-chuva "ADMINISTRATIVO - SN".
const OVERRIDE_CONTRATO_POR_TEXTO = {
  "SERVICOEMERGENCIALSENILTON": "1e3cf78f-d179-469d-97cc-a10dfb8f0823",
};

// ── Colunas da planilha (posição fixa, 0-indexed, linha 8 em diante) ──────
const COL = {
  empresa: 1, dataEmissao: 3, numeroNf: 4, competencia: 5, variacao: 6,
  codigo: 7, contrato: 8, situacaoSitePmt: 10, situacaoDominio: 11,
  valorContratoExec: 12, valorContabil: 13, vlrLiq: 14, dataPagamento: 15,
  valorRecebido: 16, issqn: 17, inss: 18, ir: 19, cofins: 20, pis: 21, csll: 22,
  faltas: 24, postoNaoImplementado: 25,
  multasAntes: 26, multasDepois: 27, glosasAntes: 28, glosasDepois: 29,
  outrosAntes: 30, outrosDepois: 31,
  descontoContaVinculada: 32, recebimentoExtra: 33, faltaReceber: 34, pagoAMais: 35,
  obs: 36,
};

async function main() {
  console.log(`Lendo empresas e contratos existentes...`);
  const empresas = await api("empresas?select=id,nome_fantasia,razao_social&ativa=eq.true");
  const contratos = await api("contratos?select=id,nome,empresa_id");
  console.log(`${empresas.length} empresas, ${contratos.length} contratos.`);

  const wb = XLSX.readFile(ARQUIVO, { cellDates: true });
  const ws = wb.Sheets["Relatório de serviços"];
  if (!ws) throw new Error(`Aba "Relatório de serviços" não encontrada no arquivo.`);
  const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

  const paraInserirNf = [];
  const paraInserirItem = []; // preenchido depois de inserir os headers e saber os ids
  const semMatchContrato = [];
  const semMatchEmpresa = [];
  let totalValorPago = 0;
  let totalVlrLiquido = 0;

  // dados a partir da linha 8 (Excel) = índice 7 (array 0-indexed)
  for (let i = 7; i < linhas.length; i++) {
    const row = linhas[i];
    if (!row) continue;
    const numeroNf = texto(row[COL.numeroNf]);
    const contratoTexto = texto(row[COL.contrato]);
    if (!numeroNf && !contratoTexto) continue; // linha vazia/separador

    const empresaTexto = texto(row[COL.empresa]);
    const empresaPlanilha = empresas.find((e) => (e.nome_fantasia || "").toUpperCase() === (empresaTexto || "").toUpperCase());
    if (!empresaPlanilha) {
      semMatchEmpresa.push({ linha: i + 1, empresa: empresaTexto, contrato: contratoTexto });
      continue;
    }

    let contrato = null, tipo = null;
    const chaveOverride = normalizarContrato(contratoTexto);
    if (OVERRIDE_CONTRATO_POR_TEXTO[chaveOverride]) {
      contrato = contratos.find((c) => c.id === OVERRIDE_CONTRATO_POR_TEXTO[chaveOverride]);
      tipo = "override_manual";
    } else {
      const candidatosContrato = contratos.filter((c) => c.empresa_id === empresaPlanilha.id);
      ({ match: contrato, tipo } = encontrarContratoComFallback(candidatosContrato, contratos, contratoTexto));
    }
    if (!contrato) {
      semMatchContrato.push({ linha: i + 1, empresa: empresaTexto, contrato: contratoTexto, numeroNf, competencia: data(row[COL.competencia]) });
      continue;
    }
    // Empresa REAL da nota é a do contrato encontrado — cobre o caso em
    // que a planilha diz uma empresa mas o contrato está sob outra (ver
    // encontrarContratoComFallback).
    const empresa = empresas.find((e) => e.id === contrato.empresa_id) || empresaPlanilha;

    const valorContratoExec = numero(row[COL.valorContratoExec]);
    const vlrBruto = numero(row[COL.valorContabil]);
    const vlrLiquido = numero(row[COL.vlrLiq]);
    const issqn = numero(row[COL.issqn]);
    const inss = numero(row[COL.inss]);
    const ir = numero(row[COL.ir]);
    const cofins = numero(row[COL.cofins]);
    const pis = numero(row[COL.pis]);
    const csll = numero(row[COL.csll]);
    const faltas = numero(row[COL.faltas]);
    const postoNaoImplementado = numero(row[COL.postoNaoImplementado]);
    const multas = numero(row[COL.multasAntes]) + numero(row[COL.multasDepois]);
    const glosas = numero(row[COL.glosasAntes]) + numero(row[COL.glosasDepois]);
    const outrosDescontos = numero(row[COL.outrosAntes]) + numero(row[COL.outrosDepois]);
    const valorPago = numero(row[COL.valorRecebido]);

    totalValorPago += valorPago;
    totalVlrLiquido += vlrLiquido;

    // Chave natural pra --somente-novas: numero_nf + contrato real
    // (resolvido, não o texto da planilha) + competência + variação.
    const chaveNatural = `${numeroNf}|${contrato.id}|${data(row[COL.competencia])}|${texto(row[COL.variacao]) ?? ""}`;

    paraInserirNf.push({
      _linha: i + 1,
      _chaveNatural: chaveNatural,
      empresa_id: empresa.id,
      contrato_id: contrato.id,
      _tipoMatch: tipo,
      variacao: texto(row[COL.variacao]),
      competencia: data(row[COL.competencia]),
      data_emissao: data(row[COL.dataEmissao]),
      numero_nf: numeroNf,
      status: "concluida",
      descricao: texto(row[COL.obs]),
      valor_contrato_exec_total: valorContratoExec,
      vlr_bruto_total: vlrBruto,
      vlr_liquido_total: vlrLiquido,
      issqn_total: issqn,
      inss_total: inss,
      ir_total: ir,
      cofins_total: cofins,
      pis_total: pis,
      csll_total: csll,
      data_pagamento: data(row[COL.dataPagamento]),
      valor_pago: valorPago,
      tipo_nota: texto(row[COL.codigo]) || "N",
      situacao_site_pmt: texto(row[COL.situacaoSitePmt]),
      situacao_dominio: texto(row[COL.situacaoDominio]),
      desconto_conta_vinculada: numero(row[COL.descontoContaVinculada]),
      recebimento_extra: numero(row[COL.recebimentoExtra]),
      falta_receber: numero(row[COL.faltaReceber]),
      pago_a_mais: numero(row[COL.pagoAMais]),
      _item: {
        ordem: 1,
        identificacao: texto(row[COL.variacao]),
        valor_contrato_exec: valorContratoExec,
        faltas, posto_nao_implementado: postoNaoImplementado,
        multas, glosas, outros_descontos: outrosDescontos,
        qtd_colaboradores: 0,
        vlr_bruto: vlrBruto,
        vlr_liquido: vlrLiquido,
        issqn, inss, ir, cofins, pis, csll,
      },
    });
  }

  console.log(`\n=== Relatório ===`);
  console.log(`Linhas processadas: ${paraInserirNf.length + semMatchContrato.length + semMatchEmpresa.length}`);
  console.log(`Prontas para importar: ${paraInserirNf.length}`);
  console.log(`Sem match de empresa: ${semMatchEmpresa.length}`);
  console.log(`Sem match de contrato: ${semMatchContrato.length}`);
  console.log(`Total valor_pago somado: R$ ${totalValorPago.toFixed(2)}`);
  console.log(`Total vlr_liquido_total somado: R$ ${totalVlrLiquido.toFixed(2)}`);

  if (semMatchContrato.length > 0) {
    const caminhoCsv = "sem-match-contrato.csv";
    const csv = ["linha,empresa,contrato,numero_nf,competencia", ...semMatchContrato.map((s) => `${s.linha},"${s.empresa}","${s.contrato}",${s.numeroNf},${s.competencia}`)].join("\n");
    fs.writeFileSync(caminhoCsv, csv);
    console.log(`Lista de contratos sem match gravada em ${caminhoCsv}`);
  }
  if (semMatchEmpresa.length > 0) {
    console.log(`Linhas sem match de empresa (revisar manual):`, semMatchEmpresa.slice(0, 10));
  }

  // Duplicidade dentro da própria planilha (mesma nota+contrato+competência
  // +variação aparecendo 2x, ex. linha de correção deixada ao lado da
  // original) — ambíguo, não dá pra decidir automaticamente qual vale.
  // Sempre reportado, mesmo fora de --somente-novas.
  const porChave = new Map();
  for (const nf of paraInserirNf) {
    if (!porChave.has(nf._chaveNatural)) porChave.set(nf._chaveNatural, []);
    porChave.get(nf._chaveNatural).push(nf);
  }
  const duplicadasNaPlanilha = [...porChave.values()].filter((arr) => arr.length > 1);
  if (duplicadasNaPlanilha.length > 0) {
    console.log(`\n⚠ ${duplicadasNaPlanilha.length} chave(s) repetida(s) DENTRO da planilha (mesma nota/contrato/competência/variação em mais de uma linha) — revisar manualmente, nenhuma das duas foi inserida automaticamente:`);
    for (const arr of duplicadasNaPlanilha) console.log(`  linhas ${arr.map((a) => a._linha).join(", ")} — nota ${arr[0].numero_nf}, contrato ${arr[0].contrato_id}`);
  }

  let paraInserirFinal = paraInserirNf;
  if (SOMENTE_NOVAS) {
    console.log(`\nBuscando notas já existentes pra comparar (--somente-novas)...`);
    const existentesPage = 1000;
    const chavesExistentes = new Set();
    // Achado real (29/09→30/09): a chave completa inclui `variacao`, que é
    // texto bruto da planilha — uma correção de parsing (ex.: a de hoje,
    // célula vazia virando data feia) muda o valor de `variacao` pras
    // MESMAS linhas que já foram importadas antes da correção, e a chave
    // completa não bate mais → pareceram "novas" e duplicaram 192 notas.
    // `chavesSemVariacao` é uma segunda rede: mesma nota/contrato/
    // competência, ignorando variacao — se bater só nessa, é sinal de
    // que já existe uma versão dessa nota no banco (mesmo que o texto da
    // variação tenha mudado), então não insere sem alguém olhar.
    const chavesExistentesSemVariacao = new Set();
    for (let offset = 0; ; offset += existentesPage) {
      const pagina = await api(`nf_emissao?select=numero_nf,contrato_id,competencia,variacao&order=created_at&offset=${offset}&limit=${existentesPage}`);
      for (const n of pagina) {
        chavesExistentes.add(`${n.numero_nf}|${n.contrato_id}|${n.competencia}|${n.variacao ?? ""}`);
        chavesExistentesSemVariacao.add(`${n.numero_nf}|${n.contrato_id}|${n.competencia}`);
      }
      if (pagina.length < existentesPage) break;
    }
    console.log(`${chavesExistentes.size} notas já existentes no banco.`);
    const jaExistiam = paraInserirNf.filter((nf) => chavesExistentes.has(nf._chaveNatural));
    const chaveSemVariacao = (nf) => nf._chaveNatural.split("|").slice(0, 3).join("|");
    const mudouSoAVariacao = paraInserirNf.filter(
      (nf) => !chavesExistentes.has(nf._chaveNatural) && chavesExistentesSemVariacao.has(chaveSemVariacao(nf))
    );
    if (mudouSoAVariacao.length > 0) {
      console.log(`\n⚠ ${mudouSoAVariacao.length} nota(s) já existe(m) no banco com a MESMA nota/contrato/competência, só a Variação leu diferente agora — não inserida(s) automaticamente, revisar manualmente:`);
      for (const nf of mudouSoAVariacao) console.log(`  linha ${nf._linha} — nota ${nf.numero_nf}, contrato ${nf.contrato_id}, variação lida agora: ${JSON.stringify(nf.variacao)}`);
    }
    // Linha duplicada NA PLANILHA nunca entra automaticamente, nem se a
    // chave for nova — fica de fora dos dois grupos, só no aviso acima.
    const chavesAmbiguas = new Set(duplicadasNaPlanilha.flatMap((arr) => arr.map((a) => a._chaveNatural)));
    const chavesMudouVariacao = new Set(mudouSoAVariacao.map((nf) => nf._chaveNatural));
    paraInserirFinal = paraInserirNf.filter(
      (nf) => !chavesExistentes.has(nf._chaveNatural) && !chavesAmbiguas.has(nf._chaveNatural) && !chavesMudouVariacao.has(nf._chaveNatural)
    );
    console.log(`${jaExistiam.length} já estavam no banco (ignoradas), ${chavesAmbiguas.size > 0 ? duplicadasNaPlanilha.reduce((s, a) => s + a.length, 0) + " em linhas ambíguas (ignoradas), " : ""}${mudouSoAVariacao.length > 0 ? mudouSoAVariacao.length + " com variação divergente (ignoradas), " : ""}${paraInserirFinal.length} são novas de verdade.`);
  }

  if (!APAGAR_TUDO && !SEM_DELETE && !SOMENTE_NOVAS) {
    console.log(`\nDry-run — nada foi escrito no banco. Rode com --apagar-tudo ou --somente-novas pra aplicar de verdade.`);
    return;
  }

  if (APAGAR_TUDO) {
    console.log(`\n--apagar-tudo confirmado. Apagando nf_emissao existente...`);
    await api("nf_emissao?id=neq.00000000-0000-0000-0000-000000000000", { method: "DELETE" });
    console.log(`nf_emissao esvaziada (cascade cuidou de nf_emissao_item/nf_emissao_anexo).`);
  } else if (SEM_DELETE) {
    console.log(`\n--sem-delete: pulando a limpeza (feita manualmente) e só inserindo.`);
  } else {
    console.log(`\n--somente-novas: nenhuma linha existente é tocada, só inserindo o que é novo.`);
  }

  if (paraInserirFinal.length === 0) {
    console.log(`\nNada pra inserir — a planilha não trouxe nenhuma nota realmente nova.`);
    return;
  }

  console.log(`Inserindo ${paraInserirFinal.length} notas...`);
  const TAMANHO_LOTE = 200;
  let inseridas = 0;
  for (let i = 0; i < paraInserirFinal.length; i += TAMANHO_LOTE) {
    const lote = paraInserirFinal.slice(i, i + TAMANHO_LOTE);
    const payload = lote.map(({ _linha, _chaveNatural, _tipoMatch, _item, ...resto }) => resto);
    const inseridos = await api("nf_emissao", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    const itens = inseridos.map((nf, idx) => ({ nf_emissao_id: nf.id, ...lote[idx]._item }));
    await api("nf_emissao_item", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(itens),
    });
    inseridas += inseridos.length;
    console.log(`  ${inseridas}/${paraInserirFinal.length}`);
  }

  console.log(`\nImportação concluída: ${inseridas} notas + ${inseridas} itens.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
