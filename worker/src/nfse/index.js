// SIS-2026-0841. Fila persistente, com certificado somente no servidor.
// A marca de envio é gravada ANTES do POST. Depois dela, inclusive se o
// processo morrer, o único caminho automático é consultar protocolo/DPS.
const zlib = require('node:zlib');
const { ErroNfse, exigir, gerarDps, identificadorDps, assinarDps, validarEsquema, descompactar, conferirNota } = require('./documento');
const { carregarConfiguracao, criarCliente } = require('./cliente');

async function rpc(supabase,nome,parametros) {
  const {data,error,status}=await supabase.rpc(nome,parametros);
  if(error) {
    const erro = new ErroNfse('FALHA_BANCO','Não foi possível registrar o processamento. A solicitação será reconciliada pela fila.');
    // Nunca preservar message/details/hint: podem conter dados e credenciais.
    erro.diagnostico = { operacao: nome, http: status,
      codigoBanco: /^(?:PGRST[0-9]{3}|[0-9A-Z]{5})$/.test(error.code || '') ? error.code : undefined };
    throw erro;
  }
  return data;
}
async function guardar(supabase,caminho,conteudo,tipo) {
  const {error}=await supabase.storage.from('nfse-integracao').upload(caminho,conteudo,{contentType:tipo,upsert:true});
  if(error) throw new ErroNfse('FALHA_ARQUIVO','Não foi possível guardar o documento oficial. O processamento será retomado sem retransmitir a DPS.');
  return caminho;
}
async function recuperarNota(s,nota,deps) {
  const xml=descompactar(nota.xmlGZipB64).toString('utf8');
  const identificacao=conferirNota(xml,s,nota.chave);
  const xmlPath=await deps.guardar('nota.xml',Buffer.from(xml),'application/xml');
  const resultado={estado:'autorizada',chave:identificacao.chave,numero_nf:identificacao.numero,xml_retorno_path:xmlPath};
  try {
    const pdf=descompactar(await deps.cliente.baixarPdf(identificacao.chave),15*1024*1024);
    exigir(pdf.subarray(0,5).toString('ascii') === '%PDF-','O provedor não retornou um PDF válido.');
    resultado.pdf_path=await deps.guardar('nota.pdf',pdf,'application/pdf');
    resultado.mensagem=`NFS-e autorizada em ${s.ambiente === 'producao' ? 'produção' : 'homologação'}. XML e PDF disponíveis.`;
  } catch {
    resultado.mensagem=`NFS-e autorizada em ${s.ambiente === 'producao' ? 'produção' : 'homologação'}. XML disponível; obtenção do PDF será retomada.`;
  }
  return resultado;
}
function conferirAmbiente(retorno, ambiente) {
  exigir(retorno.tipoAmbiente === (ambiente === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO'),`O retorno do provedor não confirma o ambiente de ${ambiente === 'producao' ? 'produção' : 'homologação'}.`);
}
async function tratarLote(s,lote,deps) {
  conferirAmbiente(lote,s.ambiente);
  if(lote.processado !== true) {
    exigir(typeof lote.protocolo === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lote.protocolo),'Retorno sem protocolo de acompanhamento válido.');
    return {estado:'aguardando',protocolo:lote.protocolo,mensagem:'Lote recebido. Aguardando processamento na prefeitura.'};
  }
  if (s.protocolo) exigir(lote.protocolo === s.protocolo, 'O retorno não corresponde ao protocolo solicitado.');
  const itens=Array.isArray(lote.lote) ? lote.lote : [];
  let item=itens.find(i => i.id === identificadorDps(s));
  // A GOVBR pode rejeitar o XML antes de ler o Id (ex.: P9022). Só aceitamos
  // esse erro sem Id no protocolo persistido, com um único item e sem nota.
  if (!item && s.protocolo && itens.length === 1 && itens[0].id == null &&
      itens[0].statusProcessamento === 'ERRO' && !itens[0].chaveAcesso && !itens[0].xmlGZipB64) item=itens[0];
  exigir(item,'O lote processado não identifica a DPS solicitada.');
  if(item.statusProcessamento === 'ERRO') {
    const mensagens=Array.isArray(item.erros) ? item.erros.slice(0,8).map(e=>`${e.codigo}: ${e.descricao}`).join(' | ') : 'Rejeição sem detalhes';
    return {estado:'rejeitada',mensagem:mensagens.slice(0,1800)};
  }
  exigir(item.statusProcessamento === 'SUCESSO','Situação de processamento desconhecida.');
  return recuperarNota(s,{chave:item.chaveAcesso,xmlGZipB64:item.xmlGZipB64},deps);
}

// Dependências explícitas permitem provar recuperação de timeout/reinício sem
// enviar documentos reais e sem usar qualquer credencial nos testes.
async function executarSolicitacao(s,deps) {
  exigir(['homologacao','producao'].includes(s.ambiente),'Ambiente fiscal inválido.');
  if(s.estado === 'autorizada') {
    const pdf=descompactar(await deps.cliente.baixarPdf(s.chave),15*1024*1024);
    exigir(pdf.subarray(0,5).toString('ascii') === '%PDF-','PDF oficial inválido.');
    return {estado:'autorizada',pdf_path:await deps.guardar('nota.pdf',pdf,'application/pdf'),mensagem:'XML e PDF oficiais disponíveis.'};
  }
  if(s.envio_iniciado_em) {
    if(s.protocolo) {
      const lote=await deps.cliente.consultarProtocolo(s.protocolo);
      if(lote) return tratarLote(s,lote,deps);
    }
    const notas=await deps.cliente.consultarDps(s.dados.empresa.cnpj,s.serie,s.numero_dps);
    if(notas.length === 1) return recuperarNota(s,notas[0],deps);
    return {estado:'incerta',mensagem:'Envio já iniciado, mas a nota ainda não foi localizada. A fila continuará consultando; não haverá retransmissão automática.'};
  }
  const xml=assinarDps(gerarDps(s),identificadorDps(s),deps.cert,deps.algoritmo);
  await deps.validarEsquema(xml);
  // Uma série já utilizada fora do ERP não pode ser adotada silenciosamente.
  const existentes=await deps.cliente.consultarDps(s.dados.empresa.cnpj,s.serie,s.numero_dps);
  exigir(existentes.length === 0,'A numeração de DPS já existe no provedor. Confirme uma série exclusiva para o ERP.');
  const xmlPath=await deps.guardar('dps.xml',Buffer.from(xml),'application/xml');
  const marcado=await deps.marcarEnvio(xmlPath);
  exigir(marcado,'A reserva expirou antes do envio. Aguarde a reconciliação da fila.');
  // Também marca o objeto em memória: uma falha daqui em diante é resultado
  // incerto, e não erro de preparação que permitiria enviar de novo.
  s.envio_iniciado_em=new Date().toISOString();
  const retorno=await deps.cliente.enviar({loteXmlGZipB64:[zlib.gzipSync(Buffer.from(xml)).toString('base64')],dadosExtras:[]});
  return tratarLote(s,retorno,deps);
}

async function processarFilaNfse(supabase, ambiente = process.env) {
  if(ambiente.NFSE_HABILITADO !== '1') return;
  const fiscal=ambiente.NFSE_AMBIENTE || 'homologacao';
  exigir(['homologacao','producao'].includes(fiscal),'Ambiente fiscal inválido.');
  if(fiscal === 'producao') exigir(ambiente.NFSE_PRODUCAO_HABILITADA === '1','Produção não habilitada no processador.');
  const trabalhos=await rpc(supabase,fiscal === 'producao' ? 'nfse_reservar_trabalho_ambiente' : 'nfse_reservar_trabalho',fiscal === 'producao' ? {_ambiente:fiscal} : undefined);
  const s=trabalhos?.[0];
  if(!s) return;
  exigir(s.ambiente === fiscal,'A fila retornou uma solicitação de outro ambiente fiscal.');
  let config;
  let resultado;
  try {
    config=carregarConfiguracao(s.dados.empresa.cnpj,s.serie,ambiente);
    if(fiscal === 'producao') exigir(config.municipio_emissor === s.dados.parametros.municipio_emissor &&
      config.inscricao_municipal === s.dados.parametros.inscricao_municipal,
      'Município e inscrição municipal divergem da configuração de produção no processador.');
    const prefixo=`${s.empresa_id}/${s.id}`;
    resultado=await executarSolicitacao(s,{
      cert:config.cert,algoritmo:config.algoritmo_assinatura,cliente:criarCliente(config),validarEsquema,
      guardar:(nome,conteudo,tipo)=>guardar(supabase,`${prefixo}/${nome}`,conteudo,tipo),
      marcarEnvio:xmlPath=>rpc(supabase,'nfse_marcar_envio',{_id:s.id,_reserva:s.reserva,_xml_path:xmlPath}),
    });
  } catch(erro) {
    const mensagem=erro instanceof ErroNfse ? erro.message : 'Falha no processamento. Confira a configuração no servidor e reconsulte a solicitação.';
    resultado={estado:s.estado === 'autorizada' ? 'autorizada' : s.envio_iniciado_em ? 'incerta' : 'erro',mensagem};
  }
  // Nem senha, caminho do certificado nem erro bruto da biblioteca saem do servidor.
  if(config?.senha) resultado.mensagem=resultado.mensagem?.replaceAll(config.senha,'[omitido]');
  if(s.tentativas >= 30 && ['aguardando','incerta','autorizada'].includes(resultado.estado) && !resultado.pdf_path) {
    resultado.mensagem=(resultado.mensagem || '')+' Limite de consultas automáticas atingido. Use Reconsultar resultado para retomar.';
  }
  const atualizado=await rpc(supabase,'nfse_registrar_resultado',{_id:s.id,_reserva:s.reserva,_resultado:resultado});
  if(!atualizado) console.warn('[nfse] Reserva expirada; o próximo ciclo reconciliará a solicitação.');
  return { aguardarConsulta: Boolean(atualizado && (['aguardando','incerta'].includes(resultado.estado) ||
    (resultado.estado === 'autorizada' && !resultado.pdf_path))) };
}
module.exports={ processarFilaNfse, executarSolicitacao, tratarLote, recuperarNota };
