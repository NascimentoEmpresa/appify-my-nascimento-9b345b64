const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { prepararArquivos, executarNoGithub } = require('../src/nfse/github-actions.js');
const { processarFilaNfse } = require('../src/nfse/index.js');
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
  it('bloqueia a URL de produção no fluxo de homologação e JSON inválido', () => {
    for (const config of ['json-invalido', JSON.stringify({ empresas: [{
      cnpj: '11222333000181', url: 'https://webapp1-triunfo.cidade360.cloud/NFSe.Api', serie: 1041,
      homologacao_confirmada: true, serie_confirmada: true, algoritmo_assinatura: 'sha1',
    }] })]) {
      const env = { ...ambiente(), NFSE_CONFIG_JSON: config };
      assert.throws(() => prepararArquivos(env)); assert.deepEqual(readdirSync(env.RUNNER_TEMP), []);
    }
  });
  it('exige liberação e configuração de produção separadas do ambiente de teste', async () => {
    const env = ambiente(); env.NFSE_AMBIENTE = 'producao';
    assert.throws(() => prepararArquivos(env), /não habilitado/);
    env.NFSE_PRODUCAO_HABILITADA = '1';
    assert.throws(() => prepararArquivos(env), /Confirme/);
    env.NFSE_CONFIG_JSON = JSON.stringify({ empresas: [{
      cnpj:'11222333000181',ambiente:'producao',url:'https://webapp1-triunfo.cidade360.cloud/NFSe.Api',
      serie:4321,producao_confirmada:true,serie_confirmada:true,algoritmo_assinatura:'sha1',
      municipio_emissor:'4322004',inscricao_municipal:'100',
    }] });
    let ciclos = 0;
    await executarNoGithub(env, { carregarConfiguracao: () => undefined, criarCliente: () => ({}),
      processarFilaNfse: async (_cliente,dados) => { ciclos++; assert.equal(dados.NFSE_AMBIENTE,'producao'); assert.equal(dados.NFSE_PRODUCAO_HABILITADA,'1'); } });
    assert.equal(ciclos,1); assert.deepEqual(readdirSync(env.RUNNER_TEMP),[]);
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
  it('consulta mais uma vez após 60 segundos quando há resultado pendente, sem laço permanente', async () => {
    const env = ambiente(); const ordem = [];
    await executarNoGithub(env, {
      carregarConfiguracao: () => undefined, criarCliente: () => ({}),
      processarFilaNfse: async () => { ordem.push('ciclo'); return { aguardarConsulta: true }; },
      aguardar: async ms => { assert.equal(ms,60_000); ordem.push('aguardar'); },
    });
    assert.deepEqual(ordem, ['ciclo','aguardar','ciclo']);
    assert.deepEqual(readdirSync(env.RUNNER_TEMP), []);
  });
  it('mantém ciclos de 60 segundos com fila vazia e encerra no prazo, removendo arquivos privados', async () => {
    const env = { ...ambiente(),NFSE_ACTIONS_CONTINUO:'1',NFSE_ACTIONS_DURACAO_MIN:'3' };
    let tempo = 0; const instantes = [];
    await executarNoGithub(env, { carregarConfiguracao:()=>undefined,criarCliente:()=>({}),agora:()=>tempo,
      processarFilaNfse:async()=>{instantes.push(tempo);},
      aguardar:async ms=>{assert.equal(ms,60_000);tempo+=ms;},
    });
    assert.deepEqual(instantes,[0,60_000,120_000]);
    assert.deepEqual(readdirSync(env.RUNNER_TEMP),[]);
  });
  it('recupera falhas de infraestrutura avulsas e zera a contagem após um ciclo válido', async () => {
    const env = { ...ambiente(),NFSE_ACTIONS_CONTINUO:'1',NFSE_ACTIONS_DURACAO_MIN:'4' };
    let tempo = 0; let ciclos = 0;
    await executarNoGithub(env, { carregarConfiguracao:()=>undefined,criarCliente:()=>({}),agora:()=>tempo,
      processarFilaNfse:async()=>{ciclos++;if(ciclos!==3)throw new Error('falha-sintetica');},
      aguardar:async ms=>{tempo+=ms;},
    });
    assert.equal(ciclos,4); assert.deepEqual(readdirSync(env.RUNNER_TEMP),[]);
  });
  it('mantém tentativas até o prazo e termina com falha se a infraestrutura continuar indisponível', async t => {
    const env = { ...ambiente(),NFSE_ACTIONS_CONTINUO:'1',NFSE_ACTIONS_DURACAO_MIN:'5' };
    let tempo = 0; let ciclos = 0;
    const avisos = [];
    t.mock.method(console,'warn',mensagem=>avisos.push(mensagem));
    await assert.rejects(executarNoGithub(env, { carregarConfiguracao:()=>undefined,criarCliente:()=>({}),agora:()=>tempo,
      processarFilaNfse:async()=>{ciclos++;throw new Error('segredo-sintetico-nao-deve-sair');},
      aguardar:async ms=>{assert.equal(ms,60_000);tempo+=ms;},
    }),/Prazo.*infraestrutura/);
    assert.equal(ciclos,5); assert.deepEqual(readdirSync(env.RUNNER_TEMP),[]);
    assert.equal(avisos.join(' ').includes('segredo-sintetico'),false);
  });
  it('recupera o banco após mais de três falhas sem encerrar o processador antecipadamente', async t => {
    const env = { ...ambiente(),NFSE_ACTIONS_CONTINUO:'1',NFSE_ACTIONS_DURACAO_MIN:'7' };
    let tempo = 0; let ciclos = 0; const avisos = []; const logs = [];
    t.mock.method(console,'warn',mensagem=>avisos.push(mensagem));
    t.mock.method(console,'log',mensagem=>logs.push(mensagem));
    await executarNoGithub(env,{carregarConfiguracao:()=>undefined,criarCliente:()=>({}),agora:()=>tempo,
      processarFilaNfse:async()=>{if(++ciclos<=4)throw new Error('segredo-sintetico-nao-deve-sair');},
      aguardar:async ms=>{assert.equal(ms,60_000);tempo+=ms;},
    });
    assert.equal(ciclos,7); assert.equal(avisos.length,4);
    assert.match(logs.join(' '),/restabelecido.*4/);
    assert.equal([...avisos,...logs].join(' ').includes('segredo-sintetico'),false);
    assert.deepEqual(readdirSync(env.RUNNER_TEMP),[]);
  });
  it('preserva diagnóstico seguro da RPC sem expor mensagem, URL ou detalhes retornados pelo banco', async t => {
    const banco = {rpc:async()=>({data:null,status:503,error:{code:'PGRST002',message:'senha-na-mensagem',details:'https://privado.invalid/segredo'}})};
    let erro;
    await assert.rejects(processarFilaNfse(banco,{NFSE_HABILITADO:'1'}),e=>{
      erro=e;assert.equal(e.codigo,'FALHA_BANCO');
      assert.deepEqual(e.diagnostico,{operacao:'nfse_reservar_trabalho',http:503,codigoBanco:'PGRST002'});return true;
    });
    const env = {...ambiente(),NFSE_ACTIONS_CONTINUO:'1',NFSE_ACTIONS_DURACAO_MIN:'2'};
    let tempo=0;let ciclos=0;const avisos=[];
    t.mock.method(console,'warn',mensagem=>avisos.push(mensagem));
    t.mock.method(console,'log',()=>{});
    await executarNoGithub(env,{carregarConfiguracao:()=>undefined,criarCliente:()=>({}),agora:()=>tempo,
      processarFilaNfse:async()=>{if(++ciclos===1)throw erro;},aguardar:async ms=>{tempo+=ms;},
    });
    assert.match(avisos.join(' '),/FALHA_BANCO.*503.*PGRST002/);
    assert.doesNotMatch(avisos.join(' '),/senha-na-mensagem|privado.invalid|segredo/);
    assert.deepEqual(readdirSync(env.RUNNER_TEMP),[]);
  });
  it('recusa duração maior que o teto do runner ou inválida', async () => {
    for (const duracao of ['0','341','abc','1.5']) {
      const env = { ...ambiente(),NFSE_ACTIONS_CONTINUO:'1',NFSE_ACTIONS_DURACAO_MIN:duracao };
      await assert.rejects(executarNoGithub(env,{carregarConfiguracao:()=>undefined,criarCliente:()=>({})}),/Duração/);
      assert.deepEqual(readdirSync(env.RUNNER_TEMP),[]);
    }
  });
});
