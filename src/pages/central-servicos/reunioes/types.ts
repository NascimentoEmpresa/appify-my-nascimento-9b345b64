export type ReuniaoEtapa = "agendada" | "em_andamento" | "concluida" | "cancelada";

export const ETAPA_LABEL: Record<ReuniaoEtapa, string> = {
  agendada: "Planejada",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export const ETAPA_COR: Record<ReuniaoEtapa, string> = {
  agendada: "bg-blue-100 text-blue-800 border-blue-200",
  em_andamento: "bg-amber-100 text-amber-800 border-amber-200",
  concluida: "bg-emerald-100 text-emerald-800 border-emerald-200",
  cancelada: "bg-red-100 text-red-700 border-red-200",
};

export type PautaStatus = "nao_iniciada" | "pendente" | "em_andamento" | "concluida";

export const PAUTA_STATUS_LABEL: Record<PautaStatus, string> = {
  nao_iniciada: "Não iniciada",
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluida: "Concluída",
};

export const PAUTA_STATUS_COR: Record<PautaStatus, string> = {
  nao_iniciada: "bg-slate-100 text-slate-600 border-slate-200",
  pendente: "bg-amber-100 text-amber-800 border-amber-200",
  em_andamento: "bg-blue-100 text-blue-800 border-blue-200",
  concluida: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export const SALAS_PRESENCIAIS = [
  "Sala de Reunião 1 - 1º Andar",
  "Sala de Reunião 2 - 1º Andar",
  "Sala de Reunião - 2º Andar",
  "Outro",
] as const;

const SALAS_FIXAS: readonly string[] = SALAS_PRESENCIAIS.filter((s) => s !== "Outro");

export type TipoLocalReuniao = "presencial" | "online" | "hibrido";

/** "Online" pra reunião online; nome da sala fixa se for uma das 3 nomeadas (presencial ou híbrida); "Outro" pra qualquer sala digitada livre. */
export function salaResumo(r: { tipo_local: TipoLocalReuniao; local_ou_link: string }): string {
  if (r.tipo_local === "online") return "Online";
  return SALAS_FIXAS.includes(r.local_ou_link) ? r.local_ou_link : "Outro";
}

export type TipoReuniao = "comunicacao" | "alinhamento" | "operacional" | "comite" | "gerencial" | "diretoria" | "equipe" | "acompanhamento" | "outro" | "treinamento";

export const TIPO_REUNIAO_LABEL: Record<TipoReuniao, string> = {
  comunicacao: "Comunicação",
  alinhamento: "Alinhamento",
  operacional: "Operacional",
  comite: "Comitê",
  gerencial: "Gerencial",
  diretoria: "Diretoria",
  equipe: "Equipe",
  acompanhamento: "Acompanhamento",
  outro: "Outro",
  treinamento: "Treinamento",
};

/** Duração padrão (minutos) por tipo de reunião — null pra "outro"/"treinamento" (usuário informa; sem duração padrão definida ainda pro treinamento). */
export const TIPO_REUNIAO_DURACAO_PADRAO: Record<TipoReuniao, number | null> = {
  comunicacao: 15,
  alinhamento: 30,
  operacional: 45,
  comite: 90,
  gerencial: 45,
  diretoria: 90,
  equipe: 30,
  acompanhamento: 30,
  outro: null,
  treinamento: null,
};

/**
 * Pedido do chefe (2026-07-21): dropdown de CRIAÇÃO de reunião não deve
 * mais oferecer Comunicação/Alinhamento/Acompanhamento, e ganhou
 * Treinamento. Os valores continuam existindo em TIPO_REUNIAO_LABEL (e no
 * CHECK do banco) pra reuniões antigas continuarem exibindo certo em
 * badges/filtros — só o formulário de criação usa esta lista restrita.
 */
export const TIPO_REUNIAO_OPCOES_CRIACAO: TipoReuniao[] = [
  "operacional", "comite", "gerencial", "diretoria", "equipe", "treinamento", "outro",
];

export type Finalidade = "comunicacao" | "alinhamento" | "decisao" | "acompanhamento_indicadores" | "resolver_problema" | "plano_acao";

export const FINALIDADE_LABEL: Record<Finalidade, string> = {
  comunicacao: "Comunicação",
  alinhamento: "Alinhamento",
  decisao: "Decisão",
  acompanhamento_indicadores: "Acompanhamento de indicadores",
  resolver_problema: "Resolver problema",
  plano_acao: "Plano de ação",
};

export type ResultadoEsperado = "compreensao" | "decisao" | "acao_definida" | "responsaveis_definidos" | "prazos_definidos" | "outro";

export const RESULTADO_ESPERADO_LABEL: Record<ResultadoEsperado, string> = {
  compreensao: "Compreensão",
  decisao: "Decisão",
  acao_definida: "Ação definida",
  responsaveis_definidos: "Responsáveis definidos",
  prazos_definidos: "Prazos definidos",
  outro: "Outro",
};

export type NotificarPor = "erp" | "email" | "whatsapp";

export const NOTIFICAR_POR_LABEL: Record<NotificarPor, string> = {
  erp: "ERP (sistema)",
  email: "E-mail",
  whatsapp: "WhatsApp",
};

export interface OpcaoPergunta {
  value: string;
  label: string;
}

export interface PerguntaChecklist {
  id: string;
  pergunta: string;
  opcoes: OpcaoPergunta[];
}

const OPCOES_SIM_NAO_NA: OpcaoPergunta[] = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
  { value: "nao_se_aplica", label: "Não se aplica" },
];

const OPCOES_SIM_NAO_PARCIALMENTE: OpcaoPergunta[] = [
  { value: "sim", label: "Sim" },
  { value: "parcialmente", label: "Parcialmente" },
  { value: "nao", label: "Não" },
];

export const PERGUNTAS_CHECKLIST_INICIO: PerguntaChecklist[] = [
  { id: "objetivo_definido", pergunta: "O objetivo da reunião foi definido?", opcoes: OPCOES_SIM_NAO_NA },
  { id: "pauta_apresentada", pergunta: "A pauta foi apresentada ou disponibilizada aos participantes?", opcoes: OPCOES_SIM_NAO_NA },
  { id: "participantes_incluidos", pergunta: "Os participantes necessários foram incluídos?", opcoes: OPCOES_SIM_NAO_NA },
  { id: "documentos_disponiveis", pergunta: "Os documentos necessários estão disponíveis?", opcoes: OPCOES_SIM_NAO_NA },
  { id: "resultado_esperado_claro", pergunta: "O resultado esperado está claro?", opcoes: OPCOES_SIM_NAO_NA },
];

export const PERGUNTAS_CONDUCAO_ITEM: PerguntaChecklist[] = [
  { id: "assunto_apresentado", pergunta: "O assunto foi apresentado?", opcoes: OPCOES_SIM_NAO_NA },
  { id: "duvida_compreensao", pergunta: "Houve dúvida de compreensão?", opcoes: OPCOES_SIM_NAO_NA },
  { id: "duvida_esclarecida", pergunta: "A dúvida foi esclarecida?", opcoes: OPCOES_SIM_NAO_PARCIALMENTE },
  { id: "gerou_decisao", pergunta: "O assunto gerou decisão?", opcoes: OPCOES_SIM_NAO_NA },
  {
    id: "gerou_acao",
    pergunta: "Essa pauta vai gerar uma ação ou tarefa?",
    opcoes: [
      { value: "sim_criar", label: "Sim, Criar" },
      { value: "nao", label: "Não" },
    ],
  },
  { id: "item_concluido", pergunta: "Item concluído?", opcoes: OPCOES_SIM_NAO_NA },
];

export const PERGUNTAS_CHECKLIST_ENCERRAMENTO: PerguntaChecklist[] = [
  { id: "itens_pauta_tratados", pergunta: "Todos os itens da pauta foram tratados?", opcoes: OPCOES_SIM_NAO_PARCIALMENTE },
  { id: "decisoes_registradas", pergunta: "As decisões foram registradas?", opcoes: [...OPCOES_SIM_NAO_PARCIALMENTE, { value: "nao_houve_decisao", label: "Não houve decisão" }] },
  { id: "acoes_com_responsavel", pergunta: "As ações possuem responsável?", opcoes: [...OPCOES_SIM_NAO_PARCIALMENTE, { value: "nao_houve_acao", label: "Não houve ação" }] },
  { id: "acoes_com_prazo", pergunta: "As ações possuem prazo?", opcoes: [...OPCOES_SIM_NAO_PARCIALMENTE, { value: "nao_houve_acao", label: "Não houve ação" }] },
  { id: "encaminhamentos_compreendidos", pergunta: "Todos compreenderam os encaminhamentos?", opcoes: OPCOES_SIM_NAO_PARCIALMENTE },
  { id: "atingiu_objetivo", pergunta: "A reunião atingiu o objetivo?", opcoes: OPCOES_SIM_NAO_PARCIALMENTE },
  { id: "focada_na_pauta", pergunta: "A reunião permaneceu focada na pauta?", opcoes: OPCOES_SIM_NAO_PARCIALMENTE },
  {
    id: "debates_improdutivos",
    pergunta: "Houve debates improdutivos?",
    opcoes: [
      { value: "nao", label: "Não" },
      { value: "sim_parcialmente", label: "Sim, parcialmente" },
      { value: "sim_relevante", label: "Sim, de forma relevante" },
    ],
  },
];

export type TipoDecisaoAcao = "decisao" | "acao";
export type PrioridadeDecisaoAcao = "alta" | "media" | "baixa";
export type StatusDecisaoAcao = "pendente" | "em_andamento" | "concluida";

export const PRIORIDADE_DECISAO_ACAO_LABEL: Record<PrioridadeDecisaoAcao, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export const STATUS_DECISAO_ACAO_LABEL: Record<StatusDecisaoAcao, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluida: "Concluída",
};

export interface ReuniaoDecisaoAcao {
  id: string;
  pauta_id: string;
  tipo: TipoDecisaoAcao;
  texto: string;
  responsavel_user_id: string | null;
  prazo: string | null;
  prioridade: PrioridadeDecisaoAcao;
  status: StatusDecisaoAcao;
  necessita_comprovacao: boolean;
  setor_impactado: string | null;
  anexo_storage_path: string | null;
  plano_acao_id: string | null;
  criado_por: string;
  created_at: string;
}

export type ClassificacaoAssunto = "urgente_relevante" | "importante_nao_urgente" | "sem_relacao";
export type TratativaAssunto = "tratar_agora" | "estacionar" | "encerrar_retornar_pauta";

export const CLASSIFICACAO_ASSUNTO_LABEL: Record<ClassificacaoAssunto, string> = {
  urgente_relevante: "Urgente e relevante",
  importante_nao_urgente: "Importante, não urgente",
  sem_relacao: "Sem relação com o objetivo",
};

export const TRATATIVA_ASSUNTO_LABEL: Record<TratativaAssunto, string> = {
  tratar_agora: "Tratar agora",
  estacionar: "Estacionar",
  encerrar_retornar_pauta: "Encerrar e retornar à pauta",
};

export interface ReuniaoAssuntoForaPauta {
  id: string;
  reuniao_id: string;
  classificacao: ClassificacaoAssunto;
  tratativa: TratativaAssunto;
  assunto_estacionado: string | null;
  responsavel_tratativa_user_id: string | null;
  data_prevista: string | null;
  reuniao_futura_necessaria: boolean;
  observacoes: string | null;
  concluido: boolean;
  criado_por: string;
  created_at: string;
}

export interface Reuniao {
  id: string;
  numero: string;
  titulo: string;
  objetivo: string | null;
  data_hora: string;
  duracao_minutos: number;
  tipo_local: TipoLocalReuniao;
  local_ou_link: string;
  link_online: string | null;
  etapa: ReuniaoEtapa;
  criado_por: string;
  organizador_user_id: string;
  responsavel_preenchimento_user_id: string;
  tipo_reuniao: TipoReuniao | null;
  finalidade: Finalidade[];
  resultado_esperado: ResultadoEsperado[];
  notificar_por: NotificarPor[];
  setor_responsavel: string | null;
  justificativa_alteracao_duracao: string | null;
  serie_recorrencia_id: string | null;
  motivo_cancelamento: string | null;
  checklist_inicio: Record<string, string> | null;
  checklist_encerramento: Record<string, string> | null;
  hora_inicio_real: string | null;
  hora_termino_real: string | null;
  duracao_real_minutos: number | null;
  created_at: string;
  updated_at: string;
}

/** Recorte mínimo pro calendário — todas as reuniões da empresa, sem objetivo/motivo_cancelamento. */
export interface ReuniaoCalendario {
  id: string;
  numero: string;
  titulo: string;
  data_hora: string;
  duracao_minutos: number;
  tipo_local: TipoLocalReuniao;
  local_ou_link: string;
  etapa: ReuniaoEtapa;
  criado_por: string;
  organizador_user_id: string;
  responsavel_preenchimento_user_id: string;
  convidados: string[];
}

export type NaturezaItem = "comunicacao" | "alinhamento" | "decisao" | "acompanhamento" | "problema" | "plano_acao";

export const NATUREZA_ITEM_LABEL: Record<NaturezaItem, string> = {
  comunicacao: "Comunicação",
  alinhamento: "Alinhamento",
  decisao: "Decisão",
  acompanhamento: "Acompanhamento",
  problema: "Problema",
  plano_acao: "Plano de ação",
};

export interface ReuniaoPauta {
  id: string;
  reuniao_id: string;
  ordem: number;
  titulo_topico: string;
  descricao: string | null;
  responsavel_user_id: string | null;
  prazo: string | null;
  tempo_previsto_minutos: number | null;
  status: PautaStatus;
  natureza: NaturezaItem | null;
  created_at: string;
}

export interface RespostaConducaoItem {
  resposta: string;
  observacao: string;
}

export interface ReuniaoResposta {
  id: string;
  pauta_id: string;
  texto_resposta: string | null;
  encaminhamento: string | null;
  checklist_conducao: Record<string, RespostaConducaoItem> | null;
  respondido_por: string;
  created_at: string;
  updated_at: string;
}

export type PapelConvidado = "convidado" | "observador";

export interface ReuniaoConvidado {
  id: string;
  reuniao_id: string;
  user_id: string;
  papel: PapelConvidado;
  presente: boolean | null;
  presente_marcado_em: string | null;
  created_at: string;
}

export interface ReuniaoAnexo {
  id: string;
  reuniao_id: string;
  storage_path: string;
  nome_arquivo: string;
  mime_type: string | null;
  tamanho_bytes: number | null;
  enviado_por: string;
  created_at: string;
}

export interface ReuniaoPautaAnexo {
  id: string;
  pauta_id: string;
  storage_path: string;
  nome_arquivo: string;
  mime_type: string | null;
  tamanho_bytes: number | null;
  enviado_por: string;
  created_at: string;
}

export interface ReuniaoLog {
  id: string;
  reuniao_id: string;
  user_id: string;
  acao: string;
  detalhe: string;
  created_at: string;
}

export interface ReuniaoComentario {
  id: string;
  reuniao_id: string;
  autor_id: string;
  texto: string;
  created_at: string;
}

export interface ReuniaoAssinatura {
  id: string;
  reuniao_id: string;
  user_id: string;
  assinatura_png: string;
  created_at: string;
}

export type TipoBloqueioAgenda = "data_especifica" | "periodo";

export type MotivoBloqueioAgenda = "viagem" | "compromisso_pessoal" | "ferias" | "treinamento_curso" | "trabalho_externo" | "outro";

export const MOTIVO_BLOQUEIO_LABEL: Record<MotivoBloqueioAgenda, string> = {
  viagem: "Viagem",
  compromisso_pessoal: "Compromisso pessoal",
  ferias: "Férias",
  treinamento_curso: "Treinamento / Curso",
  trabalho_externo: "Trabalho externo",
  outro: "Outro",
};

export interface BloqueioAgenda {
  id: string;
  user_id: string;
  tipo: TipoBloqueioAgenda;
  data_inicio: string;
  data_fim: string;
  dia_inteiro: boolean;
  hora_inicio: string | null;
  hora_fim: string | null;
  motivo: MotivoBloqueioAgenda;
  motivo_outro: string | null;
  created_at: string;
}

/** "08:00:00" -> "8h" | "08:30:00" -> "8h30" */
export function formatarHoraBloqueio(hora: string): string {
  const [h, m] = hora.split(":");
  const hNum = Number(h);
  return m && m !== "00" ? `${hNum}h${m}` : `${hNum}h`;
}

export function motivoBloqueioLabel(b: BloqueioAgenda): string {
  return b.motivo === "outro" ? (b.motivo_outro ?? "Outro") : MOTIVO_BLOQUEIO_LABEL[b.motivo];
}

/** Descrição curta pro badge do dia no calendário: horário específico quando não é dia inteiro, motivo quando é. */
export function descreverBloqueioResumo(b: BloqueioAgenda): string {
  if (!b.dia_inteiro && b.hora_inicio && b.hora_fim) {
    return `Agenda bloqueada ${formatarHoraBloqueio(b.hora_inicio)}-${formatarHoraBloqueio(b.hora_fim)}`;
  }
  return `Bloqueado: ${motivoBloqueioLabel(b)}`;
}

export interface Usuario {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

export function nomeUsuario(usuarios: Usuario[], id: string | null): string | null {
  return usuarios.find((u) => u.id === id)?.display_name ?? null;
}

export type StatusPresenca = "confirmada" | "pendente" | "recusada";

export function statusPresenca(presente: boolean | null): StatusPresenca {
  return presente === true ? "confirmada" : presente === false ? "recusada" : "pendente";
}

export const STATUS_PRESENCA_LABEL: Record<StatusPresenca, string> = {
  confirmada: "Presença confirmada",
  pendente: "Presença pendente",
  recusada: "Não poderá comparecer",
};
