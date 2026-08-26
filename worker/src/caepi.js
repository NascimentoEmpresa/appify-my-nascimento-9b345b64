// Sincronização do catálogo de CA (CAEPI/MTE).
//
// O catálogo é a fonte independente que permite conferir o CA digitado numa
// entrada de EPI contra o que o Ministério publica — e auditar o estoque
// inteiro de uma vez, que é o que responde "quais das minhas 400 máscaras
// estão vencidas".
//
// COMO SE CHEGA NO ARQUIVO
// Não existe URL fixa. O download nasce de um botão ASP.NET na página
// https://caepi.trabalho.gov.br/internet/consultaCAInternet.aspx, cujo link é
// `javascript:__doPostBack('ctl00$PlaceHolderConteudo$LinkButton1','')`. O
// arquivo é gerado sob demanda (o nome carrega o timestamp:
// RelatorioCA_20260826_104105.csv.gz), então é preciso carregar a página,
// pegar os campos de estado do ASP.NET e devolvê-los no POST.
//
// NÃO USE a cópia hospedada em gov.br/.../tgg_export_caepi.zip. Ela parece a
// fonte oficial e está congelada em 19/01/2023 — medido no arquivo: declara
// 13.088 CAs "VÁLIDO" e nenhuma validade passa de 2025. Ligar aquilo marcaria
// como vencido quase todo CA legítimo e travaria entrada de EPI no estoque,
// que é o oposto do que este módulo existe pra fazer.
//
// POR QUE O FORMATO É DETECTADO E NÃO ASSUMIDO
// O arquivo de 2023 era RAR com extensão .zip, separado por pipe, em latin1.
// O de 2026 vem .csv.gz. Duas mudanças de formato em três anos, ambas sem
// aviso — então o parser reconhece o container pelos bytes mágicos e descobre
// o separador pela própria linha de cabeçalho, em vez de depender de uma
// combinação fixa que quebra na próxima troca.

const zlib = require("node:zlib");

const PAGINA_CAEPI =
  process.env.CAEPI_PAGINA ||
  "https://caepi.trabalho.gov.br/internet/consultaCAInternet.aspx";

// Alvo do __doPostBack do botão "Base de dados do sistema CAEPI (Download)".
const BOTAO = process.env.CAEPI_BOTAO || "ctl00$PlaceHolderConteudo$LinkButton1";

// Deixe em branco para desligar o módulo. Ligar sem fonte confirmada é pior
// que não ter catálogo: catálogo vazio a tela avisa, catálogo errado o usuário
// acredita.
const LIGADO = process.env.CAEPI_LIGADO === "1";

const INTERVALO_DIAS = 7;
const LOTE = 1000;

/** "25/03/2015" ou "2015-03-25" -> "2015-03-25". Null pro que não casar. */
function dataBr(texto) {
  const t = String(texto || "").trim();
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}

const soDigitos = (texto) => String(texto || "").replace(/\D/g, "");

// ── Download ─────────────────────────────────────────────────────────────

/** Campos de estado que o ASP.NET exige de volta no POST. */
function camposOcultos(html) {
  const campos = {};
  for (const [, nome, valor] of html.matchAll(
    /<input[^>]+type="hidden"[^>]*name="(__[A-Z]+)"[^>]*value="([^"]*)"/g,
  )) {
    campos[nome] = valor;
  }
  return campos;
}

async function baixarPacote() {
  const pagina = await fetch(PAGINA_CAEPI, { redirect: "follow" });
  if (!pagina.ok) throw new Error(`página do CAEPI respondeu HTTP ${pagina.status}`);
  const cookie = (pagina.headers.get("set-cookie") || "").split(";")[0];
  const html = await pagina.text();

  const ocultos = camposOcultos(html);
  if (!ocultos.__VIEWSTATE) {
    throw new Error("página do CAEPI veio sem __VIEWSTATE — o formulário mudou");
  }

  const corpo = new URLSearchParams({
    ...ocultos,
    __EVENTTARGET: BOTAO,
    __EVENTARGUMENT: "",
  });

  const resposta = await fetch(PAGINA_CAEPI, {
    method: "POST",
    redirect: "follow",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: PAGINA_CAEPI,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: corpo,
  });
  if (!resposta.ok) throw new Error(`download do CAEPI respondeu HTTP ${resposta.status}`);

  const tipo = resposta.headers.get("content-type") || "";
  const bytes = Buffer.from(await resposta.arrayBuffer());
  // Se voltou HTML, o postback não gerou arquivo — provavelmente o nome do
  // botão mudou. Falhar aqui com mensagem clara evita gravar lixo no catálogo.
  if (/text\/html/i.test(tipo) && bytes.length < 2_000_000) {
    throw new Error("o postback devolveu HTML em vez de arquivo — confira CAEPI_BOTAO");
  }
  return bytes;
}

/**
 * Descompacta reconhecendo o container pelos bytes mágicos.
 * gzip = 1f 8b · RAR = "Rar!" · zip = "PK"
 */
async function descompactar(bytes) {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return zlib.gunzipSync(bytes);
  }
  if (bytes.slice(0, 4).toString("latin1") === "Rar!") {
    const { createExtractorFromData } = await import("node-unrar-js");
    const ex = await createExtractorFromData({ data: Uint8Array.from(bytes).buffer });
    const alvo = [...ex.getFileList().fileHeaders].find((f) => /\.(txt|csv)$/i.test(f.name));
    if (!alvo) throw new Error("pacote RAR do CAEPI sem .txt/.csv dentro");
    const arquivos = [...ex.extract({ files: [alvo.name] }).files];
    if (!arquivos.length) throw new Error("falha ao extrair o pacote RAR do CAEPI");
    return Buffer.from(arquivos[0].extraction);
  }
  if (bytes.slice(0, 2).toString("latin1") === "PK") {
    throw new Error("pacote do CAEPI veio em zip real — adicionar suporte");
  }
  return bytes; // texto puro
}

/**
 * Decodifica escolhendo entre latin1 e UTF-8.
 *
 * O arquivo de 2023 era latin1, e lido como UTF-8 todo acento vira caractere
 * de substituição — num catálogo cheio de "PROTEÇÃO DAS MÃOS", isso suja tudo.
 * Não dá para assumir o mesmo do arquivo novo, então testa: se o UTF-8 produz
 * o caractere de substituição, o arquivo é latin1.
 */
function decodificar(buffer) {
  const utf8 = buffer.toString("utf8");
  return utf8.includes("�") ? buffer.toString("latin1") : utf8;
}

/** O separador é o candidato que mais aparece na linha de cabeçalho. */
function detectarSeparador(cabecalho) {
  const candidatos = ["|", ";", "\t", ","];
  let melhor = "|";
  let maior = -1;
  for (const c of candidatos) {
    const n = cabecalho.split(c).length - 1;
    if (n > maior) { maior = n; melhor = c; }
  }
  return melhor;
}

// ── Parser ───────────────────────────────────────────────────────────────

/**
 * Converte o arquivo em linhas prontas pro banco, já deduplicadas.
 *
 * As colunas saem pelo NOME no cabeçalho, nunca por posição fixa: uma coluna
 * inserida no meio deslocaria tudo em silêncio.
 *
 * `NRRegistroCA` NÃO é chave única — há uma linha por norma técnica atendida
 * pelo mesmo CA. No arquivo de 2023 isso eram 63.264 linhas repetidas em
 * 96.553. Sem deduplicar, o upsert atinge a mesma chave duas vezes no mesmo
 * comando e o Postgres recusa o lote inteiro.
 */
function parsear(texto) {
  const linhas = texto.split(/\r?\n/);
  if (!linhas.length) return { registros: [], lidas: 0 };

  const sep = detectarSeparador(linhas[0]);
  const cabecalho = linhas[0]
    .replace(/^﻿/, "")
    .replace(/^#/, "")
    .split(sep)
    .map((c) => c.trim().replace(/^"|"$/g, ""));

  const acha = (...nomes) => {
    for (const n of nomes) {
      const i = cabecalho.findIndex((c) => c.toLowerCase() === n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };

  const iCa = acha("NRRegistroCA", "RegistroCA", "CA", "NumeroCA");
  const iValidade = acha("DataValidade", "Validade");
  const iSituacao = acha("Situacao", "Situação");
  const iEquip = acha("NomeEquipamento", "Equipamento");
  const iNatureza = acha("Natureza");
  const iCnpj = acha("CNPJ");
  const iRazao = acha("RazaoSocial", "RazãoSocial");

  if (iCa < 0 || iValidade < 0) {
    throw new Error(
      `cabeçalho do CAEPI não reconhecido (separador "${sep}"): ${cabecalho.slice(0, 8).join(", ")}`,
    );
  }

  // Map: dedup por CA mantendo a maior validade — se o mesmo CA aparece com
  // validades diferentes entre normas, a que vale pro nosso uso é a mais longa.
  const porCa = new Map();
  let lidas = 0;

  const limpo = (v) => String(v ?? "").trim().replace(/^"|"$/g, "") || null;

  for (let i = 1; i < linhas.length; i++) {
    if (!linhas[i].trim()) continue;
    lidas++;

    const campos = linhas[i].split(sep);
    const ca = soDigitos(campos[iCa]);
    if (!ca) continue;

    const validade = dataBr(campos[iValidade]);
    const anterior = porCa.get(ca);
    if (anterior && anterior.validade && validade && anterior.validade >= validade) continue;

    porCa.set(ca, {
      ca_numero: ca,
      validade,
      situacao: iSituacao >= 0 ? limpo(campos[iSituacao]) : null,
      equipamento: iEquip >= 0 ? limpo(campos[iEquip]) : null,
      natureza: iNatureza >= 0 ? limpo(campos[iNatureza]) : null,
      fabricante_cnpj: iCnpj >= 0 ? soDigitos(campos[iCnpj]) || null : null,
      fabricante: iRazao >= 0 ? limpo(campos[iRazao]) : null,
    });
  }

  return { registros: [...porCa.values()], lidas };
}

// ── Gravação ─────────────────────────────────────────────────────────────

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
  return (Date.now() - new Date(ultima).getTime()) / 86_400_000 >= INTERVALO_DIAS;
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
  if (!LIGADO) return;
  if (!(await precisaSincronizar(supabase))) return;

  const { data: linha, error: erroInicio } = await supabase
    .from("sst_ca_sincronizacao")
    .insert({})
    .select("id")
    .single();
  if (erroInicio) throw erroInicio;

  try {
    console.log("[worker] CAEPI: baixando catálogo de CA...");
    const bytes = await baixarPacote();
    const texto = decodificar(await descompactar(bytes));
    const { registros, lidas } = parsear(texto);

    // Guarda contra fonte degradada: se o arquivo vier quase vazio, é sinal de
    // que o postback devolveu outra coisa. Melhor manter o catálogo anterior.
    if (registros.length < 1000) {
      throw new Error(`catálogo veio com apenas ${registros.length} CAs — recusado`);
    }

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
    // Sem `concluido_em`, a próxima passada tenta de novo e a tela consegue
    // avisar que o catálogo está velho, em vez do erro sumir no log.
    await supabase
      .from("sst_ca_sincronizacao")
      .update({ erro: String(e && e.message ? e.message : e).slice(0, 500) })
      .eq("id", linha.id);
    throw e;
  }
}

module.exports = {
  sincronizarCaepi,
  parsear,
  dataBr,
  decodificar,
  descompactar,
  detectarSeparador,
};
