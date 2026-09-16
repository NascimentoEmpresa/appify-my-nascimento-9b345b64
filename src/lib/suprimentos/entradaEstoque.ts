/**
 * Por que o botão "Dar entrada" está cinza.
 *
 * O `disabled` do botão sempre existiu, mas era mudo: seis condições
 * (almoxarifado, material, quantidade, CA, laudo carregando, envio em curso)
 * e nenhuma delas dizia nada na tela. O relato de 16/09/2026 foi literal —
 * "preencho todas as informações de um novo item e o botão continua
 * indisponível" — e o que faltava lá era o TIPO do material novo, um campo
 * que a pessoa nem tinha visto aparecer.
 *
 * Um botão desabilitado sem motivo é pior que um botão que falha: falhando,
 * pelo menos vem uma mensagem. Por isso o motivo é calculado aqui, uma vez,
 * e serve às duas coisas — a frase no rodapé e o próprio `disabled` (que é
 * só "existe motivo?"). Duas fontes de verdade para a mesma pergunta acabam
 * discordando, e aí o botão fica cinza dizendo que está tudo certo.
 *
 * A ordem das checagens é a ordem de leitura do formulário, de cima para
 * baixo: quem está preenchendo espera ser mandado ao primeiro campo vazio,
 * não ao último.
 */

export interface EstadoEntrada {
  /** Almoxarifado escolhido (id) — primeiro campo do formulário. */
  almoxarifado: string;
  /** Material do catálogo escolhido (sup_item.id), se houver. */
  materialId: string;
  /** Nome digitado que vai virar material novo, se não houver material escolhido. */
  nomeNovo: string | null;
  /** Tipo do material novo (uniforme, epi, …). O banco exige. */
  tipoNovo: string;
  /**
   * O nome digitado parece "BASE + TAMANHO" ("JAQUETA M") e a pessoa ainda
   * não disse qual dos dois é. Não é campo faltando: é uma pergunta na tela
   * esperando resposta, e merece uma frase própria em vez do genérico
   * "escolha o material".
   */
  decisaoDeTamanhoPendente: boolean;
  /** Soma das quantidades dos blocos. */
  total: number;
  /** Erro de CA/laudo do SST, quando o material é EPI. */
  erroCa: string | null;
  /** Consulta do laudo do SST ainda em curso. */
  laudoCarregando: boolean;
  /** Entrada já enviada, aguardando o banco. */
  enviando: boolean;
}

/**
 * A frase do que falta, ou `null` quando dá para gravar.
 * `null` é a única resposta que habilita o botão.
 */
export function motivoBloqueioEntrada(e: EstadoEntrada): string | null {
  if (!e.almoxarifado) return "Escolha o almoxarifado.";
  if (!e.materialId && e.decisaoDeTamanhoPendente) {
    return "Diga se o que você digitou é o tamanho de um material que já existe ou um material próprio.";
  }
  if (!e.materialId && !e.nomeNovo) return "Escolha o material no catálogo ou digite o nome de um novo.";
  // Material novo sem tipo: o caso do relato. sup_est_criar_material recusa
  // sem ele, e o tipo muda o que o sistema deixa sair depois (EPI pede CA).
  if (!e.materialId && !e.tipoNovo) return "Escolha o tipo do material novo.";
  if (e.total <= 0) return "Informe a quantidade de pelo menos um tamanho.";
  if (e.erroCa) return e.erroCa;
  if (e.laudoCarregando) return "Consultando o laudo do SST…";
  if (e.enviando) return "Gravando a entrada…";
  return null;
}
