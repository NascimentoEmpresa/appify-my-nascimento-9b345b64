// SIS-2026-0427: port 1:1 de extratores.py (app Python da Ana) — extrai
// valor de VA/VT e dias trabalhados de PDFs de operadoras diferentes.
// Texto de cada página vem de `type3Pdf.decodificarPagina` (cobre tanto
// PDF normal quanto o formato Type3 ofuscado da TRI, sem OCR).

const { PDFDocument } = require("pdf-lib");
const { coletarCatalogoType3, decodificarPagina } = require("./type3Pdf");

function limparTexto(texto) {
  if (texto == null) return "";
  return String(texto)
    .toUpperCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

async function paginasDoPdf(caminhoOuBuffer) {
  const bytes = Buffer.isBuffer(caminhoOuBuffer) ? caminhoOuBuffer : require("fs").readFileSync(caminhoOuBuffer);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  const catalogo = coletarCatalogoType3(pdf);
  return pdf.getPages().map((p) => decodificarPagina(p, catalogo));
}

function valorParaFloat(valorStr) {
  return parseFloat(valorStr.trim().replace(/\./g, "").replace(",", "."));
}

// ── VA — mesma heurística do Python: linha com "R$" que não é "TOTAL"/
// "VALOR", nome = palavras antes do departamento conhecido ────────────────
async function extrairVA(caminhoOuBuffer) {
  const paginas = await paginasDoPdf(caminhoOuBuffer);
  const dados = [];
  for (const linhas of paginas) {
    for (const linha of linhas) {
      const upper = linha.toUpperCase();
      if (!linha.includes("R$") || upper.includes("TOTAL") || upper.includes("VALOR")) continue;
      const partes = linha.split("R$");
      if (partes.length < 2) continue;
      const textoEsquerdo = partes[0];
      const matchValor = partes[1].trim().split(/\s+/)[0];
      const valor = valorParaFloat(matchValor);
      if (!Number.isFinite(valor)) continue;

      let textoSemDepto = textoEsquerdo;
      for (const marcador of ["UFRGS", "TRIBUNAL", "SAMU", "NASCIMENTO"]) {
        textoSemDepto = textoSemDepto.split(marcador)[0];
      }
      const palavras = textoSemDepto.match(/[A-ZÀ-Ÿa-z]+/g) || [];
      const nomeLimpo = palavras.join(" ").trim();
      if (nomeLimpo.length > 4) dados.push({ nome: nomeLimpo, valorVA: valor });
    }
  }
  const porNome = new Map();
  for (const d of dados) porNome.set(limparTexto(d.nome), d); // keep=last, igual ao Python
  return Array.from(porNome.entries()).map(([nomeLimpo, d]) => ({ nome: d.nome, valorVA: d.valorVA, nomeLimpo }));
}

// ── VT — dispatcha pro sub-parser certo por marcador de texto, igual o
// Python. Type3-TRI já vem decodificado como texto normal (o decodificador
// geométrico resolve isso antes de chegar aqui), então cai no _parseTri
// direto — sem branch de OCR nenhum.
async function extrairVT(caminhoOuBuffer) {
  const paginas = await paginasDoPdf(caminhoOuBuffer);
  let todos = [];
  for (const linhas of paginas) {
    const texto = linhas.join("\n");
    if (/\b\d{14}\b/.test(texto) || texto.includes("Cartão VT") || texto.includes("TEU!")) {
      todos = todos.concat(parseTeu(texto));
    } else if (texto.includes("Status da recarga") || texto.includes("Pronto para Recarga")) {
      todos = todos.concat(parseTri(texto));
    } else if (texto.includes("SWAP Instituição") || texto.includes("Comprovante de pedido")) {
      todos = todos.concat(parseProspera(texto));
    } else if (texto.includes("ANTECIPADO") && (texto.includes("Doc. Federal") || texto.includes("Cadastro"))) {
      todos = todos.concat(parseSaoJose(texto));
    } else if (texto.includes("Recibo de Pagamento") && (texto.includes("PIX") || texto.includes("Destinatário") || texto.includes("ID Transação"))) {
      todos = todos.concat(parsePix(texto));
    }
  }
  const porNome = new Map();
  for (const d of todos) {
    const chave = limparTexto(d.nome);
    const atual = porNome.get(chave);
    if (atual) atual.valorVT += d.valorVT;
    else porNome.set(chave, { nome: d.nome, valorVT: d.valorVT });
  }
  return Array.from(porNome.entries()).map(([nomeLimpo, d]) => ({ ...d, nomeLimpo }));
}

function parseTeu(texto) {
  const dados = [];
  const blocos = texto.split(/(?=\b\d{10,15}\s+\d+\b)/);
  const ignorar = new Set(["VT", "TOTAL", "RS", "CARTAO", "LINHA", "VALOR", "TIPO", "UTILIZACAO", "TEU", "BILHETE", "METROPOLITANG", "METROPOLITAND", "ASSOC", "EMP", "SBE", "RMPA", "CNPJ", "NASCIMENTO", "SERVICOS", "LIMPEZA", "LTDA", "CENTRO", "PORTO", "ALEGRE", "TRIUNFO"]);
  for (const bloco of blocos) {
    if (bloco.trim().length < 20) continue;
    const textoUtil = bloco.split(/Funcion[aá]rio/i)[0];
    const valores = textoUtil.match(/(\d{1,3}(?:\.\d{3})*[,.]\d{2}|\b\d+[,.]\d{2}\b)/g);
    if (!valores) continue;
    const valStr = valores[valores.length - 1];
    const val = parseFloat(`${valStr.slice(0, -3).replace(/\./g, "").replace(",", "")}.${valStr.slice(-2)}`);
    if (val > 2000) continue;
    const palavras = textoUtil.match(/[A-Za-zÀ-Ÿ]{2,}/g) || [];
    const nomeLimpo = palavras.filter((p) => !ignorar.has(limparTexto(p))).map((p) => p.toUpperCase()).join(" ");
    if (nomeLimpo.length > 4) dados.push({ nome: nomeLimpo, valorVT: val });
  }
  return dados;
}

function parseTri(texto) {
  const dados = [];
  const linhas = texto.split("\n");
  const ignorar = new Set(["PRONTO", "PARA", "RECARGA", "RECARREGADO", "TOTALMENTE", "CODIGO", "CARTAO", "VALOR", "STATUS"]);
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!/\b\d{11}\b/.test(linha) || !linha.includes("R$")) continue;
    const valMatch = linha.match(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/);
    if (!valMatch) continue;
    const val = parseFloat(valMatch[1].replace(/\./g, "").replace(",", "."));
    if (val > 2000) continue;
    const vizinhos = [];
    if (i > 0 && !/\b\d{11}\b/.test(linhas[i - 1])) vizinhos.push(linhas[i - 1]);
    vizinhos.push(linha);
    if (i < linhas.length - 1 && !/\b\d{11}\b/.test(linhas[i + 1])) vizinhos.push(linhas[i + 1]);
    const bloco = vizinhos.join(" ");
    const palavras = bloco.match(/[A-Za-zÀ-Ÿ]{3,}/g) || [];
    const nome = palavras.filter((p) => !ignorar.has(limparTexto(p))).join(" ");
    if (nome.length > 4) dados.push({ nome: nome.toUpperCase(), valorVT: val });
  }
  return dados;
}

function parseProspera(texto) {
  const dados = [];
  const linhas = texto.split("\n");
  const ignorar = new Set(["UFRGS", "JARDI", "NAGEM", "NOME", "DOCUMENTO", "TIME", "VALOR", "LIVRE", "TOTAL", "PEDIDO", "CENTRO"]);
  const reCpf = /\d{3}\.\d{3}\.\d{3}-\d{2}/;
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!reCpf.test(linha) || !linha.includes("R$")) continue;
    const valMatch = linha.match(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/);
    if (!valMatch) continue;
    const val = parseFloat(valMatch[1].replace(/\./g, "").replace(",", "."));
    if (val > 2000) continue;
    const vizinhos = [];
    if (i > 0 && !reCpf.test(linhas[i - 1])) vizinhos.push(linhas[i - 1]);
    vizinhos.push(linha);
    if (i < linhas.length - 1 && !reCpf.test(linhas[i + 1])) vizinhos.push(linhas[i + 1]);
    const bloco = vizinhos.join(" ").replace(/-\n/g, "").replace(/- /g, "");
    const palavras = bloco.match(/[A-Za-zÀ-Ÿ]{3,}/g) || [];
    const nome = palavras.filter((p) => !ignorar.has(limparTexto(p))).join(" ");
    if (nome.length > 4) dados.push({ nome: nome.toUpperCase(), valorVT: val });
  }
  return dados;
}

function parseSaoJose(texto) {
  const dados = [];
  const linhas = texto.split("\n");
  const reCpf = /\d{3}\.\d{3}\.\d{3}-\d{2}/;
  const ignorar = new Set(["PAGO", "CARTAO", "TIPO", "NOME", "FEDERAL", "QUANTIDADE", "VALOR", "UNIT", "TOTAL", "DATA", "SITUACAO", "DOC"]);
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.includes("ANTECIPADO") || !reCpf.test(linha)) continue;
    const valMatch = linha.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s+\d{2}\/\d{2}\/\d{4}/);
    if (!valMatch) continue;
    const val = parseFloat(valMatch[1].replace(/\./g, "").replace(",", "."));
    if (val > 2000) continue;
    const cpfMatch = linha.match(reCpf);
    let nome = "";
    if (cpfMatch) {
      const parteMeio = linha.split("ANTECIPADO")[1].split(cpfMatch[0])[0];
      nome = parteMeio.replace(/[^A-ZÀ-Ÿa-z ]/g, "").trim();
    }
    if (nome.length < 4) {
      const vizinhos = [];
      if (i > 0 && !linhas[i - 1].includes("ANTECIPADO")) vizinhos.push(linhas[i - 1]);
      if (i < linhas.length - 1 && !linhas[i + 1].includes("ANTECIPADO")) vizinhos.push(linhas[i + 1]);
      const blocoVizinho = vizinhos.join(" ");
      const palavras = blocoVizinho.match(/[A-Za-zÀ-Ÿ]{3,}/g) || [];
      nome = palavras.filter((p) => !ignorar.has(limparTexto(p))).join(" ");
    }
    if (nome.length > 4) dados.push({ nome: nome.toUpperCase(), valorVT: val });
  }
  return dados;
}

function parsePix(texto) {
  const dados = [];
  const blocos = texto.split("Recibo de Pagamento");
  for (const bloco of blocos) {
    const valMatch = bloco.match(/Valor:\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/);
    if (!valMatch) continue;
    const val = parseFloat(valMatch[1].replace(/\./g, "").replace(",", "."));
    if (val > 2000) continue;
    const nomes = bloco.match(/Nome:\s*([A-Za-zÀ-Ÿ\s]+)/g) || [];
    for (const n of nomes) {
      const nClean = n.replace(/^Nome:\s*/, "").replace(/\n/g, " ").trim().toUpperCase();
      if (!nClean.includes("NASCIMENTO") && !nClean.includes("ASSOC") && nClean.length > 4) {
        dados.push({ nome: nClean, valorVT: val });
        break;
      }
    }
  }
  return dados;
}

// ── Ponto (SAMU/SMS) — bate batida "HH:MM" (SMS) ou só presença numérica
// (SAMU) por dia, mesma lógica do Python ─────────────────────────────────
async function extrairDiasTrabalhados(caminhoOuBuffer, { exigirHorario }) {
  const paginas = await paginasDoPdf(caminhoOuBuffer);
  const textoCompleto = paginas.map((linhas) => linhas.join("\n")).join("\n");
  const blocos = textoCompleto.split("Empregado:").slice(1);
  const dados = [];

  for (const bloco of blocos) {
    let matchNome = bloco.match(/^\s*\d+\s+([A-ZÀ-Ÿa-z ]+)/) || bloco.match(/^\s*\d+\n([A-ZÀ-Ÿa-z ]+)/);
    if (!matchNome) continue;
    let nomeSujo = matchNome[1].replace(/\n/g, " ").trim();
    let nomeLimpoPdf = nomeSujo.split(/Data de Admiss/i)[0];
    nomeLimpoPdf = nomeLimpoPdf.replace(/[^A-ZÀ-Ÿa-z ]/g, "").trim().replace(/\s+/g, " ");

    const textoCorrido = bloco.replace(/\n/g, " ");
    const diasMatches = Array.from(textoCorrido.matchAll(/(\d{2}\/\d{2})\s*["',]*\s*(DOM|SEG|TER|QUA|QUI|SEX|SAB)/g));

    let diasTrabalhados = 0;
    const diasVistos = new Set();
    for (let i = 0; i < diasMatches.length; i++) {
      const diaAtual = diasMatches[i][1];
      if (diasVistos.has(diaAtual)) continue;
      const inicioBusca = diasMatches[i].index + diasMatches[i][0].length;
      const fimBusca = i + 1 < diasMatches.length ? diasMatches[i + 1].index : textoCorrido.length;
      const textoDoDia = textoCorrido.slice(inicioBusca, fimBusca);

      let contaHoje = false;
      if (exigirHorario) {
        contaHoje = /\d{2}:\d{2}/.test(textoDoDia);
      } else {
        const palavras = textoDoDia.split(/\s+/).map((p) => p.replace(/^["', ]+|["', ]+$/g, "")).filter(Boolean);
        contaHoje = palavras.length > 0 && /^\d/.test(palavras[0]);
      }
      if (contaHoje) {
        diasTrabalhados++;
        diasVistos.add(diaAtual);
      }
    }
    if (nomeLimpoPdf.length > 4) dados.push({ nome: nomeLimpoPdf, diasTrabalhados });
  }

  const porNome = new Map();
  for (const d of dados) {
    const chave = limparTexto(d.nome);
    const atual = porNome.get(chave);
    if (atual) atual.diasTrabalhados += d.diasTrabalhados;
    else porNome.set(chave, { ...d });
  }
  return Array.from(porNome.entries()).map(([nomeLimpo, d]) => ({ ...d, nomeLimpo }));
}

const extrairDiasTrabalhadosSamu = (caminhoOuBuffer) => extrairDiasTrabalhados(caminhoOuBuffer, { exigirHorario: false });
const extrairDiasTrabalhadosSms = (caminhoOuBuffer) => extrairDiasTrabalhados(caminhoOuBuffer, { exigirHorario: true });

module.exports = {
  limparTexto,
  paginasDoPdf,
  extrairVA,
  extrairVT,
  extrairDiasTrabalhadosSamu,
  extrairDiasTrabalhadosSms,
};
