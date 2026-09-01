// Ciência da Operação — Manifestação do Destinatário (evento 210210).
//
// POR QUE ISTO EXISTE
// Nota emitida contra a empresa chega da SEFAZ como RESUMO: emitente, valor e
// chave, sem os produtos. O XML completo só é liberado depois que o
// destinatário se manifesta. Sem este módulo, o recebimento e a entrada de
// estoque continuam dependendo do fornecedor mandar o XML por e-mail.
//
// O QUE ESTE EVENTO SIGNIFICA — e o que NÃO significa
// "Ciência da Operação" declara apenas que a empresa sabe que a nota existe.
// Não confirma recebimento de mercadoria: isso é "Confirmação da Operação"
// (210200), evento distinto, mais forte e com efeito comercial. O nível daqui
// é o mínimo que destrava o XML, e foi escolhido de propósito.
//
// É ESCRITA, NÃO LEITURA. Diferente das consultas, isto grava um evento no
// histórico fiscal da empresa, em nome dela, e é IRREVERSÍVEL. Autorizado
// pelo Eduardo em 26/08/2026 depois de consulta ao jurídico.
//
// O XML COMPLETO NÃO VEM NA RESPOSTA. A SEFAZ confirma o registro do evento e
// disponibiliza o documento na fila de NSU — ele chega numa consulta seguinte
// do `nfe.js`, não aqui. Quem esperar a nota completa no retorno deste módulo
// vai achar que falhou.

const https = require("node:https");
const { abrirCertificado, assinarXml } = require("./nfeAssinatura");

const HOST = "www1.nfe.fazenda.gov.br";
const CAMINHO = "/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx";
const ACAO_SOAP =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEventoNF";

const CERT_PATH = process.env.NFE_CERT_PATH;
const CERT_PASS = process.env.NFE_CERT_PASS;
const CNPJ = (process.env.NFE_CNPJ || "").replace(/\D/g, "");
const AMBIENTE = process.env.NFE_AMBIENTE || "1";

// Só manifesta com isto ligado. Escrita em nome da empresa não nasce ativa por
// conta de uma variável esquecida.
const LIGADO = process.env.NFE_CIENCIA === "1";

// Recusas que valem para UMA nota e nao melhoram com o tempo.
//
// 650 = "Evento de Ciencia da Operacao para NFe cancelada ou denegada". Nota
// cancelada nao tem mercadoria a receber; a SEFAZ nunca vai aceitar ciencia
// sobre ela, hoje nem daqui a um mes. Isso e diferente de erro sistemico
// (assinatura, CNPJ, certificado vencido), que atinge o lote inteiro e onde
// parar e o certo -- ver o `return` la embaixo.
const RECUSA_DEFINITIVA = new Set(["650"]);

// Quantas por ciclo. Baixo de propósito: são eventos irreversíveis, e um laço
// apertado sobre uma fila grande registraria centenas antes de alguém notar
// que algo está errado.
const POR_CICLO = Number(process.env.NFE_CIENCIA_POR_CICLO || 5);

const ORGAO_AMBIENTE_NACIONAL = "91";
const TIPO_EVENTO = "210210";

let cacheCert = null;
const certificado = () => (cacheCert ??= abrirCertificado(CERT_PATH, CERT_PASS, CNPJ));

/** "2026-08-26T15:00:00-03:00" — a SEFAZ exige o fuso explícito. */
function agoraComFuso() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sinal = off >= 0 ? "+" : "-";
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" + pad(d.getMonth() + 1) +
    "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) +
    ":" + pad(d.getMinutes()) +
    ":" + pad(d.getSeconds()) +
    sinal + pad(off / 60) + ":" + pad(off % 60)
  );
}

function montarEvento(chave, sequencia) {
  const seq = String(sequencia).padStart(2, "0");
  const id = `ID${TIPO_EVENTO}${chave}${seq}`;
  const xml =
    `<evento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<infEvento Id="${id}">` +
    `<cOrgao>${ORGAO_AMBIENTE_NACIONAL}</cOrgao>` +
    `<tpAmb>${AMBIENTE}</tpAmb>` +
    `<CNPJ>${CNPJ}</CNPJ>` +
    `<chNFe>${chave}</chNFe>` +
    `<dhEvento>${agoraComFuso()}</dhEvento>` +
    `<tpEvento>${TIPO_EVENTO}</tpEvento>` +
    `<nSeqEvento>${sequencia}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento>` +
    `</infEvento></evento>`;

  return assinarXml(xml, id, '//*[local-name(.)="evento"]', certificado());
}

function envelopar(eventoAssinado, idLote) {
  const envEvento =
    `<envEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<idLote>${idLote}</idLote>${eventoAssinado}</envEvento>`;

  // `nfeDadosMsg` vai DIRETO no Body, sem elemento de operação em volta — foi
  // lido do WSDL (`<wsdl:part name="nfeDadosMsg" element="tns:nfeDadosMsg"/>`),
  // não suposto. O NFeDistribuicaoDFe usa o formato oposto, com o wrapper
  // `nfeDistDFeInteresse`; copiar o envelope de um serviço para o outro faz a
  // SEFAZ responder "Object reference not set to an instance of an object",
  // que parece defeito do lado deles e é forma errada do nosso lado.
  return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${envEvento}</nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>`;
}

function postar(corpo) {
  const { pfx, passphrase } = { pfx: require("node:fs").readFileSync(CERT_PATH), passphrase: CERT_PASS };
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST,
        path: CAMINHO,
        method: "POST",
        pfx,
        passphrase,
        headers: {
          // O `action` vai DENTRO do Content-Type, como manda o SOAP 1.2 — e
          // este serviço cobra, ao contrário do NFeDistribuicaoDFe, que aceita
          // sem. Faltando, a resposta é HTTP 500 "Unable to handle request
          // without a valid action parameter", que não parece erro de
          // cabeçalho e manda a gente procurar defeito na assinatura.
          "Content-Type": `application/soap+xml; charset=utf-8; action="${ACAO_SOAP}"`,
          "Content-Length": Buffer.byteLength(corpo),
        },
        timeout: 60_000,
      },
      (res) => {
        const p = [];
        res.on("data", (d) => p.push(d));
        res.on("end", () => resolve({ status: res.statusCode, corpo: Buffer.concat(p).toString("utf8") }));
      },
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout na SEFAZ")); });
    req.on("error", reject);
    req.end(corpo);
  });
}

const tag = (xml, nome) => {
  const m = xml.match(new RegExp(`<${nome}[^>]*>([\\s\\S]*?)</${nome}>`));
  return m ? m[1].trim() : null;
};

/**
 * Manifesta uma nota. Devolve { ok, cStat, motivo }.
 *
 * `573` (duplicidade) conta como sucesso: significa que o evento JÁ está
 * registrado na SEFAZ. Tratar como erro faria a mesma nota ser retentada para
 * sempre, e cada tentativa é uma escrita.
 */
async function manifestar(chave) {
  const { status, corpo } = await postar(envelopar(montarEvento(chave, 1), Date.now() % 1_000_000_000));

  if (status !== 200) {
    // O texto do SOAP Fault junto: sem ele, "HTTP 500" não diz se o problema
    // foi o envelope, o schema ou a assinatura — e são correções opostas.
    const falha = corpo.match(/<(?:\w+:)?(?:Text|faultstring)[^>]*>([\s\S]*?)<\//i);
    const detalhe = falha ? falha[1].replace(/\s+/g, " ").trim().slice(0, 300) : corpo.slice(0, 200);
    return { ok: false, cStat: null, motivo: `HTTP ${status}: ${detalhe}` };
  }

  // O cStat do lote (128 = lote processado) e o do evento são diferentes; o
  // que decide é o de dentro do retEvento.
  const retorno = corpo.match(/<retEvento[\s\S]*?<\/retEvento>/);
  const alvo = retorno ? retorno[0] : corpo;
  const cStat = tag(alvo, "cStat");
  const motivo = tag(alvo, "xMotivo");

  return { ok: cStat === "135" || cStat === "573", cStat, motivo };
}

async function darCienciaPendentes(supabase) {
  if (!LIGADO || !CERT_PATH || !CNPJ) return;

  const { data: pendentes, error } = await supabase
    .from("nfe_dist_documento")
    .select("id, chave")
    .eq("tipo", "resumo")
    .is("ciencia_em", null)
    .is("ciencia_dispensada_em", null)
    .not("chave", "is", null)
    .order("nsu", { ascending: true })
    .limit(POR_CICLO);
  if (error) throw error;
  if (!pendentes || !pendentes.length) return;

  for (const doc of pendentes) {
    let resultado;
    try {
      resultado = await manifestar(doc.chave);
    } catch (e) {
      console.error(`[worker] Ciência da chave ${doc.chave}: ${e.message}`);
      // Sem marcar nada: a próxima passada tenta de novo. Falha de rede não
      // pode virar "manifestada" nem bloquear a nota para sempre.
      return;
    }

    if (resultado.ok) {
      await supabase
        .from("nfe_dist_documento")
        .update({ ciencia_em: new Date().toISOString() })
        .eq("id", doc.id);
      console.log(
        `[worker] Ciência registrada: ${doc.chave} (${resultado.cStat})` +
          (resultado.cStat === "573" ? " — já existia" : ""),
      );
    } else if (RECUSA_DEFINITIVA.has(resultado.cStat)) {
      // Recusa definitiva desta nota só: registra o motivo, tira da fila e
      // SEGUE para a próxima.
      //
      // Abortar o lote aqui foi o que travou a fila em 01/09/2026. A nota
      // cancelada do RESTAURANTE DONA ANA era a mais antiga por NSU, então
      // reaparecia como primeira a cada ciclo, era recusada de novo, e as
      // outras 17 nunca chegavam a ser tentadas. Sem `ciencia_dispensada_em`
      // não havia como sair desse laço: a recusa não era gravada em lugar
      // nenhum, e a cada 60s gastava-se uma escrita inútil na SEFAZ.
      await supabase
        .from("nfe_dist_documento")
        .update({
          ciencia_dispensada_em: new Date().toISOString(),
          ciencia_dispensa_motivo: `${resultado.cStat} ${resultado.motivo ?? ""}`.trim(),
        })
        .eq("id", doc.id);
      console.warn(`[worker] Ciência dispensada: ${doc.chave} — ${resultado.cStat} ${resultado.motivo}`);
    } else {
      console.warn(`[worker] Ciência recusada: ${doc.chave} — ${resultado.cStat} ${resultado.motivo}`);
      // Para o lote aqui: erro sistêmico — assinatura, CNPJ, certificado —
      // recusaria as seguintes pelo mesmo motivo, e insistir vira consumo
      // indevido.
      return;
    }
  }
}

module.exports = { darCienciaPendentes, manifestar, montarEvento };
