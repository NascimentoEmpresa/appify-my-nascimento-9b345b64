const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { prepararArquivos, executarNoGithub } = require('../src/nfse/github-actions.js');
const pastas = [];
afterEach(() => { for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true }); });
function ambiente() {
  const pasta = mkdtempSync(join(tmpdir(), 'nfse-actions-teste-')); pastas.push(pasta);
  return { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'NascimentoEmpresa/appify-my-nascimento-9b345b64', RUNNER_TEMP: pasta,
    NFSE_SUPABASE_URL: 'https://api.exemplo.invalid', NFSE_SUPABASE_SERVICE_ROLE_KEY: 'chave-sintetica',
    NFSE_CERTIFICADO_PFX_B64: Buffer.from('arquivo-sintetico-sem-chave-privada').toString('base64'),
    NFSE_CERTIFICADO_SENHA: 'senha-sintetica', NFSE_CONFIG_JSON: JSON.stringify({ empresas: [{
      cnpj: '11222333000181', url: 'https://reformatributaria.cidade360.cloud/NFSe.Api.Teste', serie: 1041,
      homologacao_confirmada: true, serie_confirmada: true, algoritmo_assinatura: 'sha1',
      certificado_caminho: 'caminho-local-que-nao-deve-ser-usado.pfx', senha_variavel: 'OUTRA_SENHA',
    }] }),
  };
}
describe('NFS-e no GitHub Actions', () => {
  it('recusa branches, forks e secrets ausentes antes de criar o certificado', () => {
    for (const troca of [{ GITHUB_REF: 'refs/heads/eduardo' }, { GITHUB_REPOSITORY: 'outro/repo' },
      { GITHUB_ACTIONS: 'false' }, { NFSE_CERTIFICADO_SENHA: '' }]) {
      const env = { ...ambiente(), ...troca };
      assert.throws(() => prepararArquivos(env)); assert.deepEqual(readdirSync(env.RUNNER_TEMP), []);
    }
  });
  it('bloqueia produção e JSON inválido antes de criar arquivos', () => {
    for (const config of ['json-invalido', JSON.stringify({ empresas: [{
      cnpj: '11222333000181', url: 'https://webapp1-triunfo.cidade360.cloud/NFSe.Api', serie: 1041,
      homologacao_confirmada: true, serie_confirmada: true, algoritmo_assinatura: 'sha1',
    }] })]) {
      const env = { ...ambiente(), NFSE_CONFIG_JSON: config };
      assert.throws(() => prepararArquivos(env)); assert.deepEqual(readdirSync(env.RUNNER_TEMP), []);
    }
  });
  it('processa um ciclo com arquivos privados e os remove ao terminar', async () => {
    const env = ambiente(); let arquivoConfig = ''; let processados = 0; let validacoes = 0;
    await executarNoGithub(env, {
      carregarConfiguracao: () => { validacoes++; }, criarCliente: () => ({}),
      processarFilaNfse: async (_cliente, dados) => {
        processados++; arquivoConfig = dados.NFSE_CONFIG_ARQUIVO;
        const config = JSON.parse(readFileSync(arquivoConfig, 'utf8'));
        assert.equal(config.empresas[0].certificado_caminho, './certificado.pfx');
        assert.equal(config.empresas[0].senha_variavel, 'NFSE_CERTIFICADO_SENHA');
        assert.equal(readFileSync(arquivoConfig, 'utf8').includes(env.NFSE_CERTIFICADO_SENHA), false);
        assert.equal(dados.SUPABASE_SERVICE_ROLE_KEY, env.NFSE_SUPABASE_SERVICE_ROLE_KEY);
        if (process.platform !== 'win32') assert.equal(statSync(arquivoConfig).mode & 0o777, 0o600);
      },
    });
    assert.equal(validacoes, 1); assert.equal(processados, 1);
    assert.equal(existsSync(arquivoConfig), false); assert.deepEqual(readdirSync(env.RUNNER_TEMP), []);
  });
  it('remove o certificado quando a validação ou o processamento falham', async () => {
    const env = ambiente(); let processados = 0;
    const processar = async () => { processados++; throw new Error('falha-sintetica'); };
    await assert.rejects(executarNoGithub(env, { carregarConfiguracao: () => undefined, criarCliente: () => ({}), processarFilaNfse: processar }), /falha-sintetica/);
    assert.deepEqual(readdirSync(env.RUNNER_TEMP), []);
    await assert.rejects(executarNoGithub(env, { carregarConfiguracao: () => { throw new Error('certificado-sintetico-invalido'); }, processarFilaNfse: processar }), /certificado-sintetico-invalido/);
    assert.deepEqual(readdirSync(env.RUNNER_TEMP), []); assert.equal(processados, 1);
  });
});
