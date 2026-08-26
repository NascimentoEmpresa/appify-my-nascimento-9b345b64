// NF-e de entrada pela SEFAZ — serviço NFeDistribuicaoDFe.
//
// A SEFAZ mantém uma caixa postal numerada por CNPJ. Cada documento ganha um
// NSU (posição na fila, não o número da nota). A consulta é sempre "me dá o
// que veio depois do NSU X"; a resposta traz até 50 documentos e diz até onde
// entregou. A próxima consulta parte DAÍ.
//
// A REGRA QUE CUSTOU UM BLOQUEIO — medida em produção, não lida em manual:
// pular para um NSU arbitrário faz a SEFAZ responder `cStat 656 — Consumo
// Indevido` e travar o CNPJ por 1 hora. Aconteceu ao saltar de 50 para 10890.
// Todo o desenho abaixo existe para nunca mais fazer isso:
//
//   cStat 138 → vieram documentos. Pode continuar logo, do ultNSU devolvido.
//   cStat 137 → fila vazia, alcançou o presente. Recua uma hora.
//   cStat 656 → punição ativa. Recua uma hora e NÃO tenta de novo antes.
//
// O `bloqueado_ate` fica no banco e não em memória de propósito: reiniciar o
// worker durante a punição não pode fazer ele bater na porta de novo, porque
// isso renova o castigo.
//
// CERTIFICADO
// O A1 da empresa usa RC2-40-CBC, cifra legada que o OpenSSL 3 recusa. O
// worker precisa rodar com `node --openssl-legacy-provider` (já no script
// `start` do package.json). Sem a flag, o erro é
// `ERR_CRYPTO_UNSUPPORTED_OPERATION: Unsupported PKCS12 PFX data`, que não diz
// nada sobre a causa real.

const fs = require("node:fs");
const https = require("node:https");
const zlib = require("node:zlib");
const forge = require("node-forge");

const CERT_PATH = process.env.NFE_CERT_PATH;
const CERT_PASS = process.env.NFE_CERT_PASS;
const CNPJ = (process.env.NFE_CNPJ || "").replace(/\D/g, "");
const CUF = process.env.NFE_CUF || "43"; // 43 = RS
const AMBIENTE = process.env.NFE_AMBIENTE || "1"; // 1 = producao

const HOST = "www1.nfe.fazenda.gov.br";
const CAMINHO = "/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";

const RECUO_MS = 60 * 60 * 1000; // a punição da SEFAZ é de 1 hora
const INTERVALO_ATIVO_MS = 60 * 1000; // enquanto há documentos, ritmo de 1/min
const ALERTA_CERT_DIAS = 30;

// ── Certificado ──────────────────────────────────────────────────────────

let cacheCert = null;

function lerCertificado() {
  if (cacheCert) return cacheCert;
  const pfx = fs.readFileSync(CERT_PATH);
  cacheCert = { pfx, passphrase: CERT_PASS };
  return cacheCert;
}

/**
 * Data de expiração do certificado.
 *
 * Usa node-forge em vez do módulo `crypto`: o `crypto` não expõe o conteúdo de
 * um PKCS#12, e converter para PEM só para ler uma data deixaria a chave
 * privada em disco sem senha.
 */
function validadeCertificado() {
  const der = fs.readFileSync(CERT_PATH).toString("binary");
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), CERT_PASS);
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const certs = bags.map((b) => b.cert).filter(Boolean);
  if (!certs.length) throw new Error("nenhum certificado no .pfx");
  // O .pfx traz a cadeia inteira; o da empresa é o que tem o CNPJ no CN.
  const meu = certs.find((c) => {
    const cn = c.subject.getField("CN");
    return cn && cn.value.includes(CNPJ);
  });
  return (meu || certs[0]).validity.notAfter;
}

/** Avisa antes de vencer. Sem isso a integração para em silêncio e ninguém
 *  liga o sintoma ("parou de puxar nota") à causa. */
async function verificarCertificado(supabase, alertar) {
  const expira = validadeCertificado();
  const dias = Math.floor((expira.getTime() - Date.now()) / 86_400_000);
  if (dias <= ALERTA_CERT_DIAS) {
    const msg =
      dias < 0
        ? `Certificado digital VENCIDO há ${-dias} dia(s) (${expira.toISOString().slice(0, 10)}). A importação de NF-e está parada.`
        : `Certificado digital vence em ${dias} dia(s) (${expira.toISOString().slice(0, 10)}).`;
    console.warn("[worker] NF-e:", msg);
    if (typeof alertar === "function") await alertar(msg);
  }
  return dias;
}

// ── Estado da fila ───────────────────────────────────────────────────────

async function lerEstado(supabase) {
  const { data, error } = await supabase
    .from("nfe_dist_estado")
    .select("*")
    .eq("cnpj", CNPJ)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: novo, error: e2 } = await supabase
    .from("nfe_dist_estado")
    .insert({ cnpj: CNPJ })
    .select("*")
    .single();
  if (e2) throw e2;
  return novo;
}

async function salvarEstado(supabase, campos) {
  const { error } = await supabase
    .from("nfe_dist_estado")
    .update({ ...campos, atualizado_em: new Date().toISOString() })
    .eq("cnpj", CNPJ);
  if (error) throw error;
}

// ── Consulta ─────────────────────────────────────────────────────────────

function envelopeNSU(ultNSU) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>${AMBIENTE}</tpAmb>
          <cUFAutor>${CUF}</cUFAutor>
          <CNPJ>${CNPJ}</CNPJ>
          <distNSU><ultNSU>${String(ultNSU).padStart(15, "0")}</ultNSU></distNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}

function postar(envelope) {
  const { pfx, passphrase } = lerCertificado();
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST,
        path: CAMINHO,
        method: "POST",
        pfx,
        passphrase,
        headers: {
          "Content-Type": "application/soap+xml; charset=utf-8",
          "Content-Length": Buffer.byteLength(envelope),
        },
        timeout: 60_000,
      },
      (res) => {
        const partes = [];
        res.on("data", (d) => partes.push(d));
        res.on("end", () => resolve({ status: res.statusCode, corpo: Buffer.concat(partes).toString("utf8") }));
      },
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout na SEFAZ")); });
    req.on("error", reject);
    req.end(envelope);
  });
}

const tag = (xml, nome) => {
  const m = xml.match(new RegExp(`<${nome}[^>]*>([\\s\\S]*?)</${nome}>`));
  return m ? m[1].trim() : null;
};

/** Um docZip é um XML gzipado em base64. `schema` diz o que é. */
function extrairDocumentos(corpo) {
  const achados = [...corpo.matchAll(/<docZip[^>]*NSU="(\d+)"[^>]*schema="([^"]*)"[^>]*>([\s\S]*?)<\/docZip>/g)];
  return achados.map(([, nsu, schema, b64]) => {
    const xml = zlib.gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
    const tipo = /^resNFe/.test(schema) ? "resumo"
      : /^procNFe/.test(schema) ? "completo"
      : "evento";
    return {
      cnpj: CNPJ,
      nsu,
      schema,
      tipo,
      chave: tag(xml, "chNFe"),
      emitente_cnpj: tag(xml, "CNPJ"),
      emitente_nome: tag(xml, "xNome"),
      valor: tag(xml, "vNF") ? Number(tag(xml, "vNF")) : null,
      emitida_em: (tag(xml, "dhEmi") || "").slice(0, 10) || null,
      xml,
    };
  });
}

async function sincronizarNfe(supabase, alertar) {
  if (!CERT_PATH || !CERT_PASS || !CNPJ) return; // não configurado

  const estado = await lerEstado(supabase);

  // A punição sobrevive a reinício — este `return` é o que impede o worker de
  // renovar o bloqueio ao subir durante a hora de castigo.
  if (estado.bloqueado_ate && new Date(estado.bloqueado_ate) > new Date()) return;

  // Ritmo entre chamadas normais.
  if (estado.consultado_em && Date.now() - new Date(estado.consultado_em).getTime() < INTERVALO_ATIVO_MS) return;

  await verificarCertificado(supabase, alertar);

  const { status, corpo } = await postar(envelopeNSU(estado.ult_nsu));
  const agora = new Date().toISOString();

  if (status !== 200) {
    await salvarEstado(supabase, { ultimo_erro: `HTTP ${status}`, consultado_em: agora });
    throw new Error(`SEFAZ respondeu HTTP ${status}`);
  }

  const cStat = tag(corpo, "cStat");
  const xMotivo = tag(corpo, "xMotivo");
  const ultNSU = tag(corpo, "ultNSU");
  const maxNSU = tag(corpo, "maxNSU");

  // 656: consumo indevido. Recua e NÃO avança o NSU — o ultNSU que vem nessa
  // resposta não é confiável para continuar.
  if (cStat === "656") {
    await salvarEstado(supabase, {
      bloqueado_ate: new Date(Date.now() + RECUO_MS).toISOString(),
      ultimo_erro: `${cStat} ${xMotivo}`,
      consultado_em: agora,
    });
    console.warn("[worker] NF-e: consumo indevido, recuando 1 hora.");
    return;
  }

  // 137: alcançou o presente. Não é erro — só não há o que buscar agora.
  if (cStat === "137") {
    await salvarEstado(supabase, {
      ult_nsu: ultNSU || estado.ult_nsu,
      max_nsu: maxNSU || estado.max_nsu,
      bloqueado_ate: new Date(Date.now() + RECUO_MS).toISOString(),
      ultimo_erro: null,
      consultado_em: agora,
    });
    return;
  }

  const documentos = extrairDocumentos(corpo);
  if (documentos.length) {
    // onConflict no par (cnpj, nsu): reprocessar o mesmo NSU nunca duplica.
    const { error } = await supabase
      .from("nfe_dist_documento")
      .upsert(documentos, { onConflict: "cnpj,nsu" });
    if (error) throw error;
  }

  await salvarEstado(supabase, {
    ult_nsu: ultNSU || estado.ult_nsu,
    max_nsu: maxNSU || estado.max_nsu,
    bloqueado_ate: null,
    ultimo_erro: null,
    consultado_em: agora,
  });

  const restam = Number(maxNSU || 0) - Number(ultNSU || 0);
  console.log(
    `[worker] NF-e: ${documentos.length} documento(s), NSU ${estado.ult_nsu} → ${ultNSU}` +
      (restam > 0 ? `, faltam ~${restam}` : ", em dia"),
  );
}

module.exports = { sincronizarNfe, verificarCertificado, validadeCertificado, extrairDocumentos };
