// Importa a carteira de patrimônios da planilha ATIVO IMOBILIZADO para o ERP.
//
// A planilha tem duas camadas:
//   • a aba resumo, uma linha por imóvel, com a posição do contrato;
//   • uma aba por financiamento, com as parcelas — e cada uma com o SEU
//     conjunto de colunas (seguro, taxa adm, encargo, INCC, juro, correção).
//
// Por isso o leitor de parcelas não assume layout: acha a linha de cabeçalho
// pela coluna "Situação", mapeia o que reconhece e joga o resto em `detalhes`.
// Assim uma aba nova entra sem mexer no código.
//
// Idempotente: casa por endereço + classificação. Rodar de novo atualiza os
// valores e regrava as parcelas daquele patrimônio, não duplica.
//
// Uso:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/importar-patrimonios-planilha.mjs "caminho/da/planilha.xlsx"

import XLSX from "xlsx";

const URL_SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ARQUIVO = process.argv[2];

if (!URL_SB || !KEY || !ARQUIVO) {
  console.error("Uso: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/importar-patrimonios-planilha.mjs <planilha.xlsx>");
  process.exit(1);
}

const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const api = async (caminho, init = {}) => {
  const r = await fetch(URL_SB + "/rest/v1/" + caminho, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const corpo = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${caminho}: ${corpo}`);
  // return=minimal responde 201/204 sem corpo — JSON.parse de string vazia estoura.
  return corpo ? JSON.parse(corpo) : null;
};

// ── Conversões ───────────────────────────────────────────────────────
const texto = (v) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };
const numero = (v) => {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const inteiro = (v) => { const n = numero(v); return n == null ? null : Math.round(n); };
// Data do Excel é um serial contado de 30/12/1899; textos em dd/mm/aaaa também aparecem.
const data = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number" && v > 20000 && v < 60000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const capitalizado = (v) => { const s = String(v ?? "").trim().toLowerCase(); return s ? s[0].toUpperCase() + s.slice(1) : "—"; };
const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

// ── Aba resumo → um patrimônio por linha ─────────────────────────────
const COLUNA = {
  aba: 1, proxima_parcela: 2, status_aba: 3, classificacao: 4, endereco: 5,
  situacao: 6, municipio: 7, nome: 8, especie: 9, matricula: 10, escritura: 11,
  valor_contrato: 12, valor_entrada: 13, reforcos_pagos: 14, reforcos_a_pagar: 15,
  valor_parcela: 16, qtd_parcelas: 17, parcelas_pagas: 18, parcelas_falta: 19,
  valor_falta: 20, comissao: 21, valor_total: 22, valor_estimado: 23,
  observacao: 24, anotacoes: 25,
};

function lerResumo(wb) {
  const nome = wb.SheetNames[0];
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: "" });
  return linhas.slice(2)
    .filter((l) => texto(l[COLUNA.classificacao]) && texto(l[COLUNA.endereco]))
    .map((l) => ({
      classificacao: semAcento(l[COLUNA.classificacao]),
      localizacao: texto(l[COLUNA.endereco]),
      situacao_pagamento: semAcento(l[COLUNA.situacao]) || null,
      cidade: texto(l[COLUNA.municipio]),
      proprietario: texto(l[COLUNA.nome]),
      especie_escritura: texto(l[COLUNA.especie]),
      matricula: texto(l[COLUNA.matricula]),
      possui_escritura: /^SIM/.test(semAcento(l[COLUNA.escritura])) ? true
        : /^NAO/.test(semAcento(l[COLUNA.escritura])) ? false : null,
      valor_contrato: numero(l[COLUNA.valor_contrato]),
      valor_entrada: numero(l[COLUNA.valor_entrada]),
      reforcos_pagos: numero(l[COLUNA.reforcos_pagos]),
      reforcos_a_pagar: numero(l[COLUNA.reforcos_a_pagar]),
      valor_parcela: numero(l[COLUNA.valor_parcela]),
      qtd_parcelas: inteiro(l[COLUNA.qtd_parcelas]),
      parcelas_pagas: inteiro(l[COLUNA.parcelas_pagas]),
      parcelas_falta: inteiro(l[COLUNA.parcelas_falta]),
      valor_falta: numero(l[COLUNA.valor_falta]),
      comissao: numero(l[COLUNA.comissao]),
      valor_total: numero(l[COLUNA.valor_total]),
      valor_estimado: numero(l[COLUNA.valor_estimado]),
      proxima_parcela: data(l[COLUNA.proxima_parcela]),
      observacoes: texto(l[COLUNA.observacao]),
      anotacoes: texto(l[COLUNA.anotacoes]),
      aba_origem: texto(l[COLUNA.aba]),
      tipo: "Imóvel",
      status: "Ativo",
      // A planilha não tem descrição — só a classificação. Repetir a classe em
      // caixa de frase é honesto (não inventa nada) e satisfaz o NOT NULL da
      // coluna; quem cadastra depois refina para "Casa residencial" e afins.
      descricao: capitalizado(l[COLUNA.classificacao]),
    }));
}

// ── Abas de parcelas ─────────────────────────────────────────────────
// O cabeçalho é a primeira linha (das 12 primeiras) que tem uma coluna de
// situação — é a única constante entre os layouts.
const ehCabecalho = (l) => l.some((c) => /^SITUA/.test(semAcento(c)));

const CAMPO_CONHECIDO = (rotulo) => {
  const r = semAcento(rotulo);
  if (/^(N|Nº|NO|Nº;|PARCELA|PARCELAS)$/.test(r) || r === "N;") return "numero_ou_rotulo";
  if (/^(DATA|DT VENCIMENTO|DT\. VENCIMENTO|DT\. VENCTO|VENCIMENTO|DATA BASE)$/.test(r)) return "vencimento";
  if (/^(PRESTACAO|PRESTACAO ATUAL|PRESTACAO A SER PAGA|VALOR PARCELA|VALOR ORIGINAL|TOTAL)$/.test(r)) return "valor";
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
    const p = { detalhes: {}, origem: aba, ordem: parcelas.length + 1 };
    let temAlgo = false;
    for (let c = 0; c < cab.length; c++) {
      const rotulo = texto(cab[c]);
      const bruto = l[c];
      if (!rotulo || bruto === "" || bruto == null) continue;
      // A planilha repete o bloco "LEVANTAMENTO DE VALORES" à direita das
      // parcelas; ele não é coluna de parcela e entraria como lixo.
      if (c > 0 && !texto(cab[c - 1]) && !CAMPO_CONHECIDO(rotulo)) continue;
      const campo = CAMPO_CONHECIDO(rotulo);
      if (campo === "numero_ou_rotulo") {
        const n = inteiro(bruto);
        if (n != null && String(bruto).trim() === String(n)) p.numero = n; else p.rotulo = texto(bruto);
      } else if (campo === "vencimento") p.vencimento = data(bruto);
      else if (campo === "valor") p.valor = numero(bruto);
      else if (campo === "valor_pago") p.valor_pago = numero(bruto);
      else if (campo === "situacao") p.situacao = semAcento(bruto) || null;
      else p.detalhes[rotulo] = typeof bruto === "number" ? bruto : texto(bruto);
      temAlgo = true;
    }
    // Linha só com o bloco de totais à direita não é parcela.
    if (temAlgo && (p.numero != null || p.rotulo || p.vencimento || p.valor != null)) parcelas.push(p);
  }
  return parcelas;
}

// ── Execução ─────────────────────────────────────────────────────────
const wb = XLSX.readFile(ARQUIVO);
const resumo = lerResumo(wb);
console.log(`planilha: ${resumo.length} patrimônios na aba resumo`);

const existentes = await api("JUR_PATRIMONIOS?select=id,localizacao,classificacao,tipo&limit=2000");
const chave = (p) => `${semAcento(p.localizacao)}|${semAcento(p.classificacao)}`;
const porChave = new Map(existentes.map((p) => [chave(p), p.id]));

let criados = 0, atualizados = 0, totalParcelas = 0;
for (const p of resumo) {
  const jaTem = porChave.get(chave(p));
  let id = jaTem;
  if (jaTem) {
    await api(`JUR_PATRIMONIOS?id=eq.${jaTem}`, { method: "PATCH", body: JSON.stringify(p), headers: { Prefer: "return=minimal" } });
    atualizados++;
  } else {
    const [novo] = await api("JUR_PATRIMONIOS", { method: "POST", body: JSON.stringify(p), headers: { Prefer: "return=representation" } });
    id = novo.id; criados++;
  }

  if (!p.aba_origem) continue;
  // Uma linha pode apontar para MAIS DE UMA aba ("GAV COTA 22 e GAV COTA 25"):
  // sao duas cotas do mesmo consorcio, e as parcelas das duas sao do imovel.
  const abas = p.aba_origem.split(/\s+e\s+|,\s*/).map((s) => s.trim()).filter(Boolean);
  const parcelas = abas.flatMap((aba) => lerParcelas(wb, aba));
  if (!parcelas.length) { console.log(`  aviso: aba "${p.aba_origem}" não rendeu parcelas`); continue; }
  // Regrava: a planilha é a fonte da verdade dessa lista.
  await api(`JUR_PATRIMONIO_PARCELAS?patrimonio_id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  for (let i = 0; i < parcelas.length; i += 500) {
    // O PostgREST exige que TODAS as linhas do lote tenham as mesmas chaves
    // ("All object keys must match"), e cada aba preenche um conjunto diferente.
    // Por isso a linha é montada inteira, com null no que não veio.
    const lote = parcelas.slice(i, i + 500).map((x) => ({
      patrimonio_id: id,
      ordem: x.ordem ?? null,
      numero: x.numero ?? null,
      rotulo: x.rotulo ?? null,
      vencimento: x.vencimento ?? null,
      valor: x.valor ?? null,
      valor_pago: x.valor_pago ?? null,
      situacao: x.situacao ?? null,
      detalhes: x.detalhes ?? {},
      origem: x.origem ?? null,
    }));
    await api("JUR_PATRIMONIO_PARCELAS", { method: "POST", body: JSON.stringify(lote), headers: { Prefer: "return=minimal" } });
  }
  totalParcelas += parcelas.length;
  console.log(`  ${p.localizacao.slice(0, 44).padEnd(44)} → ${parcelas.length} parcelas (${p.aba_origem})`);
}

console.log(`\ncriados: ${criados} | atualizados: ${atualizados} | parcelas: ${totalParcelas}`);
