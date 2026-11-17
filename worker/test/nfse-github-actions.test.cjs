const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { prepararArquivos, executarNoGithub } = require('../src/nfse/github-actions.js');
const { processarFilaNfse } = require('../src/nfse/index.js');
const { renovarExecucao } = require('../src/nfse/renovar-actions.js');
const pastas = [];

describe('Renovação da fila no GitHub', () => {
  const agora = Date.parse('2026-11-16T16:30:00Z');
  const env = () => ({ GITHUB_ACTIONS:'true', GITHUB_REF:'refs/heads/main', GITHUB_REPOSITORY:'NascimentoEmpresa/appify-my-nascimento-9b345b64', GITHUB_RUN_ID:'123', NFSE_ACTIONS_CONTINUO:'1', NFSE_RENOVACAO_TOKEN:'token-sintetico' });
  const origem = () => ({ id:123, repository:{full_name:env().GITHUB_REPOSITORY}, head_branch:'main', path:'.github/workflows/nfse_homologacao.yml', run_started_at:'2026-11-16T10:50:00Z', conclusion:null });
  const resposta = json => ({ ok:true, json:async()=>json });
  it('solicita uma única execução contínua na main após o período longo', async () => {
    const chamadas=[];
    const r=await renovarExecucao(env(),{agora:()=>agora,fetch:async(url,opcoes)=>{chamadas.push({url,opcoes});return resposta(origem());}});
    assert.deepEqual(r,{renovada:true}); assert.equal(chamadas.length,2);
    assert.match(chamadas[1].url,/\/workflows\/nfse_homologacao.yml\/dispatches$/);
    assert.equal(chamadas[1].opcoes.method,'POST');
    assert.deepEqual(JSON.parse(chamadas[1].opcoes.body),{ref:'main',inputs:{continuo:'true'}});
    assert.equal(JSON.stringify(r).includes('token-sintetico'),false);
  });
  it('não renova diagnóstico, execução curta ou cancelada e não cria laço em falha imediata', async () => {
    for(const troca of [{run_started_at:'2026-11-16T16:29:00Z'}, {conclusion:'cancelled'}]) {
      let chamadas=0;
      const r=await renovarExecucao(env(),{agora:()=>agora,fetch:async()=>{chamadas++;return resposta({...origem(),...troca});}});
      assert.equal(r.renovada,false); assert.equal(chamadas,1);
    }
    let chamadas=0;
    const r=await renovarExecucao({...env(),NFSE_ACTIONS_CONTINUO:'0'},{fetch:async()=>{chamadas++;}});
    assert.equal(r.motivo,'diagnostico'); assert.equal(chamadas,0);
  });
  it('recusa branch, fork, token ausente e origem incorreta antes do dispatch', async () => {
    for(const troca of [{GITHUB_REF:'refs/heads/eduardo'},{GITHUB_REPOSITORY:'outro/repo'},{NFSE_RENOVACAO_TOKEN:''}]) {
      let chamadas=0;
      await assert.rejects(renovarExecucao({...env(),...troca},{fetch:async()=>{chamadas++;}}),/Contexto inválido/);
      assert.equal(chamadas,0);
    }
    for(const troca of [{head_branch:'eduardo'},{path:'.github/workflows/outro.yml'},{run_started_at:'data-invalida'}]) {
      let chamadas=0;
      await assert.rejects(renovarExecucao(env(),{agora:()=>agora,fetch:async()=>{chamadas++;return resposta({...origem(),...troca});}}));
      assert.equal(chamadas,1);
    }
  });
  it('preserva falhas HTTP sem expor resposta bruta ou token', async () => {
    for(const falharNa of [1,2]) {
      let chamadas=0;
      await assert.rejects(renovarExecucao(env(),{agora:()=>agora,fetch:async()=>++chamadas===falharNa?{ok:false,status:403,json:async()=>({token:'nao-expor'})}:resposta(origem())}),e=>/HTTP 403/.test(e.message)&&!/nao-expor|token-sintetico/.test(e.message));
      assert.equal(chamadas,falharNa);
    }
  });
});
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
  it('envia 100 notas prontas sem uma pausa por nota e consulta os resultados no ciclo seguinte', async () => {
    const env = {...ambiente(),NFSE_ACTIONS_CONTINUO:'1',NFSE_ACTIONS_DURACAO_MIN:'2'};
    let tempo=0, chamadas=0, emExecucao=0, maximoSimultaneo=0;
    const notas=Array.from({length:100},(_,id)=>({id,envios:0,consultas:0,consultarApos:Infinity,autorizada:false}));
    const pausas=[];
    await executarNoGithub(env,{
      carregarConfiguracao:()=>undefined,criarCliente:()=>({}),agora:()=>tempo,
      processarFilaNfse:async()=>{
        chamadas++; emExecucao++; maximoSimultaneo=Math.max(maximoSimultaneo,emExecucao);
        try {
          await Promise.resolve();
          const nota=notas.find(n=>n.envios===0||(!n.autorizada&&n.consultarApos<=tempo));
          if(!nota) return;
          if(nota.envios===0){nota.envios++;nota.consultarApos=tempo+60_000;}
          else {nota.consultas++;nota.autorizada=true;}
          return {processado:true,aguardarConsulta:!nota.autorizada};
        } finally {emExecucao--;}
      },
      aguardar:async ms=>{
        assert.equal(notas.filter(n=>n.envios===1).length,100);
        pausas.push(ms);tempo+=ms;
      },
    });
    assert.deepEqual(pausas,[60_000]); assert.equal(chamadas,202); assert.equal(maximoSimultaneo,1);
    assert.ok(notas.every(n=>n.envios===1&&n.consultas===1&&n.autorizada));
    assert.deepEqual(readdirSync(env.RUNNER_TEMP),[]);
  });
  it('a fila real sinaliza trabalho confirmado, inclusive erro de preparação, e reconhece fila vazia', async () => {
    for(const confirmado of [true,false]) {
      const nomes=[];
      const banco={rpc:async(nome,parametros)=>{
        nomes.push(nome);
        if(nome==='nfse_reservar_trabalho')return {data:[{id:'nota-sintetica',serie:1041,ambiente:'homologacao',estado:'processando',tentativas:1,
          reserva:'reserva-sintetica',envio_iniciado_em:null,dados:{empresa:{cnpj:'11222333000181'}}}],error:null};
        assert.equal(nome,'nfse_registrar_resultado');assert.equal(parametros._resultado.estado,'erro');
        return {data:confirmado,error:null};
      }};
      const resultado=await processarFilaNfse(banco,{NFSE_HABILITADO:'1',NFSE_CONFIG_ARQUIVO:join(tmpdir(),'nfse-config-inexistente-0841.json')});
      assert.equal(resultado.processado,confirmado);assert.equal(resultado.aguardarConsulta,false);
      assert.deepEqual(nomes,['nfse_reservar_trabalho','nfse_registrar_resultado']);
    }
    let reservas=0;
    const vazio=await processarFilaNfse({rpc:async()=>{reservas++;return {data:[],error:null};}},{NFSE_HABILITADO:'1'});
    assert.equal(vazio,undefined);assert.equal(reservas,1);
  });
  it('limita o ciclo a 200 operações sob carga contínua e preserva a pausa de 60 segundos', async () => {
    const env={...ambiente(),NFSE_ACTIONS_CONTINUO:'1',NFSE_ACTIONS_DURACAO_MIN:'2'};
    let tempo=0,operacoes=0;const pausas=[];
    await executarNoGithub(env,{carregarConfiguracao:()=>undefined,criarCliente:()=>({}),agora:()=>tempo,
      processarFilaNfse:async()=>{operacoes++;return {processado:true};},
      aguardar:async ms=>{assert.equal(operacoes,200);pausas.push(ms);tempo+=ms;},
    });
    assert.equal(operacoes,400);assert.deepEqual(pausas,[60_000]);assert.deepEqual(readdirSync(env.RUNNER_TEMP),[]);
  });
  it('confere o prazo entre operações e não reserva novas notas após o término', async () => {
    const env={...ambiente(),NFSE_ACTIONS_CONTINUO:'1',NFSE_ACTIONS_DURACAO_MIN:'1'};
    let tempo=0,operacoes=0,pausas=0;
    await executarNoGithub(env,{carregarConfiguracao:()=>undefined,criarCliente:()=>({}),agora:()=>tempo,
      processarFilaNfse:async()=>{assert.ok(tempo<60_000);operacoes++;tempo+=15_000;return {processado:true};},
      aguardar:async()=>{pausas++;},
    });
    assert.equal(operacoes,4);assert.equal(pausas,0);assert.deepEqual(readdirSync(env.RUNNER_TEMP),[]);
  });
  it('uma falha de infraestrutura interrompe a drenagem e retoma no ciclo seguinte sem expor dados', async t => {
    const env={...ambiente(),NFSE_ACTIONS_CONTINUO:'1',NFSE_ACTIONS_DURACAO_MIN:'2'};
    let tempo=0,operacoes=0;const avisos=[];
    t.mock.method(console,'warn',m=>avisos.push(m));
    await executarNoGithub(env,{carregarConfiguracao:()=>undefined,criarCliente:()=>({}),agora:()=>tempo,
      processarFilaNfse:async()=>{operacoes++;if(operacoes===2)throw new Error('segredo-sintetico');return operacoes===1||operacoes===3?{processado:true}:undefined;},
      aguardar:async ms=>{assert.equal(operacoes,2);assert.equal(ms,60_000);tempo+=ms;},
    });
    assert.equal(operacoes,4);assert.equal(avisos.length,1);assert.doesNotMatch(avisos.join(' '),/segredo-sintetico/);
    assert.deepEqual(readdirSync(env.RUNNER_TEMP),[]);
  });
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
