// =====================================================================
// RESUMO DE FUNÇÕES — como cada sistema funciona, escrito uma vez só.
//
// Toda tela de solicitação do ERP ganhou um botão "Resumo de Funções"
// (02/09/2026, pedido do Pablo: "preciso que todos sistemas que fizemos
// tenha um botão Resumo de Funções, onde um resumo explica como funciona
// todo sistema"). O texto de cada fluxo mora AQUI, não na tela, por dois
// motivos:
//
//   1. O mesmo fluxo aparece em várias telas. A demissão, por exemplo, é
//      lida pelo encarregado, pelo analista, pelo Operacional, pelo SST e
//      pelo RH — cinco lugares. Cinco cópias do texto viravam cinco versões
//      diferentes do fluxo na primeira vez que alguém mudasse uma etapa.
//
//   2. Quando a ordem das etapas muda, muda AQUI e na regra (lib/…), lado a
//      lado. Foi exatamente o que aconteceu com a demissão neste mesmo dia:
//      SST e RH trocaram de lugar. Um resumo escrito dentro do JSX de cinco
//      páginas teria ficado mentindo em pelo menos três delas.
//
// A `etapa` de cada passo é o rótulo de QUEM faz, e o `titulo` é o que
// acontece. `onde` é a tela — serve para a pessoa saber onde ir quando o
// card está parado esperando outro setor.
// =====================================================================

export interface PassoFluxo {
  /** Quem age. Vira o selo colorido da etapa. */
  quem: string;
  /** O que essa pessoa faz, em uma frase de verbo. */
  faz: string;
  /** Onde isso acontece no ERP. Vazio quando é fora do sistema. */
  onde?: string;
  /**
   * O status que a solicitação carrega ENQUANTO espera este passo. É o que
   * liga o resumo ao que a pessoa vê na coluna Status da lista.
   */
  status?: string;
}

export interface Fluxo {
  /** Chave usada pelas telas: `<ResumoDeFuncoes fluxo="demissao" />`. */
  codigo: string;
  /** Nome do sistema, como ele aparece no menu. */
  nome: string;
  /** Uma frase: para que serve. */
  paraQue: string;
  passos: PassoFluxo[];
  /**
   * O que costuma gerar dúvida e não cabe na sequência — reprovação, prazos,
   * quem pode cancelar. Some da tela quando vazio.
   */
  observacoes?: string[];
}

// ── Os fluxos ────────────────────────────────────────────────────────

const demissao: Fluxo = {
  codigo: "demissao",
  nome: "Solicitação de Demissão",
  paraQue: "Desligar um colaborador, do pedido do encarregado até o agendamento do ASO demissional no SST.",
  passos: [
    {
      quem: "Encarregado", faz: "Abre a solicitação com o motivo, o aviso prévio e os documentos.",
      onde: "Encarregados › Solicitar Demissão",
    },
    {
      quem: "Operacional", faz: "Aprova ou reprova a demissão de contrato. Reprovar exige motivo escrito — é o que o encarregado lê para corrigir.",
      onde: "Operacional › Solicitações de Demissão",
      status: "Pendente Operacional",
    },
    {
      quem: "Diretoria", faz: "Aprova ou reprova a demissão do escritório / com setor — só ela vê essas; aprovada, segue pro RH.",
      onde: "Diretoria › Solicitações de Demissão",
      status: "Pendente Diretoria",
    },
    {
      quem: "RH", faz: "Confere o desligamento e libera para o SST agendar o ASO.",
      onde: "RH › Solicitações de Demissão",
      status: "Pendente RH",
    },
    {
      quem: "SST", faz: "Marca a solicitação como recebida e agenda o ASO demissional: data, hora e local do exame. É o SST que fecha a demissão.",
      onde: "SST › ASO Demissional",
      status: "Pendente SST",
    },
  ],
  observacoes: [
    "Dentro do SST a solicitação passa por três status possíveis: primeiro \"Solicitação de agendamento de DEMISSIONAL recebida\" (o SST pegou o pedido) e depois \"Agendamento concluído\" (o exame tem data, hora e local) — ou \"ASO válido\", quando o colaborador fez ASO há menos de 90 dias e não precisa de exame. Só o painel do SST muda esses; as outras telas mostram.",
    "O SST e o RH podem DEVOLVER ao Operacional quando a solicitação vem com erro — ela volta para a fila dele com o motivo escrito, e o que já tinha sido carimbado nas etapas seguintes é desfeito. Quando voltar, passa pelo RH de novo. Depois de agendado o SST não devolve mais: já há exame marcado com o colaborador.",
    "Os analistas enxergam o fluxo inteiro em Licitações › Analistas Validações › Solicitações de Demissão, mas só para acompanhar — quem decide a primeira etapa é o Operacional.",
    "Reprovada pelo Operacional, a solicitação para e volta para o encarregado com o motivo.",
    "O encarregado acompanha tudo em Minhas Solicitações, e a conversa da solicitação é a mesma para todos os setores.",
  ],
};

const trocaFuncao: Fluxo = {
  codigo: "troca_funcao",
  nome: "Mudança de Função",
  paraQue: "Trocar o cargo de um colaborador, da proposta do encarregado até a alteração na Senior.",
  passos: [
    {
      quem: "Encarregado", faz: "Propõe a troca: colaborador, cargo novo, motivo e data pretendida.",
      onde: "Encarregados › Mudança de Função",
    },
    {
      quem: "Operacional", faz: "Aprova a troca de contrato (sem setor). Com setor, só se o setor estiver liberado pra ele em Acesso por Usuário.",
      onde: "Operacional › Mudança de Função",
      status: "Pendente Operacional",
    },
    {
      quem: "Diretoria", faz: "Aprova a troca do administrativo ou com setor — cada aprovador só vê e decide os setores marcados pra ele em Acesso por Usuário.",
      onde: "Diretoria › Mudança de Função",
      status: "Pendente Escritório",
    },
    {
      quem: "SST", faz: "Marca o ASO — ou dispensa, quando a função nova não exige exame novo.",
      onde: "SST › Mudança de Função — ASO",
      status: "Pendente SST",
    },
    {
      quem: "RH", faz: "Altera o cargo na Senior e conclui.",
      onde: "RH › Mudança de Função",
      status: "Pendente RH",
    },
  ],
  observacoes: [
    "Licitações › Analistas Validações › Mudança de Função só acompanha as trocas de contrato (sem setor) — não valida nem vê as do administrativo.",
    "Dispensar o ASO exige o porquê escrito: o RH recebe a troca sem exame e precisa saber que foi decisão, não esquecimento.",
    "Reprovar exige motivo. Depois de aprovada, não se reprova — o caminho é abrir outra.",
  ],
};

const vaga: Fluxo = {
  codigo: "vaga",
  nome: "Gestão Recrutamento",
  paraQue: "Abrir uma vaga a partir do pedido do encarregado e conduzir a seleção até a admissão.",
  passos: [
    {
      quem: "Encarregado", faz: "Solicita a vaga: contrato, posto, motivo (substituição ou aumento de quadro).",
      onde: "Encarregados › Solicitar Vaga",
    },
    {
      quem: "Analista", faz: "Aprova ou reprova a solicitação de contrato antes de ela virar vaga.",
      onde: "Licitações › Analistas Validações › Gestão Recrutamento",
      status: "Pendente Analista",
    },
    {
      quem: "Diretoria", faz: "Aprova ou reprova a vaga administrativa / com setor — só depois dela o Recrutamento vê.",
      onde: "Diretoria › Gestão Recrutamento",
      status: "Pendente Diretoria",
    },
    {
      quem: "Recrutamento", faz: "Confirma a abertura, publica no portal e recebe os currículos.",
      onde: "Recrutamento e Seleção › Gestão Recrutamento",
      status: "Pendente Recrutamento",
    },
    {
      quem: "Recrutamento", faz: "Conduz a seleção no kanban do candidato: entrevista, documentação, exame e admissão.",
      onde: "Recrutamento e Seleção › Gestão Recrutamento",
      status: "Seleção de Candidato",
    },
  ],
  observacoes: [
    "O Operacional enxerga a mesma fila em Operacional › Gestão Recrutamento, mas só para acompanhar — quem aprova é o analista.",
    "Jurídico, SST e Compras têm etapas próprias dentro do kanban do candidato, cada uma com a sua permissão.",
  ],
};

const ferias: Fluxo = {
  codigo: "ferias",
  nome: "Solicitação de Férias",
  paraQue: "Programar as férias de um colaborador a partir do pedido do encarregado.",
  passos: [
    {
      quem: "Encarregado", faz: "Solicita o período de férias do colaborador.",
      onde: "Encarregados › Solicitar Férias",
    },
    {
      quem: "RH", faz: "Confere o período aquisitivo, programa e devolve o aviso.",
      onde: "RH › Gestão de Férias",
    },
  ],
  observacoes: [
    "O encarregado acompanha o andamento em Minhas Solicitações.",
  ],
};

const advertencia: Fluxo = {
  codigo: "advertencia",
  nome: "Advertência",
  paraQue: "Registrar uma advertência disciplinar e levá-la à análise jurídica.",
  passos: [
    {
      quem: "Encarregado", faz: "Registra a ocorrência com o relato e as testemunhas.",
      onde: "Encarregados › Advertência",
      status: "Aguardando Aprovação",
    },
    {
      quem: "Aprovador (Acesso por Usuário)", faz: "Aprova ou reprova. Reprovar exige motivo — é o que o encarregado lê. Quem aprova tem a ação Aprovar no menu Advertências.",
      onde: "Jurídico › Advertências",
      status: "Aguardando Jurídico",
    },
    {
      quem: "Jurídico", faz: "Analisa, decide o enquadramento, registra o parecer e emite o documento.",
      onde: "Jurídico › Advertências",
      status: "Concluída",
    },
  ],
  observacoes: [
    "O encarregado acompanha o andamento em Minhas Solicitações.",
  ],
};

// Orientações Jurídicas (25/09/2026, migs 244/247): a pergunta do
// encarregado passa primeiro pelo Operacional (supervisor do contrato).
const orientacoes: Fluxo = {
  codigo: "orientacoes",
  nome: "Orientações Jurídicas",
  paraQue: "Tirar dúvidas jurídicas — a do encarregado passa primeiro pelo Operacional, que orienta ou encaminha ao Jurídico.",
  passos: [
    {
      quem: "Encarregado / colaborador", faz: "Faz a pergunta. Pode marcá-la como reservada (fora da biblioteca).",
      onde: "Encarregados › Orientações Jurídicas ou Central de Serviços › Orientações Jurídicas",
    },
    {
      quem: "Operacional", faz: "Pergunta de encarregado: responde direto, encaminha ao Jurídico quando não sabe orientar, ou reprova com motivo.",
      onde: "Operacional › Orientações Jurídicas",
      status: "Pendente Operacional",
    },
    {
      quem: "Aprovador (Acesso por Usuário)", faz: "Pergunta de quem não é encarregado: aprova ou reprova antes de ir ao Jurídico.",
      onde: "Jurídico › Parecer Jurídico",
      status: "Aberta",
    },
    {
      quem: "Jurídico", faz: "Responde. A resposta entra na biblioteca (se a pergunta não estiver oculta).",
      onde: "Jurídico › Parecer Jurídico",
      status: "Aprovada",
    },
    {
      quem: "Quem perguntou", faz: "Avalia a resposta e pode perguntar mais no mesmo fio.",
      onde: "Minhas perguntas",
      status: "Respondida",
    },
  ],
  observacoes: [
    "É 'de encarregado' quem tem a tela Orientações Jurídicas do módulo Encarregados, por qualquer porta que pergunte.",
    "Resposta do Operacional não vai para a biblioteca do Jurídico — não é parecer.",
    "Ocultar: a pergunta sai da biblioteca e só quem perguntou e os responsáveis (Operacional, Jurídico) veem.",
  ],
};

const FLUXOS: Record<string, Fluxo> = {
  [demissao.codigo]: demissao,
  [trocaFuncao.codigo]: trocaFuncao,
  [vaga.codigo]: vaga,
  [ferias.codigo]: ferias,
  [advertencia.codigo]: advertencia,
  [orientacoes.codigo]: orientacoes,
};

export const CODIGOS_DE_FLUXO = Object.keys(FLUXOS);

/**
 * O fluxo pelo código, ou `null` quando não existe.
 *
 * Devolver null em vez de estourar é de propósito: um botão de ajuda que
 * derruba a tela é pior do que um botão que não aparece.
 */
export function fluxoPorCodigo(codigo: string): Fluxo | null {
  return FLUXOS[codigo] ?? null;
}

/** Todos, na ordem em que foram declarados. Serve para telas de índice. */
export function todosOsFluxos(): Fluxo[] {
  return Object.values(FLUXOS);
}

/**
 * A sequência em uma linha: "Encarregado → Analista → SST → RH".
 *
 * É o subtítulo do diálogo e o que cabe num tooltip — a pergunta mais comum
 * ("quem vem depois de mim?") se responde sem ler o resto.
 */
export function sequenciaDe(fluxo: Fluxo): string {
  return fluxo.passos.map(p => p.quem).join(" → ");
}
