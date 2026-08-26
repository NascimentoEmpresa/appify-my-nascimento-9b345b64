// Assinatura digital de XML no padrão exigido pela SEFAZ.
//
// É aqui que integração de NF-e costuma morrer, e o motivo é chato: quando a
// assinatura sai errada a SEFAZ responde apenas "Rejeicao: Assinatura difere
// do calculado", sem dizer o que difere. Então cada detalhe abaixo é
// obrigatório, não preferência:
//
//   • Canonicalização C14N (não a exclusiva). A SEFAZ especifica
//     http://www.w3.org/TR/2001/REC-xml-c14n-20010315.
//   • Digest SHA-1 e assinatura RSA-SHA1. Sim, SHA-1 em 2026 — o manual da
//     NF-e ainda exige, e usar SHA-256 faz a nota ser rejeitada.
//   • Transforms na ordem: enveloped-signature, depois c14n.
//   • A referência aponta para o Id do `infEvento` com `#` na frente.
//   • O bloco <Signature> entra DENTRO de <evento>, como irmão de <infEvento>.
//   • KeyInfo com X509Data e o certificado em base64, sem cabeçalho PEM.
//
// A chave privada nunca toca o disco: sai do .pfx em memória via node-forge e
// vira PEM só para alimentar o assinador. Escrever esse PEM num arquivo
// temporário seria a chave da empresa sem senha em disco.

const forge = require("node-forge");
const fs = require("node:fs");
const { SignedXml } = require("xml-crypto");

/**
 * Abre o .pfx e devolve chave e certificado em PEM, em memória.
 *
 * O certificado A1 da empresa usa RC2-40-CBC, cifra legada — é por isso que o
 * worker roda com `--openssl-legacy-provider`. O node-forge lê esse formato
 * sem precisar da flag, mas o restante do processo precisa dela para o mTLS.
 */
function abrirCertificado(caminho, senha, cnpj) {
  const der = fs.readFileSync(caminho).toString("binary");
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), senha);

  const bagsChave =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] || [];
  const chave = bagsChave[0] && bagsChave[0].key;
  if (!chave) throw new Error("chave privada não encontrada no certificado");

  const bagsCert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const certs = bagsCert.map((b) => b.cert).filter(Boolean);
  if (!certs.length) throw new Error("nenhum certificado no .pfx");

  // O .pfx traz a cadeia inteira (raiz, intermediárias, folha). Quem assina é
  // o da empresa — identificado pelo CNPJ no CN. Assinar com uma intermediária
  // produz XML válido que a SEFAZ recusa.
  const meu =
    certs.find((c) => {
      const cn = c.subject.getField("CN");
      return cn && cn.value.includes(cnpj);
    }) || certs[0];

  const pem = forge.pki.certificateToPem(meu);

  return {
    chavePem: forge.pki.privateKeyToPem(chave),
    certPem: pem,
    // Base64 puro, sem as linhas BEGIN/END: é o formato do X509Certificate.
    certBase64: pem
      .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
      .replace(/\s+/g, ""),
    validade: meu.validity.notAfter,
  };
}

/**
 * Assina um XML, referenciando o elemento cujo atributo Id é `idReferencia`.
 *
 * `xpath` aponta para o elemento que vai receber o <Signature> como último
 * filho — em evento de NF-e é o próprio <evento>.
 */
function assinarXml(xml, idReferencia, xpathDestino, cert) {
  const assinador = new SignedXml({
    privateKey: cert.chavePem,
    publicCert: cert.certPem,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  });

  assinador.addReference({
    xpath: `//*[@Id='${idReferencia}']`,
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
    // A SEFAZ exige a URI com `#`; sem ela a referência fica vazia e o digest
    // é calculado sobre o documento inteiro.
    uri: `#${idReferencia}`,
  });

  // A SEFAZ valida o certificado que veio no XML contra o que assinou. Sem
  // KeyInfo, a resposta é "Certificado nao informado".
  assinador.getKeyInfoContent = () =>
    `<X509Data><X509Certificate>${cert.certBase64}</X509Certificate></X509Data>`;

  assinador.computeSignature(xml, {
    location: { reference: xpathDestino, action: "append" },
  });

  return assinador.getSignedXml();
}

module.exports = { abrirCertificado, assinarXml };
