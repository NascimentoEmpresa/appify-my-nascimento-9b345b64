// =====================================================================
// COMITÊ DE ÉTICA — vocabulário único das listas do módulo
//
// Ficha de tratativa, dashboard e formulário público precisam concordar
// letra por letra: se o `value` gravado divergir do esperado pelo painel,
// o indicador some sem erro nenhum na tela. Por isso as listas moram aqui,
// e não copiadas em cada arquivo.
//
// Os `value` são os mesmos aceitos pelo CHECK das colunas em
// 20260901000003_comite_etica_indicadores.sql — mudar um lado obriga o outro.
// =====================================================================

export interface Opcao { value: string; label: string; }

/** Por onde a denúncia chegou (não confundir com quem denunciou). */
export const ORIGEM: Opcao[] = [
  { value: "canal_web", label: "Canal de Ética (site)" },
  { value: "presencial", label: "Presencial" },
  { value: "email", label: "E-mail" },
  { value: "telefone", label: "Telefone" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "carta", label: "Carta / caixa de sugestões" },
  { value: "contato_seguro", label: "Contato Seguro (legado)" },
  { value: "gestor", label: "Encaminhada por gestor" },
  { value: "outro", label: "Outro" },
];

/**
 * Tipos. Os 12 primeiros são os mesmos do formulário público — o comitê
 * pode reclassificar, e é a classificação dele que manda no indicador.
 */
export const TIPO: Opcao[] = [
  { value: "assedio_moral", label: "Assédio moral" },
  { value: "assedio_sexual", label: "Assédio sexual" },
  { value: "discriminacao", label: "Discriminação / Preconceito" },
  { value: "desrespeito", label: "Desrespeito / Conduta inadequada" },
  { value: "fraude", label: "Fraude / Corrupção / Suborno" },
  { value: "furto_desvio", label: "Furto / Roubo / Desvio" },
  { value: "conflito_interesses", label: "Conflito de interesses" },
  { value: "uso_indevido", label: "Uso indevido de recursos" },
  { value: "informacoes", label: "Vazamento de informações" },
  { value: "sst", label: "Segurança e saúde no trabalho" },
  { value: "meio_ambiente", label: "Meio ambiente" },
  { value: "violacao_conduta", label: "Descumprimento de norma / Código de Conduta" },
  { value: "outro", label: "Outro" },
];

export const GRAVIDADE: Opcao[] = [
  { value: "baixa", label: "Baixa" },
  { value: "media", label: "Média" },
  { value: "alta", label: "Alta" },
  { value: "critica", label: "Crítica" },
];

/** Sigilo do CASO (a apuração corre restrita), não do denunciante. */
export const SIGILO: Opcao[] = [
  { value: "sigilosa", label: "Sigilosa" },
  { value: "identificada", label: "Identificada" },
];

/**
 * Situação = onde o processo está. Separada do resultado de propósito:
 * antes, "procedente" era status, e não dava para dizer que um caso julgado
 * procedente continuava aberto aguardando o cumprimento da medida.
 */
export const SITUACAO: Opcao[] = [
  { value: "nova", label: "Denúncia recebida" },
  { value: "triagem", label: "Em triagem" },
  { value: "investigacao", label: "Em apuração" },
  { value: "aguardando_esclarecimentos", label: "Aguardando esclarecimentos" },
  { value: "aguardando_documentos", label: "Aguardando documentos" },
  { value: "parecer_elaboracao", label: "Parecer em elaboração" },
  { value: "aguardando_presidencia", label: "Aguardando decisão da Presidência" },
  { value: "aguardando_cumprimento", label: "Aguardando cumprimento de medida" },
  { value: "concluida", label: "Concluída" },
  { value: "arquivada", label: "Arquivada" },
  { value: "reaberta", label: "Reaberta" },
];

/**
 * Situações que param o cronômetro do SLA.
 *
 * `aguardando_cumprimento` NÃO entra — e é o ponto todo dela existir. Antes,
 * o equivalente (`julgada`) parava o relógio, então um caso julgado cuja
 * medida ninguém executou aparecia como concluído e sumia do radar.
 */
export const SITUACOES_CONCLUIDAS = ["concluida", "arquivada"];

/** Situações em que a bola está com quem denunciou, não com o Comitê. */
export const SITUACOES_AGUARDANDO_TERCEIRO = [
  "aguardando_esclarecimentos", "aguardando_documentos",
];

/** O que o Comitê recomenda ao fim da apuração. */
export const RECOMENDACAO: Opcao[] = [
  { value: "arquivamento", label: "Arquivamento" },
  { value: "aplicacao_medida", label: "Aplicação de medida" },
  { value: "apuracao_complementar", label: "Apuração complementar" },
  { value: "reabertura", label: "Reabertura" },
];

/** O que a Presidência fez com a recomendação do Comitê. */
export const DECISAO_SOBRE_PARECER: Opcao[] = [
  { value: "aprovada", label: "Aprovou a recomendação" },
  { value: "alterada", label: "Alterou a recomendação" },
  { value: "rejeitada", label: "Rejeitou a recomendação" },
];

/** Frequência do fato, informada por quem denuncia. */
export const FREQUENCIA: Opcao[] = [
  { value: "unica", label: "Aconteceu uma vez" },
  { value: "recorrente", label: "Acontece de forma repetida" },
  { value: "em_curso", label: "Está acontecendo agora" },
];

/** Como o contrato foi informado — "em branco" significava três coisas. */
export const CONTRATO_SITUACAO: Opcao[] = [
  { value: "selecionado", label: "Selecionado na lista" },
  { value: "manual", label: "Informado manualmente" },
  { value: "nao_localizado", label: "Contrato não localizado" },
  { value: "nao_sei", label: "Não sei informar" },
];

/** Para que serve cada arquivo do procedimento. */
export const CATEGORIA_ANEXO: Opcao[] = [
  { value: "evidencia", label: "Evidência" },
  { value: "documento_suporte", label: "Documento de suporte" },
  { value: "entrevista", label: "Entrevista" },
  { value: "manifestacao", label: "Manifestação" },
  { value: "parecer", label: "Parecer" },
  { value: "outro", label: "Outro" },
];

/** Registros de apuração que entram no fio da conversa, sempre internos. */
export const TIPO_REGISTRO: Opcao[] = [
  { value: "nota", label: "Nota interna" },
  { value: "entrevista", label: "Entrevista" },
  { value: "manifestacao", label: "Manifestação" },
  { value: "providencia", label: "Registro de providência" },
];

/** Andamento de cada providência. */
export const SITUACAO_PROVIDENCIA: Opcao[] = [
  { value: "pendente", label: "Pendente" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "concluida", label: "Concluída" },
  { value: "cancelada", label: "Cancelada" },
];

/** O que cada alerta do tick quer dizer. */
export const TIPO_ALERTA: Record<string, string> = {
  prazo_vencido: "Prazo estourado",
  resposta_pendente: "Pendente de resposta",
  providencia_vencida: "Providência vencida",
  // Aposentados na 20260930000057: alertavam AUSÊNCIA de movimento, e alerta
  // que toca sem ninguém estar esperando vira ruído. Os rótulos ficam porque
  // linhas antigas continuam no histórico — e porque migration aqui é
  // aplicada à mão: até alguém rodar o SQL, o tick ainda os acende.
  primeira_providencia: "Sem primeira providência",
  parado: "Sem movimentação",
};

/**
 * O que o banner da lista mostra. Os dois tipos de ausência de movimento
 * ficam de fora mesmo que o tick ainda os crie — ver TIPO_ALERTA.
 */
export const TIPOS_ALERTA_NO_BANNER = [
  "prazo_vencido", "resposta_pendente", "providencia_vencida",
];

export const RESULTADO: Opcao[] = [
  { value: "procedente", label: "Procedente" },
  { value: "parcialmente_procedente", label: "Parcialmente procedente" },
  { value: "improcedente", label: "Improcedente" },
  { value: "arquivada", label: "Arquivada" },
];

/** Medidas são múltiplas: um caso pode gerar advertência E treinamento. */
export const MEDIDA: Opcao[] = [
  { value: "advertencia", label: "Advertência" },
  { value: "suspensao", label: "Suspensão" },
  { value: "demissao", label: "Demissão" },
  { value: "treinamento", label: "Treinamento" },
  { value: "orientacao", label: "Orientação / Feedback" },
  { value: "melhoria_processo", label: "Melhoria de processo" },
  { value: "nenhuma", label: "Nenhuma medida" },
];

/** As que contam como medida disciplinar no indicador. */
export const MEDIDAS_DISCIPLINARES = ["advertencia", "suspensao", "demissao"];

export const RECURSO_RESULTADO: Opcao[] = [
  { value: "mantida", label: "Decisão mantida" },
  { value: "parcialmente_reformada", label: "Parcialmente reformada" },
  { value: "reformada", label: "Decisão reformada" },
];

export const CAUSA_RAIZ: Opcao[] = [
  { value: "falha_lideranca", label: "Falha de liderança" },
  { value: "comunicacao", label: "Comunicação" },
  { value: "treinamento", label: "Treinamento / capacitação" },
  { value: "processo", label: "Falha de processo" },
  { value: "comportamento_individual", label: "Comportamento individual" },
  { value: "descumprimento_norma", label: "Descumprimento de norma" },
  { value: "clima_organizacional", label: "Clima organizacional" },
  { value: "outro", label: "Outro" },
];

/**
 * Causas que apontam para o sistema, não para a pessoa — é o que responde
 * "existem padrões que indiquem falha de processo, e não de comportamento?".
 */
export const CAUSAS_SISTEMICAS = [
  "falha_lideranca", "comunicacao", "treinamento", "processo", "clima_organizacional",
];

export const RELACAO: Opcao[] = [
  { value: "colaborador", label: "Colaborador(a)" },
  { value: "ex_colaborador", label: "Ex-colaborador(a)" },
  { value: "estagiario", label: "Estagiário / Aprendiz" },
  { value: "terceirizado", label: "Terceirizado(a)" },
  { value: "fornecedor", label: "Fornecedor(a)" },
  { value: "cliente", label: "Cliente" },
  { value: "outro", label: "Outro" },
];

export const SIM_NAO_NAOSEI: Opcao[] = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
  { value: "nao_sei", label: "Não sei" },
];

/** Cor de cada gravidade — usada em badge e em barra de gráfico. */
export const COR_GRAVIDADE: Record<string, string> = {
  baixa: "#16a34a", media: "#eab308", alta: "#ea580c", critica: "#dc2626",
};

export const COR_RESULTADO: Record<string, string> = {
  procedente: "#dc2626", parcialmente_procedente: "#ea580c",
  improcedente: "#16a34a", arquivada: "#94a3b8",
};

/** Paleta das séries dos gráficos, na ordem em que são consumidas. */
export const CORES = [
  "#0f3171", "#2563eb", "#0891b2", "#16a34a", "#eab308",
  "#ea580c", "#dc2626", "#9333ea", "#db2777", "#64748b",
];

/** Converte lista de opções em mapa value → label, para exibir. */
export const mapaDe = (o: Opcao[]): Record<string, string> =>
  Object.fromEntries(o.map((x) => [x.value, x.label]));

export const LABEL_ORIGEM = mapaDe(ORIGEM);
export const LABEL_TIPO = mapaDe(TIPO);
export const LABEL_GRAVIDADE = mapaDe(GRAVIDADE);
export const LABEL_SIGILO = mapaDe(SIGILO);
export const LABEL_SITUACAO = mapaDe(SITUACAO);
export const LABEL_RESULTADO = mapaDe(RESULTADO);
export const LABEL_MEDIDA = mapaDe(MEDIDA);
export const LABEL_RECURSO = mapaDe(RECURSO_RESULTADO);
export const LABEL_CAUSA = mapaDe(CAUSA_RAIZ);
export const LABEL_RELACAO = mapaDe(RELACAO);
export const LABEL_SIM_NAO = mapaDe(SIM_NAO_NAOSEI);
export const LABEL_RECOMENDACAO = mapaDe(RECOMENDACAO);
export const LABEL_DECISAO = mapaDe(DECISAO_SOBRE_PARECER);
export const LABEL_FREQUENCIA = mapaDe(FREQUENCIA);
export const LABEL_CONTRATO_SIT = mapaDe(CONTRATO_SITUACAO);
export const LABEL_CATEGORIA_ANEXO = mapaDe(CATEGORIA_ANEXO);
export const LABEL_TIPO_REGISTRO = mapaDe(TIPO_REGISTRO);
export const LABEL_SIT_PROVIDENCIA = mapaDe(SITUACAO_PROVIDENCIA);

/** Rótulo com fallback: valor desconhecido aparece cru em vez de sumir. */
export const rotulo = (mapa: Record<string, string>, v?: string | null) =>
  (v && (mapa[v] ?? v)) || "—";
