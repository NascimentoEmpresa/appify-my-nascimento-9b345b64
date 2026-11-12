import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const documento = require("../../worker/src/nfse/documento.js");
const { validarUrlHomologacao, criarCliente } = require("../../worker/src/nfse/cliente.js");
const { executarSolicitacao, tratarLote } = require("../../worker/src/nfse/index.js");
const forge = require("../../worker/node_modules/node-forge");
const { SignedXml } = require("../../worker/node_modules/xml-crypto");
const CNPJ = "11222333000181";
const pasta = mkdtempSync(join(tmpdir(), "nfse-test-"));
const arquivo = join(pasta, "certificado-teste.pfx");
let cert: { certPem: string; chavePem: string; cadeiaPem: string };

function solicitacao() {
  return {
    id: "11111111-1111-4111-8111-111111111111", empresa_id: "22222222-2222-4222-8222-222222222222",
    ambiente: "homologacao", estado: "processando", serie: 123, numero_dps: 42,
    criado_em: "2026-11-10T10:00:00Z", envio_iniciado_em: null as string | null, protocolo: null as string | null,
    chave: null as string | null,
    dados: {
      empresa: { cnpj: CNPJ, razao_social: "EMPRESA DE TESTES" },
      nota: { competencia: "2026-10-01", descricao: "Serviço de teste", vlr_bruto_total: 100,
        vlr_liquido_total: 82.2, issqn_total: 2, inss_total: 11, ir_total: 4.8, pis_total: 0, cofins_total: 0, csll_total: 0 },
      parametros: {
        serie: "123", municipio_emissor: "4322004", inscricao_municipal: "100", opcao_simples: "1", regime_especial: "0", regime_apuracao: "",
        local_prestacao: "4314902", codigo_tributacao: "071002", codigo_municipal: "", codigo_nbs: "118031000", descricao: "Limpeza & conservação <teste>",
        iss_retido: "2", aliquota_iss: "2.00", cst_pis_cofins: "01", retencao_pis_cofins: "3", ibs_cst: "000", ibs_classificacao: "000001", ibs_indicador_operacao: "100301",
        consumidor_final: "0", tipo_operacao: "", tipo_ente_governamental: "", tributos_aproximados_federais: "0", tributos_aproximados_estaduais: "0", tributos_aproximados_municipais: "2",
        confirmacao_fiscal: true, confirmacao_producao: false,
        informar_imovel: false, imovel: { cep: "", logradouro: "", numero: "", bairro: "", complemento: "", inscricao: "" },
        tomador: { documento: "98765432000198", nome: "TOMADOR DE TESTES", municipio: "4314902", cep: "90000000", logradouro: "Rua de teste", numero: "1", bairro: "Centro", complemento: "", email: "" },
      },
    },
  };
}
function dependencias() {
  return {
    cert, algoritmo: "sha1", validarEsquema: documento.validarEsquema,
    guardar: vi.fn(async (nome: string) => `pasta/${nome}`), marcarEnvio: vi.fn(async () => true),
    cliente: {
      consultarDps: vi.fn(async () => []),
      enviar: vi.fn(async () => ({ tipoAmbiente: "HOMOLOGACAO", processado: false, protocolo: "33333333-3333-4333-8333-333333333333" })),
      consultarProtocolo: vi.fn(async () => null), baixarPdf: vi.fn(async () => gzipSync(Buffer.from("%PDF-1.7 teste")).toString("base64")),
    },
  };
}
function retornoXml(s = solicitacao(), alteracoes: { cnpj?: string; liquido?: string; ambiente?: string } = {}) {
  const chave = "4".repeat(50);
  const dps = documento.gerarDps(s).replace(/<\?xml[^>]*>/, "").replace(/<tpAmb>[12]<\/tpAmb>/, `<tpAmb>${alteracoes.ambiente ?? (s.ambiente === "producao" ? "1" : "2")}</tpAmb>`);
  return {
    chave,
    xmlGZipB64: gzipSync(Buffer.from(`<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${chave}"><nNFSe>900</nNFSe><emit><CNPJ>${alteracoes.cnpj ?? CNPJ}</CNPJ></emit><valores><vLiq>${alteracoes.liquido ?? "82.20"}</vLiq></valores>${dps}</infNFSe></NFSe>`)).toString("base64"),
  };
}

beforeAll(() => {
  const par = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const chave = forge.pki.privateKeyFromPem(par.privateKey.export({ format: "pem", type: "pkcs1" }).toString());
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = forge.pki.publicKeyFromPem(par.publicKey.export({ format: "pem", type: "spki" }).toString());
  certificado.serialNumber = "01";
  certificado.validity.notBefore = new Date("2020-01-01"); certificado.validity.notAfter = new Date("2099-01-01");
  certificado.setSubject([{ name: "commonName", value: `EMPRESA DE TESTES:${CNPJ}` }]);
  certificado.setIssuer([{ name: "commonName", value: "AC DE TESTES" }]);
  certificado.sign(chave, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(chave, [certificado], "senha-sintetica", { algorithm: "3des" });
  writeFileSync(arquivo, Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"));
  cert = documento.abrirCertificado(arquivo, "senha-sintetica", CNPJ);
});
afterAll(() => { unlinkSync(arquivo); rmdirSync(pasta); });

describe("NFS-e: documento fiscal e certificado", () => {
  it("gera e confere produção separadamente, recusando retorno de homologação", async () => {
    const s = solicitacao(); s.ambiente = "producao";
    expect(() => documento.gerarDps(s)).toThrow(/nota fiscal real/);
    s.dados.parametros.confirmacao_producao = true;
    const xml = documento.gerarDps(s);
    expect(xml).toContain("<tpAmb>1</tpAmb>");
    await documento.validarEsquema(documento.assinarDps(xml, documento.identificadorDps(s), cert, "sha1"));
    const nota = retornoXml(s);
    expect(documento.conferirNota(documento.descompactar(nota.xmlGZipB64).toString(), s, nota.chave).numero).toBe("900");
    const outro = retornoXml(s, { ambiente: "2" });
    expect(() => documento.conferirNota(documento.descompactar(outro.xmlGZipB64).toString(), s, outro.chave)).toThrow(/outro ambiente/);
    await expect(tratarLote(s, { tipoAmbiente: "HOMOLOGACAO", processado: false }, dependencias())).rejects.toThrow(/produção/);
  });
  it("monta a identificação da DPS e passa no XSD oficial antes e depois da assinatura", async () => {
    const s = solicitacao();
    const xml = documento.gerarDps(s);
    expect(documento.identificadorDps(s)).toBe(`DPS43220042${CNPJ}00123000000000000042`);
    expect(xml).toContain("Limpeza &amp; conservação &lt;teste&gt;");
    await documento.validarEsquema(xml);
    for (const algoritmo of ["sha1", "sha256"]) {
      const assinado = documento.assinarDps(xml, documento.identificadorDps(s), cert, algoritmo);
      await documento.validarEsquema(assinado);
      const doc = documento.lerXml(assinado);
      const verificador = new SignedXml({ publicCert: cert.certPem, getCertFromKeyInfo: () => null });
      verificador.loadSignature(documento.elementos(doc, "Signature")[0]);
      expect(verificador.checkSignature(assinado)).toBe(true);
    }
  });
  it("impede certificado de outra empresa, vencido ou com senha incorreta sem expor o segredo", () => {
    expect(() => documento.abrirCertificado(arquivo, "senha-sintetica", "99999999000199")).toThrow(/CNPJ/);
    expect(() => documento.abrirCertificado(arquivo, "senha-sintetica", CNPJ, new Date("2100-01-01"))).toThrow(/validade/);
    expect(() => documento.abrirCertificado(arquivo, "senha-incorreta", CNPJ)).toThrow(/arquivo e a senha/);
  });
  it("remove quebras dos textos antes de assinar, preserva valores e mantém a assinatura válida", async () => {
    const s = solicitacao();
    s.dados.parametros.descricao = "Limpeza & conservação\r\nCompetência: 10/2026\nValor: R$ 100,00\rFim\tOK";
    const assinado = documento.assinarDps(documento.gerarDps(s), documento.identificadorDps(s), cert, "sha1");
    expect(assinado).not.toMatch(/[\r\n\t]/);
    expect(assinado).toContain("Limpeza &amp; conservação Competência: 10/2026 Valor: R$ 100,00 Fim OK");
    expect(assinado).toContain("<vServ>100.00</vServ>");
    expect(s.dados.parametros.descricao).toContain("\r\n");
    await documento.validarEsquema(assinado);
    const verificador = new SignedXml({ publicCert: cert.certPem, getCertFromKeyInfo: () => null });
    verificador.loadSignature(documento.elementos(documento.lerXml(assinado), "Signature")[0]);
    expect(verificador.checkSignature(assinado)).toBe(true);
  });
  it("impede envio com líquido inconsistente, revisão ausente e dados incompatíveis com o XSD", async () => {
    const s = solicitacao(); s.dados.nota.vlr_liquido_total = 99;
    expect(() => documento.gerarDps(s)).toThrow(/líquido salvo/);
    const semConfirmacao = solicitacao(); semConfirmacao.dados.parametros.confirmacao_fiscal = false;
    expect(() => documento.gerarDps(semConfirmacao)).toThrow(/revisão/);
    const invalida = documento.gerarDps(solicitacao()).replace("<cTribNac>071002", "<cTribNac>123");
    await expect(documento.validarEsquema(invalida)).rejects.toThrow(/esquema oficial/);
  });
  it("detalha PIS/COFINS e agrupa as contribuições retidas conforme o líquido validado na GOVBR", async () => {
    const s = solicitacao();
    Object.assign(s.dados.nota, { pis_total: 0.65, cofins_total: 3, csll_total: 1, vlr_liquido_total: 77.55 });
    const xml = documento.gerarDps(s);
    expect(xml).toContain("<vPis>0.65</vPis>"); expect(xml).toContain("<vCofins>3.00</vCofins>"); expect(xml).toContain("<vRetCSLL>4.65</vRetCSLL>");
    expect(s.dados.nota.csll_total).toBe(1);
    await documento.validarEsquema(xml);
    s.dados.parametros.retencao_pis_cofins = "4";
    expect(() => documento.gerarDps(s)).toThrow(/CSLL retida/);
  });
  it("exige e valida o imóvel para a operação imobiliária de limpeza observada na homologação", async () => {
    const s = solicitacao(); s.dados.parametros.ibs_indicador_operacao = "020201";
    expect(() => documento.gerarDps(s)).toThrow(/imóvel/);
    s.dados.parametros.informar_imovel = true;
    s.dados.parametros.imovel = { cep: "90000000", logradouro: "Rua de teste", numero: "1", bairro: "Centro", complemento: "Sala de teste", inscricao: "" };
    const xml = documento.gerarDps(s);
    expect(xml).toContain("<imovel><end><CEP>90000000</CEP>");
    await documento.validarEsquema(xml);
  });
  it("envia o código da prefeitura em cIntContrib sem confundir com cTribMun e passa no XSD assinado", async () => {
    for (const codigo of ["7830200", "8111700", "8630502"]) {
      const s = solicitacao();
      const p = s.dados.parametros as typeof s.dados.parametros & { codigo_integracao_municipal?: string };
      p.codigo_tributacao = "170501"; p.codigo_municipal = "123"; p.codigo_integracao_municipal = codigo;
      const xml = documento.gerarDps(s);
      expect(xml).toContain(`<cTribMun>123</cTribMun>`);
      expect(xml).toContain(`<cNBS>118031000</cNBS><cIntContrib>${codigo}</cIntContrib>`);
      await documento.validarEsquema(documento.assinarDps(xml, documento.identificadorDps(s), cert, "sha1"));
    }
    expect(documento.gerarDps(solicitacao())).not.toContain("<cIntContrib>");
  });
  it("bloqueia serviço ambíguo em produção antes de enviar e recusa código fora do esquema", async () => {
    const s = solicitacao(); s.ambiente = "producao"; s.dados.parametros.confirmacao_producao = true;
    s.dados.parametros.codigo_tributacao = "170501";
    const deps = dependencias();
    await expect(executarSolicitacao(s, deps)).rejects.toThrow(/Código do serviço na prefeitura/);
    expect(deps.marcarEnvio).not.toHaveBeenCalled(); expect(deps.cliente.enviar).not.toHaveBeenCalled();
    const p = s.dados.parametros as typeof s.dados.parametros & { codigo_integracao_municipal?: string };
    for (const invalido of ["x".repeat(21), "8111700<"]){
      p.codigo_integracao_municipal = invalido;
      expect(() => documento.gerarDps(s)).toThrow(/Código do serviço na prefeitura inválido/);
    }
    p.codigo_integracao_municipal = "8111700";
    await documento.validarEsquema(documento.gerarDps(s));
  });
  it("continua consultando o retorno de uma DPS antiga já enviada sem o código municipal", async () => {
    const s = solicitacao(); s.ambiente = "producao"; s.dados.parametros.confirmacao_producao = true;
    s.dados.parametros.codigo_tributacao = "170501"; s.envio_iniciado_em = "2026-11-11T18:05:00Z";
    s.protocolo = "33333333-3333-4333-8333-333333333333";
    const deps = dependencias();
    deps.cliente.consultarProtocolo.mockResolvedValue({tipoAmbiente:"PRODUCAO",processado:true,protocolo:s.protocolo,lote:[{
      id:documento.identificadorDps(s),statusProcessamento:"ERRO",erros:[{codigo:"P5006",descricao:"Informe o código municipal"}],
    }]} as never);
    expect(await executarSolicitacao(s,deps)).toEqual({estado:"rejeitada",mensagem:"P5006: Informe o código municipal"});
    expect(deps.cliente.enviar).not.toHaveBeenCalled();
  });
  it("omite pAliq no cenário local não optante de Triunfo, preservando valores e assinatura", async () => {
    const s = solicitacao(); s.ambiente = "producao";
    Object.assign(s.dados.parametros,{confirmacao_producao:true,codigo_tributacao:"170501",codigo_integracao_municipal:"8111700",aliquota_iss:"5.00",local_prestacao:"4322004"});
    s.dados.parametros.tomador.municipio = "4322004";
    Object.assign(s.dados.nota,{vlr_bruto_total:1500,issqn_total:75,inss_total:165,ir_total:72,vlr_liquido_total:1188});
    const antes = JSON.stringify(s);
    const xml = documento.gerarDps(s);
    expect(xml).not.toContain("<pAliq>");
    expect(xml).toContain("<tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>2</tpRetISSQN></tribMun>");
    expect(xml).toContain("<vRetCP>165.00</vRetCP><vRetIRRF>72.00</vRetIRRF>");
    const assinado = documento.assinarDps(xml,documento.identificadorDps(s),cert,"sha1");
    await documento.validarEsquema(assinado);
    const verificador = new SignedXml({publicCert:cert.certPem,getCertFromKeyInfo:()=>null});
    verificador.loadSignature(documento.elementos(documento.lerXml(assinado),"Signature")[0]);
    expect(verificador.checkSignature(assinado)).toBe(true);
    expect(JSON.stringify(s)).toBe(antes);
    const retorno = retornoXml(s,{liquido:"1188.00"});
    expect(documento.conferirNota(documento.descompactar(retorno.xmlGZipB64).toString(),s,retorno.chave).numero).toBe("900");
    const divergente = retornoXml(s,{liquido:"1200.00"});
    expect(()=>documento.conferirNota(documento.descompactar(divergente.xmlGZipB64).toString(),s,divergente.chave)).toThrow(/líquido retornado diverge/);
  });
  it("preserva pAliq em homologação, fora do cenário local e no Simples Nacional", async () => {
    for (const caso of ["homologacao","prestacao_fora","tomador_fora","simples"]) {
      const s = solicitacao(); s.ambiente = caso === "homologacao" ? "homologacao" : "producao";
      Object.assign(s.dados.parametros,{confirmacao_producao:true,local_prestacao:"4322004"});
      s.dados.parametros.tomador.municipio = "4322004";
      if(caso === "prestacao_fora")s.dados.parametros.local_prestacao="4314902";
      if(caso === "tomador_fora")s.dados.parametros.tomador.municipio="4314902";
      if(caso === "simples")Object.assign(s.dados.parametros,{opcao_simples:"3",regime_apuracao:"1"});
      const xml = documento.gerarDps(s);
      expect(xml).toContain("<pAliq>2.00</pAliq>");
      await documento.validarEsquema(xml);
    }
  });
  it("recusa XML com entidade externa, CNPJ divergente, ambiente real e líquido diferente", () => {
    expect(() => documento.lerXml('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///segredo">]><x/>')).toThrow(/XML/);
    for (const alteracoes of [{ cnpj: "99999999000199" }, { liquido: "90.00" }, { ambiente: "1" }]) {
      const nota = retornoXml(solicitacao(), alteracoes);
      expect(() => documento.conferirNota(documento.descompactar(nota.xmlGZipB64).toString(), solicitacao(), nota.chave)).toThrow();
    }
  });
  it("bloqueia URL de produção, redirecionamento para terceiros e parâmetros no endereço", () => {
    expect(validarUrlHomologacao("https://reformatributaria.cidade360.cloud/NFSe.Api.Teste").pathname).toBe("/NFSe.Api.Teste");
    for (const url of ["https://webapp1-triunfo.cidade360.cloud/NFSe.Api", "http://reformatributaria.cidade360.cloud/NFSe.Api.Teste", "https://localhost/NFSe.Api.Teste", "https://reformatributaria.cidade360.cloud/NFSe.Api.Teste?x=1"]) expect(() => validarUrlHomologacao(url)).toThrow();
  });
  it("trata ausência de nota em texto simples sem confundir erro de certificado com ausência de DPS", async () => {
    const transporte = (mensagem: string) => (_opcoes: unknown, receber: (resposta: EventEmitter & { statusCode: number }) => void) => {
      const req = Object.assign(new EventEmitter(), { setTimeout: () => undefined, destroy: () => undefined, end: () => {
        queueMicrotask(() => { const res = Object.assign(new EventEmitter(), { statusCode: 406 }); receber(res); res.emit("data", Buffer.from(mensagem)); res.emit("end"); });
      } });
      return req;
    };
    const config = { url: "https://reformatributaria.cidade360.cloud/NFSe.Api.Teste", cert };
    const ausente = criarCliente(config, transporte("Nota fiscal não encontrada com os dados de DPS informados"));
    expect(await ausente.consultarDps(CNPJ, 123, 42)).toEqual([]);
    const recusado = criarCliente(config, transporte("Certificado não encontrado"));
    await expect(recusado.consultarDps(CNPJ, 123, 42)).rejects.toThrow(/credenciamento/);
  });
});

describe("NFS-e: recuperação sem emissão duplicada", () => {
  it("grava a marca de envio antes do POST e, após timeout/reinício, apenas consulta", async () => {
    const s = solicitacao(); const deps = dependencias(); const ordem: string[] = [];
    deps.marcarEnvio.mockImplementation(async () => { ordem.push("marca"); return true; });
    deps.cliente.enviar.mockImplementation(async () => { ordem.push("POST"); throw new Error("timeout"); });
    await expect(executarSolicitacao(s, deps)).rejects.toThrow("timeout");
    expect(ordem).toEqual(["marca", "POST"]); expect(s.envio_iniciado_em).not.toBeNull();
    const novaRodada = dependencias();
    const resultado = await executarSolicitacao(s, novaRodada);
    expect(resultado.estado).toBe("incerta"); expect(novaRodada.cliente.enviar).not.toHaveBeenCalled();
    expect(novaRodada.cliente.consultarDps).toHaveBeenCalledOnce();
  });
  it("não transmite quando a reserva expira ou a numeração já existe no provedor", async () => {
    const deps = dependencias(); deps.marcarEnvio.mockResolvedValue(false);
    await expect(executarSolicitacao(solicitacao(), deps)).rejects.toThrow(/reserva/);
    expect(deps.cliente.enviar).not.toHaveBeenCalled();
    const repetida = dependencias(); repetida.cliente.consultarDps.mockResolvedValue([retornoXml()] as never[]);
    await expect(executarSolicitacao(solicitacao(), repetida)).rejects.toThrow(/numeração/);
    expect(repetida.cliente.enviar).not.toHaveBeenCalled();
  });
  it("mantém autorização e XML se o PDF falhar; recupera o PDF sem transmitir novamente", async () => {
    const s = solicitacao(); s.envio_iniciado_em = "2026-11-10T10:00:00Z";
    const deps = dependencias(); deps.cliente.consultarDps.mockResolvedValue([retornoXml(s)] as never[]);
    deps.cliente.baixarPdf.mockRejectedValue(new Error("indisponível"));
    const resultado = await executarSolicitacao(s, deps);
    expect(resultado.estado).toBe("autorizada"); expect(resultado.xml_retorno_path).toBe("pasta/nota.xml"); expect(resultado.pdf_path).toBeUndefined();
    s.estado = "autorizada"; s.chave = resultado.chave;
    const retomada = dependencias(); const concluida = await executarSolicitacao(s, retomada);
    expect(concluida.pdf_path).toBe("pasta/nota.pdf"); expect(retomada.cliente.enviar).not.toHaveBeenCalled();
  });
  it("interpreta rejeição fiscal por DPS, não apenas o sucesso HTTP do lote", async () => {
    const s = solicitacao();
    const resultado = await tratarLote(s, { tipoAmbiente: "HOMOLOGACAO", processado: true, lote: [{ id: documento.identificadorDps(s), statusProcessamento: "ERRO", erros: [{ codigo: "E001", descricao: "Cadastro inválido" }] }] }, dependencias());
    expect(resultado).toEqual({ estado: "rejeitada", mensagem: "E001: Cadastro inválido" });
    await expect(tratarLote(s, { tipoAmbiente: "PRODUCAO", processado: true }, dependencias())).rejects.toThrow(/homologação/);
  });
  it("mostra rejeição sem Id somente para o protocolo persistido de um lote unitário sem nota", async () => {
    const s = solicitacao(); s.envio_iniciado_em = "2026-11-11T16:00:00Z";
    s.protocolo = "33333333-3333-4333-8333-333333333333";
    const item = { id: null, chaveAcesso: null, xmlGZipB64: null, statusProcessamento: "ERRO", erros: [{ codigo: "P9022", descricao: "XML com quebras de linha" }] };
    const lote = { tipoAmbiente: "HOMOLOGACAO", processado: true, protocolo: s.protocolo, lote: [item] };
    expect(await tratarLote(s, lote, dependencias())).toEqual({ estado: "rejeitada", mensagem: "P9022: XML com quebras de linha" });
    for (const invalido of [
      { ...lote, protocolo: "outro-protocolo" }, { ...lote, lote: [item, item] },
      { ...lote, lote: [{ ...item, id: "outra-DPS" }] },
      { ...lote, lote: [{ ...item, chaveAcesso: "4".repeat(50) }] },
      { ...lote, lote: [{ ...item, statusProcessamento: "SUCESSO" }] },
    ]) await expect(tratarLote(s, invalido, dependencias())).rejects.toThrow();
    const semProtocolo = { ...s, protocolo: null };
    await expect(tratarLote(semProtocolo, lote, dependencias())).rejects.toThrow(/não identifica/);
    const deps = dependencias(); deps.cliente.consultarProtocolo.mockResolvedValue(lote as never);
    expect((await executarSolicitacao(s, deps)).estado).toBe("rejeitada");
    expect(deps.cliente.enviar).not.toHaveBeenCalled();
  });
});
