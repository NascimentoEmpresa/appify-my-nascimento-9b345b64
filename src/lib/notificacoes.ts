// Notificações com ciência — as regras que as telas compartilham.
//
// Novidade é changelog: a pessoa lê se quiser. Notificação é o contrário —
// aparece no CENTRO da tela e só sai depois de CONCORDO ou DISCORDO.
//
// A escolha não muda nada no sistema, de propósito. O que se registra é que a
// pessoa VIU e RESPONDEU; qual botão ela apertou fica no histórico, porque
// "todo mundo leu, e três discordaram" é uma informação diferente de "todo
// mundo leu".
//
// Quem publica é o MESMO de Novidades (`novidades_publicar`): foi o pedido —
// quem cria novidade ganha Notificações ao lado. Nada de menu de permissão
// novo (ver o README sobre não criar tela de permissão à parte).

export const TABELA = "SISTEMA_NOTIFICACOES";
export const TABELA_CIENCIA = "SISTEMA_NOTIFICACAO_CIENCIA";
export const TABELA_ALVO = "SISTEMA_NOTIFICACAO_ALVO";
/**
 * A imagem do aviso.
 *
 * Bucket público, como o das capas de BI: a imagem aparece dentro do aviso
 * que para a tela de todo mundo, e URL assinada ali venceria justamente em
 * quem deixou a aba aberta — imagem quebrada num aviso que trava a tela é o
 * pior lugar para esse tipo de falha. Ver a migration 20260930000082.
 */
export const BUCKET_ANEXOS = "avisos-anexos";
export const MENU_PUBLICAR = "novidades_publicar";
/** A tela do Quadro de Avisos. Vale AO LADO de MENU_PUBLICAR, nunca no lugar. */
export const MENU_QUADRO = "central_servicos_quadro_avisos";

/**
 * CIENTE é a resposta do aviso que não oferece escolha ("Estou ciente").
 * Fica na mesma coluna das outras de propósito: a pergunta "quem respondeu?"
 * tem que ter uma resposta só, seja qual for o formato do aviso.
 */
export const ESCOLHAS = ["CONCORDO", "DISCORDO", "CIENTE"] as const;
export type Escolha = (typeof ESCOLHAS)[number];

/** As categorias do quadro. Lista fechada: filtro só funciona com vocabulário fixo. */
export const CATEGORIAS = [
  "Comunicado", "Sistemas", "Treinamento", "Processos", "Procedimentos", "RH",
] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export interface Notificacao {
  id: number;
  titulo: string;
  /** O conteúdo completo do aviso. */
  mensagem: string;
  /** Ativo (true) x Arquivado (false) — é o "status" da tela. */
  publicado: boolean;
  publicado_em: string;
  criado_por_nome: string | null;
  created_at: string;
  categoria: string | null;
  /** A linha curta que aparece na lista, sem abrir o aviso. */
  resumo: string | null;
  /** Depois disto o aviso some sozinho. NULL = não expira. */
  expira_em: string | null;
  anexo_url: string | null;
  anexo_nome: string | null;
  /** Precisa confirmar que leu? Desligado, é mural: aparece na lista e pronto. */
  exigir_ciencia: boolean;
  /** Trava a tela até responder. Só faz sentido junto com exigir_ciencia. */
  bloquear_acesso: boolean;
  /** CONCORDO/DISCORDO (true) ou um "Estou ciente" só (false). */
  permitir_escolha: boolean;
}

/**
 * Para quem é o aviso: setor OU pessoa, nunca os dois.
 *
 * Sem nenhuma linha, o aviso é de TODOS — restringir é o ato explícito. É o
 * mesmo desenho dos links de BI, para que quem administra aprenda uma regra
 * só (ver a migration 20260930000081).
 */
export interface AlvoNotificacao {
  id: number;
  notificacao_id: number;
  setor: string | null;
  user_id: string | null;
}

export interface CienciaNotificacao {
  notificacao_id: number;
  user_id: string;
  escolha: Escolha;
  respondido_em: string;
  /** Quando o aviso abriu na frente da pessoa. A distância até
   *  `respondido_em` separa quem leu de quem só tirou da frente. */
  lido_em?: string | null;
  /** O que a pessoa escreveu ao responder — normalmente por que discordou. */
  observacao?: string | null;
}

/**
 * Uma linha do "quem respondeu o quê", já com o nome resolvido.
 *
 * O nome não vem no registro de ciência (que guarda user_id) nem podia vir:
 * congelar o nome na hora da resposta deixaria o painel mostrando gente com
 * o nome antigo depois de qualquer correção de cadastro. Quem monta a lista
 * cruza com `profiles` na hora.
 */
export interface RespostaComNome extends CienciaNotificacao {
  nome: string;
}

export interface FormNotificacao {
  id?: number;
  titulo: string;
  mensagem: string;
  publicado: boolean;
  categoria: string;
  resumo: string;
  /** "aaaa-mm-dd" do input date, ou vazio para "não expira". */
  expira_em: string;
  /** URL da imagem do aviso. Vazio = aviso sem imagem. */
  anexo_url: string;
  /** Nome do arquivo que a pessoa subiu — a tela precisa de algo para mostrar. */
  anexo_nome: string;
  /** Setores que recebem o aviso. Vazio + sem pessoas = todo mundo. */
  setores: string[];
  /** Pessoas que recebem, por id do profile. */
  usuarios: string[];
  exigir_ciencia: boolean;
  bloquear_acesso: boolean;
  permitir_escolha: boolean;
}

/** Um aviso novo, em branco — o mesmo estado inicial em toda tela que cria. */
export const FORM_VAZIO: FormNotificacao = {
  titulo: "", mensagem: "", publicado: true, categoria: "Comunicado", resumo: "",
  expira_em: "", anexo_url: "", anexo_nome: "", setores: [], usuarios: [],
  exigir_ciencia: true, bloquear_acesso: true, permitir_escolha: true,
};

/**
 * Do banco para o formulário — o caminho de "Editar".
 *
 * Os alvos vêm à parte porque moram em outra tabela; quem chama passa o que
 * já carregou. Sem eles o formulário abriria "para todos" e o SALVAR apagaria
 * o recorte que o aviso tinha.
 */
export function formDoAviso(
  n: Notificacao,
  alvos: AlvoNotificacao[] = [],
): FormNotificacao {
  const meus = alvos.filter((a) => a.notificacao_id === n.id);
  return {
    id: n.id,
    titulo: n.titulo,
    mensagem: n.mensagem,
    publicado: n.publicado,
    categoria: n.categoria ?? "Comunicado",
    resumo: n.resumo ?? "",
    // O input date só entende "aaaa-mm-dd"; o banco guarda timestamp.
    expira_em: n.expira_em ? n.expira_em.slice(0, 10) : "",
    anexo_url: n.anexo_url ?? "",
    anexo_nome: n.anexo_nome ?? "",
    setores: meus.filter((a) => a.setor).map((a) => a.setor as string),
    usuarios: meus.filter((a) => a.user_id).map((a) => a.user_id as string),
    exigir_ciencia: n.exigir_ciencia,
    bloquear_acesso: n.bloquear_acesso,
    permitir_escolha: n.permitir_escolha,
  };
}

/** O mínimo para o aviso valer alguma coisa na tela. */
export function erroDoFormulario(f: FormNotificacao): string | null {
  if (!f.titulo.trim()) return "Escreva um título.";
  if (f.titulo.length > 150) return "O título passou de 150 caracteres.";
  if (!f.categoria) return "Escolha uma categoria.";
  if (f.resumo.length > 300) return "O resumo passou de 300 caracteres.";
  if (f.mensagem.trim().length < 10) return "Escreva o conteúdo do aviso (mín. 10 caracteres).";
  if (f.mensagem.length > 5000) return "O conteúdo passou de 5000 caracteres.";
  // Travar a tela sem pedir ciência não quer dizer nada: não há o que
  // responder para destravar, e a pessoa ficaria presa num aviso sem botão.
  if (f.bloquear_acesso && !f.exigir_ciencia) {
    return "Para bloquear o acesso é preciso exigir a ciência — senão não há o que responder.";
  }
  return null;
}

/** O aviso ainda vale hoje? Arquivado e expirado saem do quadro do mesmo jeito. */
export function estaVigente(n: Notificacao, agora = new Date()): boolean {
  if (!n.publicado) return false;
  if (!n.expira_em) return true;
  const fim = new Date(n.expira_em);
  return isNaN(+fim) || fim >= agora;
}

/**
 * As que esta pessoa ainda não respondeu.
 *
 * Só publicadas: rascunho aparece para quem publica na lista de gestão, mas
 * travar a tela de todo mundo com um rascunho seria o pior tipo de acidente.
 */
export function pendentesDe(
  notificacoes: Notificacao[],
  minhas: CienciaNotificacao[],
): Notificacao[] {
  const respondidas = new Set(minhas.map((c) => c.notificacao_id));
  return notificacoes.filter(
    // Aviso que não pede ciência não para ninguém: ele vive na lista do
    // quadro, não na frente da tela.
    (n) => estaVigente(n) && n.exigir_ciencia && !respondidas.has(n.id),
  );
}

/**
 * Dos pendentes, os que realmente TRAVAM a tela.
 *
 * A distinção é o pedido inteiro: um comunicado de recesso quer ciência sem
 * prender ninguém; uma mudança de norma prende. Antes era tudo-ou-nada.
 */
export function bloqueantesDe(
  notificacoes: Notificacao[],
  minhas: CienciaNotificacao[],
): Notificacao[] {
  return pendentesDe(notificacoes, minhas).filter((n) => n.bloquear_acesso);
}

/** As respostas de UM aviso, contadas para o painel de detalhes. */
export interface PanoramaRespostas {
  responderam: number;
  concordaram: number;
  discordaram: number;
  cientes: number;
}

export function panoramaDe(ciencias: CienciaNotificacao[]): PanoramaRespostas {
  return {
    responderam: ciencias.length,
    concordaram: ciencias.filter((c) => c.escolha === "CONCORDO").length,
    discordaram: ciencias.filter((c) => c.escolha === "DISCORDO").length,
    cientes: ciencias.filter((c) => c.escolha === "CIENTE").length,
  };
}

/**
 * Quem respondeu o quê, na ordem em que o painel precisa ler.
 *
 * DISCORDO PRIMEIRO, e não é capricho de ordenação: num aviso com 200
 * respostas o que interessa a quem publicou é justamente quem discordou —
 * é o único grupo que pede alguma providência. Deixar em ordem de data
 * enterraria essa pessoa no meio da lista.
 *
 * Dentro de cada grupo, a mais recente primeiro: quem respondeu agora é
 * quem ainda está com o assunto na cabeça.
 */
const PESO_ESCOLHA: Record<Escolha, number> = { DISCORDO: 0, CONCORDO: 1, CIENTE: 2 };

export function ordenarRespostas<T extends CienciaNotificacao>(ciencias: T[]): T[] {
  return [...ciencias].sort((a, b) => {
    const peso = PESO_ESCOLHA[a.escolha] - PESO_ESCOLHA[b.escolha];
    if (peso !== 0) return peso;
    return (b.respondido_em ?? "").localeCompare(a.respondido_em ?? "");
  });
}

/**
 * As respostas de um aviso com o nome de cada pessoa, prontas para a lista.
 *
 * Quem não estiver no mapa de nomes aparece como "(usuário removido)" em vez
 * de sumir: a resposta dele conta no total, e uma lista com 15 linhas embaixo
 * de um cartão que diz 16 faz quem administra procurar bug onde não há.
 */
export function respostasComNome(
  ciencias: CienciaNotificacao[],
  nomePorId: Map<string, string>,
): RespostaComNome[] {
  return ordenarRespostas(ciencias).map((c) => ({
    ...c,
    nome: nomePorId.get(c.user_id) ?? "(usuário removido)",
  }));
}

/** "12 de 30 responderam · 3 discordaram" — o histórico em uma linha. */
export function resumoDasRespostas(ciencias: CienciaNotificacao[]): string {
  if (!ciencias.length) return "Ninguém respondeu ainda.";
  const discordaram = ciencias.filter((c) => c.escolha === "DISCORDO").length;
  const plural = ciencias.length === 1 ? "pessoa respondeu" : "pessoas responderam";
  if (!discordaram) return `${ciencias.length} ${plural}.`;
  return `${ciencias.length} ${plural} · ${discordaram} discordou${discordaram > 1 ? "ram" : ""}.`;
}

export const fmtDataHora = (iso?: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};
