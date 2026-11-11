// Executa somente a fila NFS-e durante a homologação assistida.
// O worker completo continua usando processarFilaNfse no seu ciclo habitual.
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { processarFilaNfse } = require('./index');

async function iniciar() {
  if (process.env.NFSE_HABILITADO !== '1' || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[nfse] Configure e habilite a integração no ambiente privado do worker.');
    process.exitCode = 1;
    return;
  }
  const { supabase } = require('../supabaseClient');
  const pastaEstado = path.resolve(__dirname, '../../state');
  fs.mkdirSync(pastaEstado, { recursive: true });
  do {
    let status = 'ativo';
    try { await processarFilaNfse(supabase); }
    catch { status = 'falha'; console.error('[nfse] Falha no ciclo; consulte a configuração e o estado da solicitação.'); }
    fs.writeFileSync(path.join(pastaEstado, 'nfse-status.json'), JSON.stringify({ pid: process.pid, ambiente: process.env.NFSE_AMBIENTE || 'homologacao', atualizadoEm: new Date().toISOString(), status }));
    if (process.argv.includes('--uma-vez')) { process.exitCode = status === 'ativo' ? 0 : 1; break; }
    await new Promise(resolve => setTimeout(resolve, 60_000));
  } while (true);
}
if (require.main === module) iniciar().catch(() => { console.error('[nfse] Não foi possível iniciar o processador.'); process.exitCode = 1; });
module.exports = { iniciar };
