// =====================================================================
// TREINAMENTOS — plataforma de cursos (porta do membox para o ERP)
//
// Tipos do módulo. Espelham as tabelas "TRN_*" da migration
// 20260930000190_treinamentos_plataforma.sql. As tabelas ainda não estão em
// `integrations/supabase/types.ts` (arquivo gerado à mão, fora do CI), por
// isso o hook usa `supabase as any` — o mesmo que os módulos recentes fazem.
// =====================================================================

// "inativo" (21/09/2026): colaborador afastado ou demitido no cadastro — vem
// da sincronização com EMPREGADOS, não de decisão de alguém (isso é bloqueado).
export type StatusAluno = "pendente" | "ativo" | "bloqueado" | "inativo";
export const ROTULO_STATUS_ALUNO: Record<StatusAluno, string> = {
  pendente: "Pendente", ativo: "Ativo", bloqueado: "Bloqueado", inativo: "Inativo",
};

export interface Tag { id: string; nome: string; cor: string | null; created_at: string; alunos?: number }

export interface Aluno {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  documento: string | null;
  observacoes: string | null;
  idioma: string;
  status: StatusAluno;
  acesso_completo: boolean;
  bloquear_gamificacao: boolean;
  prazo_acesso_dias: number | null;
  expira_em: string | null;
  empregado_id: number | null;
  origem: "manual" | "importacao" | "integracao";
  ultimo_acesso_em: string | null;
  created_at: string;
  updated_at: string;
}

/** Linha da RPC trn_alunos_lista — a tabela de "Visualizar alunos". */
export interface AlunoLista {
  id: string; nome: string; email: string; telefone: string | null; documento: string | null;
  status: StatusAluno; acesso_completo: boolean; expira_em: string | null;
  created_at: string; ultimo_acesso_em: string | null;
  tags: string[]; tag_ids: string[]; cursos: number; aulas_concluidas: number;
}

export interface Matricula {
  id: string; aluno_id: string; curso_id: string; inscrito_em: string;
  origem: "manual" | "massa" | "importacao" | "completo"; created_at: string;
}

export interface Historico {
  id: string; aluno_id: string; acao: string; detalhes: string | null;
  origem: "gestao" | "plataforma" | "sistema"; autor_nome: string | null; created_at: string;
}

export interface Categoria { id: string; nome: string; ordem: number; ativo: boolean; created_at: string }

export interface CertificadoModelo {
  id: string; nome: string; titulo: string; texto_superior: string | null; texto_inferior: string | null;
  exibir_nome_negocio: boolean; exibir_logo: boolean; exibir_cnpj: boolean; exibir_carga_horaria: boolean;
  exibir_qr: boolean; exibir_documento: boolean; frente_verso: boolean; verso_somente_modulos: boolean;
  verso_titulo: string | null; layout: "esquerda" | "centro"; fundo_path: string | null; fundo_verso_path: string | null;
  created_at: string; updated_at: string;
}

export interface Certificado {
  id: string; aluno_id: string; curso_id: string; modelo_id: string | null; codigo_validacao: string;
  carga_horaria_min: number | null; emitido_em: string;
}

export type CapaFormato = "paisagem" | "retrato" | "quadrado";

export interface Curso {
  id: string; nome: string; descricao: string | null; slug: string; capa_path: string | null; capa_formato: CapaFormato;
  categoria_id: string | null; certificado_modelo_id: string | null; ordem_vitrine: number | null;
  carga_horaria_min: number | null; url_vendas: string | null; liberar_em: string | null; liberar_dias: number;
  prazo_acesso_dias: number | null; modulos_como_cursos: boolean; publicado: boolean; em_breve: boolean;
  comentarios_habilitados: boolean; created_at: string; updated_at: string;
}

/** Linha da RPC trn_cursos_lista. */
export interface CursoLista {
  id: string; nome: string; descricao: string | null; slug: string; capa_path: string | null;
  categoria_id: string | null; categoria: string | null; publicado: boolean; em_breve: boolean;
  comentarios_habilitados: boolean; modulos_como_cursos: boolean; ordem_vitrine: number | null; created_at: string;
  alunos: number; modulos: number; aulas: number; avaliacao: number | null; avaliacoes: number;
}

export interface Modulo { id: string; curso_id: string; nome: string; posicao: number; liberar_dias: number | null; created_at: string }

export type TipoConteudo = "texto" | "video" | "ao_vivo" | "audio" | "link" | "embed";
export const ROTULO_TIPO_CONTEUDO: Record<TipoConteudo, string> = {
  texto: "Somente texto", video: "Player de vídeo", ao_vivo: "Aula ao vivo",
  audio: "Áudio", link: "Link externo", embed: "Conteúdo incorporado",
};

export interface Material { nome: string; path?: string | null; url?: string | null }
/**
 * Pergunta da prova (TRN_AULA.quiz). Campos além de id/enunciado/opcoes/correta
 * são opcionais (22/09/2026) — o quiz antigo continua valendo como "única".
 */
export type TipoPergunta = "unica" | "multipla" | "vf";
export interface PerguntaQuiz {
  id: string; enunciado: string; opcoes: string[]; correta: number;
  tipo?: TipoPergunta; corretas?: number[]; pontos?: number; explicacao?: string;
}
export const ROTULO_TIPO_PERGUNTA: Record<TipoPergunta, string> = {
  unica: "Escolha única", multipla: "Múltipla escolha", vf: "Verdadeiro ou falso",
};

/** TRN_AULA.prova_config — chave ausente = padrão (espelha trn_prova_cfg no banco). */
export type ModoGabarito = "nunca" | "resultado" | "ao_final" | "sempre";
export interface ProvaConfig {
  titulo?: string; instrucoes?: string | null;
  tentativas_max?: number | null; nota_vale?: "maior" | "ultima"; liberar_apos_video?: boolean;
  embaralhar_perguntas?: boolean; embaralhar_opcoes?: boolean; sortear?: number | null;
  tempo_limite_min?: number | null; intervalo_min?: number | null; gabarito?: ModoGabarito; multipla_parcial?: boolean;
}
export const PROVA_PADRAO: Required<ProvaConfig> = {
  titulo: "Prova da aula", instrucoes: null, tentativas_max: 3, nota_vale: "maior", liberar_apos_video: true,
  embaralhar_perguntas: false, embaralhar_opcoes: false, sortear: null, tempo_limite_min: null, intervalo_min: null,
  gabarito: "ao_final", multipla_parcial: false,
};
export const ROTULO_GABARITO: Record<ModoGabarito, string> = {
  nunca: "Não mostrar — só a nota",
  resultado: "Mostrar o que acertou e errou",
  ao_final: "Mostrar a resposta certa ao aprovar ou quando acabarem as tentativas",
  sempre: "Mostrar a resposta certa depois de cada tentativa",
};

export interface Aula {
  id: string; modulo_id: string; nome: string; tipo_conteudo: TipoConteudo;
  video_url: string | null; video_path: string | null; thumb_path: string | null; descricao: string | null;
  posicao: number; publicada: boolean; gratuita: boolean; gratuita_ate: string | null;
  liberar_em: string | null; liberar_dias: number | null; carga_horaria_min: number | null;
  materiais: Material[]; cta_texto: string | null; cta_url: string | null;
  quiz: PerguntaQuiz[] | null; nota_minima: number; prova_config: ProvaConfig; created_at: string; updated_at: string;
}

export interface ProgressoLinha {
  curso_id: string; curso: string; modulo_id: string; modulo: string; modulo_posicao: number;
  aula_id: string; aula: string; aula_posicao: number; concluida: boolean; concluida_em: string | null;
  avaliacao: number | null; tempo_seg: number; nota_quiz: number | null;
}

export type StatusComentario = "pendente" | "aprovado" | "rejeitado";
export interface Comentario {
  id: string; aula_id: string; aluno_id: string; texto: string; status: StatusComentario;
  resposta: string | null; respondido_em: string | null; created_at: string;
  // joins
  aluno?: { nome: string; email: string } | null;
  aula?: { nome: string; modulo?: { curso_id: string; curso?: { nome: string } | null } | null } | null;
}

export type Publico = "todos" | "tags";

export interface Aviso {
  id: string; titulo: string; url: string | null; tipo_conteudo: "texto" | "imagem" | "video";
  mensagem: string | null; imagem_path: string | null; video_url: string | null; publico: Publico;
  inicio_em: string | null; fim_em: string | null; publicado: boolean; created_at: string;
  tags?: { tag_id: string }[];
}

export interface Notificacao {
  id: string; titulo: string; mensagem: string; url: string | null; publico: Publico;
  alcance: number; enviada_em: string; autor_nome: string | null;
  tags?: { tag_id: string }[];
}

export interface Evento {
  id: string; titulo: string; descricao: string | null; inicio_em: string; fim_em: string | null;
  dia_inteiro: boolean; local: string | null; url: string | null; cor: string | null; publico: Publico;
  curso_id: string | null; created_at: string;
  tags?: { tag_id: string }[];
}

export interface Dashboard {
  alunos: number; alunos_ativos: number; alunos_pendentes: number; alunos_bloqueados: number;
  aulas_concluidas: number; avaliacao_media: number | null; avaliacoes: number;
  comentarios: number; comentarios_pendentes: number; cursos_publicados: number; cursos_total: number;
  certificados: number; interacao_real: number; concluidos: number; ano: number;
  novos_por_mes: number[]; top_cursos: { nome: string; alunos: number }[];
}

/** Menus do módulo (app_menu.codigo) — um por tela, como no membox. */
export const MENU = {
  dashboard: "treinamentos_dashboard",
  alunos: "treinamentos_alunos",
  alunosNovo: "treinamentos_alunos_novo",
  cursos: "treinamentos_cursos",
  cursosNovo: "treinamentos_cursos_novo",
  comentarios: "treinamentos_comentarios",
  categorias: "treinamentos_categorias",
  certificados: "treinamentos_certificados",
  avisos: "treinamentos_avisos",
  notificacoes: "treinamentos_notificacoes",
  calendario: "treinamentos_calendario",
} as const;

export const BUCKET_TRN = "trn-midia";
