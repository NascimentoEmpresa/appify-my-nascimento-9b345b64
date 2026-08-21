// Lança as PARCELAS da planilha ATIVO IMOBILIZADO como CONTAS do patrimônio
// (JUR_PATRIMONIO_OBRIGACOES) — a aba "Contas / Obrigações" da tela.
//
// POR QUE ESTE SCRIPT EXISTE
//   O importador irmão (importar-patrimonios-planilha.mjs) já traz a carteira e
//   grava as parcelas em JUR_PATRIMONIO_PARCELAS. Aquela tabela é HISTÓRICO: não
//   tem status, comprovante nem ligação com o Malote, e por isso a parcela não
//   aparece como conta a pagar em lugar nenhum. Quem paga precisa dela como
//   conta — com vencimento, selo de pago e botão de enviar ao Malote.
//
// CADA PARCELA VIRA UMA LINHA de obrigação, como manda a migration
// 20260910000005: `contrato_uid` amarra as parcelas do mesmo contrato e
// `parcela_numero`/`parcela_total` fazem a tela mostrar "12/91".
//
// DE-PARA DAS ABAS
//   A coluna "ABA" do resumo NÃO é o nome da aba do arquivo ("PARCELAS CASA
//   CADU" x "RUA RAMIRO JUVENAL MAIOLI,"). O de-para abaixo é explícito de
//   propósito: casar por aproximação erraria de imóvel, e errar de imóvel aqui
//   é lançar conta de centenas de milhares no bem errado.
//
// IDEMPOTENTE: a descrição de cada conta carrega aba + número da parcela, e o
// script só insere o que ainda não existe naquele patrimônio. Rodar de novo
// não duplica.
//
// Uso:
//   node scripts/lancar-contas-patrimonio.mjs <planilha.xlsx>            (simulação)
//   node scripts/lancar-contas-patrimonio.mjs <planilha.xlsx> --aplicar  (grava)
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=… (ou
//   SUPABASE_KEY_FILE=caminho/para/chave)

import XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const ARQUIVO = process.argv[2];
const APLICAR = process.argv.includes("--aplicar");
const URL_SB = process.env.SUPABASE_URL ?? "https://fwmzeaztjxrxxzxzxmgc.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? (process.env.SUPABASE_KEY_FILE ? readFileSync(process.env.SUPABASE_KEY_FILE, "utf8").trim() : null);

if (!ARQUIVO || !KEY) {
  console.error("Uso: [SUPABASE_KEY_FILE=… ] node scripts/lancar-contas-patrimonio.mjs <planilha.xlsx> [--aplicar]");
  process.exit(1);
}

const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const api = async (caminho, init = {}) => {
  const r = await fetch(URL_SB + "/rest/v1/" + caminho, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const corpo = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${caminho}: ${corpo.slice(0, 400)}`);
  return corpo ? JSON.parse(corpo) : null;
};

// ── Conversões (mesmas do importador irmão) ──────────────────────────
const texto = (v) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };
const numero = (v) => {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const inteiro = (v) => { const n = numero(v); return n == null ? null : Math.round(n); };
const data = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const brl = (v) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ── De-para: aba do arquivo → o imóvel dela ──────────────────────────
// `chave` casa com o patrimônio já cadastrado por endereço + classificação —
// a mesma chave que o importador da carteira usa.
const CONTRATOS = [
  { aba: "RUA RAMIRO JUVENAL MAIOLI,",      endereco: "RUA  RAMIRO JUVENAL MAIOLI, 22",                     classificacao: "CASA",        categoria: "Financiamento" },
  { aba: "D1 LITORAL EMPREENDIM E I R-26",  endereco: "D1 LITORAL EMPREENDIMENTOS E I 1 - R026",             classificacao: "TERRENO",     categoria: "Financiamento" },
  { aba: "D1 LITORAL EMPREENDIM E I B-03",  endereco: "D1 LITORAL EMPREENDIMENTOS E I 2 - B03",              classificacao: "TERRENO",     categoria: "Financiamento" },
  { aba: "D1 LITORAL EMPREENDIM E I A-02",  endereco: "D1 LITORAL EMPREENDIMENTOS E I 3 - A02",              classificacao: "TERRENO",     categoria: "Financiamento" },
  { aba: "D1 LITORAL EMPREENDIM E I M-04",  endereco: "D1 LITORAL EMPREENDIMENTOS E I 4 - M04",              classificacao: "TERRENO",     categoria: "Financiamento" },
  { aba: "FINANCIAMENTO CASA DO SENILTON",  endereco: "FINANCIAMENTO CASA DO SENILTON - 13 E MAIO, 1867",    classificacao: "CASA",        categoria: "Financiamento" },
  { aba: "TURIM - RUA JOSE MILTON LOPES, ", endereco: "TURIM - RUA JOSE MILTON LOPES, 557 - AP 01102 150 E BOX",  classificacao: "APARTAMENTO", categoria: "Financiamento" },
  { aba: "MURANO PARCELAS",                 endereco: "MURANO",                                              classificacao: "APARTAMENTO", categoria: "Financiamento" },
  { aba: "GREEN PARCELAS",                  endereco: "ATLANTIDA GREEN SQUARE -  AV CENTRAL, 1891 - BL B AP 00308 -  XANGRI-LA",   classificacao: "APARTAMENTO", categoria: "Financiamento" },
  // As duas cotas do mesmo consórcio caem no MESMO imóvel, cada uma como um
  // contrato próprio (contrato_uid diferente) — é assim que a tela consegue
  // mostrar "12/91" de uma sem misturar com a outra.
  { aba: "GAV COTA 22",                     endereco: "COTAS - GAV",                                         classificacao: "COTAS",       categoria: "Consórcio" },
  { aba: "GAV COTA 25",                     endereco: "COTAS - GAV",                                         classificacao: "COTAS",       categoria: "Consórcio" },
  // SOBRADO HELENA PARCELAS ficou DE FORA por decisão do Pablo (21/08/2026).
  // A aba não é citada na coluna "ABA" do resumo e nenhum imóvel aponta para
  // ela; o palpite era a Santos Dumont, 800 (proprietária "HELENA / ALIENAÇÃO
  // FIDUCIÁRIA CAIXA"), mas o contrato da aba é R$ 660.000 e o resumo declara
  // R$ 1.410.000 naquele imóvel — não é o mesmo contrato. Quando souber de
  // qual bem é, basta descomentar com o endereço certo:
  // { aba: "SOBRADO HELENA PARCELAS", endereco: "…", classificacao: "…", categoria: "Financiamento" },
];

// ── Leitura das abas de parcelas ─────────────────────────────────────
// O cabeçalho é a primeira linha (das 12 primeiras) com uma coluna de situação
// — é a única constante entre os layouts.
const ehCabecalho = (l) => l.some((c) => /^SITUA/.test(semAcento(c)));

const CAMPO = (rotulo) => {
  const r = semAcento(rotulo);
  if (/^(N|Nº|NO|Nº;|N;|PARCELA|PARCELAS)$/.test(r)) return "numero_ou_rotulo";
  if (/^(DATA|DT VENCIMENTO|DT\. VENCIMENTO|DT\. VENCTO|VENCIMENTO|DATA BASE)$/.test(r)) return "vencimento";
  if (/^(PRESTACAO|PRESTACAO ATUAL|PRESTACAO A SER PAGA|VALOR PARCELA|VALOR ORIGINAL|TOTAL|SALDO DEV)$/.test(r)) return "valor";
  if (/^(VALOR PAGO|VALOR CORRIGIDO)$/.test(r)) return "valor_pago";
  if (/^SITUA/.test(r)) return "situacao";
  return null;
};

function lerParcelas(wb, aba) {
  const ws = wb.Sheets[aba];
  if (!ws) return [];
  const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const iCab = linhas.findIndex((l, i) => i < 12 && ehCabecalho(l));
  if (iCab < 0) return [];
  const cab = linhas[iCab];

  const parcelas = [];
  for (let i = iCab + 1; i < linhas.length; i++) {
    const l = linhas[i];
    const p = { origem: aba, ordem: parcelas.length + 1 };
    let temAlgo = false;
    for (let c = 0; c < cab.length; c++) {
      const rotulo = texto(cab[c]);
      const bruto = l[c];
      if (!rotulo || bruto === "" || bruto == null) continue;
      // A planilha repete o bloco "LEVANTAMENTO DE VALORES" à direita das
      // parcelas; ele não é coluna de parcela e entraria como lixo.
      if (c > 0 && !texto(cab[c - 1]) && !CAMPO(rotulo)) continue;
      const campo = CAMPO(rotulo);
      if (campo === "numero_ou_rotulo") {
        const n = inteiro(bruto);
        if (n != null && String(bruto).trim() === String(n)) p.numero = n; else p.rotulo = texto(bruto);
      } else if (campo === "vencimento") p.vencimento = data(bruto);
      else if (campo === "valor") p.valor = numero(bruto);
      else if (campo === "valor_pago") p.valor_pago = numero(bruto);
      else if (campo === "situacao") p.situacao = semAcento(bruto) || null;
      temAlgo = true;
    }
    // Entrada do contrato: as abas da D1 Litoral abrem com duas linhas SEM
    // número de parcela e SEM situação, antes da parcela 1. São a entrada, e
    // já foi paga — a soma delas bate exatamente com o "valor de entrada" que
    // o resumo declara (R026: 2 × 50.385,60 = 100.771,20). Sem isto elas
    // entrariam como conta em aberto e o imóvel passaria a dever a entrada
    // de novo.
    if (p.numero == null && !p.rotulo && !p.situacao && (p.valor != null || p.valor_pago != null)) {
      p.rotulo = "Entrada";
      p.situacao = "PAGA";
      p.entrada = true;
    }
    // Linha só com o bloco de totais à direita não é parcela.
    if (temAlgo && (p.numero != null || p.rotulo || p.vencimento || p.valor != null)) parcelas.push(p);
  }
  return parcelas;
}

/**
 * Os totais que a própria planilha calcula, no bloco "LEVANTAMENTO DE VALORES".
 * Servem de conferência: se o que o leitor somou não bate com o que a planilha
 * diz, é o leitor que está errado — e é melhor descobrir antes de gravar.
 */
function levantamento(wb, aba) {
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, defval: "" });
  const achar = (rotulo) => {
    for (const l of linhas) {
      for (let c = 0; c < l.length; c++) {
        if (semAcento(l[c]).startsWith(semAcento(rotulo))) {
          for (let d = c + 1; d < l.length; d++) if (typeof l[d] === "number") return l[d];
        }
      }
    }
    return null;
  };
  return {
    total: achar("Valor Total do Contrato"),
    pago: achar("Total Pago"),
    aberto: achar("Total em Aberto"),
    qtd: achar("Total de Parcelas"),
    pagas: achar("Parcelas Pagas"),
  };
}

/** PAGA / Paga / PAGO → paga. O resto (NÃO PAGA, vazio) é conta em aberto. */
const estaPaga = (situacao) => /^PAG[AO]/.test(semAcento(situacao));

// ── Execução ─────────────────────────────────────────────────────────
const wb = XLSX.readFile(ARQUIVO);

const abasSemDePara = wb.SheetNames.slice(1).filter((n) => !CONTRATOS.some((c) => c.aba === n));
if (abasSemDePara.length) {
  console.log("\n⚠ abas de parcela sem de-para (NÃO serão lançadas):");
  abasSemDePara.forEach((n) => console.log("   ·", n));
}

const patrimonios = await api("JUR_PATRIMONIOS?select=id,localizacao,classificacao&limit=2000");
const chave = (loc, cls) => `${semAcento(loc)}|${semAcento(cls)}`;
const porChave = new Map(patrimonios.map((p) => [chave(p.localizacao, p.classificacao), p.id]));

// PostgREST corta a resposta em 1.000 linhas; sem paginar, o script acha que
// quase nada existe e lança tudo de novo.
const paginado = async (caminho) => {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const r = await fetch(URL_SB + "/rest/v1/" + caminho, { headers: { ...H, Range: `${de}-${de + 999}`, "Range-Unit": "items" } });
    if (!r.ok) throw new Error(`${r.status} ${caminho}`);
    const l = await r.json();
    out.push(...l);
    if (l.length < 1000) return out;
  }
};

const existentes = await paginado("JUR_PATRIMONIO_OBRIGACOES?select=id,patrimonio_id,categoria,descricao,contrato_uid&order=id");
const jaLancada = new Set(existentes.map((o) => `${o.patrimonio_id}|${o.descricao ?? ""}`));

/**
 * O contrato já foi lançado por fora deste script?
 *
 * A idempotência por descrição só reconhece o que ESTE script gravou. Quem
 * cadastra pela tela não escreve "GAV COTA 22 · Parcela 3/91" na descrição — e
 * foi assim que o R026 ficou com o contrato em dobro: 36 parcelas feitas na
 * mão (29 já com comprovante anexado) mais as 38 do import. Se o imóvel já tem
 * parcelas de contrato daquela categoria sem a marca do script, ele para.
 */
const contratoJaExiste = (patrimonioId, categoria) =>
  existentes.some((o) => o.patrimonio_id === patrimonioId && o.categoria === categoria
    && o.contrato_uid && !/ · /.test(o.descricao ?? ""));

let totalLinhas = 0, totalNovas = 0, problemas = 0;
const paraInserir = [];

for (const ct of CONTRATOS) {
  const id = porChave.get(chave(ct.endereco, ct.classificacao));
  const parcelas = lerParcelas(wb, ct.aba);
  const lv = levantamento(wb, ct.aba);

  if (!id) { console.log(`\n✗ ${ct.aba}: patrimônio não encontrado (${ct.endereco} / ${ct.classificacao})`); problemas++; continue; }
  if (!parcelas.length) { console.log(`\n✗ ${ct.aba}: nenhuma parcela lida`); problemas++; continue; }
  if (contratoJaExiste(id, ct.categoria) && !process.argv.includes("--forcar")) {
    console.log("");
    console.log(`[pulado] ${ct.aba.trim()}: o patrimonio #${id} ja tem contrato de ${ct.categoria} lancado fora deste script. Use --forcar para lancar assim mesmo.`);
    problemas++; continue;
  }

  const contratoUid = randomUUID();
  const pagas = parcelas.filter((p) => estaPaga(p.situacao)).length;
  const soma = parcelas.reduce((s, p) => s + (p.valor ?? p.valor_pago ?? 0), 0);
  const somaAberto = parcelas.filter((p) => !estaPaga(p.situacao)).reduce((s, p) => s + (p.valor ?? p.valor_pago ?? 0), 0);
  const semData = parcelas.filter((p) => !p.vencimento).length;

  const linhas = parcelas.map((p) => {
    const rotulo = p.rotulo ? p.rotulo : `Parcela ${p.numero ?? p.ordem}/${parcelas.length}`;
    return {
      patrimonio_id: id,
      categoria: ct.categoria,
      // A descrição é a chave natural da idempotência — e é o que a tela mostra
      // ao lado da categoria, então diz de qual contrato a parcela é.
      descricao: `${ct.aba.trim()} · ${rotulo}`,
      valor: p.valor ?? p.valor_pago ?? null,
      vencimento: p.vencimento ?? null,
      periodicidade: "Mensal",
      status: estaPaga(p.situacao) ? "Pago" : "Pendente",
      // pago_em fica nulo de propósito: a planilha diz QUE foi paga, não QUANDO.
      pago_em: null,
      contrato_uid: contratoUid,
      parcela_numero: p.numero ?? p.ordem,
      parcela_total: parcelas.length,
    };
  });

  const novas = linhas.filter((l) => !jaLancada.has(`${l.patrimonio_id}|${l.descricao}`));
  paraInserir.push(...novas);
  totalLinhas += linhas.length;
  totalNovas += novas.length;

  // O "Total de Parcelas" da planilha conta só as parcelas NUMERADAS; sinal,
  // entrada, reforço e quitação são linhas à parte. Comparar com o total lido
  // acusaria diferença em toda aba que tem extras — e elas são contas iguais
  // às outras: têm data, valor e alguém para pagar.
  const numeradas = parcelas.filter((x) => x.numero != null).length;
  const extras = parcelas.length - numeradas;
  const confereQtd = lv.qtd == null || lv.qtd === numeradas ? "" : `  ⚠ parcelas numeradas: li ${numeradas}, planilha diz ${lv.qtd}`;
  const confereAberto = lv.aberto == null || Math.abs(lv.aberto - somaAberto) < 1 ? "" : `  ⚠ em aberto: li ${brl(somaAberto)}, planilha diz ${brl(lv.aberto)}`;
  if (confereQtd || confereAberto) problemas++;

  console.log(`\n▸ ${ct.aba.trim()}  →  patrimônio #${id} (${ct.endereco.slice(0, 42)})`);
  console.log(`   ${ct.categoria} · ${parcelas.length} contas (${numeradas} parcelas${extras ? ` + ${extras} entrada/sinal/reforço/quitação` : ""})`);
  console.log(`   ${pagas} pagas / ${parcelas.length - pagas} em aberto${semData ? ` · ${semData} sem data` : ""}`);
  console.log(`   soma ${brl(soma)} · em aberto ${brl(somaAberto)}${lv.total ? ` · contrato (planilha) ${brl(lv.total)}` : ""}`);
  console.log(`   a inserir: ${novas.length}${novas.length !== linhas.length ? ` (${linhas.length - novas.length} já lançadas)` : ""}`);
  if (confereQtd) console.log("  " + confereQtd);
  if (confereAberto) console.log("  " + confereAberto);
}

console.log(`\n${"=".repeat(66)}`);
console.log(`total de parcelas na planilha: ${totalLinhas}`);
console.log(`a inserir agora: ${totalNovas}${problemas ? `  ·  avisos: ${problemas}` : ""}`);

if (!APLICAR) {
  console.log("\nSIMULAÇÃO — nada foi gravado. Rode com --aplicar para lançar.");
  process.exit(0);
}

for (let i = 0; i < paraInserir.length; i += 400) {
  const lote = paraInserir.slice(i, i + 400);
  await api("JUR_PATRIMONIO_OBRIGACOES", { method: "POST", body: JSON.stringify(lote), headers: { Prefer: "return=minimal" } });
  console.log(`gravadas ${Math.min(i + lote.length, paraInserir.length)}/${paraInserir.length}`);
}
console.log("\n✓ contas lançadas.");
