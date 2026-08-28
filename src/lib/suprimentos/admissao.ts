export interface ItemCatalogoEnxoval {
  id: string;
  nome: string;
  tipo?: string | null;
  ativo?: boolean;
  aprovado?: boolean;
}

export interface VinculoFuncaoItem {
  item_id: string;
  ordem?: number | null;
  ativo?: boolean;
  aprovado?: boolean;
  sup_item?: ItemCatalogoEnxoval | null;
  item?: ItemCatalogoEnxoval | null;
}

export interface ItemPreCadastro {
  sup_item_id: string;
  nome_item: string;
  tipo_item: string | null;
  tamanho: string | null;
  quantidade: number;
  ordem: number;
}

/**
 * Produz o snapshot que acompanha o candidato. O nome não volta a ser lido
 * depois do catálogo, pois uma renomeação futura não pode alterar a admissão.
 */
export function montarItensDoEnxoval(funcaoItens: VinculoFuncaoItem[]): ItemPreCadastro[] {
  return funcaoItens
    .filter((vinculo) => {
      const item = vinculo.sup_item ?? vinculo.item;
      return vinculo.ativo !== false
        && vinculo.aprovado === true
        && !!item
        && item.ativo !== false
        && item.aprovado !== false;
    })
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .map((vinculo) => {
      const item = (vinculo.sup_item ?? vinculo.item)!;
      return {
        sup_item_id: vinculo.item_id || item.id,
        nome_item: item.nome,
        tipo_item: item.tipo ?? null,
        tamanho: null,
        quantidade: 1,
        ordem: vinculo.ordem ?? 0,
      };
    });
}

export interface ItemRespostaEnxoval {
  tamanho?: string | null;
  tamanho_informado?: string | null;
  tamanhos_disponiveis?: string[] | null;
}

/**
 * Todo item precisa de tamanho — muda só a forma de responder.
 *
 * COM grade → escolher da lista.
 * SEM grade → escrever, porque não há o que escolher.
 *
 * A regra do item sem grade mudou por pedido do Cassio (ajuste 10 de
 * 27/08/2026). Antes ele passava em branco, e esse é justamente o caso em que
 * o tamanho importa e ninguém sabe: bota com numeração do fabricante, luva que
 * veio sem grade no catálogo, item novo. O buraco só aparecia no dia da
 * entrega, com o colaborador na frente do almoxarife.
 *
 * Escolha e texto não são intercambiáveis: valor da grade casa com o estoque e
 * vira etiqueta; texto livre é recado para quem separa. Por isso item COM grade
 * continua exigindo a escolha — ali o texto é observação opcional — e a RPC
 * pública `sup_adm_enxoval_responder` também exige, então aceitar texto no
 * lugar da escolha deixaria a tela enviar e o banco recusar depois.
 */
export function enxovalCompleto(itens: ItemRespostaEnxoval[]): boolean {
  return itens.every((item) =>
    item.tamanhos_disponiveis?.length
      ? !!item.tamanho?.trim()
      : !!item.tamanho_informado?.trim(),
  );
}

export type MotivoTokenInvalido = "inexistente" | "ja_usado" | "expirado";

export interface EstadoToken {
  existe: boolean;
  usadoEm?: string | Date | null;
  expiraEm?: string | Date | null;
}

/**
 * A precedência evita que um link usado revele também a sua expiração. O dia
 * de expiração é inclusivo: "expira hoje" continua válido até o fim do dia.
 */
export function motivoTokenInvalido(
  estado: EstadoToken,
  agora: string | Date = new Date(),
): MotivoTokenInvalido | null {
  if (!estado.existe) return "inexistente";
  if (estado.usadoEm) return "ja_usado";
  if (!estado.expiraEm) return null;

  const dataExpiracao = new Date(estado.expiraEm);
  const dataAtual = new Date(agora);
  if (Number.isNaN(dataExpiracao.getTime()) || Number.isNaN(dataAtual.getTime())) return null;

  const formatador = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dataCivil = (data: Date) => {
    const partes = Object.fromEntries(
      formatador.formatToParts(data).map((parte) => [parte.type, parte.value]),
    );
    return `${partes.year}-${partes.month}-${partes.day}`;
  };
  return dataCivil(dataAtual) > dataCivil(dataExpiracao) ? "expirado" : null;
}
