// Complemento de nfse-fila.sql: usa somente o banco descartável local fixo.
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const executar = promisify(execFile);
const psql = process.env.NFSE_TESTE_PSQL || 'psql';
async function sql(comando) {
  const { stdout } = await executar(psql,['-h','127.0.0.1','-p','58441','-U','postgres','-d','nfse_0841_teste','-X','-tA','-v','ON_ERROR_STOP=1','-c',comando],{windowsHide:true});
  return stdout;
}
(async () => {
  assert.equal((await sql('SELECT current_database()')).trim(),'nfse_0841_teste');
  await sql(`INSERT INTO public.nf_emissao SELECT '66666666-6666-4666-8666-666666666666',empresa_id,status,deleted_at,competencia,descricao,NULL,vlr_bruto_total,vlr_liquido_total,issqn_total,inss_total,ir_total,pis_total,cofins_total,csll_total FROM public.nf_emissao LIMIT 1;
    UPDATE public."NFSE_SOLICITACAO" SET pdf_path='empresa/solicitacao/nota.pdf' WHERE estado='autorizada';`);
  const pedido = `BEGIN; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
    SELECT 'SOLICITACAO='||public.nfse_solicitar_homologacao('66666666-6666-4666-8666-666666666666','{"serie":"123","confirmacao_fiscal":true}'); SELECT pg_sleep(0.3); COMMIT;`;
  const resultados = await Promise.all([sql(pedido),sql(pedido)]);
  const ids=resultados.map(r=>r.match(/SOLICITACAO=([0-9a-f-]{36})/)[1]);
  assert.equal(ids[0],ids[1],'Duas transações criaram solicitações diferentes');
  assert.equal((await sql(`SELECT count(*) FROM public."NFSE_SOLICITACAO" WHERE nf_emissao_id='66666666-6666-4666-8666-666666666666'`)).trim(),'1');
  const reserva = `BEGIN; SET ROLE service_role; SELECT 'RESERVA='||id FROM public.nfse_reservar_trabalho(); SELECT pg_sleep(0.3); COMMIT;`;
  const reservas=await Promise.all([sql(reserva),sql(reserva)]);
  assert.equal(reservas.flatMap(r=>r.match(/RESERVA=[0-9a-f-]{36}/g)||[]).length,1,'Dois workers reservaram a mesma solicitação');
  console.log('OK: duas solicitações concorrentes retornaram o mesmo pedido; dois workers reservaram uma única execução.');
})().catch(erro=>{console.error(erro.message);process.exitCode=1;});
