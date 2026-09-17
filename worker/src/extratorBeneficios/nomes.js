// SIS-2026-0427: fuzzy match de nome (Excel × PDF) — port do padrão usado
// nos 4 processadores Python (`difflib.get_close_matches`). Node não tem
// equivalente pronto, então usamos coeficiente de Dice sobre bigramas de
// caractere, que se comporta de forma parecida pra diferenças pequenas de
// digitação (é uma aproximação, não o mesmo algoritmo — revisitar se algum
// caso real divergir muito do resultado do app Python).

function bigramas(s) {
  const b = [];
  for (let i = 0; i < s.length - 1; i++) b.push(s.slice(i, i + 2));
  return b;
}

function similaridade(a, b) {
  if (a === b) return 1;
  const ba = bigramas(a);
  const bb = bigramas(b);
  if (ba.length === 0 || bb.length === 0) return 0;
  const contagem = new Map();
  for (const x of ba) contagem.set(x, (contagem.get(x) || 0) + 1);
  let interseccao = 0;
  for (const x of bb) {
    const c = contagem.get(x) || 0;
    if (c > 0) {
      interseccao++;
      contagem.set(x, c - 1);
    }
  }
  return (2 * interseccao) / (ba.length + bb.length);
}

function melhorPorSimilaridade(nomeProcurado, lista, cutoff) {
  let melhor = null;
  let melhorScore = 0;
  for (const candidato of lista) {
    const score = similaridade(nomeProcurado, candidato);
    if (score > melhorScore) {
      melhorScore = score;
      melhor = candidato;
    }
  }
  return melhorScore >= cutoff ? melhor : null;
}

// Padrão UFRGS (cutoff 0.85 + substring com trava de 2+ palavras).
function encontrarMelhorMatchExcel(nomeProcurado, listaNomesExcel) {
  if (!nomeProcurado) return null;
  if (listaNomesExcel.includes(nomeProcurado)) return nomeProcurado;
  const porSimilaridade = melhorPorSimilaridade(nomeProcurado, listaNomesExcel, 0.85);
  if (porSimilaridade) return porSimilaridade;
  if (nomeProcurado.split(" ").length >= 2) {
    for (const n of listaNomesExcel) {
      if (nomeProcurado.includes(n) || n.includes(nomeProcurado)) return n;
    }
  }
  return null;
}

// Padrão SAMU/SMS/TJ (substring primeiro, depois cutoff 0.75).
function encontrarMelhorMatchPdf(nomeProcurado, listaNomesPdf) {
  if (!nomeProcurado) return null;
  if (listaNomesPdf.includes(nomeProcurado)) return nomeProcurado;
  for (const nomePdf of listaNomesPdf) {
    if (nomeProcurado.includes(nomePdf) || nomePdf.includes(nomeProcurado)) return nomePdf;
  }
  return melhorPorSimilaridade(nomeProcurado, listaNomesPdf, 0.75);
}

module.exports = { encontrarMelhorMatchExcel, encontrarMelhorMatchPdf };
