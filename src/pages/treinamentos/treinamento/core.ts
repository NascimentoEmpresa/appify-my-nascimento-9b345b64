// =====================================================================
// TREINAMENTOS — a lógica que não depende de React
//
// Fica separada da tela porque é o que tem regra de verdade: o que conta
// como conteúdo, como um link vira player e como a prova é corrigida.
// Testado em src/test/treinamentos.test.ts.
// =====================================================================

export interface PerguntaProva {
  id: string;
  enunciado: string;
  opcoes: string[];
  /** Índice da opção certa dentro de `opcoes`. */
  correta: number;
}

/**
 * Em que módulo(s) o treinamento aparece.
 *
 * São grades separadas — treinamento de encarregado não é o de escritório —
 * mas o mesmo treinamento pode estar nos dois, e aí é UMA linha só, com uma
 * prova e um histórico de conclusão. Duplicar a linha para aparecer duas
 * vezes daria dois históricos para o mesmo vídeo.
 *
 * Os valores casam com os menus: `encarregados` ↔ `treinamentos_erp`,
 * `central_servicos` ↔ `central_servicos_treinamentos`. O banco cobra a
 * mesma lista no CHECK `trn_escopos_validos`.
 */
export type EscopoTreinamento = "encarregados" | "central_servicos";

export const ESCOPOS_TREINAMENTO: { id: EscopoTreinamento; label: string }[] = [
  { id: "encarregados", label: "Encarregados" },
  { id: "central_servicos", label: "Central de Serviços" },
];

export interface Treinamento {
  id: string;
  titulo: string;
  descricao: string | null;
  /** Módulos em que este treinamento aparece — nunca vazio (CHECK no banco). */
  escopos: EscopoTreinamento[];
  video_url: string | null;
  video_path: string | null;
  anexo_path: string | null;
  anexo_nome: string | null;
  /** Imagem de capa do card. Opcional — sem ela o card usa o gradiente. */
  capa_path: string | null;
  prova: PerguntaProva[] | null;
  nota_minima: number;
  publicado: boolean;
  ordem: number;
  criado_por: string | null;
  criado_por_nome: string | null;
  created_at: string;
  updated_at: string;
}

/** O que o card oferece — vira os selos coloridos na grade. */
export interface Recursos {
  video: boolean;
  anexo: boolean;
  prova: boolean;
  questoes: number;
}

const cheio = (s?: string | null) => !!s && s.trim().length > 0;

export function recursosDe(t: Partial<Treinamento>): Recursos {
  const questoes = Array.isArray(t.prova) ? t.prova.length : 0;
  return {
    video: cheio(t.video_url) || cheio(t.video_path),
    anexo: cheio(t.anexo_path),
    prova: questoes > 0,
    questoes,
  };
}

/**
 * A regra que o banco também cobra (CHECK `trn_precisa_de_conteudo`):
 * tudo é opcional, mas alguma coisa tem que vir. Card só com título não
 * ensina nada — e a descrição sozinha não conta, porque ela existe para
 * explicar o material, não para ser o material.
 *
 * Repetida aqui para o formulário avisar antes de bater no banco; quem
 * decide continua sendo o CHECK.
 */
export function temConteudo(t: Partial<Treinamento>): boolean {
  const r = recursosDe(t);
  return r.video || r.anexo || r.prova;
}

export type Embed =
  | { tipo: "youtube" | "vimeo"; src: string }
  | { tipo: "arquivo"; src: string }
  | { tipo: "desconhecido"; src: string };

/**
 * Descobre como tocar o vídeo.
 *
 * YouTube e Vimeo não tocam em <video>: precisam do iframe de /embed. Um
 * .mp4 solto toca em <video> e não em iframe. Errar isso dá o quadrado
 * preto silencioso que ninguém sabe depurar — por isso a escolha é
 * explícita, e não "tenta um, se não der tenta o outro".
 */
export function embedDeVideo(url: string): Embed {
  const u = (url ?? "").trim();
  if (!u) return { tipo: "desconhecido", src: "" };

  // youtu.be/ID · youtube.com/watch?v=ID · /embed/ID · /shorts/ID · /live/ID
  const yt = u.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
  );
  if (yt) return { tipo: "youtube", src: `https://www.youtube.com/embed/${yt[1]}` };

  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { tipo: "vimeo", src: `https://player.vimeo.com/video/${vm[1]}` };

  if (/\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(u)) return { tipo: "arquivo", src: u };

  return { tipo: "desconhecido", src: u };
}

export interface Resultado {
  acertos: number;
  total: number;
  /** Percentual inteiro de 0 a 100. */
  nota: number;
  aprovado: boolean;
  /** Índice da questão → acertou? Alimenta o gabarito da tela. */
  porQuestao: boolean[];
}

/**
 * Corrige a prova. `respostas` é questão → índice marcado; questão sem
 * resposta conta como erro (não dá para "não responder e passar").
 *
 * Prova vazia devolve aprovado: o treinamento sem prova é concluído só por
 * ter sido aberto, e quem chama não precisa tratar esse caso à parte.
 */
export function corrigirProva(
  prova: PerguntaProva[] | null | undefined,
  respostas: Record<string, number | undefined>,
  notaMinima = 70,
): Resultado {
  const qs = Array.isArray(prova) ? prova : [];
  if (qs.length === 0) {
    return { acertos: 0, total: 0, nota: 100, aprovado: true, porQuestao: [] };
  }
  const porQuestao = qs.map((q) => respostas[q.id] === q.correta);
  const acertos = porQuestao.filter(Boolean).length;
  // Arredonda para inteiro: "66,66%" não ajuda ninguém a entender se passou.
  const nota = Math.round((acertos / qs.length) * 100);
  return { acertos, total: qs.length, nota, aprovado: nota >= notaMinima, porQuestao };
}

/**
 * A prova está pronta para salvar? Devolve o motivo em português, ou null.
 *
 * Pergunta sem enunciado, com menos de duas opções ou sem gabarito não é
 * corrigível — e descobrir isso só na hora em que o funcionário responde é
 * tarde demais.
 */
export function validarProva(prova: PerguntaProva[]): string | null {
  for (let i = 0; i < prova.length; i++) {
    const q = prova[i];
    const n = i + 1;
    if (!cheio(q.enunciado)) return `A questão ${n} está sem enunciado.`;
    const opcoes = q.opcoes.filter(cheio);
    if (opcoes.length < 2) return `A questão ${n} precisa de pelo menos duas alternativas.`;
    if (q.correta == null || q.correta < 0 || q.correta >= q.opcoes.length) {
      return `Marque a alternativa correta da questão ${n}.`;
    }
    if (!cheio(q.opcoes[q.correta])) return `A alternativa correta da questão ${n} está em branco.`;
  }
  return null;
}

/**
 * Teto de upload, em bytes.
 *
 * Vale o MENOR entre dois limites do Supabase, e os dois precisam ser
 * olhados: o do bucket `treinamentos` (200 MB) e o `fileSizeLimit` GLOBAL
 * do projeto, que vence sobre qualquer bucket. Arquivo acima disso volta
 * com "The object exceeded the maximum allowed size" — em inglês, direto
 * da API, sem dizer qual é o limite.
 *
 * Em 25/08/2026 o global estava em 50 MB e barrava vídeo de 60 MB mesmo
 * com o bucket em 200 MB; foi elevado para 1 GB no painel, então quem
 * manda agora é o bucket. Atenção ao aviso "Reduced max upload file size
 * limit due to spend cap" naquela tela: com o limite de gastos ativo, o
 * valor efetivo pode ser menor do que o campo mostra.
 *
 * Mudou lá? Mude aqui junto — senão a tela recusa arquivo que o servidor
 * aceitaria, ou deixa subir 200 MB para falhar no fim.
 */
export const LIMITE_UPLOAD_BYTES = 200 * 1024 * 1024;

export const formatarMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

/**
 * O arquivo cabe? Devolve o motivo em português, ou null.
 *
 * Vale a pena checar no cliente porque o upload de 60 MB sobe inteiro antes
 * de ser recusado: sem isto a pessoa espera a barra encher para receber um
 * erro em inglês que não diz o tamanho permitido.
 */
export function validarTamanho(arquivo: File, limite = LIMITE_UPLOAD_BYTES): string | null {
  if (arquivo.size <= limite) return null;
  return `O arquivo tem ${formatarMB(arquivo.size)} e o limite é ${formatarMB(limite)}. `
       + "Para vídeo grande, publique no YouTube e cole o link aqui — não há limite de tamanho por esse caminho.";
}

/** Nome de arquivo previsível no bucket, sem acento nem espaço. */
export function caminhoNoBucket(treinamentoId: string, tipo: "video" | "anexo" | "capa", nome: string): string {
  const limpo = nome
    // NFD antes do filtro ASCII para "Ação.pdf" virar "Acao.pdf", e não
    // "A__o.pdf": o acento vira combining mark separado e cai fora sozinho.
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(-80);
  return `${treinamentoId}/${tipo}-${Date.now()}-${limpo}`;
}

// =====================================================================
// DASHBOARD DE VÍDEOS — os números que a tela mostra em cima das tabelas.
//
// Vive aqui, e não dentro do componente, porque "quantas pessoas viram" tem
// uma armadilha de contagem que merece teste: somar a coluna de cada vídeo
// conta três vezes quem assistiu a três treinamentos. O total de
// VISUALIZAÇÕES soma; o total de PESSOAS não — ele se conta por distintas.
// =====================================================================

/** O que `trn_dashboard_videos` devolve, na parte que o resumo usa. */
export interface LinhaVideoResumo {
  pessoas_viram: number;
  visualizacoes: number;
  conclusoes: number;
  aprovados: number;
}

/** O que `trn_dashboard_pessoas` devolve, na parte que o resumo usa. */
export interface LinhaPessoaResumo {
  user_id: string;
  visualizou: boolean;
}

export interface ResumoDashboard {
  /** Aberturas somadas — a mesma pessoa abrindo 3× conta 3. */
  visualizacoes: number;
  /** Pessoas DISTINTAS que abriram algum dos vídeos do filtro. */
  distintas: number;
  conclusoes: number;
  aprovados: number;
  /**
   * Conclusões ÷ pessoas que viram, em %. O denominador é "quem viu", não
   * "quem existe no ERP": o módulo não tem público-alvo cadastrado, então
   * uma taxa sobre a empresa inteira seria um número inventado.
   */
  taxa: number;
}

export function resumirDashboard(
  videos: LinhaVideoResumo[],
  pessoas: LinhaPessoaResumo[],
): ResumoDashboard {
  const soma = (f: (v: LinhaVideoResumo) => number) =>
    videos.reduce((s, v) => s + (Number(f(v)) || 0), 0);

  const conclusoes = soma((v) => v.conclusoes);
  const viram = soma((v) => v.pessoas_viram);

  return {
    visualizacoes: soma((v) => v.visualizacoes),
    distintas: new Set(pessoas.filter((p) => p.visualizou).map((p) => p.user_id)).size,
    conclusoes,
    aprovados: soma((v) => v.aprovados),
    taxa: viram > 0 ? Math.round((conclusoes / viram) * 100) : 0,
  };
}
