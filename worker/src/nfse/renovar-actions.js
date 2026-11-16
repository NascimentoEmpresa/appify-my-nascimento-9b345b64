const REPOSITORIO = 'NascimentoEmpresa/appify-my-nascimento-9b345b64';
const WORKFLOW = '.github/workflows/nfse_homologacao.yml';

async function renovarExecucao(ambiente = process.env, dependencias = {}) {
  if (ambiente.NFSE_ACTIONS_CONTINUO !== '1') return { renovada: false, motivo: 'diagnostico' };
  if (ambiente.GITHUB_ACTIONS !== 'true' || ambiente.GITHUB_REF !== 'refs/heads/main' ||
      ambiente.GITHUB_REPOSITORY !== REPOSITORIO || !/^\d+$/.test(ambiente.GITHUB_RUN_ID || '') ||
      !ambiente.NFSE_RENOVACAO_TOKEN) throw new Error('Contexto inválido para renovar a fila de NFS-e.');
  const transporte = dependencias.fetch || fetch;
  const headers = { Authorization: `Bearer ${ambiente.NFSE_RENOVACAO_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  async function requisitar(rota, opcoes = {}) {
    const r = await transporte(`https://api.github.com/repos/${REPOSITORIO}/actions/${rota}`, { ...opcoes, headers: { ...headers, ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Falha ao renovar a fila de NFS-e: HTTP ${r.status}.`);
    return r;
  }
  const r = await requisitar(`runs/${ambiente.GITHUB_RUN_ID}`);
  const execucao = await r.json();
  if (String(execucao.id) !== ambiente.GITHUB_RUN_ID || execucao.repository?.full_name !== REPOSITORIO ||
      execucao.head_branch !== 'main' || execucao.path !== WORKFLOW) throw new Error('Execução de origem inválida para renovar a fila de NFS-e.');
  if (execucao.conclusion === 'cancelled') return { renovada: false, motivo: 'cancelada' };
  const duracao = (dependencias.agora || Date.now)() - Date.parse(execucao.run_started_at);
  // Só repõe uma execução longa. Falha imediata de configuração não pode
  // criar um laço de disparos e consumir os minutos do repositório.
  if (!Number.isFinite(duracao) || duracao < 0) throw new Error('Início da execução de NFS-e inválido.');
  if (duracao < 300 * 60_000) return { renovada: false, motivo: 'execucao_curta' };
  await requisitar('workflows/nfse_homologacao.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { continuo: 'true' } }) });
  return { renovada: true };
}

if (require.main === module) renovarExecucao()
  .then(r => console.log(r.renovada ? '[nfse-actions] Próxima execução da fila solicitada.' : `[nfse-actions] Renovação dispensada: ${r.motivo}.`))
  .catch(() => { console.error('[nfse-actions] Não foi possível renovar a fila; confira a execução e o agendamento de contingência.'); process.exitCode = 1; });

module.exports = { renovarExecucao };
