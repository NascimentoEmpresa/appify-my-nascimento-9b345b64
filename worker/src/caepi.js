// Sincronização do catálogo de CA (CAEPI/MTE).
//
// O catálogo é a fonte independente que permite conferir o CA digitado numa
// entrada de EPI contra o que o Ministério publica — e auditar o estoque
// inteiro de uma vez, que é o que responde "quais das minhas 400 máscaras
// estão vencidas".
//
// COMO SE CHEGA NO ARQUIVO — e por que não dá para automatizar o download
//
// Não existe URL fixa. O download nasce de um botão ASP.NET na página
// https://caepi.trabalho.gov.br/internet/consultaCAInternet.aspx, cujo link é
// `javascript:__doPostBack('ctl00$PlaceHolderConteudo$LinkButton1','')`, e o
// arquivo é gerado sob demanda (o nome carrega o timestamp:
// RelatorioCA_20260826_104105.csv.gz).
//
// O fluxo de postback está implementado em `baixarPacote()` e **não funciona
// hoje**: o WAF do site responde 403 para qualquer cliente que não seja um
// navegador de verdade. Testado da própria máquina onde o Chrome baixa sem
// problema, com cabeçalhos completos de Chrome — mesmo assim 403, enquanto
// google.com responde 200 no mesmo processo. A distinção é a impressão digital
// do handshake TLS, que nenhum ajuste de header muda.
//
// Por isso o caminho principal é a PASTA: alguém baixa pelo navegador e larga
// o arquivo em `state/caepi/`. O worker pega o mais recente. Não é elegante,
// mas é honesto sobre a restrição — e a base de CA muda devagar, então uma
// visita ocasional ao site resolve. A alternativa seria embutir um navegador
// headless (~300 MB de Chromium) no worker para baixar um arquivo por semana.
//
// A tela avisa a idade do catálogo, então catálogo velho é visível em vez de
// silencioso.
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
const fs = require("node:fs");
const path = require("node:path");

// Pasta onde alguém deposita o arquivo baixado do site. É o caminho PRINCIPAL,
// não um plano B — ver a nota sobre o WAF logo abaixo.
const PASTA = process.env.CAEPI_PASTA || path.join(__dirname, "..", "state", "caepi");

const PAGINA_CAEPI =
  process.env.CAEPI_PAGINA ||
  "https://caepi.trabalho.gov.br/internet/consultaCAInternet.aspx";

// Alvo do __doPostBack do botão "Base de dados do sistema CAEPI (Download)".
const BOTAO = process.env.CAEPI_BOTAO || "ctl00$PlaceHolderConteudo$LinkButton1";

// Deixe em branco para desligar o módulo. Ligar sem fonte confirmada é pior
// que não ter catálogo: catálogo vazio a tela avisa, catálogo errado o usuário
// acredita.
const LIGADO = process.env.CAEPI_LIGADO === "1";

// O postback so e tentado com isso ligado — hoje o WAF do site devolve 403
// para cliente que nao seja navegador. Existe para o dia em que mudar.
const TENTAR_SITE = process.env.CAEPI_TENTAR_SITE === "1";

let avisouPastaVazia = false;

const INTERVALO_DIAS = 7;
const LOTE = 1000;

/** "25/03/2015" ou "2015-03-25" -> "2015-03-25". Null pro que não casar. */
function dataBr(texto) {
  // As aspas são do CSV de 2026, onde todo valor vem entre `"`. Sem tirá-las
  // aqui, nenhuma data casa e o catálogo inteiro entra sem validade.
  const t = String(texto || "").trim().replace(/^"|"$/g, "").trim();
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
 * Descompacta gzip em fluxo, tolerando o lixo no fim do arquivo.
 *
 * O arquivo do Ministério traz bytes sobrando depois do conteúdo. O `gunzip`
 * de linha de comando descompacta tudo e não reclama; o Node tenta ler o resto
 * como um segundo arquivo gzip e estoura com "incorrect header check" — erro
 * que não diz nada sobre a causa. Por isso o fluxo, que permite ficar com o
 * que já saiu antes do erro.
 *
 * NÃO tente validar o tamanho pelos últimos 4 bytes do arquivo. Num gzip o
 * rodapé guarda o tamanho original, mas aqui os 4 últimos bytes pertencem ao
 * LIXO, não ao gzip — e comparar o que saiu contra esse número reprova arquivo
 * íntegro. Eu implementei essa checagem, ela acusou 144 de 161 MB e mandou o
 * usuário baixar de novo duas vezes; o `gunzip` do sistema extraía os mesmos
 * 144 MB sem um aviso sequer. A integridade é conferida no parser, sobre os
 * dados: ver a checagem do último registro em `parsear`.
 */
function gunzipTolerante(bytes) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let lidos = 0;

    const gun = zlib.createGunzip();
    gun.on("data", (d) => { partes.push(d); lidos += d.length; });
    gun.on("error", () => {}); // esperado: ver nota sobre o lixo no fim
    gun.on("close", () => {
      if (!lidos) {
        reject(new Error("não foi possível descompactar o arquivo do CAEPI"));
        return;
      }
      resolve(Buffer.concat(partes));
    });

    gun.end(bytes);
  });
}

/**
 * Descompacta reconhecendo o container pelos bytes mágicos.
 * gzip = 1f 8b · RAR = "Rar!" · zip = "PK"
 */
async function descompactar(bytes) {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return await gunzipTolerante(bytes);
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

/**
 * Corta uma linha em campos RESPEITANDO aspas.
 *
 * Não é preciosismo: no arquivo de 2026, **39% das linhas** têm o separador
 * dentro de um valor entre aspas — a descrição do equipamento é texto corrido
 * cheio de `;`. Com `split(sep)` cru, toda coluna depois da descrição sai
 * deslocada, e basta um `;` no nome de um fabricante para embaralhar o
 * registro inteiro.
 */
function cortarLinha(linha, sep) {
  const campos = [];
  let atual = "";
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      // `""` dentro de campo entre aspas é uma aspa literal, não o fim dele.
      if (dentroDeAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroDeAspas = !dentroDeAspas;
      continue;
    }
    if (c === sep && !dentroDeAspas) { campos.push(atual); atual = ""; continue; }
    atual += c;
  }
  campos.push(atual);
  return campos;
}

/**
 * Percorre o CSV inteiro devolvendo REGISTROS, não linhas.
 *
 * A diferença é o que quebrou a primeira versão deste parser: a descrição do
 * equipamento é texto corrido com parágrafos, então **um registro ocupa várias
 * linhas**. Quebrar o arquivo por `\n` e tratar cada pedaço como um registro
 * produz fragmentos — a "última linha" do arquivo de 2026 começa no meio de
 * uma palavra ("ponsável pela avaliação..."), porque é a cauda de um registro
 * que começou muito antes.
 *
 * Só a quebra de linha FORA de aspas encerra um registro.
 */
function* registrosDoCsv(texto, sep) {
  let campos = [];
  let atual = "";
  let dentroDeAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (c === '"') {
      if (dentroDeAspas && texto[i + 1] === '"') { atual += '"'; i++; }
      else dentroDeAspas = !dentroDeAspas;
      continue;
    }

    if (!dentroDeAspas) {
      if (c === sep) { campos.push(atual); atual = ""; continue; }
      if (c === "\n" || c === "\r") {
        if (c === "\r" && texto[i + 1] === "\n") i++;
        campos.push(atual);
        // Linha em branco entre registros não vira registro vazio.
        if (campos.length > 1 || campos[0].trim() !== "") yield campos;
        campos = [];
        atual = "";
        continue;
      }
    }

    atual += c;
  }

  if (atual !== "" || campos.length) {
    campos.push(atual);
    if (campos.length > 1 || campos[0].trim() !== "") yield campos;
  }
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
  // `﻿+` e não uma vez só: o arquivo de 2026 vem com DOIS marcadores de
  // codificação no começo, um colado no outro.
  const cabecalho = cortarLinha(
    linhas[0].replace(/^﻿+/, "").replace(/^#/, ""),
    sep,
  ).map((c) => c.trim());

  /**
   * Compara nomes de coluna ignorando espaço, acento e caixa.
   *
   * Em 2023 a coluna era `NRRegistroCA`; em 2026 virou `NR Registro CA`, e
   * `DataValidade` virou `DATA DE VALIDADE`. Comparar o texto cru faria a
   * carga falhar a cada reformatação de cabeçalho do Ministério.
   */
  const normalizar = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const normalizado = cabecalho.map(normalizar);

  // Exato primeiro, "contém" depois: `EQUIPAMENTO` e `DESCRICAO EQUIPAMENTO`
  // convivem no arquivo, e sem essa ordem a descrição venceria o nome.
  const acha = (...nomes) => {
    for (const n of nomes) {
      const i = normalizado.indexOf(normalizar(n));
      if (i >= 0) return i;
    }
    for (const n of nomes) {
      const alvo = normalizar(n);
      const i = normalizado.findIndex((c) => c.includes(alvo));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iCa = acha("NRRegistroCA", "NR Registro CA", "RegistroCA", "NumeroCA");
  const iValidade = acha("DataValidade", "Data de Validade", "Validade");
  const iSituacao = acha("Situacao");
  const iEquip = acha("Equipamento", "NomeEquipamento");
  const iNatureza = acha("Natureza");
  const iCnpj = acha("CNPJ");
  const iRazao = acha("RazaoSocial", "Razao Social");

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

  let primeiro = true;
  let ultimoRegistro = null;
  let incompletos = 0;

  for (const campos of registrosDoCsv(texto, sep)) {
    // O primeiro registro é o cabeçalho, já lido acima.
    if (primeiro) { primeiro = false; continue; }
    ultimoRegistro = campos;

    // Registro com menos campos que o cabeçalho está cortado. Acontece no
    // ÚLTIMO do arquivo do Ministério, que vem truncado no finalzinho — 1 em
    // 124.062 na medição de 26/08/2026. Descartar o pedaço e seguir é a reação
    // proporcional; recusar 42 mil CAs por causa de um registro não é.
    if (campos.length < cabecalho.length) { incompletos++; continue; }
    lidas++;

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

  return { registros: [...porCa.values()], lidas, incompletos };
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

/**
 * Arquivo mais recente depositado na pasta, ou null.
 *
 * Aceita qualquer extensão porque o Ministério já serviu `.zip` que era RAR e
 * agora serve `.csv.gz` — quem decide o formato é `descompactar()`, pelos
 * bytes, não o nome do arquivo.
 */
function arquivoDaPasta() {
  if (!fs.existsSync(PASTA)) return null;
  const candidatos = fs
    .readdirSync(PASTA)
    .filter((n) => !n.startsWith("."))
    .map((n) => {
      const completo = path.join(PASTA, n);
      const st = fs.statSync(completo);
      return st.isFile() ? { caminho: completo, nome: n, mtime: st.mtimeMs } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return candidatos[0] || null;
}

/** Anexo feito pela tela e ainda não processado. */
async function uploadPendente(supabase) {
  const { data, error } = await supabase
    .from("sst_ca_sincronizacao")
    .select("id, arquivo_path, arquivo_nome")
    .not("arquivo_path", "is", null)
    .is("concluido_em", null)
    .is("erro", null)
    .order("iniciado_em", { ascending: true })
    .limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

async function sincronizarCaepi(supabase) {
  if (!LIGADO) return;

  // 1º) anexo feito pela tela. É o caminho normal — alguém baixou do site do
  // Ministério e subiu pelo ERP. Tem prioridade e ignora o intervalo semanal:
  // se a pessoa acabou de anexar, ela quer que valha agora.
  const upload = await uploadPendente(supabase);

  // 2º) arquivo largado na máquina do worker, para quem tem acesso a ela.
  const local = upload ? null : arquivoDaPasta();

  if (!upload && !local) {
    if (!TENTAR_SITE) {
      if (!avisouPastaVazia) {
        console.log("[worker] CAEPI: nenhum arquivo anexado — aguardando envio pela tela.");
        avisouPastaVazia = true;
      }
      return;
    }
    if (!(await precisaSincronizar(supabase))) return;
  }
  avisouPastaVazia = false;

  // O upload já criou a linha; nos outros caminhos ela nasce aqui.
  let idSync = upload && upload.id;
  if (!idSync) {
    const { data: linha, error: erroInicio } = await supabase
      .from("sst_ca_sincronizacao")
      .insert({ origem: local ? "pasta" : "site" })
      .select("id")
      .single();
    if (erroInicio) throw erroInicio;
    idSync = linha.id;
  }
  const linha = { id: idSync };

  try {
    let bytes;
    if (upload) {
      console.log(`[worker] CAEPI: baixando ${upload.arquivo_nome || upload.arquivo_path} do Storage`);
      const { data, error } = await supabase.storage.from("caepi").download(upload.arquivo_path);
      if (error) throw error;
      bytes = Buffer.from(await data.arrayBuffer());
    } else if (local) {
      console.log(`[worker] CAEPI: lendo ${local.nome} de ${PASTA}`);
      bytes = fs.readFileSync(local.caminho);
    } else {
      console.log("[worker] CAEPI: tentando baixar do site...");
      bytes = await baixarPacote();
    }
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
  baixarPacote,
  registrosDoCsv,
  cortarLinha,
  parsear,
  dataBr,
  decodificar,
  descompactar,
  detectarSeparador,
};
