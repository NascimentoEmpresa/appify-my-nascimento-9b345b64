// SIS-2026-0427: leitor de PDF de baixo nível pra decodificar o "novo
// layout da TRI" (fonte Type3 com nome de glifo embaralhado por PDF, só
// pra dificultar copiar-colar) sem OCR/Tesseract.
//
// `pdf-lib` não tem extração de texto (só criação/edição de PDF), então
// este módulo faz as duas coisas com o mesmo mecanismo:
//   1. Um tokenizer/interpretador mínimo do content stream de uma página
//      (só os operadores que interessam pra texto: BT/ET, Tf, Tm/Td/TD/T*,
//      Tj/TJ) — reconstrói a sequência de códigos de caractere por linha,
//      na ordem em que o PDF desenha (que já é esquerda→direita, então não
//      precisa de posição x/y pra ordenar, só pra saber onde quebra linha).
//   2. Pra fonte Type3 (a única onde "código de caractere" não é
//      Unicode/ASCII direto): monta um dicionário assinatura-geométrica →
//      caractere, comparando os operadores de desenho (m/l/c/d1) de cada
//      glifo — validado manualmente contra um PDF real da TRI nesta
//      sessão (nomes/valores bateram 100% com a tela de referência).
//
// Fontes simples (não-Type3) nos outros formatos conhecidos (TEU, Prospera,
// São José, Pix) são tratadas como passthrough latin1 (código = byte =
// caractere) — é o caso comum pra PDF gerado por lib padrão sem ofuscação;
// ajustar aqui se algum formato novo usar Encoding não-trivial.

const { PDFName, PDFDict, PDFArray, PDFNumber, decodePDFRawStream } = require("pdf-lib");

// Rótulo por índice de 1ª ocorrência da assinatura geométrica no
// documento (mesma ordem/validação manual feita em Python nesta sessão,
// com a correção do índice 69: era "9", é vírgula).
const ROTULOS_TYPE3 = [
  "", "V", "ú", "Z", "8", "h", "U", "5", "i", "U", "6", "C", "ã", "C", "a", "d",
  "e", "2", "U", "O", "S", "L", "m", "m", "6", "6", "e", "D", "0", "P", "/", "R",
  "S", "t", "n", "0", "$", ",", "b", "N", "e", "d", "ó", "r", "F", "O", "u", "t",
  "O", "E", "g", "S", "S", "2", "l", "4", "D", "V", "H", "T", "K", "2", "?", ":",
  "O", "t", "5", "3", "1", ",", "p", "0", "M", "1", "A", "5", "?", "O", "8", "N",
  "O", "4", "I", "r", "9", ":", "X", "a", "C", "7", "8", "k", "?", "3", "b", "d",
  "9", "P", "7", "L", "/", "P", "S", "a", "Q", "R", "G", "n", "$", "F", "B", "C",
  "g", "1", "f", "Y", "J", "3", "4", "W",
];

// ── Tokenizer do content stream ──────────────────────────────────────────
function tokenizar(texto) {
  const tokens = [];
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i];
    if (c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f") {
      i++;
      continue;
    }
    if (c === "%") {
      while (i < n && texto[i] !== "\n") i++;
      continue;
    }
    if (c === "(") {
      let profundidade = 1;
      i++;
      const bytes = [];
      while (i < n && profundidade > 0) {
        const ch = texto[i];
        if (ch === "\\") {
          const prox = texto[i + 1];
          if (prox >= "0" && prox <= "7") {
            let oct = "";
            let k = i + 1;
            while (k < n && k < i + 4 && texto[k] >= "0" && texto[k] <= "7") {
              oct += texto[k];
              k++;
            }
            bytes.push(parseInt(oct, 8) & 0xff);
            i = k;
            continue;
          }
          const mapa = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
          if (prox in mapa) {
            bytes.push(mapa[prox]);
            i += 2;
            continue;
          }
          i += 2;
          continue;
        }
        if (ch === "(") profundidade++;
        if (ch === ")") {
          profundidade--;
          if (profundidade === 0) {
            i++;
            break;
          }
        }
        bytes.push(ch.charCodeAt(0) & 0xff);
        i++;
      }
      tokens.push({ tipo: "str", bytes });
      continue;
    }
    if (c === "/") {
      let j = i + 1;
      while (j < n && !/[\s()<>\[\]{}\/%]/.test(texto[j])) j++;
      tokens.push({ tipo: "nome", valor: texto.slice(i + 1, j) });
      i = j;
      continue;
    }
    if (c === "[" || c === "]") {
      tokens.push({ tipo: c });
      i++;
      continue;
    }
    if (c === "<" && texto[i + 1] === "<") {
      // dicionário inline (ex: BDC/gs) — pula até o par >> correspondente
      let profundidade = 1;
      i += 2;
      while (i < n && profundidade > 0) {
        if (texto[i] === "<" && texto[i + 1] === "<") {
          profundidade++;
          i += 2;
        } else if (texto[i] === ">" && texto[i + 1] === ">") {
          profundidade--;
          i += 2;
        } else i++;
      }
      continue;
    }
    if (/[-.\d]/.test(c)) {
      let j = i + 1;
      while (j < n && /[-.\d]/.test(texto[j])) j++;
      tokens.push({ tipo: "num", valor: parseFloat(texto.slice(i, j)) });
      i = j;
      continue;
    }
    // operador (letras, *, ', ")
    let j = i;
    while (j < n && /[A-Za-z*'"]/.test(texto[j])) j++;
    if (j === i) {
      i++;
      continue;
    } // caractere solto desconhecido — ignora
    tokens.push({ tipo: "op", valor: texto.slice(i, j) });
    i = j;
  }
  return tokens;
}

// Agrupa array [ ... ] em 1 token pra simplificar o interpretador.
function agruparArrays(tokens) {
  const saida = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.tipo === "[") {
      const itens = [];
      i++;
      while (i < tokens.length && tokens[i].tipo !== "]") {
        itens.push(tokens[i]);
        i++;
      }
      i++; // pula o ]
      saida.push({ tipo: "arr", itens });
      continue;
    }
    saida.push(t);
    i++;
  }
  return saida;
}

/**
 * Interpreta o content stream de 1 página e devolve linhas de {fonte, code}.
 *
 * Não flusha a cada operador de posicionamento — alguns geradores de PDF
 * (achado real testando com PDF de exemplo) usam vários `Td` pequenos
 * DENTRO da mesma linha visual (ajuste fino de espaçamento), então flushar
 * em todo Td picotava uma linha em vários pedaços. Em vez disso, rastreia
 * a posição Y acumulada (Tm define absoluto; Td/TD/T* somam) e agrupa por
 * Y arredondado no final — mesmo espírito de agrupar por `top` que
 * `pdfplumber`/`pdfminer` fazem em Python, só que calculado à mão aqui.
 */
const FONTE_ESPACO_SINTETICO = "__espaco__";

function extrairLinhasBrutas(conteudoLatin1, fontesType3 = new Set()) {
  const tokens = agruparArrays(tokenizar(conteudoLatin1));
  const itens = []; // { y, fonte, code }
  let fonteAtual = null;
  let y = 0;
  let leading = 0;
  // Um `Td`/`TD` de deslocamento "grande" (salto de coluna, ex.: código ->
  // nome numa tabela) não vem com espaço embutido na string — só a posição
  // muda. Um `Td` pequeno é kerning fino dentro da mesma palavra/linha (visto
  // testando com PDF real) e não deve virar espaço. 0.3 (em unidade de
  // espaço de texto, antes de multiplicar pelo tamanho da fonte) separa bem
  // os dois casos nos PDFs testados nesta sessão — MAS a fonte Type3
  // ofuscada da TRI usa `Td` entre glifos individuais com deslocamentos que
  // passam desse limiar mesmo dentro da mesma palavra, então a heurística
  // fica desligada quando a fonte ativa é Type3 (o texto ali já sai sem
  // espaço nenhum, igual ao PDF original).
  const LIMIAR_ESPACO = 0.3;
  let precisaEspaco = false;

  function pushString(bytes) {
    if (precisaEspaco && itens.length > 0 && bytes.length > 0) {
      itens.push({ y, fonte: FONTE_ESPACO_SINTETICO, code: 32 });
    }
    precisaEspaco = false;
    for (const b of bytes) itens.push({ y, fonte: fonteAtual, code: b });
  }

  let operandos = [];
  for (const tok of tokens) {
    if (tok.tipo !== "op") {
      operandos.push(tok);
      continue;
    }
    const nums = operandos.filter((o) => o.tipo === "num").map((o) => o.valor);
    switch (tok.valor) {
      case "Tf":
        if (operandos[0] && operandos[0].tipo === "nome") fonteAtual = operandos[0].valor;
        break;
      case "TL":
        leading = nums[0] ?? leading;
        break;
      case "Tm":
        // a b c d e f Tm — f é a translação Y absoluta da matriz de texto.
        y = nums[5] ?? y;
        break;
      case "Td":
      case "TD": {
        const tx = nums[0] ?? 0;
        const ty = nums[1] ?? 0;
        y += ty;
        if (!fontesType3.has(fonteAtual) && (Math.abs(tx) > LIMIAR_ESPACO || Math.abs(ty) > LIMIAR_ESPACO)) {
          precisaEspaco = true;
        }
        if (tok.valor === "TD") leading = -ty;
        break;
      }
      case "T*":
        y -= leading;
        break;
      case "Tj":
        if (operandos[0] && operandos[0].tipo === "str") pushString(operandos[0].bytes);
        break;
      case "TJ":
        if (operandos[0] && operandos[0].tipo === "arr") {
          for (const item of operandos[0].itens) {
            if (item.tipo === "str") pushString(item.bytes);
          }
        }
        break;
      default:
        break;
    }
    operandos = [];
  }

  // Agrupa por Y arredondado, preservando a ordem de encontro (que já é
  // esquerda→direita/topo→baixo na ordem em que o PDF desenha).
  const gruposPorY = new Map();
  const ordemY = [];
  for (const item of itens) {
    const chaveY = Math.round(item.y);
    if (!gruposPorY.has(chaveY)) {
      gruposPorY.set(chaveY, []);
      ordemY.push(chaveY);
    }
    gruposPorY.get(chaveY).push(item);
  }
  // Página normalmente desenha de cima (Y maior) pra baixo (Y menor).
  ordemY.sort((a, b) => b - a);
  return ordemY.map((chaveY) => gruposPorY.get(chaveY));
}

// ── Assinatura geométrica de um glifo Type3 (mesma lógica da validação em
// Python: só os operadores m/l/c/d1 importam, arredondados) ──────────────
function assinaturaDoGlifo(conteudoLatin1) {
  const tokens = tokenizar(conteudoLatin1);
  const ops = [];
  let operandos = [];
  for (const tok of tokens) {
    if (tok.tipo === "num") {
      operandos.push(tok.valor);
      continue;
    }
    if (tok.tipo === "op") {
      if (tok.valor === "m" || tok.valor === "l") {
        const [x, y] = operandos.slice(-2);
        ops.push([tok.valor, round1(x), round1(y)]);
      } else if (tok.valor === "c") {
        const seis = operandos.slice(-6).map(round1);
        ops.push(["c", ...seis]);
      } else if (tok.valor === "d1") {
        ops.push(["d1"]);
      }
      operandos = [];
    }
  }
  return JSON.stringify(ops);
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function decodePDFStreamBytes(page, ref) {
  const stream = page.doc.context.lookup(ref);
  return decodePDFRawStream(stream).decode();
}

/**
 * Varre TODAS as páginas do documento e monta o catálogo
 * assinatura → índice de 1ª ocorrência (pra bater com ROTULOS_TYPE3).
 */
function coletarCatalogoType3(pdfDoc) {
  const assinaturaParaIndice = new Map();
  for (const page of pdfDoc.getPages()) {
    const resources = page.node.Resources();
    const fontDict = resources && resources.lookupMaybe(PDFName.of("Font"), PDFDict);
    if (!fontDict) continue;
    for (const [, ref] of fontDict.entries()) {
      const fontObj = page.doc.context.lookup(ref, PDFDict);
      const subtype = fontObj.get(PDFName.of("Subtype"));
      if (!subtype || subtype.toString() !== "/Type3") continue;
      const charProcs = fontObj.lookupMaybe(PDFName.of("CharProcs"), PDFDict);
      if (!charProcs) continue;
      for (const [, gref] of charProcs.entries()) {
        const bytes = decodePDFStreamBytes(page, gref);
        const sig = assinaturaDoGlifo(Buffer.from(bytes).toString("latin1"));
        if (!assinaturaParaIndice.has(sig)) {
          assinaturaParaIndice.set(sig, assinaturaParaIndice.size);
        }
      }
    }
  }
  return assinaturaParaIndice;
}

/** Monta code(int) -> rótulo pra 1 página, usando o catálogo global. */
function mapaCodigoDaPagina(page, assinaturaParaIndice) {
  const mapa = {};
  const resources = page.node.Resources();
  const fontDict = resources && resources.lookupMaybe(PDFName.of("Font"), PDFDict);
  if (!fontDict) return mapa;
  for (const [fname, ref] of fontDict.entries()) {
    const fontObj = page.doc.context.lookup(ref, PDFDict);
    const subtype = fontObj.get(PDFName.of("Subtype"));
    if (!subtype || subtype.toString() !== "/Type3") continue;
    const encoding = fontObj.lookupMaybe(PDFName.of("Encoding"), PDFDict);
    if (!encoding) continue;
    const diffs = encoding.lookupMaybe(PDFName.of("Differences"), PDFArray);
    if (!diffs) continue;
    const charProcs = fontObj.lookupMaybe(PDFName.of("CharProcs"), PDFDict);
    if (!charProcs) continue;

    let atual = null;
    const codigoParaNome = {};
    for (const item of diffs.asArray()) {
      if (item instanceof PDFNumber) {
        atual = item.asNumber();
      } else {
        codigoParaNome[atual] = item.toString().replace(/^\//, "");
        atual++;
      }
    }
    const nomeFonteSemBarra = fname.toString().replace(/^\//, "");
    for (const [codigo, gname] of Object.entries(codigoParaNome)) {
      const gref = charProcs.get(PDFName.of(gname));
      if (!gref) continue;
      const bytes = decodePDFStreamBytes(page, gref);
      const sig = assinaturaDoGlifo(Buffer.from(bytes).toString("latin1"));
      const idx = assinaturaParaIndice.get(sig);
      if (idx !== undefined) {
        mapa[`${nomeFonteSemBarra}:${codigo}`] = ROTULOS_TYPE3[idx] ?? "?";
      }
    }
  }
  return mapa;
}

/**
 * Decodifica 1 página inteira pra texto (linhas), resolvendo código de
 * caractere pela fonte ativa em cada trecho: Type3 usa o mapa de
 * assinatura geométrica, fonte simples usa passthrough latin1.
 */
function fontesType3DaPagina(page) {
  const nomes = new Set();
  const resources = page.node.Resources();
  const fontDict = resources && resources.lookupMaybe(PDFName.of("Font"), PDFDict);
  if (!fontDict) return nomes;
  for (const [fname, ref] of fontDict.entries()) {
    const fontObj = page.doc.context.lookup(ref, PDFDict);
    const subtype = fontObj.get(PDFName.of("Subtype"));
    if (subtype && subtype.toString() === "/Type3") nomes.add(fname.toString().replace(/^\//, ""));
  }
  return nomes;
}

function decodificarPagina(page, assinaturaParaIndice) {
  const contentsEntry = page.node.get(PDFName.of("Contents"));
  const refs = contentsEntry.constructor.name === "PDFArray" ? contentsEntry.asArray() : [contentsEntry];
  const partes = refs.map((r) => Buffer.from(decodePDFStreamBytes(page, r)).toString("latin1"));
  const conteudo = partes.join("\n");

  const mapaCodigo = mapaCodigoDaPagina(page, assinaturaParaIndice);
  const linhasBrutas = extrairLinhasBrutas(conteudo, fontesType3DaPagina(page));

  return linhasBrutas.map((linha) =>
    linha
      .map(({ fonte, code }) => (fonte === FONTE_ESPACO_SINTETICO ? " " : mapaCodigo[`${fonte}:${code}`] ?? String.fromCharCode(code)))
      .join(""),
  );
}

module.exports = { coletarCatalogoType3, decodificarPagina, ROTULOS_TYPE3 };
