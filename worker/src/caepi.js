// Sincronização do catálogo de CA (CAEPI/MTE).
//
// O Ministério publica a base inteira de Certificados de Aprovação num arquivo
// atualizado diariamente às 20h. Este módulo baixa, descompacta, deduplica e
// grava em `sst_ca_catalogo`, que é o que permite conferir o CA digitado numa
// entrada de EPI contra a fonte oficial — e auditar o estoque inteiro de uma
// vez, que é o que originou o chamado das 400 máscaras vencidas.
//
// TRÊS COISAS QUE SÓ SE DESCOBRE ABRINDO O ARQUIVO REAL, e que ditam o código
// abaixo:
//
//   1. O arquivo tem extensão .zip mas é RAR. O descompactador do Windows
//      recusa ("Pasta Compactada inválida") e qualquer lib de zip também.
//      Por isso node-unrar-js, que é WASM e não exige binário instalado.
//
//   2. A codificação é latin1, não UTF-8. Lido como UTF-8, todo acento vira
//      caractere de substituição — e como nome de equipamento é justamente
//      cheio de acento ("PROTEÇÃO DAS MÃOS"), o catálogo inteiro fica sujo.
//
//   3. `NRRegistroCA` NÃO é chave única: há uma linha por norma técnica
//      atendida pelo mesmo CA. Sem deduplicar, o upsert reescreve a mesma
//      chave várias vezes por lote e o Postgres reclama de linha afetada duas
//      vezes no mesmo comando.
//
// O ciclo do worker é de 60s; esta carga é semanal. O controle de quando rodar
// vive em `sst_ca_sincronizacao`, no banco, e não num arquivo local — assim
// reiniciar o worker não dispara download de 3 MB à toa.

// A URL vem do .env, sem valor padrão, DE PROPÓSITO.
//
// A cópia hospedada na página do gov.br (.../tgg_export_caepi.zip) parece a
// fonte certa e não é: está congelada em 19/01/2023. Medido no arquivo real —
// ela diz que 13.088 CAs estão "VÁLIDO", mas nenhuma validade passa de 2025.
// Usá-la hoje marcaria como vencido praticamente todo CA legítimo e travaria
// entrada de EPI no estoque, que é o oposto do que este módulo existe pra
// fazer.
//
// O FTP histórico (ftp.mtps.gov.br), que era atualizado diariamente às 20h,
// não responde mais. Enquanto a fonte vigente não estiver confirmada, o
// módulo não roda — melhor catálogo vazio, com a tela avisando que não há
// catálogo, do que catálogo errado que o usuário acredita.
const URL_CAEPI = process.env.CAEPI_URL;

const INTERVALO_DIAS = 7;
const LOTE = 1000;

/** "25/03/2015" -> "2015-03-25". Devolve null pro que não casar. */
function dataBr(texto) {
  const m = String(texto || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dia, mes, ano] = m;
  return `${ano}-${mes}-${dia}`;
}

/** Só dígitos — o CA é numérico e vem com espaço/zero à esquerda em alguns lotes. */
const soDigitos = (texto) => String(texto || "").replace(/\D/g, "");

async function precisaSincronizar(supabase) {
  const { data, error } = await supabase
    .from("sst_ca_sincronizacao")
    .select("concluido_em")
    .is("erro", null)
    .not("concluido_em", "is", null)
    .order("concluido_em", { ascending: false })
    .limit(1);
  if (error) throw error;

  const ultima = data && data[0] && data[0].concluido_em;
  if (!ultima) return true;
  const dias = (Date.now() - new Date(ultima).getTime()) / 86_400_000;
  return dias >= INTERVALO_DIAS;
}

async function baixarEExtrair() {
  const resposta = await fetch(URL_CAEPI, { redirect: "follow" });
  if (!resposta.ok) {
    throw new Error(`CAEPI respondeu HTTP ${resposta.status}`);
  }
  const bruto = Buffer.from(await resposta.arrayBuffer());

  // node-unrar-js é ESM; este worker é CommonJS. Import dinâmico resolve sem
  // converter o resto do worker.
  const { createExtractorFromData } = await import("node-unrar-js");
  const extrator = await createExtractorFromData({
    data: Uint8Array.from(bruto).buffer,
  });

  const cabecalhos = [...extrator.getFileList().fileHeaders];
  const txt = cabecalhos.find((f) => /\.txt$/i.test(f.name));
  if (!txt) throw new Error("pacote do CAEPI não contém o .txt esperado");

  const extraidos = [...extrator.extract({ files: [txt.name] }).files];
  if (!extraidos.length) throw new Error("falha ao extrair o .txt do CAEPI");

  // latin1 de propósito — ver nota 2 no topo.
  return Buffer.from(extraidos[0].extraction).toString("latin1");
}

/**
 * Converte o texto do arquivo em linhas prontas pro banco, já deduplicadas.
 *
 * As colunas são localizadas pelo NOME no cabeçalho, não por posição fixa: se
 * o Ministério inserir uma coluna no meio (já aconteceu com outras bases
 * abertas), a carga continua correta em vez de gravar tudo deslocado.
 */
function parsear(texto) {
  const linhas = texto.split(/\r?\n/);
  if (!linhas.length) return { registros: [], lidas: 0 };

  const cabecalho = linhas[0].replace(/^#/, "").split("|").map((c) => c.trim());
  const idx = (nome) => cabecalho.indexOf(nome);

  const iCa = idx("NRRegistroCA");
  const iValidade = idx("DataValidade");
  const iSituacao = idx("Situacao");
  const iEquip = idx("NomeEquipamento");
  const iNatureza = idx("Natureza");
  const iCnpj = idx("CNPJ");
  const iRazao = idx("RazaoSocial");

  if (iCa < 0 || iValidade < 0) {
    throw new Error("cabeçalho do CAEPI mudou: NRRegistroCA/DataValidade não encontrados");
  }

  // Map em vez de array: dedup por CA, mantendo a linha de maior validade —
  // se o mesmo CA aparece com validades diferentes entre normas, a que vale
  // pro nosso uso é a mais longa.
  const porCa = new Map();
  let lidas = 0;

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) continue;
    lidas++;

    const campos = linha.split("|");
    const ca = soDigitos(campos[iCa]);
    if (!ca) continue;

    const validade = dataBr(campos[iValidade]);
    const anterior = porCa.get(ca);
    if (anterior && anterior.validade && validade && anterior.validade >= validade) continue;

    porCa.set(ca, {
      ca_numero: ca,
      validade,
      situacao: (campos[iSituacao] || "").trim() || null,
      equipamento: (campos[iEquip] || "").trim() || null,
      natureza: (campos[iNatureza] || "").trim() || null,
      fabricante_cnpj: soDigitos(campos[iCnpj]) || null,
      fabricante: (campos[iRazao] || "").trim() || null,
    });
  }

  return { registros: [...porCa.values()], lidas };
}

async function gravar(supabase, registros) {
  let gravados = 0;
  for (let i = 0; i < registros.length; i += LOTE) {
    const lote = registros.slice(i, i + LOTE).map((r) => ({
      ...r,
      atualizado_em: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("sst_ca_catalogo")
      .upsert(lote, { onConflict: "ca_numero" });
    if (error) throw error;
    gravados += lote.length;
  }
  return gravados;
}

async function sincronizarCaepi(supabase) {
  if (!URL_CAEPI) return; // sem fonte confirmada, não carrega nada — ver nota no topo
  if (!(await precisaSincronizar(supabase))) return;

  const { data: linha, error: erroInicio } = await supabase
    .from("sst_ca_sincronizacao")
    .insert({})
    .select("id")
    .single();
  if (erroInicio) throw erroInicio;

  try {
    console.log("[worker] CAEPI: baixando catálogo de CA...");
    const texto = await baixarEExtrair();
    const { registros, lidas } = parsear(texto);
    const gravados = await gravar(supabase, registros);

    await supabase
      .from("sst_ca_sincronizacao")
      .update({
        concluido_em: new Date().toISOString(),
        linhas_lidas: lidas,
        cas_gravados: gravados,
      })
      .eq("id", linha.id);

    console.log(`[worker] CAEPI: ${lidas} linhas lidas, ${gravados} CAs gravados.`);
  } catch (e) {
    // A falha fica registrada em vez de sumir no log: sem `concluido_em`, a
    // próxima passada do ciclo tenta de novo, e a tela de CA consegue avisar
    // que o catálogo está velho.
    await supabase
      .from("sst_ca_sincronizacao")
      .update({ erro: String(e && e.message ? e.message : e).slice(0, 500) })
      .eq("id", linha.id);
    throw e;
  }
}

module.exports = { sincronizarCaepi, parsear, dataBr };
