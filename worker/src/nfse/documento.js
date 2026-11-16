const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DOMParser } = require('@xmldom/xmldom');
const { SignedXml } = require('xml-crypto');
const { validateXML } = require('xmllint-wasm');

const NAMESPACE = 'http://www.sped.fazenda.gov.br/nfse';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const PREFIXO_DS = 'http://www.w3.org/2000/09/xmldsig#';
const FORMATO_EMISSAO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', calendar: 'gregory', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
});

class ErroNfse extends Error {
  constructor(codigo, mensagem) { super(mensagem); this.name = 'ErroNfse'; this.codigo = codigo; }
}
function exigir(condicao, mensagem) { if (!condicao) throw new ErroNfse('DADOS_INVALIDOS', mensagem); }
const digitos = valor => String(valor ?? '').replace(/[.\-/\s]/g, '');
// P9022 da GOVBR: até quebras dentro da descrição devem sair antes da assinatura.
const escapar = valor => String(valor).replace(/\r\n|[\r\n\t]/g, ' ').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const tag = (nome, valor) => `<${nome}>${escapar(valor)}</${nome}>`;
function dataHoraEmissao(valor) {
  const instante = new Date(valor);
  exigir(typeof valor === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(valor) && Number.isFinite(instante.getTime()), 'Data e hora de emissão inválidas: informe o instante com fuso horário.');
  // Compatibilidade E0008: o portal municipal usa o fuso brasileiro. Converter
  // a representação antes de assinar, preservando o instante original do banco.
  const p = Object.fromEntries(FORMATO_EMISSAO.formatToParts(instante).map(({ type, value }) => [type, value]));
  const fuso = p.timeZoneName.replace(/^GMT/, '') || '+00:00';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${fuso}`;
}
function centavos(valor) {
  exigir(valor !== null && valor !== undefined && valor !== '' && Number.isFinite(Number(valor)), 'Valor monetário ausente ou inválido.');
  const numero = Number(valor);
  exigir(numero >= 0 && numero <= 9999999999999.99, 'Valor monetário fora do intervalo permitido.');
  return Math.round((numero + Number.EPSILON) * 100);
}
const moeda = valor => (centavos(valor) / 100).toFixed(2);
function codigo(valor, tamanho, nome) {
  const resultado = digitos(valor);
  exigir(new RegExp(`^[0-9]{${tamanho}}$`).test(resultado), `Confira ${nome}.`);
  return resultado;
}
function texto(valor, maximo, nome) {
  const resultado = String(valor ?? '').trim();
  exigir(resultado.length > 0 && resultado.length <= maximo && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(resultado), `Confira ${nome}.`);
  return resultado;
}
function codigoMunicipal(valor) {
  const resultado = String(valor ?? '').trim();
  // Preparações antigas usam '-' como ausência deste campo opcional.
  if (resultado === '-') return '';
  exigir(!resultado || /^[0-9]{3}$/.test(resultado), 'Confira o código municipal do serviço: informe três dígitos ou deixe o campo vazio. O código de integração da prefeitura é informado separadamente.');
  return resultado;
}
function validarSolicitacao(s) {
  exigir(['homologacao','producao'].includes(s.ambiente), 'Ambiente fiscal inválido.');
  const p = s.dados?.parametros;
  const n = s.dados?.nota;
  exigir(p && n && p.confirmacao_fiscal === true, 'Confirme a revisão dos dados fiscais antes de solicitar.');
  if (s.ambiente === 'producao') exigir(p.confirmacao_producao === true, 'Confirme a emissão de uma nota fiscal real.');
  const cnpj = codigo(s.dados.empresa?.cnpj, 14, 'o CNPJ do prestador');
  exigir(Number.isSafeInteger(Number(s.numero_dps)) && Number(s.numero_dps) > 0 && Number(s.numero_dps) <= 999999999999999, 'Número de DPS inválido.');
  exigir(Number.isInteger(Number(s.serie)) && Number(s.serie) >= 1 && Number(s.serie) <= 49999, 'Série inválida.');
  // O mês interno da preparação pode usar dia 01. A escolha fiscal é salva
  // nos parâmetros; pedidos antigos continuam com a data do snapshot original.
  const competencia = String(p.data_competencia ?? n.competencia ?? '');
  exigir(/^\d{4}-\d{2}-\d{2}$/.test(competencia) && !Number.isNaN(Date.parse(competencia)) && new Date(competencia).toISOString().slice(0,10) === competencia, 'Data de competência inválida.');
  codigo(p.municipio_emissor, 7, 'o município emissor');
  codigo(p.local_prestacao, 7, 'o local da prestação');
  codigo(p.codigo_tributacao, 6, 'o código nacional do serviço');
  codigo(p.codigo_nbs, 9, 'a NBS');
  codigoMunicipal(p.codigo_municipal);
  const integracaoMunicipal = String(p.codigo_integracao_municipal ?? '').trim();
  exigir(!integracaoMunicipal || /^[a-zA-Z0-9]{1,20}$/.test(integracaoMunicipal), 'Código do serviço na prefeitura inválido: use até 20 letras ou números, sem separadores.');
  if (s.ambiente === 'producao' && !s.envio_iniciado_em && digitos(p.municipio_emissor) === '4322004' && digitos(p.codigo_tributacao) === '170501') {
    exigir(integracaoMunicipal, 'Informe o Código do serviço na prefeitura para o serviço 170501 de Triunfo. Confirme o código usado no portal com o responsável fiscal.');
  }
  texto(p.inscricao_municipal, 15, 'a inscrição municipal');
  texto(p.descricao || n.descricao, 2000, 'a descrição do serviço');
  exigir(['1','2','3'].includes(p.opcao_simples), 'Informe a opção pelo Simples Nacional.');
  exigir(/^\d$/.test(p.regime_especial ?? ''), 'Informe o regime especial.');
  if (p.opcao_simples === '3') exigir(['1','2','3'].includes(p.regime_apuracao), 'Informe o regime de apuração do Simples Nacional.');
  exigir(['1','2'].includes(p.iss_retido), 'O piloto aceita ISS não retido ou retido pelo tomador, sem intermediário.');
  exigir(Number.isFinite(Number(p.aliquota_iss)) && Number(p.aliquota_iss) >= 0 && Number(p.aliquota_iss) <= 5, 'Alíquota de ISS inválida.');
  const t = p.tomador || {};
  const inscricaoTomador = String(t.inscricao_municipal ?? '').trim();
  exigir(inscricaoTomador.length <= 15 && ![...inscricaoTomador].some(caractere => caractere.charCodeAt(0) < 32), 'Confira a inscrição municipal do tomador (até 15 caracteres válidos).');
  exigir(/^(\d{11}|\d{14})$/.test(digitos(t.documento)), 'Informe CPF/CNPJ do tomador.');
  texto(t.nome, 150, 'o nome do tomador'); codigo(t.municipio, 7, 'o município do tomador'); codigo(t.cep, 8, 'o CEP do tomador');
  texto(t.logradouro, 255, 'o logradouro do tomador'); texto(t.numero, 60, 'o número do endereço'); texto(t.bairro, 60, 'o bairro do tomador');
  const bruto = centavos(n.vlr_bruto_total);
  exigir(bruto > 0, 'O valor dos serviços deve ser positivo.');
  const retencoes = ['issqn_total','inss_total','ir_total','pis_total','cofins_total','csll_total'].map(c => centavos(n[c]));
  exigir(Math.abs(bruto - retencoes.reduce((a,b) => a+b,0) - centavos(n.vlr_liquido_total)) <= 2, 'O líquido salvo não confere com as retenções. Revise a preparação.');
  if (p.iss_retido === '1') exigir(retencoes[0] === 0, 'A preparação desconta ISS, mas o formulário informa ISS não retido.');
  else exigir(Math.abs(Math.round(bruto * Number(p.aliquota_iss) / 100) - retencoes[0]) <= 1, 'A alíquota e a base de ISS não conferem com a retenção salva.');
  if (retencoes[3] > 0 || retencoes[4] > 0) {
    exigir(['1','3','4'].includes(p.retencao_pis_cofins), 'Confirme a retenção de PIS/COFINS.');
    exigir(retencoes[5] === 0 || p.retencao_pis_cofins === '3', 'Há CSLL retida na preparação. Informe PIS/COFINS/CSLL retidos.');
    codigo(p.cst_pis_cofins, 2, 'o CST de PIS/COFINS');
  }
  codigo(p.ibs_cst, 3, 'o CST de IBS/CBS'); codigo(p.ibs_classificacao, 6, 'a classificação tributária de IBS/CBS'); codigo(p.ibs_indicador_operacao, 6, 'o indicador da operação de IBS/CBS');
  // Regra E0932 observada no ambiente GOVBR: operações imobiliárias com
  // determinados serviços exigem o imóvel da prestação, inclusive limpeza.
  const dispensadosImovel = ['070201','070202','070401','070501','070502','070601','070602','070701','070801','071701','071901'];
  const exigeImovel = ['020101','020201','020301'].includes(p.ibs_indicador_operacao) && !dispensadosImovel.includes(digitos(p.codigo_tributacao));
  exigir(!exigeImovel || p.informar_imovel === true, 'A operação informada exige o imóvel da prestação. Informe seu endereço no grupo IBS/CBS.');
  if (p.informar_imovel) {
    const imovel = p.imovel || {};
    codigo(imovel.cep, 8, 'o CEP do imóvel'); texto(imovel.logradouro, 255, 'o logradouro do imóvel');
    texto(imovel.numero, 60, 'o número do imóvel'); texto(imovel.bairro, 60, 'o bairro do imóvel');
  }
  exigir(['0','1'].includes(p.consumidor_final), 'Informe o indicador de consumidor final.');
  for (const campo of ['tributos_aproximados_federais','tributos_aproximados_estaduais','tributos_aproximados_municipais']) centavos(p[campo]);
  return { p, n, cnpj, competencia };
}

function identificadorDps(s) {
  const { p, cnpj } = validarSolicitacao(s);
  return `DPS${digitos(p.municipio_emissor)}2${cnpj}${String(s.serie).padStart(5,'0')}${String(s.numero_dps).padStart(15,'0')}`;
}
function gerarDps(s) {
  const { p, n, cnpj, competencia } = validarSolicitacao(s);
  const t = p.tomador;
  const documento = digitos(t.documento);
  const identificacaoTomador = tag(documento.length === 14 ? 'CNPJ' : 'CPF',documento) +
    (String(t.inscricao_municipal ?? '').trim() ? tag('IM',String(t.inscricao_municipal).trim()) : '');
  const endereco = `<end><endNac>${tag('cMun',digitos(t.municipio))}${tag('CEP',digitos(t.cep))}</endNac>${tag('xLgr',t.logradouro.trim())}${tag('nro',t.numero.trim())}${t.complemento ? tag('xCpl',t.complemento.trim()) : ''}${tag('xBairro',t.bairro.trim())}</end>`;
  const regTrib = `<regTrib>${tag('opSimpNac',p.opcao_simples)}${p.opcao_simples === '3' ? tag('regApTribSN',p.regime_apuracao) : ''}${tag('regEspTrib',p.regime_especial)}</regTrib>`;
  const integracaoMunicipal = String(p.codigo_integracao_municipal ?? '').trim();
  const municipal = codigoMunicipal(p.codigo_municipal);
  const servico = `<serv><locPrest>${tag('cLocPrestacao',digitos(p.local_prestacao))}</locPrest><cServ>${tag('cTribNac',digitos(p.codigo_tributacao))}${municipal ? tag('cTribMun',municipal) : ''}${tag('xDescServ',p.descricao || n.descricao)}${tag('cNBS',digitos(p.codigo_nbs))}${integracaoMunicipal ? tag('cIntContrib',integracaoMunicipal) : ''}</cServ></serv>`;
  const pisCofins = centavos(n.pis_total) + centavos(n.cofins_total) > 0
    ? `<piscofins>${tag('CST',p.cst_pis_cofins)}${tag('vBCPisCofins',moeda(n.vlr_bruto_total))}${tag('pAliqPis',(Number(n.pis_total) / Number(n.vlr_bruto_total) * 100).toFixed(2))}${tag('pAliqCofins',(Number(n.cofins_total) / Number(n.vlr_bruto_total) * 100).toFixed(2))}${tag('vPis',moeda(n.pis_total))}${tag('vCofins',moeda(n.cofins_total))}${tag('tpRetPisCofins',p.retencao_pis_cofins)}</piscofins>` : '';
  // Compatibilidade GOVBR comprovada em homologação e nos XMLs de Triunfo:
  // vRetCSLL compõe o total retido das contribuições; vPis/vCofins continuam
  // detalhados. Enviar apenas CSLL faz o provedor ignorar PIS/COFINS no líquido.
  const contribuicoesRetidas = (centavos(n.pis_total) + centavos(n.cofins_total) + centavos(n.csll_total)) / 100;
  const federais = pisCofins + [['vRetCP',n.inss_total],['vRetIRRF',n.ir_total],['vRetCSLL',contribuicoesRetidas]].filter(([,v]) => centavos(v) > 0).map(([nome,v]) => tag(nome,moeda(v))).join('');
  // P3070 GOVBR: no cenário local de Triunfo, não optante e sem regime especial,
  // a prefeitura fornece a alíquota. TribISSQN é 1 e não emitimos benefício BM.
  // Só omitimos pAliq; a taxa e as retenções salvas continuam sendo conferidas.
  const aliquotaPelaPrefeitura = s.ambiente === 'producao' && digitos(p.municipio_emissor) === '4322004' &&
    p.opcao_simples === '1' && p.regime_especial === '0' &&
    digitos(p.local_prestacao) === '4322004' && digitos(t.municipio) === '4322004';
  const aliquotaXml = aliquotaPelaPrefeitura ? '' : tag('pAliq',Number(p.aliquota_iss).toFixed(2));
  const valores = `<valores><vServPrest>${tag('vServ',moeda(n.vlr_bruto_total))}</vServPrest><trib><tribMun>${tag('tribISSQN','1')}${tag('tpRetISSQN',p.iss_retido)}${aliquotaXml}</tribMun>${federais ? `<tribFed>${federais}</tribFed>` : ''}<totTrib><vTotTrib>${tag('vTotTribFed',moeda(p.tributos_aproximados_federais))}${tag('vTotTribEst',moeda(p.tributos_aproximados_estaduais))}${tag('vTotTribMun',moeda(p.tributos_aproximados_municipais))}</vTotTrib></totTrib></trib></valores>`;
  const i = p.imovel;
  const imovel = p.informar_imovel ? `<imovel>${i.inscricao ? tag('inscImobFisc',i.inscricao) : ''}<end>${tag('CEP',digitos(i.cep))}${tag('xLgr',i.logradouro)}${tag('nro',i.numero)}${i.complemento ? tag('xCpl',i.complemento) : ''}${tag('xBairro',i.bairro)}</end></imovel>` : '';
  const ibsCbs = `<IBSCBS>${tag('finNFSe','0')}${tag('indFinal',p.consumidor_final)}${tag('cIndOp',p.ibs_indicador_operacao)}${p.tipo_operacao ? tag('tpOper',p.tipo_operacao) : ''}${p.tipo_ente_governamental ? tag('tpEnteGov',p.tipo_ente_governamental) : ''}${tag('indDest','0')}${imovel}<valores><trib><gIBSCBS>${tag('CST',p.ibs_cst)}${tag('cClassTrib',p.ibs_classificacao)}</gIBSCBS></trib></valores></IBSCBS>`;
  return `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="${NAMESPACE}" versao="1.01"><infDPS Id="${identificadorDps(s)}">${tag('tpAmb',s.ambiente === 'producao' ? '1' : '2')}${tag('dhEmi',dataHoraEmissao(s.criado_em))}${tag('verAplic','ERP-0841-1.0')}${tag('serie',s.serie)}${tag('nDPS',s.numero_dps)}${tag('dCompet',competencia)}${tag('tpEmit','1')}${tag('cLocEmi',digitos(p.municipio_emissor))}<prest>${tag('CNPJ',cnpj)}${tag('IM',p.inscricao_municipal)}${regTrib}</prest><toma>${identificacaoTomador}${tag('xNome',t.nome.trim())}${endereco}${t.email ? tag('email',t.email.trim()) : ''}</toma>${servico}${valores}${ibsCbs}</infDPS></DPS>`;
}

function abrirCertificado(caminho, senha, cnpj, agora = new Date()) {
  const forge = require('node-forge');
  try {
    const pacote = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(fs.readFileSync(caminho).toString('binary')), senha);
    const certificados = (pacote.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map(b => b.cert).filter(Boolean);
    const chaves = [forge.pki.oids.pkcs8ShroudedKeyBag,forge.pki.oids.keyBag].flatMap(oid => (pacote.getBags({ bagType: oid })[oid] || []).map(b => b.key)).filter(Boolean);
    const cert = certificados.find(c => c.subject.getField('CN')?.value.match(/\b\d{14}\b/)?.[0] === cnpj);
    exigir(cert, 'O certificado não pertence ao CNPJ da solicitação.');
    exigir(cert.validity.notBefore <= agora && cert.validity.notAfter > agora, 'Certificado fora da validade.');
    const chave = chaves.find(c => c.n.equals(cert.publicKey.n) && c.e.equals(cert.publicKey.e));
    exigir(chave, 'Chave privada correspondente não encontrada.');
    const certPem = forge.pki.certificateToPem(cert);
    const chavePem = forge.pki.privateKeyToPem(chave);
    exigir(new crypto.X509Certificate(certPem).checkPrivateKey(crypto.createPrivateKey(chavePem)), 'Chave privada não corresponde ao certificado.');
    return { certPem, chavePem, cadeiaPem: [cert,...certificados.filter(c => c !== cert)].map(c => forge.pki.certificateToPem(c)).join('\n'), validade: cert.validity.notAfter };
  } catch (erro) {
    if (erro instanceof ErroNfse) throw erro;
    throw new ErroNfse('CERTIFICADO_INVALIDO','Não foi possível abrir o certificado. Confira o arquivo e a senha configurados no servidor.');
  }
}
function assinarDps(xml, id, cert, algoritmo) {
  exigir(['sha1','sha256'].includes(algoritmo), 'Configure o algoritmo de assinatura confirmado pelo provedor.');
  // A GOVBR inclui xsd/xsi no ancestral NFSe. A C14N inclusiva herda esses
  // namespaces; declará-los antes de assinar mantém digest e SignedInfo
  // válidos tanto na DPS isolada quanto no documento municipal completo.
  const contexto = lerXml(xml);
  contexto.documentElement.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xsd', 'http://www.w3.org/2001/XMLSchema');
  contexto.documentElement.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');
  const assinador = new SignedXml({ privateKey: cert.chavePem, publicCert: cert.certPem,
    signatureAlgorithm: algoritmo === 'sha1' ? `${PREFIXO_DS}rsa-sha1` : 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', canonicalizationAlgorithm: C14N });
  assinador.addReference({ xpath: `//*[@Id='${id}']`, uri: `#${id}`, transforms: [`${PREFIXO_DS}enveloped-signature`,C14N],
    digestAlgorithm: algoritmo === 'sha1' ? `${PREFIXO_DS}sha1` : 'http://www.w3.org/2001/04/xmlenc#sha256' });
  assinador.computeSignature(contexto.toString(), { location: { reference: "/*[local-name()='DPS']", action: 'append' } });
  return assinador.getSignedXml();
}
let esquemas;
async function validarEsquema(xml) {
  // O pacote oficial de 09/02/2026 traz ^ e $ no pattern de TSSerieDPS.
  // Em XSD 1.0 essas âncoras são literais; libxml2 rejeitaria até as séries
  // dos XMLs municipais. Corrigimos somente esse pattern em memória, mantendo
  // os arquivos oficiais intactos e validando integralmente a série abaixo.
  const doc = lerXml(xml);
  exigir(/^[0-9]{1,5}$/.test(valor(doc,'serie') || ''), 'Série de DPS fora do formato permitido.');
  if (!esquemas) esquemas = ['DPS_v1.01.xsd','tiposComplexos_v1.01.xsd','tiposSimples_v1.01.xsd','xmldsig-core-schema.xsd'].map(fileName => {
    let contents = fs.readFileSync(path.join(__dirname,'esquemas',fileName),'utf8');
    if(fileName === 'tiposSimples_v1.01.xsd') contents = contents.replace('value="^0{0,4}\\d{1,5}$"','value="0{0,4}[0-9]{1,5}"');
    return {fileName,contents};
  });
  const resultado = await validateXML({ xml: [{fileName:'DPS.xml',contents:xml}], schema:[esquemas[0]], preload:esquemas.slice(1) });
  if (!resultado.valid) throw new ErroNfse('XML_INVALIDO',`DPS fora do esquema oficial: ${resultado.errors.slice(0,3).map(e => e.message).join(' ').slice(0,1500)}`);
}
function lerXml(xml) {
  exigir(typeof xml === 'string' && Buffer.byteLength(xml) <= 5 * 1024 * 1024 && !/<!DOCTYPE|<!ENTITY/i.test(xml), 'XML inválido ou fora do limite.');
  let invalido = false;
  const doc = new DOMParser({ onError: () => { invalido = true; } }).parseFromString(xml,'text/xml');
  exigir(!invalido && doc?.documentElement, 'XML inválido.');
  return doc;
}
const elementos = (no,nome) => Array.from(no.getElementsByTagName('*')).filter(n => n.localName === nome);
const valor = (no,nome) => elementos(no,nome)[0]?.textContent?.trim();
function descompactar(base64, limite = 5 * 1024 * 1024) {
  exigir(typeof base64 === 'string' && base64.length <= limite * 2, 'Arquivo de retorno ausente ou fora do limite.');
  try { return zlib.gunzipSync(Buffer.from(base64,'base64'), { maxOutputLength: limite }); }
  catch { throw new ErroNfse('RETORNO_INVALIDO','Não foi possível descompactar o documento retornado pelo provedor.'); }
}
function conferirNota(xml, s, chave) {
  const doc = lerXml(xml);
  exigir(doc.documentElement.localName === 'NFSe' && doc.documentElement.namespaceURI === NAMESPACE, 'Documento retornado não é uma NFS-e nacional.');
  const dps = elementos(doc,'DPS');
  exigir(dps.length === 1, 'Retorno sem uma única DPS identificada.');
  const info = elementos(dps[0],'infDPS')[0];
  exigir(info?.getAttribute('Id') === identificadorDps(s), 'A DPS retornada não corresponde à solicitação.');
  exigir(valor(info,'tpAmb') === (s.ambiente === 'producao' ? '1' : '2'), 'O provedor retornou um documento de outro ambiente fiscal.');
  if (s.dados.parametros.data_competencia != null) exigir(valor(info,'dCompet') === s.dados.parametros.data_competencia, 'A competência fiscal retornada diverge da data selecionada. Confira o documento oficial com a prefeitura.');
  const emit = elementos(doc,'emit')[0];
  exigir(emit && valor(emit,'CNPJ') === s.dados.empresa.cnpj, 'O CNPJ do documento retornado diverge do prestador.');
  exigir(/^\d{50}$/.test(chave) && elementos(doc,'infNFSe')[0]?.getAttribute('Id') === `NFS${chave}`, 'Chave de NFS-e inconsistente.');
  exigir(centavos(valor(info,'vServ')) === centavos(s.dados.nota.vlr_bruto_total), 'O valor do serviço retornado diverge da preparação.');
  exigir(Math.abs(centavos(valor(doc,'vLiq')) - centavos(s.dados.nota.vlr_liquido_total)) <= 2, 'O líquido retornado diverge da preparação. Revise o tratamento das retenções com o Financeiro.');
  const numero = valor(doc,'nNFSe');
  exigir(/^\d+$/.test(numero), 'Número oficial da NFS-e inválido.');
  return { numero, chave };
}

module.exports = { ErroNfse, exigir, digitos, centavos, gerarDps, identificadorDps, abrirCertificado, assinarDps, validarEsquema, lerXml, elementos, valor, descompactar, conferirNota };
