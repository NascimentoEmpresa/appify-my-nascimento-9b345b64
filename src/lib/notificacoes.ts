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
/** Comentários e reações do aviso (16/10/2026) — ver a migration 20261016000003. */
export const TABELA_COMENTARIO = "SISTEMA_NOTIFICACAO_COMENTARIO";
export const TABELA_REACAO = "SISTEMA_NOTIFICACAO_REACAO";
/** Os emojis aceitos — a mesma lista do CHECK do banco. */
export const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "👏", "🎉", "🙏"] as const;
/** Quantos comentários um aviso carrega ao abrir. O banco andou caindo: nada de "todos". */
export const LIMITE_COMENTARIOS = 50;
export const MAX_COMENTARIO = 1000;
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

/** Uma imagem do aviso (21/09/2026: o aviso pode ter várias). */
export interface ImagemDoAviso { url: string; nome: string }
/**
 * O tamanho da imagem no aviso (16/10/2026, pedido do Pablo com o print do
 * "3 Anos de Empresa": cartaz quadrado saía pequeno na caixa 16:9 do modal).
 *
 * "" é o padrão de sempre — e é o que aviso antigo (coluna NULL) recebe, para
 * nada que já foi publicado mudar de cara. Ver a migration 20261016000001.
 */
export const TAMANHOS_IMAGEM = [
  { valor: "", rotulo: "Padrão" },
  { valor: "pequena", rotulo: "Pequena" },
  { valor: "media", rotulo: "Média" },
  { valor: "grande", rotulo: "Grande" },
  { valor: "total", rotulo: "Largura total" },
] as const;
export type TamanhoImagem = (typeof TAMANHOS_IMAGEM)[number]["valor"];

/** Qualquer coisa do banco vira um tamanho conhecido; o desconhecido cai no padrão. */
export function tamanhoImagemDe(v: unknown): TamanhoImagem {
  return TAMANHOS_IMAGEM.some((t) => t.valor === v) ? (v as TamanhoImagem) : "";
}

/**
 * Onde a imagem fica (16/10/2026, foto do Pablo do "3 Anos de Empresa" no
 * notebook: cartaz quadrado em cima empurrava texto e botão para baixo da
 * dobra). "lado" = imagem inteira à esquerda, texto à direita; "cima" = como
 * sempre foi, e é o que aviso antigo (coluna NULL) recebe. Aviso NOVO nasce
 * "lado" (FORM_VAZIO). Ver a migration 20261016000006.
 */
export const POSICOES_IMAGEM = [
  { valor: "lado", rotulo: "Imagem ao lado do texto" },
  { valor: "cima", rotulo: "Imagem em cima" },
] as const;
export type PosicaoImagem = (typeof POSICOES_IMAGEM)[number]["valor"];

export function posicaoImagemDe(v: unknown): PosicaoImagem {
  return v === "lado" ? "lado" : "cima";
}

/**
 * A altura da imagem ao lado do texto, como valor CSS.
 *
 * O tamanho escolhido é o TETO; o chão é a tela: 100dvh menos o que a janela
 * gasta fora da imagem (margem, cabeçalho, rodapé com o botão, os avisos de
 * rodapé e a linha do "ver em tamanho real") — assim a imagem nunca empurra o
 * botão para fora num notebook de 768 px. A prévia tem a faixa azul no topo.
 *
 * A LARGURA da coluna sai da proporção do arquivo (altura × largura/altura),
 * medida quando ele carrega — ver PainelImagemAviso. Antes (16/10/2026, print
 * do Pablo) a coluna tinha largura fixa e sobrava faixa cinza dos lados.
 */
export function alturaImagemLado(t: TamanhoImagem, previa = false): string {
  const teto = { pequena: "20rem", media: "28rem", "": "34rem", grande: "40rem", total: "48rem" }[t];
  return `min(${teto}, calc(100dvh - ${previa ? "22.5rem" : "19.5rem"}))`;
}

/** Largura da coluna da imagem: a proporção da imagem, entre 15rem e 58% da janela. */
export function larguraColunaImagem(altura: string, proporcao: number | null | undefined): string {
  if (!proporcao || !isFinite(proporcao) || proporcao <= 0) return "45%";
  // + 1.5rem = o respiro (p-3) dos dois lados da imagem.
  return `clamp(15rem, calc(${altura} * ${proporcao.toFixed(4)} + 1.5rem), 58%)`;
}

/**
 * A caixa de cada imagem. O padrão continua `aspect-video`: altura reservada
 * ANTES de o arquivo chegar (ver ImagemAviso, 10/09/2026). Os fixos também
 * reservam; só "Largura total" segue a proporção da imagem, com um mínimo
 * enquanto ela desce.
 */
export function classeCaixaImagem(t: TamanhoImagem): string {
  switch (t) {
    // Alturas presas também à tela (vh): num notebook de ~700 px úteis o
    // texto e o botão têm que caber junto com a imagem (16/10/2026).
    case "pequena": return "h-[min(10rem,22vh)] w-full";
    case "media": return "h-[min(16rem,32vh)] w-full";
    case "grande": return "h-[min(24rem,40vh)] w-full";
    case "total": return "h-[min(40rem,50vh)] w-full";
    default: return "aspect-video w-full";
  }
}

/** A largura do modal: imagem grande num modal estreito continuaria pequena. */
export function larguraJanelaAviso(t: TamanhoImagem, posicao: PosicaoImagem = "cima"): string {
  // Lado a lado precisa de largura para as duas colunas.
  // Tela grande (≥1600 px) ganha mais largura: a coluna da imagem é limitada
  // a 58% da janela, e o cartaz quadrado ficava menor que a altura permitia.
  if (posicao === "lado") return t === "grande" || t === "total" ? "max-w-5xl min-[1600px]:max-w-6xl" : "max-w-4xl min-[1600px]:max-w-5xl";
  if (t === "total") return "max-w-3xl";
  if (t === "grande") return "max-w-2xl";
  return "max-w-lg";
}

/**
 * Um botão de resposta escolhido por quem publica (16/10/2026, pedido do
 * Pablo: "escolher quais vão ser os botões, não só concordo ou discordo").
 * Sem nenhum, vale o de antes (CONCORDO/DISCORDO ou "Estou ciente").
 * Ver a migration 20261016000002.
 */
export interface BotaoDoAviso { rotulo: string; estilo: EstiloBotao }
export const ESTILOS_BOTAO = [
  { valor: "principal", rotulo: "Cheio" },
  { valor: "contorno", rotulo: "Contorno" },
  { valor: "perigo", rotulo: "Vermelho" },
] as const;
export type EstiloBotao = (typeof ESTILOS_BOTAO)[number]["valor"];
export const MAX_BOTOES = 4;
export const MAX_ROTULO_BOTAO = 40;

/** Os botões próprios do aviso, limpos; vazio = o comportamento de antes. */
export function botoesDoAviso(n: Pick<Notificacao, "botoes">): BotaoDoAviso[] {
  return (Array.isArray(n.botoes) ? n.botoes : [])
    .map((b) => ({
      rotulo: String(b?.rotulo ?? "").trim(),
      estilo: (ESTILOS_BOTAO.some((e) => e.valor === b?.estilo) ? b.estilo : "principal") as EstiloBotao,
    }))
    .filter((b) => b.rotulo);
}

/** A variante do Button do shadcn para cada estilo. */
export function varianteDoBotao(e: EstiloBotao): "default" | "outline" | "destructive" {
  return e === "contorno" ? "outline" : e === "perigo" ? "destructive" : "default";
}

/**
 * A animação comemorativa ao abrir o aviso (16/10/2026, pedido do Pablo:
 * "confetes, estrelas, etc. quando for algo a comemorar"). "" = nenhuma, que
 * é o que aviso antigo (coluna NULL) recebe. Ver a migration 20261016000005.
 */
export const ANIMACOES = [
  { valor: "", rotulo: "Nenhuma" },
  { valor: "confetes", rotulo: "🎊 Confetes" },
  { valor: "estrelas", rotulo: "⭐ Estrelas" },
  { valor: "coracoes", rotulo: "❤️ Corações" },
  { valor: "fogos", rotulo: "🎆 Fogos" },
] as const;
export type Animacao = (typeof ANIMACOES)[number]["valor"];

export function animacaoDe(v: unknown): Animacao {
  return ANIMACOES.some((a) => a.valor === v) ? (v as Animacao) : "";
}

/**
 * A cor do cabeçalho do aviso (16/10/2026, Pablo: "deixa customizar essa cor e
 * ícone aqui de cima também onde tá amarelo"). "" = amarelo, o de sempre — é
 * o que aviso antigo (coluna NULL) recebe. Ver a migration 20261016000011.
 *
 * Classes inteiras escritas aqui (o Tailwind só gera o que lê no código):
 *   faixa     tom claro no tema claro, tom escuro translúcido no escuro — o
 *             título continua em text-foreground e mantém o contraste;
 *   quadrado  tom forte (600) com ícone branco; o amarelo segue no 500 de
 *             antes para o aviso antigo não mudar de cara.
 */
export const CORES_CABECALHO = [
  { valor: "", rotulo: "Amarelo", faixa: "bg-amber-50 dark:bg-amber-950/30", quadrado: "bg-amber-500 text-white" },
  { valor: "azul", rotulo: "Azul", faixa: "bg-blue-50 dark:bg-blue-950/40", quadrado: "bg-blue-600 text-white" },
  { valor: "verde", rotulo: "Verde", faixa: "bg-emerald-50 dark:bg-emerald-950/40", quadrado: "bg-emerald-600 text-white" },
  { valor: "vermelho", rotulo: "Vermelho", faixa: "bg-red-50 dark:bg-red-950/40", quadrado: "bg-red-600 text-white" },
  { valor: "roxo", rotulo: "Roxo", faixa: "bg-violet-50 dark:bg-violet-950/40", quadrado: "bg-violet-600 text-white" },
  { valor: "rosa", rotulo: "Rosa", faixa: "bg-pink-50 dark:bg-pink-950/40", quadrado: "bg-pink-600 text-white" },
  { valor: "cinza", rotulo: "Cinza", faixa: "bg-slate-100 dark:bg-slate-800/60", quadrado: "bg-slate-600 text-white" },
  { valor: "laranja", rotulo: "Laranja", faixa: "bg-orange-50 dark:bg-orange-950/40", quadrado: "bg-orange-600 text-white" },
] as const;
export type CorCabecalho = (typeof CORES_CABECALHO)[number]["valor"];

export function corCabecalhoDe(v: unknown): (typeof CORES_CABECALHO)[number] {
  return CORES_CABECALHO.find((c) => c.valor === v && v !== "") ?? CORES_CABECALHO[0];
}

/** Os ícones do cabeçalho. "" = o "!" de sempre. O desenho de cada um fica em IconeCabecalho. */
export const ICONES_CABECALHO = [
  { valor: "", rotulo: "Alerta" },
  { valor: "megafone", rotulo: "Megafone" },
  { valor: "festa", rotulo: "Festa" },
  { valor: "trofeu", rotulo: "Troféu" },
  { valor: "coracao", rotulo: "Coração" },
  { valor: "estrela", rotulo: "Estrela" },
  { valor: "calendario", rotulo: "Calendário" },
  { valor: "info", rotulo: "Informação" },
  { valor: "escudo", rotulo: "Escudo" },
  { valor: "presente", rotulo: "Presente" },
  { valor: "bolo", rotulo: "Bolo" },
  { valor: "sino", rotulo: "Sino" },
] as const;
export type IconeCabecalho = (typeof ICONES_CABECALHO)[number]["valor"];

export function iconeCabecalhoDe(v: unknown): IconeCabecalho {
  return ICONES_CABECALHO.some((i) => i.valor === v) ? (v as IconeCabecalho) : "";
}

/** Um link clicável do aviso, com o nome que quem escreveu escolheu. */
export interface LinkDoAviso { rotulo: string; url: string }

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
  /** Todas as imagens, na ordem (21/09/2026). anexo_url/anexo_nome = a primeira. */
  imagens?: ImagemDoAviso[] | null;
  /** 'carrossel' (passa pro lado) | 'grade' (todas de uma vez). */
  imagens_layout?: string | null;
  /** Tamanho da imagem no modal — NULL = padrão (ver TAMANHOS_IMAGEM). */
  imagens_tamanho?: string | null;
  /** 'lado' | 'cima'; NULL = em cima, como sempre foi (16/10/2026). */
  imagens_posicao?: string | null;
  /** Botões clicáveis abaixo do texto. */
  links?: LinkDoAviso[] | null;
  /** Botões de resposta próprios (16/10/2026). Vazio = permitir_escolha decide. */
  botoes?: BotaoDoAviso[] | null;
  /** Animação ao abrir (16/10/2026). NULL = nenhuma. */
  animacao?: string | null;
  /** Cor e ícone do cabeçalho (16/10/2026). NULL = amarelo com "!". */
  cabecalho_cor?: string | null;
  cabecalho_icone?: string | null;
  /** Quem recebeu pode comentar e reagir (16/10/2026). */
  permitir_comentarios?: boolean | null;
  /** O comentário pode ir sem nome — o autor não é gravado. */
  permitir_anonimo?: boolean | null;
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
  /** O rótulo do botão apertado, num aviso com botões próprios (escolha = CIENTE). */
  resposta?: string | null;
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
  /** Todas as imagens (21/09/2026). A primeira vira anexo_url/anexo_nome ao salvar. */
  imagens: ImagemDoAviso[];
  imagens_layout: "carrossel" | "grade";
  /** Tamanho da imagem no modal; "" = padrão. */
  imagens_tamanho: TamanhoImagem;
  /** Imagem ao lado do texto ou em cima. */
  imagens_posicao: PosicaoImagem;
  /** Links com nome. */
  links: LinkDoAviso[];
  /** Botões de resposta próprios; vazio = Concordo/Discordo ou "Estou ciente". */
  botoes: BotaoDoAviso[];
  permitir_comentarios: boolean;
  permitir_anonimo: boolean;
  /** "" = nenhuma. */
  animacao: Animacao;
  /** "" = amarelo / "!" — o cabeçalho de sempre. */
  cabecalho_cor: CorCabecalho;
  cabecalho_icone: IconeCabecalho;
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
  expira_em: "", anexo_url: "", anexo_nome: "", imagens: [], imagens_layout: "carrossel", imagens_tamanho: "", imagens_posicao: "lado", links: [], botoes: [],
  permitir_comentarios: false, permitir_anonimo: false, animacao: "", cabecalho_cor: "", cabecalho_icone: "",
  setores: [], usuarios: [],
  exigir_ciencia: true, bloquear_acesso: true, permitir_escolha: true,
};

/**
 * As imagens de um aviso, sem depender de qual coluna foi preenchida: a
 * lista nova quando existe; senão a capa antiga (anexo_url) como lista de um.
 */
export function imagensDoAviso(n: Pick<Notificacao, "anexo_url" | "anexo_nome" | "imagens">): ImagemDoAviso[] {
  const lista = (Array.isArray(n.imagens) ? n.imagens : [])
    .map((i) => ({ url: String(i?.url ?? "").trim(), nome: String(i?.nome ?? "") }))
    .filter((i) => i.url);
  if (lista.length) return lista;
  return n.anexo_url ? [{ url: n.anexo_url, nome: n.anexo_nome ?? "" }] : [];
}

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
    imagens: imagensDoAviso(n),
    imagens_layout: n.imagens_layout === "grade" ? "grade" : "carrossel",
    imagens_tamanho: tamanhoImagemDe(n.imagens_tamanho),
    imagens_posicao: posicaoImagemDe(n.imagens_posicao),
    links: (Array.isArray(n.links) ? n.links : []).map((l) => ({ rotulo: String(l?.rotulo ?? ""), url: String(l?.url ?? "") })),
    botoes: botoesDoAviso(n),
    permitir_comentarios: !!n.permitir_comentarios,
    permitir_anonimo: !!n.permitir_comentarios && !!n.permitir_anonimo,
    animacao: animacaoDe(n.animacao),
    cabecalho_cor: corCabecalhoDe(n.cabecalho_cor).valor,
    cabecalho_icone: iconeCabecalhoDe(n.cabecalho_icone),
    setores: meus.filter((a) => a.setor).map((a) => a.setor as string),
    usuarios: meus.filter((a) => a.user_id).map((a) => a.user_id as string),
    exigir_ciencia: n.exigir_ciencia,
    bloquear_acesso: n.bloquear_acesso,
    permitir_escolha: n.permitir_escolha,
  };
}

/**
 * O formulário como aviso, para a Pré-visualização: o MESMO objeto que o modal
 * recebe do banco, montado com as mesmas normalizações do salvar — senão a
 * prévia mostraria uma coisa e o aviso publicado outra.
 */
export function avisoDoFormulario(f: FormNotificacao, autor: string | null, agora = new Date()): Notificacao {
  const imagens = f.imagens.filter((i) => i.url.trim()).map((i) => ({ url: i.url.trim(), nome: i.nome ?? "" }));
  return {
    id: f.id ?? -1,
    titulo: f.titulo.trim() || "(sem título)",
    mensagem: f.mensagem.trim(),
    publicado: true,
    publicado_em: agora.toISOString(),
    criado_por_nome: autor,
    created_at: agora.toISOString(),
    categoria: f.categoria || null,
    resumo: f.resumo.trim() || null,
    expira_em: null,
    anexo_url: imagens[0]?.url ?? null,
    anexo_nome: imagens[0]?.nome ?? null,
    imagens,
    imagens_layout: f.imagens_layout,
    imagens_tamanho: f.imagens_tamanho || null,
    imagens_posicao: f.imagens_posicao,
    links: f.links.filter((l) => l.url.trim()).map((l) => ({ rotulo: l.rotulo.trim() || "Link", url: l.url.trim() })),
    botoes: botoesDoAviso(f),
    permitir_comentarios: f.permitir_comentarios,
    permitir_anonimo: f.permitir_comentarios && f.permitir_anonimo,
    animacao: f.animacao || null,
    cabecalho_cor: f.cabecalho_cor || null,
    cabecalho_icone: f.cabecalho_icone || null,
    exigir_ciencia: f.exigir_ciencia,
    bloquear_acesso: f.exigir_ciencia && f.bloquear_acesso,
    permitir_escolha: f.permitir_escolha,
  };
}

/** Um comentário do aviso. Anônimo chega sem user_id e sem autor_nome — o banco não guarda. */
export interface ComentarioAviso {
  id: number;
  notificacao_id: number;
  user_id: string | null;
  autor_nome: string | null;
  anonimo: boolean;
  texto: string;
  criado_em: string;
}

export interface ReacaoAviso {
  id: number;
  comentario_id: number | null;
  user_id: string;
  emoji: string;
}

/** Uma linha de reações: cada emoji usado, quantos, e se eu estou entre eles. */
export interface ResumoReacao { emoji: string; total: number; minha: boolean }

/**
 * As reações de UM alvo (o aviso, com comentarioId null, ou um comentário),
 * na ordem fixa de EMOJIS — a linha não pula de lugar a cada clique.
 */
export function resumoReacoes(
  reacoes: Pick<ReacaoAviso, "comentario_id" | "user_id" | "emoji">[],
  comentarioId: number | null,
  eu: string | null | undefined,
): ResumoReacao[] {
  const doAlvo = reacoes.filter((r) => (r.comentario_id ?? null) === comentarioId);
  return EMOJIS
    .map((emoji) => {
      const desse = doAlvo.filter((r) => r.emoji === emoji);
      return { emoji, total: desse.length, minha: !!eu && desse.some((r) => r.user_id === eu) };
    })
    .filter((r) => r.total > 0);
}

/** Como o autor aparece. Anônimo é anônimo para todo mundo — inclusive para quem publicou. */
export function autorDoComentario(c: Pick<ComentarioAviso, "anonimo" | "autor_nome">): string {
  if (c.anonimo) return "Anônimo";
  return c.autor_nome?.trim() || "(usuário removido)";
}

/** O mínimo para o aviso valer alguma coisa na tela. */
export function erroDoFormulario(f: FormNotificacao): string | null {
  if (!f.titulo.trim()) return "Escreva um título.";
  if (f.titulo.length > 150) return "O título passou de 150 caracteres.";
  if (!f.categoria) return "Escolha uma categoria.";
  if (f.resumo.length > 300) return "O resumo passou de 300 caracteres.";
  if (f.mensagem.trim().length < 10) return "Escreva o conteúdo do aviso (mín. 10 caracteres).";
  if (f.mensagem.length > 5000) return "O conteúdo passou de 5000 caracteres.";
  // Link sem endereço não leva a lugar nenhum; o nome pode ficar em branco (vira "Link").
  if (f.links.some((l) => !l.url.trim())) return "Todo link precisa do endereço (URL). Tire o que ficou vazio.";
  if (f.imagens.length > 10) return "No máximo 10 imagens por aviso.";
  if (f.exigir_ciencia && f.botoes.length) {
    if (f.botoes.length > MAX_BOTOES) return `No máximo ${MAX_BOTOES} botões de resposta.`;
    if (f.botoes.some((b) => !b.rotulo.trim())) return "Todo botão de resposta precisa de um texto.";
    if (f.botoes.some((b) => b.rotulo.trim().length > MAX_ROTULO_BOTAO)) {
      return `O texto do botão passou de ${MAX_ROTULO_BOTAO} caracteres.`;
    }
    // A resposta é gravada pelo texto do botão: dois iguais seriam a mesma resposta.
    const textos = f.botoes.map((b) => b.rotulo.trim().toLocaleLowerCase("pt-BR"));
    if (new Set(textos).size !== textos.length) return "Dois botões com o mesmo texto — a resposta ficaria igual.";
  }
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

/**
 * Num aviso com botões próprios, quantos apertaram cada um — na ordem dos
 * botões, com zero para o que ninguém apertou. Resposta de um botão que foi
 * renomeado/removido depois continua contando, no fim, com o texto gravado.
 */
export function contagemPorBotao(
  botoes: BotaoDoAviso[],
  ciencias: CienciaNotificacao[],
): { rotulo: string; estilo: EstiloBotao | null; total: number }[] {
  const linhas: { rotulo: string; estilo: EstiloBotao | null; total: number }[] =
    botoes.map((b) => ({ rotulo: b.rotulo, estilo: b.estilo, total: 0 }));
  for (const c of ciencias) {
    const rotulo = respostaDe(c);
    const linha = linhas.find((l) => l.rotulo === rotulo);
    if (linha) linha.total += 1;
    else linhas.push({ rotulo, estilo: null, total: 1 });
  }
  return linhas;
}

/** O que a pessoa respondeu, em texto: o botão próprio, ou a escolha de sempre. */
export function respostaDe(c: Pick<CienciaNotificacao, "escolha" | "resposta">): string {
  if (c.resposta?.trim()) return c.resposta.trim();
  return c.escolha === "CONCORDO" ? "Concordo" : c.escolha === "DISCORDO" ? "Discordo" : "Ciente";
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
