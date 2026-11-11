// Um ciclo da fila NFS-e por execução do Actions, sem iniciar os outros workers.
const fs = require('node:fs');
const path = require('node:path');
const { carregarConfiguracao, validarUrlHomologacao } = require('./cliente');
const { processarFilaNfse } = require('./index');

function prepararArquivos(ambiente) {
  if (ambiente.GITHUB_ACTIONS !== 'true' || ambiente.GITHUB_REF !== 'refs/heads/main' ||
      ambiente.GITHUB_REPOSITORY !== 'NascimentoEmpresa/appify-my-nascimento-9b345b64') {
    throw new Error('A execução fiscal do Actions exige o repositório oficial e a main.');
  }
  const obrigatorios = ['RUNNER_TEMP', 'NFSE_SUPABASE_URL', 'NFSE_SUPABASE_SERVICE_ROLE_KEY',
    'NFSE_CONFIG_JSON', 'NFSE_CERTIFICADO_PFX_B64', 'NFSE_CERTIFICADO_SENHA'];
  if (obrigatorios.some(nome => !ambiente[nome])) throw new Error('Configure os secrets da homologação no GitHub.');
  let configuracao;
  try { configuracao = JSON.parse(ambiente.NFSE_CONFIG_JSON); }
  catch { throw new Error('Configuração de homologação inválida.'); }
  const empresa = configuracao?.empresas?.[0];
  if (configuracao?.empresas?.length !== 1 || !/^\d{14}$/.test(empresa?.cnpj) ||
      !Number.isInteger(empresa.serie) || empresa.serie < 1 || empresa.serie > 49999 ||
      empresa.homologacao_confirmada !== true || empresa.serie_confirmada !== true ||
      !['sha1', 'sha256'].includes(empresa.algoritmo_assinatura)) {
    throw new Error('Confirme a empresa, a série e a homologação antes de executar.');
  }
  const url = validarUrlHomologacao(empresa.url).toString();
  const base64 = ambiente.NFSE_CERTIFICADO_PFX_B64;
  if (base64.length > 65536 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('Certificado de homologação inválido.');
  }
  const base = path.resolve(ambiente.RUNNER_TEMP);
  const pasta = fs.mkdtempSync(path.join(base, 'nfse-actions-'));
  fs.chmodSync(pasta, 0o700);
  const descartar = () => {
    if (path.dirname(pasta) !== base) throw new Error('Diretório temporário inválido.');
    fs.rmSync(pasta, { recursive: true, force: true });
  };
  try {
    fs.writeFileSync(path.join(pasta, 'certificado.pfx'), Buffer.from(base64, 'base64'), { mode: 0o600 });
    const arquivoConfiguracao = path.join(pasta, 'config.json');
    fs.writeFileSync(arquivoConfiguracao, JSON.stringify({ empresas: [{
      cnpj: empresa.cnpj, url, serie: empresa.serie, homologacao_confirmada: true,
      serie_confirmada: true, algoritmo_assinatura: empresa.algoritmo_assinatura,
      certificado_caminho: './certificado.pfx', senha_variavel: 'NFSE_CERTIFICADO_SENHA',
    }] }), { mode: 0o600 });
    return { empresa, pasta, descartar, ambienteWorker: {
      NFSE_HABILITADO: '1', NFSE_CONFIG_ARQUIVO: arquivoConfiguracao,
      NFSE_CERTIFICADO_SENHA: ambiente.NFSE_CERTIFICADO_SENHA,
      SUPABASE_URL: ambiente.NFSE_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: ambiente.NFSE_SUPABASE_SERVICE_ROLE_KEY,
    } };
  } catch (erro) { descartar(); throw erro; }
}

async function executarNoGithub(ambiente = process.env, dependencias = {}) {
  const temporarios = prepararArquivos(ambiente);
  try {
    // Mesmo com a fila vazia, detecta certificado vencido, titular ou senha incorretos.
    const validar = dependencias.carregarConfiguracao || carregarConfiguracao;
    validar(temporarios.empresa.cnpj, temporarios.empresa.serie, temporarios.ambienteWorker);
    const criarCliente = dependencias.criarCliente || require('@supabase/supabase-js').createClient;
    const supabase = criarCliente(temporarios.ambienteWorker.SUPABASE_URL,
      temporarios.ambienteWorker.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    await (dependencias.processarFilaNfse || processarFilaNfse)(supabase, temporarios.ambienteWorker);
  } finally { temporarios.descartar(); }
}

if (require.main === module) executarNoGithub()
  .then(() => console.log('[nfse-actions] Ciclo de homologação concluído. Confira o resultado fiscal no ERP.'))
  .catch(() => {
    console.error('[nfse-actions] Falha no ciclo. Confira os secrets e a configuração do ambiente nfse-homologacao.');
    process.exitCode = 1;
  });
module.exports = { prepararArquivos, executarNoGithub };
