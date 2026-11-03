const PALAVRAS_VAZIAS = new Set([
  "a", "ao", "as", "com", "da", "das", "de", "do", "dos", "e", "em", "eu",
  "meu", "minha", "no", "nos", "o", "os", "para", "por", "que", "um", "uma",
  "agora", "atual", "atualmente", "disponivel", "disponiveis", "estoque",
  "fisica", "fisicas", "fisico", "hoje", "item", "material", "materiais", "mais",
  "produto", "qual", "quanto", "quantas", "quantidade", "reservada", "reservadas",
  "reservado", "temos", "tenho", "unidade", "unidades",
]);

function normalizar(texto: unknown): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizarCodigo(texto: unknown): string {
  const codigo = normalizar(texto).replace(/\s+/g, "");
  return codigo.replace(/^0+(?=\d)/, "");
}

export function ehPerguntaQuantidadeAtual(pergunta: string): boolean {
  const q = normalizar(pergunta);
  if (/(entrada.*registrad|quantas entradas)/.test(q)) return false;
  if (/(comprar|compra|dinheiro|valor|reais|parado|acumulado|alvo|minimo|maximo)/.test(q)) return false;
  if (/qual .*mais/.test(q)) return false;
  return /(quanto|quantas|quantidade|tenho|temos|unidades?)/.test(q)
    && /(estoque|fisic|disponivel|tenho|temos)/.test(q);
}

type ItemRelacionado = Record<string, unknown> & {
  _pontuacao: number;
  _tamanho_exato: boolean;
  _cobertura_termos: number;
  _codigo_exato: boolean;
};

export function itensRelacionados(
  pergunta: string,
  itens: Record<string, unknown>[],
): ItemRelacionado[] {
  const tokensPergunta = new Set(normalizar(pergunta).split(" ").filter(Boolean));
  const termos = [...tokensPergunta].filter((token) => token.length > 1 && !PALAVRAS_VAZIAS.has(token));
  const codigosPergunta = new Set([...tokensPergunta].map(normalizarCodigo).filter(Boolean));

  return itens
    .map((item) => {
      const nome = normalizar(item.item);
      const tamanho = normalizar(item.tamanho);
      const codigo = normalizarCodigo(item.codigo);
      const palavrasNome = nome.split(" ").filter((token) => token.length > 1);
      const acertosNome = palavrasNome.filter((token) => tokensPergunta.has(token)).length;
      const tamanhoExato = Boolean(tamanho && tokensPergunta.has(tamanho));
      const codigoExato = Boolean(codigo && codigosPergunta.has(codigo));
      const termosEncontrados = termos.filter((termo) =>
        palavrasNome.includes(termo)
        || termo === tamanho
        || normalizarCodigo(termo) === codigo
      ).length;
      return {
        ...item,
        _pontuacao: acertosNome * 2 + termosEncontrados + (tamanhoExato ? 8 : 0) + (codigoExato ? 20 : 0),
        _tamanho_exato: tamanhoExato,
        _cobertura_termos: termos.length ? termosEncontrados / termos.length : 0,
        _codigo_exato: codigoExato,
      };
    })
    .filter((item) => item._pontuacao >= 3)
    .sort((a, b) =>
      Number(b._codigo_exato) - Number(a._codigo_exato)
      || b._cobertura_termos - a._cobertura_termos
      || b._pontuacao - a._pontuacao
      || Number(b._tamanho_exato) - Number(a._tamanho_exato)
    );
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
  if (!ehPerguntaQuantidadeAtual(pergunta)) return null;

  const relacionados = itensRelacionados(pergunta, itens);
  if (!relacionados.length) {
    return "Não encontrei uma ficha operacional que corresponda ao item informado. Para não confundir cadastros parecidos, não usei um saldo aproximado. Confira o nome exato ou informe o código exibido em Estoque & Etiquetas.";
  }
  const melhor = relacionados[0];
  if (!melhor._codigo_exato && melhor._cobertura_termos < 1) {
    return `Não encontrei uma ficha operacional que corresponda a todos os termos informados. O cadastro mais próximo é **${String(melhor.item)}**, mas não usei o saldo dele porque itens parecidos podem ter códigos e quantidades diferentes. Informe o código do item para uma consulta exata.`;
  }
  const nomeMelhor = normalizar(melhor.item);
  const temTamanhoExato = relacionados.some((item) => item._tamanho_exato);
  const linhas = relacionados
    .filter((item) => normalizar(item.item) === nomeMelhor && (!temTamanhoExato || item._tamanho_exato))
    .slice(0, 12);
  if (!linhas.length) return null;

  const numero = (valor: unknown) => Number(valor ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  if (linhas.length === 1) {
    const item = linhas[0];
    const codigo = item.codigo ? ` — código **${String(item.codigo)}**` : "";
    return `**${String(item.item)} (${String(item.tamanho ?? "único")})**${codigo}: ${numero(item.fisico)} unidade(s) física(s), ${numero(item.disponivel)} disponível(is) e ${numero(item.reservado)} reservada(s).`;
  }

  const totalFisico = linhas.reduce((soma, item) => soma + Number(item.fisico ?? 0), 0);
  const totalDisponivel = linhas.reduce((soma, item) => soma + Number(item.disponivel ?? 0), 0);
  const detalhe = linhas.map((item) => {
    const codigo = item.codigo ? `, código ${String(item.codigo)}` : "";
    return `- **${String(item.tamanho ?? "único")}**${codigo}: ${numero(item.fisico)} física(s), ${numero(item.disponivel)} disponível(is), ${numero(item.reservado)} reservada(s)`;
  }).join("\n");
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
