import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { prepararArquivos, executarNoGithub } = require('../../worker/src/nfse/github-actions.js');
const pastas: string[] = [];
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
  it('recusa branches, forks e configurações ausentes antes de materializar o certificado', () => {
    for (const troca of [{ GITHUB_REF: 'refs/heads/eduardo' }, { GITHUB_REPOSITORY: 'outro/repo' },
      { GITHUB_ACTIONS: 'false' }, { NFSE_CERTIFICADO_SENHA: '' }]) {
      const env = { ...ambiente(), ...troca };
      expect(() => prepararArquivos(env)).toThrow();
      expect(readdirSync(env.RUNNER_TEMP)).toEqual([]);
    }
  });
  it('bloqueia produção e JSON inválido antes de criar arquivos', () => {
    for (const config of ['json-invalido', JSON.stringify({ empresas: [{
      cnpj: '11222333000181', url: 'https://webapp1-triunfo.cidade360.cloud/NFSe.Api', serie: 1041,
      homologacao_confirmada: true, serie_confirmada: true, algoritmo_assinatura: 'sha1',
    }] })]) {
      const env = { ...ambiente(), NFSE_CONFIG_JSON: config };
      expect(() => prepararArquivos(env)).toThrow();
      expect(readdirSync(env.RUNNER_TEMP)).toEqual([]);
    }
  });
  it('processa um único ciclo usando arquivos privados temporários e os remove ao terminar', async () => {
    const env = ambiente(); let pastaCertificado = '';
    const processar = vi.fn(async (_cliente, dados) => {
      pastaCertificado = dados.NFSE_CONFIG_ARQUIVO;
      const config = JSON.parse(readFileSync(pastaCertificado, 'utf8'));
      expect(config.empresas[0].certificado_caminho).toBe('./certificado.pfx');
      expect(config.empresas[0].senha_variavel).toBe('NFSE_CERTIFICADO_SENHA');
      expect(readFileSync(pastaCertificado, 'utf8')).not.toContain(env.NFSE_CERTIFICADO_SENHA);
      expect(dados.SUPABASE_SERVICE_ROLE_KEY).toBe(env.NFSE_SUPABASE_SERVICE_ROLE_KEY);
      if (process.platform !== 'win32') expect(statSync(pastaCertificado).mode & 0o777).toBe(0o600);
    });
    const validar = vi.fn();
    await executarNoGithub(env, { carregarConfiguracao: validar, criarCliente: () => ({}), processarFilaNfse: processar });
    expect(validar).toHaveBeenCalledOnce(); expect(processar).toHaveBeenCalledOnce();
    expect(existsSync(pastaCertificado)).toBe(false); expect(readdirSync(env.RUNNER_TEMP)).toEqual([]);
  });
  it('remove o certificado quando o ciclo ou a validação falham', async () => {
    const env = ambiente(); const processar = vi.fn(async () => { throw new Error('falha-sintetica'); });
    await expect(executarNoGithub(env, { carregarConfiguracao: () => undefined, criarCliente: () => ({}), processarFilaNfse: processar })).rejects.toThrow('falha-sintetica');
    expect(readdirSync(env.RUNNER_TEMP)).toEqual([]);
    await expect(executarNoGithub(env, { carregarConfiguracao: () => { throw new Error('certificado-sintetico-invalido'); }, processarFilaNfse: processar })).rejects.toThrow('certificado-sintetico-invalido');
    expect(readdirSync(env.RUNNER_TEMP)).toEqual([]); expect(processar).toHaveBeenCalledOnce();
  });
});
