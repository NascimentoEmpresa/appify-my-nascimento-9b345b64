// =====================================================================
// Recuperação dos anexos de patrimônio que ficaram só com a URL do legado.
//
// Uso:
//   LEGADO_BASE_URL=https://servidor-antigo node migrar-anexos-patrimonio.mjs
//   node migrar-anexos-patrimonio.mjs --base=https://servidor-antigo --executar
//
// Sem --executar é DRY-RUN: baixa e confere os arquivos, mas não escreve no
// Supabase. O relatório local RESULTADO-ANEXOS.md é sempre atualizado.
// =====================================================================
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIRETORIO = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO_ENV = path.resolve(DIRETORIO, '../worker/.env');
const ARQUIVO_RELATORIO = path.join(DIRETORIO, 'RESULTADO-ANEXOS.md');
const EXECUTAR = process.argv.includes('--executar');
const CONCORRENCIA = 5;
const TAMANHO_PAGINA = 100;
const TENTATIVAS = 2;

function valorArgumento(nome) {
  const prefixo = `${nome}=`;
  return process.argv.find((arg) => arg.startsWith(prefixo))?.slice(prefixo.length);
}

function lerEnv(texto) {
  const variaveis = {};
  for (const linha of texto.split(/\r?\n/)) {
    const encontrada = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!encontrada || linha.trimStart().startsWith('#')) continue;
    let [, chave, valor] = encontrada;
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    variaveis[chave] = valor;
  }
  return variaveis;
}

function validarBase(valor) {
  if (!valor) {
    throw new Error('Falta a base do legado. Passe --base=https://servidor-antigo ou defina LEGADO_BASE_URL.');
  }
  const url = new URL(valor);
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
    throw new Error('A base do legado deve ser uma URL http(s), sem query string nem fragmento.');
  }
  return url.toString().replace(/\/+$/, '');
}

function repararMojibake(texto) {
  // Só aceita a conversão quando os bytes latin-1 formam UTF-8 estritamente
  // válido. Assim um nome já correto não é trocado por caracteres inválidos.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(texto, 'latin1'));
  } catch {
    return null;
  }
}

function recodificarUtf8ComoLatin1(texto) {
  return Buffer.from(texto, 'utf8').toString('latin1');
}

function variantesDoCaminho(caminho) {
  const decodificado = (() => {
    try { return decodeURIComponent(caminho); } catch { return caminho; }
  })();
  const reparado = repararMojibake(caminho);
  return [...new Set([
    caminho,
    decodificado,
    reparado,
    recodificarUtf8ComoLatin1(caminho),
  ].filter(Boolean))];
}

function urlDoLegado(base, caminho) {
  // encodeURI é aplicado somente ao path legado: a origem pode ter espaços e
  // mojibake, enquanto protocolo/host da base nunca devem ser recodificados.
  return `${base}${encodeURI(caminho)}`;
}

function extensaoDoCaminho(caminho) {
  const nome = caminho.split('/').pop() ?? '';
  const encontrada = nome.match(/\.([a-z0-9]{1,16})$/i);
  return encontrada ? encontrada[1].toLowerCase() : 'bin';
}

async function requisicaoComRetry(url, opcoes = {}) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      const resposta = await fetch(url, opcoes);
      if (resposta.status < 500 || tentativa === TENTATIVAS) return resposta;
      await resposta.body?.cancel();
      ultimoErro = new Error(`HTTP ${resposta.status}`);
    } catch (erro) {
      ultimoErro = erro;
      if (tentativa === TENTATIVAS) throw erro;
    }
  }
  throw ultimoErro;
}

function cabecalhosSupabase(chave, extras = {}) {
  return { apikey: chave, Authorization: `Bearer ${chave}`, ...extras };
}

async function buscarAnexos(urlSupabase, chave) {
  const anexos = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const consulta = new URL('/rest/v1/sup_patrimonio_arquivo', urlSupabase);
    consulta.search = new URLSearchParams({
      select: 'id,patrimonio_id,caminho,nome_arquivo,tipo_mime,tamanho_kb,patrimonio:sup_patrimonio(nome)',
      caminho: 'like./uploads/%',
      order: 'id.asc',
    }).toString();
    const resposta = await requisicaoComRetry(consulta, {
      headers: cabecalhosSupabase(chave, { Range: `${inicio}-${inicio + TAMANHO_PAGINA - 1}` }),
    });
    if (!resposta.ok) throw new Error(`Falha ao listar anexos no Supabase (HTTP ${resposta.status}).`);
    const pagina = await resposta.json();
    anexos.push(...pagina);
    if (pagina.length < TAMANHO_PAGINA) return anexos;
  }
}

function anexoEhHtml(caminho, tipoMime) {
  return ['html', 'htm'].includes(extensaoDoCaminho(caminho))
    || tipoMime?.split(';')[0].trim().toLowerCase() === 'text/html';
}

function binarioPareceHtml(binario) {
  const inicio = new TextDecoder().decode(binario.subarray(0, 1024)).trimStart().toLowerCase();
  return inicio.startsWith('<!doctype html') || inicio.startsWith('<html');
}

async function baixarDoLegado(base, caminho, tipoMime) {
  let ultimoMotivo = 'sem resposta';
  for (const variante of variantesDoCaminho(caminho)) {
    const url = urlDoLegado(base, variante);
    try {
      const resposta = await requisicaoComRetry(url);
      if (resposta.status !== 200) {
        ultimoMotivo = `HTTP ${resposta.status}`;
        await resposta.body?.cancel();
        continue;
      }
      const binario = new Uint8Array(await resposta.arrayBuffer());
      // Render/Express pode transmitir em chunked, sem content-length. O corpo
      // recebido é a única fonte confiável para decidir se há arquivo válido.
      if (!binario.byteLength) {
        ultimoMotivo = 'corpo vazio';
        continue;
      }
      // Algumas rotas legadas fazem catch-all e retornam a página HTML com 200
      // quando o arquivo não existe. Sem esta guarda, um PDF ausente viraria
      // silenciosamente uma página web no Storage.
      if (!anexoEhHtml(caminho, tipoMime)
        && (resposta.headers.get('content-type')?.toLowerCase().startsWith('text/html') || binarioPareceHtml(binario))) {
        ultimoMotivo = 'servidor devolveu HTML, provável rota catch-all';
        continue;
      }
      return { binario, url }; 
    } catch (erro) {
      ultimoMotivo = erro.message;
    }
  }
  return { binario: null, motivo: ultimoMotivo };
}

async function subirObjeto(urlSupabase, chave, chaveStorage, binario, tipoMime) {
  const url = new URL(`/storage/v1/object/sup-patrimonio/${chaveStorage.split('/').map(encodeURIComponent).join('/')}`, urlSupabase);
  const resposta = await requisicaoComRetry(url, {
    method: 'POST',
    headers: cabecalhosSupabase(chave, {
      'Content-Type': tipoMime || 'application/octet-stream',
      'x-upsert': 'false',
    }),
    body: binario,
  });
  if (!resposta.ok) throw new Error(`upload HTTP ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`);
}

async function atualizarAnexo(urlSupabase, chave, anexo, chaveStorage, nomeCorrigido) {
  const url = new URL(`/rest/v1/sup_patrimonio_arquivo?id=eq.${encodeURIComponent(anexo.id)}`, urlSupabase);
  const alteracoes = { caminho: chaveStorage };
  if (nomeCorrigido && nomeCorrigido !== anexo.nome_arquivo) alteracoes.nome_arquivo = nomeCorrigido;
  const resposta = await requisicaoComRetry(url, {
    method: 'PATCH',
    headers: cabecalhosSupabase(chave, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(alteracoes),
  });
  if (!resposta.ok) throw new Error(`PATCH HTTP ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`);
}

async function removerObjeto(urlSupabase, chave, chaveStorage) {
  const url = new URL(`/storage/v1/object/sup-patrimonio/${chaveStorage.split('/').map(encodeURIComponent).join('/')}`, urlSupabase);
  const resposta = await requisicaoComRetry(url, {
    method: 'DELETE', headers: cabecalhosSupabase(chave),
  });
  if (!resposta.ok) throw new Error(`remoção HTTP ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`);
}

function escaparMarkdown(valor) {
  return String(valor ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function nomeDoBem(anexo) {
  return anexo.patrimonio?.nome || `(patrimônio ${anexo.patrimonio_id})`;
}

function avisoDeTamanho(anexo, tamanhoBaixado) {
  const tamanhoEsperado = Number(anexo.tamanho_kb) * 1024;
  if (!Number.isFinite(tamanhoEsperado) || tamanhoEsperado <= 0) return null;
  const proporcao = tamanhoBaixado / tamanhoEsperado;
  if (proporcao >= 0.5 && proporcao <= 2) return null;
  return `esperado ${anexo.tamanho_kb} KB; baixado ${(tamanhoBaixado / 1024).toFixed(1)} KB (${(proporcao * 100).toFixed(0)}%)`;
}

function montarRelatorio(resultado) {
  const linhas = [
    '# Resultado — recuperação de anexos de patrimônio',
    '',
    `Modo: **${EXECUTAR ? 'EXECUÇÃO' : 'DRY-RUN'}**`,
    '',
    '| Total | Migrados | Não encontrados | Erros |',
    '|---:|---:|---:|---:|',
    `| ${resultado.total} | ${resultado.migrados} | ${resultado.naoEncontrados.length} | ${resultado.erros.length} |`,
    '',
    '## Itens que exigem atenção',
    '',
    '| Situação | Caminho legado | Bem | Detalhe |',
    '|---|---|---|---|',
  ];
  for (const item of [...resultado.naoEncontrados, ...resultado.erros]) {
    linhas.push(`| ${item.situacao} | ${escaparMarkdown(item.caminho)} | ${escaparMarkdown(item.bem)} | ${escaparMarkdown(item.detalhe)} |`);
  }
  if (!resultado.naoEncontrados.length && !resultado.erros.length) linhas.push('| — | — | — | Nenhum. |');
  linhas.push(
    '',
    '## Avisos de tamanho para conferência manual',
    '',
    '| Caminho legado | Bem | Divergência |',
    '|---|---|---|',
  );
  for (const item of resultado.avisosTamanho) {
    linhas.push(`| ${escaparMarkdown(item.caminho)} | ${escaparMarkdown(item.bem)} | ${escaparMarkdown(item.detalhe)} |`);
  }
  if (!resultado.avisosTamanho.length) linhas.push('| — | — | Nenhum. |');
  return `${linhas.join('\n')}\n`;
}

async function executarComConcorrencia(itens, fn) {
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, itens.length) }, async () => {
    while (proximo < itens.length) {
      const indice = proximo++;
      await fn(itens[indice]);
    }
  }));
}

async function main() {
  const base = validarBase(valorArgumento('--base') ?? process.env.LEGADO_BASE_URL);
  const env = lerEnv(await readFile(ARQUIVO_ENV, 'utf8'));
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('worker/.env precisa conter SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  }
  const urlSupabase = new URL(env.SUPABASE_URL);
  const anexos = await buscarAnexos(urlSupabase, env.SUPABASE_SERVICE_ROLE_KEY);
  const resultado = { total: anexos.length, migrados: 0, naoEncontrados: [], erros: [], avisosTamanho: [] };

  console.log(`=== ANEXOS DE PATRIMÔNIO — ${EXECUTAR ? 'EXECUÇÃO' : 'DRY-RUN'} ===`);
  console.log(`${anexos.length} anexos legados selecionados; concorrência ${CONCORRENCIA}.`);

  await executarComConcorrencia(anexos, async (anexo) => {
    const baixado = await baixarDoLegado(base, anexo.caminho, anexo.tipo_mime);
    if (!baixado.binario) {
      resultado.naoEncontrados.push({ situacao: 'NAO_ENCONTRADO', caminho: anexo.caminho, bem: nomeDoBem(anexo), detalhe: baixado.motivo });
      return;
    }
    const avisoTamanho = avisoDeTamanho(anexo, baixado.binario.byteLength);
    if (avisoTamanho) {
      resultado.avisosTamanho.push({ caminho: anexo.caminho, bem: nomeDoBem(anexo), detalhe: avisoTamanho });
    }
    if (!EXECUTAR) {
      resultado.migrados++;
      return;
    }

    const chaveStorage = `${anexo.patrimonio_id}/${randomUUID()}.${extensaoDoCaminho(anexo.caminho)}`;
    const nomeCorrigido = repararMojibake(anexo.nome_arquivo);
    try {
      await subirObjeto(urlSupabase, env.SUPABASE_SERVICE_ROLE_KEY, chaveStorage, baixado.binario, anexo.tipo_mime);
    } catch (erro) {
      resultado.erros.push({ situacao: 'ERRO_UPLOAD', caminho: anexo.caminho, bem: nomeDoBem(anexo), detalhe: erro.message });
      return;
    }

    try {
      await atualizarAnexo(urlSupabase, env.SUPABASE_SERVICE_ROLE_KEY, anexo, chaveStorage, nomeCorrigido);
      resultado.migrados++;
    } catch (erroPatch) {
      // Upload sem PATCH quebraria a idempotência. Compensamos imediatamente;
      // se a remoção também falhar, o relatório aponta a chave órfã exata.
      try {
        await removerObjeto(urlSupabase, env.SUPABASE_SERVICE_ROLE_KEY, chaveStorage);
        resultado.erros.push({ situacao: 'ERRO_PATCH', caminho: anexo.caminho, bem: nomeDoBem(anexo), detalhe: `${erroPatch.message}; objeto removido` });
      } catch (erroRemocao) {
        resultado.erros.push({ situacao: 'OBJETO_ORFAO', caminho: anexo.caminho, bem: nomeDoBem(anexo), detalhe: `${erroPatch.message}; não foi possível remover ${chaveStorage}: ${erroRemocao.message}` });
      }
    }
  });

  const relatorio = montarRelatorio(resultado);
  await writeFile(ARQUIVO_RELATORIO, relatorio, 'utf8');
  console.log('\n| Total | Migrados | Não encontrados | Erros |');
  console.log('|---:|---:|---:|---:|');
  console.log(`| ${resultado.total} | ${resultado.migrados} | ${resultado.naoEncontrados.length} | ${resultado.erros.length} |`);
  for (const item of [...resultado.naoEncontrados, ...resultado.erros]) {
    console.log(`${item.situacao}: ${item.caminho} — ${item.bem} (${item.detalhe})`);
  }
  console.log(`Relatório gravado em ${ARQUIVO_RELATORIO}`);
}

main().catch((erro) => {
  console.error(`ERRO: ${erro.message}`);
  process.exitCode = 1;
});

// O ETL (etl.mjs:681) gravou a.url em caminho, isto é, o endereço no disco
// Render, não um objeto do Storage. MAPEAMENTO.md:139-142 já registrava que
// esses binários ficariam para trás; este lote termina essa etapa separada.
