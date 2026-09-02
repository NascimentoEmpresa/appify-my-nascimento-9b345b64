/**
 * Regras da edição de um pedido de materiais, em funções puras.
 *
 * Vivem fora do modal por dois motivos: são as mesmas regras que a RPC
 * `sup_pedido_editar` aplica no banco (e precisam ser conferíveis lado a
 * lado), e é o que dá para testar sem montar a tela — o padrão de teste
 * deste repo é regra de negócio, não rendering.
 *
 * A tela nunca é a dona da regra: tudo aqui existe para o operador
 * descobrir o "não pode" ANTES de preencher o formulário inteiro. Se algo
 * escapar daqui, o banco recusa do mesmo jeito.
 */

/**
 * Status em que o pedido só aceita observação.
 *
 * DESPACHADO: a peça física já saiu. CANCELADO: o pedido acabou. Reescrever
 * colaborador ou itens depois disso não corrige nada — reescreve o que
 * aconteceu.
 */
export const STATUS_SO_OBSERVACAO = ["DESPACHADO", "CANCELADO"] as const;

export function edicaoReduzida(status: string | null | undefined): boolean {
  return !!status && (STATUS_SO_OBSERVACAO as readonly string[]).includes(status);
}

/**
 * Ids de item que já consumiram etiqueta do estoque, e por isso não podem
 * ser removidos nem alterados — em nenhum status.
 *
 * É a dívida §12.7 do legado: lá, editar o pedido reordenava o array JSONB e
 * a ligação entre item e TAG (que era pelo ÍNDICE) se perdia em silêncio.
 */
export function itensTravados(tags: { pedido_item_id: string }[]): Set<string> {
  return new Set(tags.map((t) => t.pedido_item_id));
}

export interface LinhaEditavel {
  /** Nulo enquanto o item ainda não existe no banco. */
  id: string | null;
  item_id: string | null;
  nome_item: string;
  tamanho: string;
  litros: string;
  quantidade: string;
}

export interface ContextoEdicao {
  admissao: boolean;
  nomeColaborador: string;
  /** `true` quando alguém foi escolhido no combobox de colaborador. */
  temColaborador: boolean;
  /**
   * Nome que já está gravado no pedido. Pedido anterior a 30/08/2026 tem
   * nome e nenhum vínculo com EMPREGADOS: exigir a escolha na lista travaria
   * até a correção de uma observação num pedido antigo.
   */
  nomeJaGravado?: string | null;
  tipoPedido: string;
  linhas: LinhaEditavel[];
  /** O catálogo da função obriga tamanho neste item? */
  exigeTamanho: (itemId: string | null) => boolean;
}

/**
 * Devolve a mensagem do primeiro problema, ou `null` se pode salvar.
 *
 * A ordem das checagens é a ordem em que o operador lê o formulário, de
 * cima para baixo — apontar primeiro um erro que está no fim da tela faz
 * ele rolar atrás de um campo que ainda nem preencheu.
 */
export function validarEdicao(c: ContextoEdicao): string | null {
  if (c.admissao && !c.nomeColaborador.trim()) {
    return "Informe o nome do novo colaborador.";
  }
  // Pedido só de insumos não atende ninguém em específico — é material de
  // posto, e por isso é o único caso sem colaborador.
  if (
    !c.admissao && !c.temColaborador
    && !(c.nomeJaGravado ?? "").trim()
    && c.tipoPedido !== "insumos"
  ) {
    return 'Escolha o colaborador na lista, ou marque "É admissão".';
  }
  if (c.linhas.length === 0) {
    return "O pedido precisa ter ao menos um item.";
  }
  const semTamanho = c.linhas.find((l) => c.exigeTamanho(l.item_id) && !l.tamanho.trim());
  if (semTamanho) {
    return `Escolha o tamanho de ${semTamanho.nome_item}.`;
  }
  const semQuantidade = c.linhas.find((l) => !(Number(l.quantidade) >= 1));
  if (semQuantidade) {
    return `A quantidade de ${semQuantidade.nome_item} precisa ser 1 ou mais.`;
  }
  return null;
}

export interface ItemPayload {
  id: string | null;
  item_id: string | null;
  tamanho: string | null;
  litros: string | null;
  quantidade: number;
}

/**
 * Converte as linhas da tela no `itens` que a RPC espera.
 *
 * Campo vazio vira `null`, e não `""`: no banco a coluna é anulável, e uma
 * string vazia apareceria como um tamanho de verdade nos relatórios.
 */
export function montarItensPayload(linhas: LinhaEditavel[]): ItemPayload[] {
  return linhas.map((l) => ({
    id: l.id,
    item_id: l.item_id,
    tamanho: l.tamanho.trim() || null,
    litros: l.litros.trim() || null,
    quantidade: Math.max(Math.trunc(Number(l.quantidade) || 1), 1),
  }));
}

/** "2 item(ns) incluído(s), 1 removido(s)" para o toast de sucesso. */
export function resumoAlteracoes(r: {
  itens_incluidos?: number; itens_alterados?: number; itens_removidos?: number;
}): string {
  return [
    r.itens_incluidos ? `${r.itens_incluidos} item(ns) incluído(s)` : "",
    r.itens_alterados ? `${r.itens_alterados} alterado(s)` : "",
    r.itens_removidos ? `${r.itens_removidos} removido(s)` : "",
  ].filter(Boolean).join(", ");
}
