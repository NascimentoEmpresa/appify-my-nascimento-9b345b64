// A mesma lista alimenta a divisão e a conferência final: uma fatia ausente
// nunca pode transformar uma varredura incompleta em check verde.
export function descobrirRotas(app, so = null) {
  const bloco = app.slice(app.indexOf('<Route path="/app"'));
  return [...new Set([...bloco.matchAll(/<Route path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => !p.includes(":") && !p.includes("*"))
    .map((p) => p.startsWith("/") ? p : `/app/${p}`)
    .filter((p) => p.startsWith("/app/") && (!so || p.startsWith(so))))].sort();
}

export function selecionarFatia(rotas, especificacao = "1/1") {
  const partes = /^(\d+)\/(\d+)$/.exec(especificacao);
  const indice = Number(partes?.[1]), total = Number(partes?.[2]);
  if (!Number.isSafeInteger(indice) || !Number.isSafeInteger(total)
      || indice < 1 || total < 1 || indice > total || total > rotas.length) {
    throw new Error(`Fatia inválida: ${especificacao} (${rotas.length} rotas disponíveis). Use N/T, com 1 <= N <= T <= número de rotas.`);
  }
  return { indice, total, rotas: rotas.filter((_, i) => i % total === indice - 1) };
}

export function consolidarOrcamentos(relatorios, rotasEsperadas) {
  const total = relatorios[0]?.fatia?.total;
  if (!Number.isSafeInteger(total) || total < 1 || relatorios.length !== total) {
    throw new Error("Relatórios incompletos: falta pelo menos uma fatia do QA.");
  }
  const base = relatorios[0].base;
  const indices = new Set(), porRota = new Map();
  for (const relatorio of relatorios) {
    const { indice, total: tamanho } = relatorio.fatia ?? {};
    if (tamanho !== total || indices.has(indice) || relatorio.base !== base) {
      throw new Error("Fatias repetidas ou incompatíveis entre os relatórios do QA.");
    }
    const esperadas = selecionarFatia(rotasEsperadas, `${indice}/${total}`).rotas;
    indices.add(indice);
    if (!Array.isArray(relatorio.resultados) || relatorio.resultados.length !== esperadas.length) {
      throw new Error(`Fatia ${indice}/${total} incompleta.`);
    }
    const permitidas = new Set(esperadas);
    for (const resultado of relatorio.resultados) {
      if (!permitidas.has(resultado.rota) || porRota.has(resultado.rota)) {
        throw new Error(`Rota repetida ou fora da fatia ${indice}/${total}: ${resultado.rota}`);
      }
      if (!Number.isInteger(resultado.abertura) || resultado.abertura < 0
          || !Number.isInteger(resultado.parada) || resultado.parada < 0
          || !Array.isArray(resultado.problemas)) {
        throw new Error(`Resultado inválido para ${resultado.rota}.`);
      }
      porRota.set(resultado.rota, resultado);
    }
  }
  return { quando: new Date().toISOString(), base, resultados: [...porRota.values()].sort((a, b) => a.rota.localeCompare(b.rota)) };
}
