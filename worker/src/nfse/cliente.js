const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { ErroNfse, exigir, abrirCertificado } = require('./documento');

function carregarConfiguracao(cnpj, serie, ambiente = process.env) {
  exigir(ambiente.NFSE_CONFIG_ARQUIVO, 'A integração ainda não foi configurada no servidor. Solicite a habilitação à equipe de TI.');
  let configuracoes;
  try { configuracoes = JSON.parse(fs.readFileSync(ambiente.NFSE_CONFIG_ARQUIVO,'utf8')); }
  catch { throw new ErroNfse('CONFIGURACAO_INVALIDA','Não foi possível ler a configuração da integração no servidor.'); }
  const fiscal = ambiente.NFSE_AMBIENTE || 'homologacao';
  exigir(['homologacao','producao'].includes(fiscal), 'Ambiente fiscal inválido.');
  if (fiscal === 'producao') exigir(ambiente.NFSE_PRODUCAO_HABILITADA === '1', 'Produção não habilitada no processador.');
  const config = configuracoes.empresas?.find(c => c.cnpj === cnpj && (c.ambiente || 'homologacao') === fiscal);
  exigir(config, 'O certificado desta empresa ainda não está configurado no servidor.');
  exigir((fiscal === 'producao' ? config.producao_confirmada : config.homologacao_confirmada) === true && config.serie_confirmada === true,
    'O responsável pela integração deve confirmar o ambiente e a série antes de habilitar envios.');
  exigir(String(config.serie) === String(serie), 'A série informada não corresponde à série liberada no servidor.');
  exigir(['sha1','sha256'].includes(config.algoritmo_assinatura), 'Configure o algoritmo de assinatura confirmado pelo provedor.');
  const url = validarUrlFiscal(config.url, fiscal);
  const senha = ambiente[config.senha_variavel];
  exigir(typeof senha === 'string' && senha.length > 0, 'Senha do certificado ausente no servidor.');
  const cert = abrirCertificado(path.resolve(path.dirname(ambiente.NFSE_CONFIG_ARQUIVO),config.certificado_caminho),senha,cnpj);
  return { ...config, ambiente: fiscal, url, cert, senha };
}
function validarUrlFiscal(endereco, fiscal = 'homologacao') {
  let url;
  try { url = new URL(endereco); } catch { throw new ErroNfse('URL_INVALIDA','Endereço de homologação inválido.'); }
  exigir(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && (!url.port || url.port === '443'), 'Use um endereço HTTPS do provedor sem credenciais ou parâmetros.');
  exigir(['homologacao','producao'].includes(fiscal), 'Ambiente fiscal inválido.');
  if (fiscal === 'producao') exigir(url.hostname === 'webapp1-triunfo.cidade360.cloud' && /^\/NFSe\.Api\/?$/.test(url.pathname), 'Use exclusivamente a API oficial de produção de Triunfo.');
  else exigir(url.hostname.endsWith('.cidade360.cloud') && /^\/NFSe\.Api\.(Teste|Homologacao)\/?$/i.test(url.pathname),
    'O endereço de produção não pode ser utilizado como homologação.');
  url.pathname = url.pathname.replace(/\/$/,'');
  return url;
}
function validarUrlHomologacao(endereco) { return validarUrlFiscal(endereco, 'homologacao'); }
function criarCliente(config, transporte = https.request) {
  const url = validarUrlFiscal(config.url.toString(), config.ambiente || 'homologacao');
  async function requisitar(metodo, rota, dados) {
    exigir((metodo === 'POST' && rota === '/NotaNacional/EnviarAssincrono') || (metodo === 'GET' && /^\/NotaNacional\/(ConsultarProtocolo|ConsultarDPS|DownloadPDFChave)\/[0-9a-fA-F\-/]+$/.test(rota)), 'Operação não permitida no piloto.');
    const corpo = dados ? Buffer.from(JSON.stringify(dados)) : null;
    const resposta = await new Promise((resolve,reject) => {
      const req = transporte({ hostname:url.hostname, port:443, path:url.pathname+rota, method:metodo,
        key:config.cert.chavePem, cert:config.cert.cadeiaPem, rejectUnauthorized:true, minVersion:'TLSv1.2',
        headers:{Accept:'application/json', ...(corpo ? {'Content-Type':'application/json','Content-Length':corpo.length} : {})} }, res => {
        const partes=[]; let tamanho=0;
        res.on('data',parte => { tamanho+=parte.length; if(tamanho>20*1024*1024) req.destroy(new Error('limite')); else partes.push(parte); });
        res.on('error',reject);
        res.on('end',() => { const texto=Buffer.concat(partes).toString('utf8'); let json; try { json=JSON.parse(texto); } catch { json=texto; } resolve({http:res.statusCode,json}); });
      });
      req.on('error',() => reject(new ErroNfse('FALHA_CONEXAO','Falha na conexão com a prefeitura. O resultado será consultado antes de qualquer nova transmissão.')));
      req.setTimeout(20000,() => req.destroy(new Error('timeout')));
      req.end(corpo);
    });
    return resposta;
  }
  return {
    async consultarDps(cnpj,serie,numero) {
      const r=await requisitar('GET',`/NotaNacional/ConsultarDPS/${cnpj}/${serie}/${numero}`);
      if(r.http === 200 && Array.isArray(r.json?.notas)) return r.json.notas;
      const mensagem=typeof r.json === 'string' ? r.json : r.json?.message || r.json?.Message || '';
      // Não confundir "certificado não encontrado" com ausência de nota.
      // Mensagens diferentes exigem revisão antes de iniciar um POST.
      if(r.http === 406 && /^(?:a\s+)?(?:nfs-e|dps|nota(?:\s+fiscal)?)\s+n[aã]o\s+(?:foi\s+)?(?:encontrada|localizada)(?: com os dados de DPS informados)?\.?$/i.test(mensagem.trim())) return [];
      throw new ErroNfse('FALHA_CONSULTA',`A consulta de DPS retornou HTTP ${r.http}. Confirme credenciamento e configuração do ambiente.`);
    },
    async enviar(lote) {
      const r=await requisitar('POST','/NotaNacional/EnviarAssincrono',lote);
      if(r.http !== 200 || !r.json || typeof r.json !== 'object') throw new ErroNfse('ENVIO_INDETERMINADO',`O envio retornou HTTP ${r.http}. É necessário consultar o resultado; a DPS não será retransmitida automaticamente.`);
      return r.json;
    },
    async consultarProtocolo(protocolo) {
      const r=await requisitar('GET',`/NotaNacional/ConsultarProtocolo/${protocolo}`);
      if(r.http !== 200 || !r.json) return null;
      return r.json;
    },
    async baixarPdf(chave) {
      const r=await requisitar('GET',`/NotaNacional/DownloadPDFChave/${chave}`);
      if(r.http !== 200 || !r.json?.pdfGZipB64) throw new ErroNfse('PDF_PENDENTE','NFS-e localizada; o PDF ainda não pôde ser obtido.');
      return r.json.pdfGZipB64;
    },
  };
}
module.exports = { carregarConfiguracao, validarUrlHomologacao, validarUrlFiscal, criarCliente };
