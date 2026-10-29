const PALAVRAS_VAZIAS = new Set([
  "a", "ao", "as", "com", "da", "das", "de", "do", "dos", "e", "em", "eu",
  "meu", "minha", "no", "nos", "o", "os", "para", "por", "que", "um", "uma",
  "atual", "atualmente", "estoque", "quanto", "quantidade", "tenho",
]);

function normalizar(texto: unknown): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function itensRelacionados(
  pergunta: string,
  itens: Record<string, unknown>[],
): Array<Record<string, unknown> & { _pontuacao: number; _tamanho_exato: boolean }> {
  const tokensPergunta = new Set(normalizar(pergunta).split(" ").filter(Boolean));
  const termos = [...tokensPergunta].filter((token) => token.length > 1 && !PALAVRAS_VAZIAS.has(token));

  return itens
    .map((item) => {
      const nome = normalizar(item.item);
      const tamanho = normalizar(item.tamanho);
      const palavrasNome = nome.split(" ").filter((token) => token.length > 1);
      const acertosNome = palavrasNome.filter((token) => tokensPergunta.has(token)).length;
      const tamanhoExato = Boolean(tamanho && tokensPergunta.has(tamanho));
      const termosEncontrados = termos.filter((termo) => nome.includes(termo) || termo === tamanho).length;
      return {
        ...item,
        _pontuacao: acertosNome * 2 + termosEncontrados + (tamanhoExato ? 8 : 0),
        _tamanho_exato: tamanhoExato,
      };
    })
    .filter((item) => item._pontuacao >= 3)
    .sort((a, b) => b._pontuacao - a._pontuacao || Number(b._tamanho_exato) - Number(a._tamanho_exato));
}

/**
 * Responde saldo atual diretamente do resultado determinístico da RPC. O
 * modelo de linguagem não participa da conta e não pode confundir ausência
 * na amostra do prompt com ausência no estoque.
 */
export function respostaQuantidadeAtual(
  pergunta: string,
  itens: Record<string, unknown>[],
): string | null {
  const q = normalizar(pergunta);
  if (!/(quanto|quantidade|tenho)/.test(q) || !/(estoque|fisic|disponivel|tenho)/.test(q)) return null;

  const relacionados = itensRelacionados(pergunta, itens);
  if (!relacionados.length) return null;
  const melhor = relacionados[0];
  const nomeMelhor = normalizar(melhor.item);
  const temTamanhoExato = relacionados.some((item) => item._tamanho_exato);
  const linhas = relacionados
    .filter((item) => normalizar(item.item) === nomeMelhor && (!temTamanhoExato || item._tamanho_exato))
    .slice(0, 12);
  if (!linhas.length) return null;

  const numero = (valor: unknown) => Number(valor ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  if (linhas.length === 1) {
    const item = linhas[0];
    return `**${String(item.item)} (${String(item.tamanho ?? "único")})**: ${numero(item.fisico)} unidade(s) física(s), ${numero(item.disponivel)} disponível(is) e ${numero(item.reservado)} reservada(s).`;
  }

  const totalFisico = linhas.reduce((soma, item) => soma + Number(item.fisico ?? 0), 0);
  const totalDisponivel = linhas.reduce((soma, item) => soma + Number(item.disponivel ?? 0), 0);
  const detalhe = linhas.map((item) =>
    `- **${String(item.tamanho ?? "único")}**: ${numero(item.fisico)} física(s), ${numero(item.disponivel)} disponível(is), ${numero(item.reservado)} reservada(s)`,
  ).join("\n");
  return `**${String(linhas[0].item)}**: ${numero(totalFisico)} unidade(s) física(s) e ${numero(totalDisponivel)} disponível(is) no total.\n${detalhe}`;
}

/**
 * KPIs operacionais não passam pelo modelo de linguagem. A resposta usa o
 * mesmo número que alimenta o cartão da tela Estoque & Etiquetas.
 */
export function respostaResumoOperacional(
  pergunta: string,
  resumo: Record<string, unknown>,
): string | null {
  const q = normalizar(pergunta);
  const perguntaEntradas = (
    /entrada/.test(q) && /(registrad|registro|etiqueta)/.test(q)
  ) || /quantas entradas/.test(q);
  if (!perguntaEntradas) return null;

  const valor = Number(resumo.entradas_registradas);
  if (!Number.isFinite(valor)) return null;
  return `Há **${valor.toLocaleString("pt-BR")} entradas registradas** no estoque atual. Esse é o mesmo total exibido no cartão “Entradas registradas” de Estoque & Etiquetas para a empresa selecionada.`;
}
