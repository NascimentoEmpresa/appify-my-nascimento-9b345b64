export interface Solicitacao {
  id: string;
  titulo: string;
  descricao: string | null;
  etapa: string;
  recusado: boolean;
  prioridade: number | null;
  responsavel_user_id: string | null;
  progresso_pct: number;
  data_inicio: string | null;
  data_fim: string | null;
  status_desenvolvimento: string | null;
  criterio_triagem: string | null;
  analise_necessidade_texto: string | null;
  analise_necessidade_prazo: string | null;
  levantamento_funcional_texto: string | null;
  levantamento_funcional_prazo: string | null;
  documentacao_tecnica_texto: string | null;
  documentacao_tecnica_prazo: string | null;
  analise_tecnica_texto: string | null;
  analise_tecnica_prazo: string | null;
  treinamento_data: string | null;
  implantacao_status: string | null;
  finalizado: boolean;
  testes_interno_aprov_1: boolean;
  testes_interno_aprov_2: boolean;
  testes_interno_aprov_3: boolean;
  complexidade: string | null;
  // Campos legados de abertura (records anteriores ao FSD)
  objetivo_solicitacao: string | null;
  problema_atual: string | null;
  justificativa: string | null;
  beneficio_esperado: string | null;
  impacto_operacional: string | null;
  grau_urgencia: string | null;
  tipo_solicitacao: string | null;
  pesquisa_atendeu_necessidade: number | null;
  pesquisa_levantamento_claro: number | null;
  pesquisa_conducao_ti: number | null;
  pesquisa_treinamento_suporte: number | null;
  pesquisa_avaliacao_geral: number | null;
  pesquisa_pode_encerrar: boolean | null;
  etapa_entrada_em: string;
  criado_por: string;
  created_at: string;
  // Número sequencial (SD-AAAA-NNNN)
  numero: number | null;
  // FSD Parte A — preenchida pelo solicitante na criação
  area_solicitante: string | null;
  responsavel_solicitacao: string | null;
  cargo_solicitante: string | null;
  email_solicitante: string | null;
  telefone_solicitante: string | null;
  classificacao_demanda: string[] | null;
  descricao_necessidade: string | null;
  situacao_desejada: string | null;
  beneficios_esperados_lista: string[] | null;
  impacto_tipo: string | null;
  areas_impactadas: string | null;
  justificativa_urgencia: string | null;
  existe_processo_documentado: boolean | null;
  codigo_processo: string | null;
  tipos_documentos_apoio: string[] | null;
  observacoes_abertura: string | null;
  // FSD Parte B — preenchida pela Controladoria na Triagem Inicial
  triagem_recebido_por: string | null;
  triagem_concluida_em: string | null;
  triagem_classificacao: string | null;
  triagem_sem_desenvolvimento: boolean | null;
  triagem_sem_desenvolvimento_como: string | null;
  triagem_encaminhamento_para: string | null;
  triagem_encaminhamento_responsavel: string | null;
  triagem_parecer: string | null;
  triagem_decisao: string | null;
  triagem_data_decisao: string | null;
  // Análise de Necessidade — critérios de prioridade e pessoas impactadas
  an_criterios:          string[] | null;
  an_pessoas_impactadas: string   | null;
  // Documentação Funcional — formulário DFD completo (JSONB)
  dfd_dados: DfdDados | null;
  // Análise Técnica — formulário PTV completo (JSONB)
  ptv_dados: PtvDados | null;
  // Aprovação e Priorização — formulário AAP completo (JSONB)
  aap_dados: AapDados | null;
}

export interface DfdEtapa {
  codigo: string;
  descricao: string;
}

export interface DfdDados {
  // Cabeçalho
  usuario_chave?: string;
  objetivo?: string;
  justificativa?: string;
  // 1. Escopo Funcional
  tipo_solucao?: string[];
  modulos_impactados?: string[];
  contemplar?: string[];
  entrega_principal?: string;
  tipo_info_controlada?: string[];
  escopo_negativo?: string[];
  item_excluido?: string;
  item_excluido_tipos?: string[];
  // 2. Mapa das Etapas
  etapas?: DfdEtapa[];
  quem_inicia?: string[];
  como_inicia?: string[];
  tem_retorno?: string;
  retorno_motivos?: string[];
  encerramento?: string[];
  // 3. Matriz Funcional (Record<codigo, booleans>)
  matriz?: Record<string, {
    registrar?: boolean; validar?: boolean; aprovar?: boolean; notificar?: boolean;
    gerar_doc?: boolean; integrar?: boolean; encerrar?: boolean;
    gera_historico?: boolean; gera_notificacao?: boolean;
    bloqueia_avanco?: boolean; bloqueia_outro?: boolean;
  }>;
  // 4. Regras de Negócio
  regras_negocio?: Array<{ etapa?: string; tipo?: string; regra?: string; responsavel?: string; acoes?: string[]; }>;
  regras_sobre?: string[];
  tem_prazo?: string;
  prazo_definido_por?: string[];
  prazos_controlados?: string[];
  alertar_quando?: string[];
  prazo_vence?: string[];
  // 5. Funcionalidades
  funcionalidades?: string[];
  acoes?: Array<{ acao?: string; etapa_vinculada?: string; executores?: string[]; precisa_aprovacao?: boolean | null; gera_historico?: boolean | null; }>;
  resultado_automatico?: string[];
  condicoes?: string[];
  // 6. Interface
  estrutura_interface?: string[];
  navegacao?: string[];
  elementos_visuais?: string[];
  referencia_sistemas?: string[];
  referencia_outro_sistema?: string;
  // 7. Perfis e Permissões
  perfis?: string[];
  permissoes?: Array<{ perfil?: string; etapa_vinculada?: string; visualizar?: boolean; incluir?: boolean; alterar?: boolean; aprovar?: boolean; reprovar?: boolean; cancelar?: boolean; anexar?: boolean; exportar?: boolean; indicadores?: boolean; }>;
  restricoes_acesso?: string[];
  // 8. Integrações
  tem_integracao?: string;
  integracoes?: Array<{ etapa_vinculada?: string; sistema?: string; tipo?: string[]; dados?: string; frequencia?: string; tratamento_falha?: string; }>;
  // 9. Documentos e Indicadores
  documentos?: Array<{ etapa_vinculada?: string; documento?: string; finalidade?: string; formato?: string[]; gerado_auto?: boolean | null; quem_acessa?: string; }>;
  indicadores?: Array<{ etapa_vinculada?: string; indicador?: string; objetivo?: string; fonte?: string; frequencia?: string; responsavel?: string; }>;
  // 10. Premissas, Restrições, Dependências e Riscos
  premissas?: Array<{ tipos?: string[]; etapa_vinculada?: string; responsavel?: string; impacto?: string; tratamento?: string; }>;
  // 11. Critérios de Homologação
  criterios_etapa?: Array<{ etapa_vinculada?: string; criterio?: string; resultado?: string; }>;
  itens_homologacao?: string[];
  // 12. Validação do DFD
  situacao?: string;
  observacoes_finais?: string;
  validacoes_dfd?: Array<{ area: string; nome?: string; cargo?: string; data?: string; situacao?: string; }>;
}

export interface PtvDados {
  // Seção 2 — Conferência mínima do DFD
  dfd_suficiente?: string;
  dfd_pendencias?: string[];
  dfd_encaminhamento?: string[];
  // Seção 3 — Viabilidade técnica
  tecnicamente_viavel?: string;
  forma_atendimento?: string[];
  impedimento_tecnico?: string;
  impedimento_tipos?: string[];
  // Seção 4.3 — Override manual da prioridade (só Gerente de Sistemas)
  prioridade_override?: string;
  pode_alterar_prioridade?: string;
  prioridade_justificativa?: string;
  // Seção 4.4 — Complexidade técnica (preenchimento manual TI)
  complexidade_itens?: string[];
  // Seção 5 — Dependências, riscos e condições
  tem_dependencias?: string;
  dependencia_tipos?: string[];
  tem_risco_tecnico?: string;
  risco_tipos?: string[];
  dividir_fases?: string;
  fase1_entrega?: string;
  fase2_complementacao?: string;
  encaminhar_comite?: string;
  comite_motivos?: string[];
  observacao_5?: string;
  // Seção 6 — Parecer técnico final
  parecer_final?: string[];
  observacoes_justificativas?: string;
}

export interface AapDados {
  // Seção 3 — Condição da Demanda para Deliberação
  demanda_apta?: string;           // "sim" | "sim_ressalvas" | "nao"
  situacao_fsd?: string;           // "aprovado" | "pendente" | "retornado"
  situacao_dfd?: string;           // "aprovado" | "aprovado_ressalvas" | "retornado"
  situacao_ptv?: string;           // "viavel" | "viavel_ressalvas" | "inviavel" | "pendente"
  motivos_nao_apta?: string[];

  // Seção 4 — Deliberação da Demanda
  decisao_instancia?: string;
  motivos_decisao?: string[];
  observacao_deliberacao?: string;

  // Seção 5 — Priorização Aprovada
  classificacao_execucao?: string;
  data_inicio_previsto?: string;
  data_conclusao_prevista?: string;
  prazo_diferente?: string;        // "sim" | "nao"
  motivos_prazo_diferente?: string[];
}

export interface Anexo {
  id: string;
  storage_path: string;
  nome_arquivo: string;
  campo: string | null;
  created_at: string;
}

export interface Comentario {
  id: string;
  autor_id: string;
  texto: string;
  tipo: string | null;
  created_at: string;
}

export interface Convidado {
  id: string;
  user_id: string;
  created_at: string;
}

export interface Usuario {
  id: string;
  display_name: string;
}

export interface Assinatura {
  id: string;
  user_id: string;
  etapa: string;
  assinatura_png: string;
  created_at: string;
}

export interface AprovadorTesteInterno {
  slot: number;
  user_id: string | null;
  display_name: string | null;
}

export interface Papeis {
  comite: boolean;
  controladoria: boolean;
  gerenteSistemas: boolean;
  desenvolvedores: boolean;
  criarSolicitacao: boolean;
  convidado: boolean;
  verTodas: boolean;
}

// 14 etapas (reestruturação pedida pelo CEO — ver KANBAN CARDS.xlsx). "Projeto"
// virou 4 colunas independentes; "Aprovações e Priorização" + "Definição de
// Responsável" virou 1 coluna só.
export const ETAPAS: Array<{ key: string; label: string }> = [
  { key: "solicitacao_demanda", label: "Solicitação da Demanda" },
  { key: "triagem_inicial", label: "Triagem Inicial" },
  { key: "analise_necessidade", label: "Análise de Necessidade" },
  { key: "levantamento_funcional", label: "Levantamento Funcional" },
  { key: "documentacao_funcional", label: "Documentação Funcional" },
  { key: "analise_tecnica", label: "Análise Técnica" },
  { key: "aprovacao_priorizacao", label: "Aprovação e Priorização" },
  { key: "desenvolvimento", label: "Desenvolvimento" },
  { key: "testes_internos", label: "Testes Internos" },
  { key: "homologacao_area_solicitante", label: "Homologação da Área Solicitante" },
  { key: "treinamento", label: "Treinamento" },
  { key: "implantacao", label: "Implantação" },
  { key: "acompanhamento_assistido", label: "Acompanhamento Assistido" },
  { key: "encerramento", label: "Encerramento" },
];

// Prazo normal em dias úteis por etapa (espelha public.prazo_dias_uteis_etapa
// no banco) — etapas ausentes daqui não têm prazo. Usado só pro badge visual;
// quem decide de verdade se o prazo venceu é o servidor.
export const PRAZO_DIAS_UTEIS: Record<string, number> = {
  triagem_inicial: 2,
  analise_necessidade: 5,
  levantamento_funcional: 10,
  documentacao_funcional: 5,
  analise_tecnica: 5,
  testes_internos: 3,
  homologacao_area_solicitante: 5,
  treinamento: 5,
  acompanhamento_assistido: 10,
};

export const DIAS_UTEIS_PRORROGACAO = 2;

// Aprovações nominais dos Testes Internos — nomes só aqui (front-end), as
// colunas no banco (testes_interno_aprov_1/2/3) são genéricas pra não acoplar
// schema a pessoas. Cada slot só pode ser marcado pela própria pessoa vinculada
// (ver public.testes_interno_aprovador_user_id no banco).
export const APROVACOES_TESTES_INTERNOS: Record<"testes_interno_aprov_1" | "testes_interno_aprov_2" | "testes_interno_aprov_3", string> = {
  testes_interno_aprov_1: "Érica Souza Ávila",
  testes_interno_aprov_2: "Yuri Rosa",
  testes_interno_aprov_3: "Iury de Jesus Silva",
};

// 6 campos de texto da abertura — "Tipo da Solicitação" e "Grau de Urgência"
// são dropdowns fixos (TIPO_SOLICITACAO_LABEL / GRAU_URGENCIA_LABEL), não
// entram nessa lista.
export const CAMPOS_ABERTURA: Array<{ key: keyof Solicitacao; label: string; placeholder: string }> = [
  { key: "objetivo_solicitacao", label: "Objetivo da solicitação", placeholder: "Qual é o objetivo desta solicitação?" },
  { key: "problema_atual", label: "Problema atual", placeholder: "Descreva o problema que motivou esta solicitação." },
  { key: "justificativa", label: "Justificativa", placeholder: "Por que esta solicitação é necessária?" },
  { key: "beneficio_esperado", label: "Benefício esperado", placeholder: "Que benefício esta solicitação trará?" },
  { key: "impacto_operacional", label: "Impacto operacional", placeholder: "Qual o impacto na operação?" },
];

export const GRAU_URGENCIA_LABEL: Record<string, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
};

export const TIPO_SOLICITACAO_LABEL: Record<string, string> = {
  correcao: "Correção",
  melhoria: "Melhoria",
  novo_modulo: "Novo Módulo",
  integracao: "Integração",
  relatorio: "Relatório",
  automacao: "Automação",
  alteracao_legal: "Alteração Legal",
};

export const CRITERIO_TRIAGEM_LABEL: Record<string, string> = {
  falha_processo: "Falha no Processo",
  necessidade_treinamento: "Necessidade de Treinamento",
  possibilidade_parametrizacao: "Possibilidade de Parametrização",
  necessidade_desenvolvimento: "Necessidade de Desenvolvimento",
};

export const COMPLEXIDADE_LABEL: Record<string, string> = {
  pequena: "Pequena",
  media: "Média",
  grande: "Grande",
  projeto: "Projeto",
};

export const STATUS_DESENVOLVIMENTO_LABEL: Record<string, string> = {
  em_desenvolvimento: "Em Desenvolvimento",
  em_validacao: "Em Validação",
  em_correcao: "Em Correção",
  finalizado: "Finalizado",
};

export const STATUS_DESENVOLVIMENTO_COR: Record<string, string> = {
  em_desenvolvimento: "bg-info/15 text-info border-info/30",
  em_validacao: "bg-warning/15 text-warning border-warning/30",
  em_correcao: "bg-destructive/15 text-destructive border-destructive/30",
  finalizado: "bg-success/15 text-success border-success/30",
};

// Pesquisa de Avaliação da Demanda — respondida na etapa Encerramento por quem
// criou, convidados, ou Controladoria. As 5 primeiras são escala 1-5; a última
// é sim/não e só tem caráter informativo (não bloqueia o "Finalizar demanda").
export const PESQUISA_ENCERRAMENTO: Array<{
  key: "pesquisa_atendeu_necessidade" | "pesquisa_levantamento_claro" | "pesquisa_conducao_ti" | "pesquisa_treinamento_suporte" | "pesquisa_avaliacao_geral";
  pergunta: string;
  opcoes: string[];
}> = [
  {
    key: "pesquisa_atendeu_necessidade",
    pergunta: "A solução implantada atendeu à necessidade que originou a solicitação?",
    opcoes: ["Não atendeu", "Atendeu pouco", "Atendeu parcialmente", "Atendeu", "Atendeu completamente"],
  },
  {
    key: "pesquisa_levantamento_claro",
    pergunta: "O levantamento da necessidade foi realizado de forma clara, permitindo que sua demanda fosse corretamente compreendida?",
    opcoes: ["Muito insatisfatório", "Insatisfatório", "Regular", "Bom", "Excelente"],
  },
  {
    key: "pesquisa_conducao_ti",
    pergunta: "Como você avalia a condução do processo pela equipe de TI e Processos (comunicação, acompanhamento e suporte durante o desenvolvimento)?",
    opcoes: ["Muito insatisfeito", "Insatisfeito", "Regular", "Satisfeito", "Muito satisfeito"],
  },
  {
    key: "pesquisa_treinamento_suporte",
    pergunta: "Como você avalia o treinamento e o suporte prestado durante a implantação da solução?",
    opcoes: ["Muito insatisfatório", "Insatisfatório", "Regular", "Bom", "Excelente"],
  },
  {
    key: "pesquisa_avaliacao_geral",
    pergunta: "De forma geral, como você avalia todo o processo de atendimento da sua demanda, desde a solicitação até a implantação?",
    opcoes: ["Muito insatisfeito", "Insatisfeito", "Regular", "Satisfeito", "Muito satisfeito"],
  },
];

export const PESQUISA_PODE_ENCERRAR_PERGUNTA = "Você considera que esta demanda pode ser encerrada?";
export const PESQUISA_PODE_ENCERRAR_OPCOES = {
  sim: "Sim, a demanda foi plenamente atendida.",
  nao: "Não, ainda existem ajustes necessários.",
};

// Comentários "tipados" (justificativa/ressalva/reprovação/etc.) ganham borda própria.
export const TIPO_COMENTARIO_LABEL: Record<string, string> = {
  justificativa_retorno: "Justificativa de retorno de etapa",
  aprovado_ressalva: "Aprovado com ressalva",
  reprovado: "Reprovado",
  faltou_funcoes: "Faltou função",
  encontrado_bug: "Bug encontrado",
  implantacao_comentario: "Comentário de implantação",
  encerramento_comentario: "Comentário de conclusão",
  interromper_desenvolvimento: "Interrupção do desenvolvimento",
  erro_documental: "Erro documental",
};

export const TIPO_COMENTARIO_BORDA: Record<string, string> = {
  justificativa_retorno: "border-l-warning",
  aprovado_ressalva: "border-l-warning",
  reprovado: "border-l-destructive",
  faltou_funcoes: "border-l-warning",
  encontrado_bug: "border-l-destructive",
  implantacao_comentario: "border-l-muted-foreground",
  encerramento_comentario: "border-l-success",
  interromper_desenvolvimento: "border-l-destructive",
  erro_documental: "border-l-warning",
};

// FSD — constantes de opções para Parte A (criação)
export const CLASSIFICACAO_DEMANDA_OPCOES = [
  { value: "correcao_falha", label: "Correção de Falha (Bug)" },
  { value: "melhoria_processo", label: "Melhoria de Processo" },
  { value: "nova_funcionalidade", label: "Nova Funcionalidade" },
  { value: "novo_processo", label: "Novo Processo" },
  { value: "novo_relatorio", label: "Novo Relatório" },
  { value: "integracao_sistemas", label: "Integração entre Sistemas" },
  { value: "automacao", label: "Automação" },
  { value: "alteracao_legal", label: "Alteração Legal" },
  { value: "outro", label: "Outro" },
];

export const BENEFICIOS_ESPERADOS_OPCOES = [
  { value: "reducao_tempo", label: "Redução de tempo" },
  { value: "aumento_produtividade", label: "Aumento da produtividade" },
  { value: "reducao_retrabalho", label: "Redução de retrabalho" },
  { value: "maior_controle", label: "Maior controle" },
  { value: "reducao_custos", label: "Redução de custos" },
  { value: "atendimento_legislacao", label: "Atendimento à legislação" },
  { value: "outro", label: "Outro" },
];

export const IMPACTO_TIPO_OPCOES = [
  { value: "apenas_minha_area", label: "Apenas minha área" },
  { value: "mais_de_uma_area", label: "Mais de uma área" },
  { value: "toda_empresa", label: "Toda a empresa" },
];

export const DOCUMENTOS_APOIO_OPCOES = [
  { value: "fluxograma", label: "Fluxograma" },
  { value: "planilha", label: "Planilha" },
  { value: "relatorio", label: "Relatório" },
  { value: "print_tela", label: "Print de Tela" },
  { value: "outro", label: "Outro" },
];

export const TRIAGEM_CLASSIFICACAO_LABEL: Record<string, string> = {
  processo: "Falha/Melhoria de Processo",
  sistema: "Necessidade de Sistemas",
  treinamento: "Necessidade de Treinamento",
  parametrizacao: "Possibilidade de Parametrização",
  outro: "Outro",
};

export const TRIAGEM_DECISAO_LABEL: Record<string, string> = {
  aprovado: "Aprovado — encaminhar para Análise de Necessidade",
  reprovado: "Reprovado — encerrar solicitação",
  devolvido_ajustes: "Devolvido para ajustes ao solicitante",
};

export function sdNumero(card: Pick<Solicitacao, "numero" | "created_at">): string {
  if (card.numero == null) return "SD-????-????";
  const ano = new Date(card.created_at).getFullYear();
  return `SD-${ano}-${String(card.numero).padStart(4, "0")}`;
}

export function nomeUsuario(usuarios: Usuario[], id: string | null): string | null {
  return usuarios.find((u) => u.id === id)?.display_name ?? null;
}

export function iniciais(nome: string): string {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export function fmtData(data: string | null): string | null {
  if (!data) return null;
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

// Conta dias úteis (seg-sex) entre 2 datas — espelha public.dias_uteis_entre no
// banco. Só pra exibição; quem decide de verdade é o servidor.
export function diasUteisEntre(inicio: Date, fim: Date): number {
  let dias = 0;
  const d = new Date(inicio);
  d.setHours(0, 0, 0, 0);
  const limite = new Date(fim);
  limite.setHours(0, 0, 0, 0);
  while (d < limite) {
    d.setDate(d.getDate() + 1);
    const diaSemana = d.getDay();
    if (diaSemana !== 0 && diaSemana !== 6) dias++;
  }
  return dias;
}

export interface StatusPrazo {
  temPrazo: boolean;
  prorrogado: boolean;
  expirado: boolean;
  diasUteisRestantes: number;
}

// Calcula o status do prazo (normal / em prorrogação / expirado) de uma etapa,
// a partir de quando o card entrou nela.
export function statusPrazoEtapa(etapaKey: string, etapaEntradaEm: string): StatusPrazo {
  const prazo = PRAZO_DIAS_UTEIS[etapaKey];
  if (!prazo) return { temPrazo: false, prorrogado: false, expirado: false, diasUteisRestantes: 0 };
  const passados = diasUteisEntre(new Date(etapaEntradaEm), new Date());
  const prorrogado = passados > prazo;
  const expirado = passados > prazo + DIAS_UTEIS_PRORROGACAO;
  const limite = prorrogado ? prazo + DIAS_UTEIS_PRORROGACAO : prazo;
  return { temPrazo: true, prorrogado, expirado, diasUteisRestantes: limite - passados };
}

export interface EtapaPanelProps {
  card: Solicitacao;
  papeis: Papeis;
  userId: string | null;
  usuarios: Usuario[];
  convidaveis: Usuario[];
  anexos: Anexo[];
  comentarios: Comentario[];
  convidados: Convidado[];
  totalNaColuna: number;
  prioridadesUsadas: number[];
  aprovadoresTestesInternos: AprovadorTesteInterno[];
  /** Atualiza colunas da própria solicitação (etapa, campos, flags) — já passa pelas regras do trigger no banco. */
  onUpdate: (patch: Record<string, unknown>) => Promise<boolean>;
  onComentar: (texto: string, tipo?: string) => Promise<boolean>;
  onAnexar: (file: File, campo?: string) => Promise<boolean>;
  onDownloadAnexo: (path: string) => void;
  onAdicionarConvidado: (userId: string) => Promise<boolean>;
  onRemoverConvidado: (convidadoId: string) => Promise<boolean>;
  onExcluir: () => Promise<boolean>;
}
