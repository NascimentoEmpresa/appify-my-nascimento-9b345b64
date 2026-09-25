// Solicitação de Demissão — as regras que as telas compartilham.
//
// O encarregado abre → o OPERACIONAL (contrato) ou a DIRETORIA (escritório /
// com setor, desde 16/09/2026) aprova → o RH libera → o SST agenda o ASO
// demissional:
//
//   Pendente Operacional ─┐
//                         ├→ Pendente RH → Pendente SST
//   Pendente Diretoria  ──┘
//        → Solicitação de agendamento de DEMISSIONAL recebida
//        → Agendamento concluído
//          ↘ Reprovada
//
// A ETAPA 1 VOLTOU PARA O OPERACIONAL EM 14/09/2026 (migration
// 20260930000103). Tinha ido para o analista em 02/09/2026 ("Pendente
// Operacional" virou "Pendente Analista", o Operacional ficou só olhando);
// o pedido do Pablo inverteu: "agora o OPERACIONAL aprova e os analistas só
// veem". A tela dos analistas continua de pé, para acompanhar — o mesmo
// desenho de antes, com os papéis trocados. As colunas `operacional_*`
// voltaram a dizer o que o nome diz.
//
// DUAS MUDANÇAS EM 02/09/2026, no mesmo movimento que criou o submódulo
// "Analistas Validações" em Licitações:
//
//   1. Quem decide a etapa 1 passou a ser o ANALISTA, não o Operacional
//      (desfeito em 14/09/2026, ver acima).
//
//   2. SST e RH TROCARAM DE LUGAR. Era RH → SST ("Concluída" era o fim no
//      SST desde 25/08/2026); passou a ser SST → RH.
//
// E EM 08/09/2026 O SST VOLTOU A SER O ÚLTIMO, a pedido do RH: o RH libera e
// o SST agenda. É a terceira arrumação dessas duas etapas em duas semanas —
// se for mexer de novo, mexa AQUI e deixe as telas seguirem, que é o motivo
// deste arquivo existir.
//
// No mesmo dia entraram os DOIS STATUS DO SST. Eles são o miolo da última
// etapa, e existem porque "Pendente SST" respondia mal à pergunta que o
// encarregado faz: o SST viu meu pedido? já marcou? Agora:
//
//   Pendente SST ................ o RH liberou, o SST ainda não pegou
//   Solicitação ... recebida .... o SST pegou e está agendando
//   Agendamento concluído ....... o ASO tem data, hora e local
//
// Só o painel do SST os define (ver STATUS_DE_ACAO, em PainelDemissoes); as
// outras telas leem, filtram e mostram, como qualquer outro status.
//
// Como são várias telas lendo a mesma tabela, o que define o fluxo (as
// opções dos campos, os status e quem pode agir em cada um) mora aqui —
// assim o painel do RH não pode discordar do formulário do encarregado
// sobre o que é uma solicitação válida.

import { localEhEscritorio } from "@/lib/trocaFuncao/solicitacao";

export const TABELA = "SISTEMA_SOLICITACOES_DEMISSAO";
export const TABELA_ANEXOS = "SISTEMA_SOL_DEMISSAO_ANEXOS";
export const BUCKET = "demissoes-docs";

// ── Opções dos campos ────────────────────────────────────────────────
export const MOTIVOS_SOLICITACAO = [
  "Pedido de demissão pelo colaborador",
  "Desligamento por justa causa",
  "Desligamento sem justa causa",
  "Término de contrato de experiência",
  "Abandono de emprego",
  "Outro",
] as const;

export const MOTIVOS_PEDIDO = [
  "Insatisfação salarial",
  "Proposta de outro emprego",
  "Problemas pessoais/familiares",
  "Insatisfação com o ambiente de trabalho",
  "Mudança de cidade",
  "Problemas de saúde",
  "Aposentadoria",
  "Abandono de emprego",
  "Falta grave/indisciplina",
  "Não informado",
  "Outro",
] as const;

export const TERMINOS_EXPERIENCIA = [
  "Não se aplica",
  "Dentro do período de experiência (até 30 dias)",
  "Dentro do período de experiência (até 90 dias)",
  "Após período de experiência",
  "Outro",
] as const;

export const MODELOS_AVISO = [
  "Aviso Prévio Trabalhado",
  "Aviso Prévio Indenizado",
  "Dispensa do Aviso Prévio",
  "Não se aplica",
  "Término de contrato (ausência e dispensa)",
] as const;

// ── Documentos ───────────────────────────────────────────────────────
// O teto de 10 MB é o mesmo do bucket: validar aqui faz o erro aparecer no
// formulário, em vez de voltar como um 413 sem explicação depois do upload.
export const MAX_ARQUIVO_BYTES = 10 * 1024 * 1024;
export const EXTENSOES_ACEITAS = [".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx"];
export const ACCEPT_ANEXO = EXTENSOES_ACEITAS.join(",");

/** Diz por que o arquivo não serve, ou null se está tudo certo. */
export function erroDoArquivo(f: File): string | null {
  const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
  if (!EXTENSOES_ACEITAS.includes(ext)) {
    return `"${f.name}": formato não aceito. Envie ${EXTENSOES_ACEITAS.join(", ")}.`;
  }
  if (f.size > MAX_ARQUIVO_BYTES) {
    return `"${f.name}": ${(f.size / 1024 / 1024).toFixed(1)} MB — o limite é 10 MB por arquivo.`;
  }
  return null;
}

// ── Status ───────────────────────────────────────────────────────────
// O status é o andamento do pedido, não um campo livre: quem muda é sempre
// uma ação de tela (aprovar, reprovar, concluir), nunca digitação.
/**
 * Os dois status que só o SST define.
 *
 * Constantes, e não texto solto: são frases longas, repetidas em tela, filtro
 * e teste, e uma diferença de um acento entre dois lugares vira um card que
 * some do filtro sem ninguém entender por quê.
 *
 * Sem ponto final, ao contrário de como foram pedidos: isto aqui é VALOR
 * gravado no banco e comparado com `===`, não frase de tela. Ponto final em
 * valor é a pontuação que um dia alguém digita errado.
 */
export const STATUS_SST_RECEBIDA = "Solicitação de agendamento de DEMISSIONAL recebida";
export const STATUS_SST_AGENDADO = "Agendamento concluído";
/**
 * O terceiro do SST (11/09/2026): o colaborador fez ASO há menos de 90 dias
 * e o exame ainda vale — não precisa marcar outro. Conclui a demissão direto
 * dali, sem data/hora/local, e é tão final quanto o agendado.
 */
export const STATUS_SST_ASO_VALIDO = "ASO válido";
/**
 * O encarregado PEDIU o cancelamento (25/09/2026, mig 239) e o RH ainda não
 * decidiu. A solicitação fica congelada aqui — nenhuma etapa age nela — e o
 * status de onde saiu está em `cancel_status_anterior`, pra onde volta se o
 * RH recusar.
 */
export const STATUS_CANCELAMENTO_SOLICITADO = "Cancelamento solicitado";

export type Status =
  | "Pendente Operacional"
  // Diretoria (16/09/2026): demissão do escritório OU com setor nasce aqui e
  // é aprovada por quem tem o setor marcado em Acesso por Usuário.
  | "Pendente Diretoria"
  | "Reprovada"
  | "Pendente RH"
  | "Pendente SST"
  | typeof STATUS_SST_RECEBIDA
  | typeof STATUS_SST_AGENDADO
  | typeof STATUS_SST_ASO_VALIDO
  | "Concluída"
  | typeof STATUS_CANCELAMENTO_SOLICITADO
  | "Cancelada";

/** Na ordem do fluxo, que é a ordem em que fazem sentido em qualquer filtro. */
export const STATUS_TODOS: Status[] = [
  "Pendente Operacional", "Pendente Diretoria", "Pendente RH", "Pendente SST",
  STATUS_SST_RECEBIDA, STATUS_SST_AGENDADO, STATUS_SST_ASO_VALIDO,
  "Concluída", "Reprovada", STATUS_CANCELAMENTO_SOLICITADO, "Cancelada",
];

/**
 * O fim da linha.
 *
 * "Concluída" continua aqui por causa das solicitações fechadas no desenho
 * antigo, em que quem fechava era o RH. Nada novo cai nele — hoje o fluxo
 * termina no SST, com o agendamento feito.
 */
export const STATUS_FINAIS: string[] = [STATUS_SST_AGENDADO, STATUS_SST_ASO_VALIDO, "Concluída"];

/** Cor do selo de status — a mesma régua nas três telas. */
export function corDoStatus(status: string): string {
  const cores: Record<string, string> = {
    "Pendente Operacional": "bg-yellow-100 text-yellow-800 border-yellow-200",
    "Pendente Diretoria": "bg-amber-100 text-amber-800 border-amber-200",
    "Pendente RH": "bg-purple-100 text-purple-700 border-purple-200",
    "Pendente SST": "bg-cyan-100 text-cyan-800 border-cyan-200",
    // Os dois do SST puxam para o mesmo lado do círculo cromático que
    // "Pendente SST" — quem olha a fila vê que são a mesma etapa —, mas o
    // agendado já é verde: é o fim da linha.
    [STATUS_SST_RECEBIDA]: "bg-sky-100 text-sky-800 border-sky-200",
    [STATUS_SST_AGENDADO]: "bg-emerald-100 text-emerald-700 border-emerald-200",
    [STATUS_SST_ASO_VALIDO]: "bg-emerald-100 text-emerald-700 border-emerald-200",
    "Concluída": "bg-green-100 text-green-700 border-green-200",
    "Reprovada": "bg-red-100 text-red-700 border-red-200",
    // Vermelho (17/09/2026): reconsiderada pelo encarregado — tem que saltar aos olhos.
    "Cancelada": "bg-red-100 text-red-700 border-red-300",
    // Pedido de cancelamento esperando o RH (25/09/2026): vermelho cheio —
    // é o que o RH tem que ver primeiro na fila.
    [STATUS_CANCELAMENTO_SOLICITADO]: "bg-red-600 text-white border-red-700",
  };
  return cores[status] ?? "bg-blue-100 text-blue-700 border-blue-200";
}

/** O que ainda falta acontecer, em uma frase, para quem só acompanha. */
export function explicaStatus(status: string): string {
  const textos: Record<string, string> = {
    "Pendente Operacional": "Aguardando a aprovação do Operacional.",
    "Pendente Diretoria": "Aguardando a aprovação da Diretoria (administrativo / setor).",
    "Pendente RH": "Aprovada. Aguardando o RH liberar.",
    "Pendente SST": "Liberada pelo RH. Aguardando o SST receber a solicitação.",
    [STATUS_SST_RECEBIDA]: "O SST recebeu a solicitação e está agendando o ASO demissional.",
    [STATUS_SST_AGENDADO]: "ASO demissional agendado — a data, a hora e o local estão na solicitação.",
    [STATUS_SST_ASO_VALIDO]: "O ASO do colaborador ainda está válido (menos de 90 dias) — não precisa de exame demissional. Concluída pelo SST.",
    "Concluída": "O RH confirmou. Desligamento concluído.",
    "Reprovada": "Reprovada na aprovação — veja o motivo.",
    "Cancelada": "A solicitação foi cancelada.",
    [STATUS_CANCELAMENTO_SOLICITADO]: "O solicitante pediu o cancelamento. Aguardando o RH aprovar ou recusar.",
  };
  return textos[status] ?? "";
}

/**
 * Administrativa = escritório OU com setor (16/09/2026). Nasce em "Pendente
 * Diretoria" e só aparece pra quem tem o setor marcado em Acesso por Usuário.
 * Mesma regra da Mudança de Função (lib/trocaFuncao/solicitacao.ts).
 */
export const ehAdministrativaDemissao = (s: { e_escritorio?: boolean | null; setor?: string | null; colaborador_posto?: string | null }): boolean =>
  !!s.e_escritorio || !!String(s.setor ?? "").trim()
  // Pedidos antigos (antes do checkbox) e cadastro que já diz "ADMINISTRATIVO"
  // / "ESCRITÓRIO" no posto: é do escritório mesmo sem ninguém ter marcado.
  || localEhEscritorio(s.colaborador_posto);

export const statusInicialDemissao = (eEscritorio: boolean, setor?: string | null): Status =>
  ehAdministrativaDemissao({ e_escritorio: eEscritorio, setor }) ? "Pendente Diretoria" : "Pendente Operacional";

/** Pra onde a devolução leva: a etapa 1 de cada tipo. */
export const statusDaEtapa1 = (s: { e_escritorio?: boolean | null; setor?: string | null; colaborador_posto?: string | null }): Status =>
  ehAdministrativaDemissao(s) ? "Pendente Diretoria" : "Pendente Operacional";

/** Sem acento, caixa alta — a régua do banco (cs_reembolso_norm_setor). */
export const normSetorDemissao = (s: string | null | undefined): string =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();

/**
 * A linha entra na tela desta etapa? (16/09/2026)
 *   • Diretoria: só administrativa (escritório ou com setor). Os setores
 *     marcados em Acesso por Usuário são FILTRO: sem nenhum, vê todas; com
 *     algum, só as daqueles setores.
 *   • Operacional: só contrato sem setor.
 *   • Analista (Licitações): só contrato simples, acompanhamento.
 *   • SST e RH: tudo.
 */
export function visivelNaEtapaDemissao(
  s: { e_escritorio?: boolean | null; setor?: string | null; colaborador_posto?: string | null },
  etapa: "analista" | "operacional" | "diretoria" | "rh" | "sst",
  setores: ReadonlySet<string> | null = null,
): boolean {
  if (etapa === "sst" || etapa === "rh") return true;
  const adm = ehAdministrativaDemissao(s);
  if (etapa !== "diretoria") return !adm;
  if (!adm) return false;
  const setor = normSetorDemissao(s.setor);
  return !setor || !setores || setores.size === 0 || setores.has(setor);
}

// ── A solicitação ────────────────────────────────────────────────────
export interface SolicitacaoDemissao {
  id: number;
  solicitante_nome: string | null;
  solicitante_email: string | null;
  data_solicitacao: string | null;

  colaborador_id: number | null;
  colaborador_nome: string | null;
  colaborador_cpf: string | null;
  colaborador_posto: string | null;
  colaborador_cargo: string | null;
  colaborador_filial: string | null;
  colaborador_admissao: string | null;
  colaborador_telefone: string | null;
  colaborador_email: string | null;
  contrato: string | null;
  contrato_id: number | null;
  escala: string | null;
  /** Escritório administrativo / setor (16/09/2026) — decide se vai pra Diretoria. */
  e_escritorio?: boolean | null;
  setor?: string | null;

  motivo_solicitacao: string | null;
  motivo_pedido: string | null;
  relato: string | null;

  termino_experiencia: string | null;
  data_aviso: string | null;
  modelo_aviso: string | null;

  status: string;
  /**
   * A decisão da ETAPA 1 — do Operacional. Entre 02/09 e 14/09/2026 quem
   * decidia era o analista e as colunas guardaram a decisão dele com este
   * mesmo nome (renomear três colunas com histórico gravado só para acertar
   * o rótulo não valia a migração). Desde 14/09/2026 o nome voltou a bater
   * com o dono.
   */
  operacional_por: string | null;
  operacional_em: string | null;
  operacional_motivo: string | null;
  rh_por: string | null;
  rh_em: string | null;
  rh_observacao: string | null;
  /** Última data trabalhada, informada pelo RH ao liberar pro SST (17/09/2026, mig 181). */
  rh_ultima_data_trabalhada?: string | null;
  /** Reconsiderada pelo encarregado (17/09/2026, mig 182 — RPC demissao_cancelar). */
  cancelado_por?: string | null;
  cancelado_em?: string | null;
  cancelado_motivo?: string | null;
  /**
   * PEDIDO de cancelamento do encarregado, que o RH aprova ou recusa
   * (25/09/2026, mig 239). `cancel_status_anterior` é pra onde a solicitação
   * volta se o RH recusar; a recusa fica gravada em `cancel_recusa_*`.
   */
  cancel_pedido_por?: string | null;
  cancel_pedido_em?: string | null;
  cancel_pedido_motivo?: string | null;
  cancel_status_anterior?: string | null;
  cancel_recusa_por?: string | null;
  cancel_recusa_em?: string | null;
  cancel_recusa_motivo?: string | null;

  // ASO demissional. Os nomes são os MESMOS do ASO de admissão
  // (WA_CURRICULOS.sst_*) de propósito: quem trabalha no SST preenche a mesma
  // ficha nas duas pontas, e um dia dá para juntar as telas sem renomear
  // coluna nenhuma.
  sst_data_exame: string | null;
  sst_hora_exame: string | null;
  sst_local_exame: string | null;
  sst_maps_url: string | null;
  sst_observacao: string | null;
  sst_por: string | null;
  sst_em: string | null;

  /**
   * A DEVOLUÇÃO à etapa 1 (02/09/2026).
   *
   * O erro na solicitação costuma aparecer no fim — o RH é a última etapa e é
   * lá que se percebe que o aviso está errado, que falta documento, que a
   * data não bate. Antes disso as únicas saídas eram concluir um desligamento
   * errado ou abandonar o card.
   *
   * Devolver leva de volta para `Pendente Operacional` — a primeira porta,
   * que desde 14/09/2026 é de novo o Operacional (era o analista entre 02/09
   * e 14/09; ver o cabeçalho da migration 20260930000045).
   *
   * Colunas próprias, e não `operacional_motivo`: aquela é da etapa 1, e
   * escrever a devolução do RH lá faria o histórico mentir sobre quem recusou.
   */
  devolvido_por: string | null;
  devolvido_em: string | null;
  devolvido_motivo: string | null;
  /** De qual etapa a devolução partiu: 'sst' ou 'rh'. */
  devolvido_de: string | null;

  criado_em: string | null;
  atualizado_em: string | null;

  /**
   * DEMISSÃO ↔ VAGA (11/09/2026). Toda demissão nova abre uma vaga de
   * Substituição de quem sai — a vaga aponta para cá (demissao_id) e o
   * banco devolve o id dela aqui. Sem a vaga, o pedido não sai de
   * "Pendente Operacional" (trigger demissao_exige_vaga); `vaga_obrigatoria`
   * é false só nas solicitações anteriores à regra.
   */
  vaga_id?: number | null;
  vaga_obrigatoria?: boolean | null;
  /**
   * EXCEÇÃO (17/09/2026, mig 000169): a etapa 1 aprovou SEM a vaga de
   * Substituição e escreveu por quê. Preenchido, o trigger deixa o pedido
   * seguir mesmo com `vaga_obrigatoria`; a tela pede o motivo em QUALQUER
   * aprovação sem vaga, para a exceção ficar registrada no card.
   */
  sem_vaga_motivo?: string | null;
}

/**
 * A demissão que ainda não tem a vaga de reposição que a regra exige. Com o
 * motivo da exceção gravado a vaga deixou de ser exigida — não é mais
 * "falta", é decisão.
 */
export const faltaVagaDeReposicao = (s: Pick<SolicitacaoDemissao, "vaga_id" | "vaga_obrigatoria" | "status" | "sem_vaga_motivo">): boolean =>
  !!s.vaga_obrigatoria && !s.vaga_id && s.status !== "Reprovada" && !temMotivoSemVaga(s.sem_vaga_motivo);

/** Mínimo do motivo da exceção — a mesma régua do motivo da reprovação e do trigger. */
export const MOTIVO_SEM_VAGA_MIN = 10;
export const temMotivoSemVaga = (motivo?: string | null): boolean =>
  String(motivo ?? "").trim().length >= MOTIVO_SEM_VAGA_MIN;

/**
 * Aprovar na etapa 1 sem vaga de Substituição pede o motivo da exceção —
 * vale para o pedido que respondeu "Sim" (preso pelo banco) e para o que
 * respondeu "Não" (o banco deixa passar, mas a tela registra por quê).
 */
export const aprovarPedeMotivoSemVaga = (s: Pick<SolicitacaoDemissao, "vaga_id">): boolean => !s.vaga_id;

export interface AnexoDemissao {
  id: number;
  solicitacao_id: number;
  nome: string;
  storage_path: string;
  tamanho: number | null;
  tipo: string | null;
  criado_em: string | null;
}

// ── Formatação ───────────────────────────────────────────────────────
export function fmtData(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso);
  return isNaN(+d) ? "—" : d.toLocaleDateString("pt-BR");
}

export function fmtDataHora(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function fmtTamanho(bytes?: number | null): string {
  if (!bytes) return "";
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const hojeISO = () => new Date().toISOString().slice(0, 10);

// ── Última data trabalhada (RH → SST) ────────────────────────────────
/**
 * A última data trabalhada pode ser FUTURA (18/09/2026): o RH libera pro
 * SST enquanto o colaborador ainda cumpre o aviso, então o limite é 60 dias
 * pra frente — não "hoje". Pra trás não há limite (acerto atrasado acontece).
 */
export const ULTIMA_DATA_DIAS_A_FRENTE = 60;
export function limiteUltimaDataTrabalhada(hoje = hojeISO()): string {
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ULTIMA_DATA_DIAS_A_FRENTE);
  return d.toISOString().slice(0, 10);
}
/** Mensagem de erro, ou null quando a data serve. */
export function erroUltimaDataTrabalhada(data: string, hoje = hojeISO()): string | null {
  if (!data) return "Informe a última data trabalhada do colaborador antes de liberar.";
  if (data > limiteUltimaDataTrabalhada(hoje)) return `A última data trabalhada pode ser no máximo ${ULTIMA_DATA_DIAS_A_FRENTE} dias à frente (até ${fmtData(limiteUltimaDataTrabalhada(hoje))}).`;
  return null;
}

// ── Devolução ────────────────────────────────────────────────────────

/** As etapas que podem mandar a solicitação de volta para o Operacional. */
export const ETAPAS_QUE_DEVOLVEM = ["sst", "rh"] as const;
export type EtapaQueDevolve = (typeof ETAPAS_QUE_DEVOLVEM)[number];

/** Mínimo do motivo — o mesmo das outras recusas do ERP. */
export const MOTIVO_DEVOLUCAO_MIN = 10;

/**
 * Esta etapa pode devolver ESTA solicitação agora?
 *
 * Só quem tem trabalho a fazer nela: devolver é recusar o próprio turno, e
 * não faz sentido recusar um turno que ainda não chegou (ou que já passou).
 */
/**
 * O que o SST pode fazer NESTE status — e nada além disso.
 *
 * Os dois passos são sequenciais: recebe, depois agenda. A primeira versão
 * deixava agendar direto de "Pendente SST", para poupar um clique de quem já
 * tinha a data — só que um status que dá para pular deixa de significar algo,
 * e "recebida" existe justamente para o encarregado saber que o SST viu o
 * pedido. A regra mora aqui, e não no JSX, porque foi no JSX que ela se
 * perdeu da primeira vez.
 */
export function acaoDoSST(status: string): "receber" | "agendar" | null {
  if (status === "Pendente SST") return "receber";
  if (status === STATUS_SST_RECEBIDA) return "agendar";
  return null;
}

export function podeDevolver(etapa: string, status: string): etapa is EtapaQueDevolve {
  // O SST devolve enquanto não agendou — inclusive depois de dar "recebida",
  // que é justamente quando ele lê a solicitação com atenção e acha o erro.
  // Depois de agendado não devolve mais: já existe exame marcado com o
  // colaborador, e desmarcar não é assunto de um botão de devolver.
  if (etapa === "sst") return status === "Pendente SST" || status === STATUS_SST_RECEBIDA;
  if (etapa === "rh") return status === "Pendente RH";
  return false;
}

/**
 * O que fica gravado quando alguém devolve.
 *
 * O status volta para o começo da linha de decisão — `Pendente Operacional`
 * — e os carimbos das etapas seguintes são LIMPOS: se o SST tinha marcado o
 * ASO e a solicitação voltou, aquele exame não vale mais como etapa cumprida.
 * Sem isso a solicitação voltaria ao Operacional já "meio aprovada", e ao
 * seguir de novo pularia o SST.
 */
export function patchDevolucao(
  etapa: EtapaQueDevolve,
  quem: string,
  motivo: string,
  // Administrativa volta pra Diretoria, não pro Operacional (16/09/2026).
  voltaPara: Status = "Pendente Operacional",
): Record<string, unknown> {
  return {
    status: voltaPara,
    devolvido_por: quem,
    devolvido_em: new Date().toISOString(),
    devolvido_motivo: motivo.trim(),
    devolvido_de: etapa,
    // A decisão do Operacional também sai: ele vai decidir de novo, e manter a
    // anterior faria a tela mostrar "aprovado por" numa solicitação pendente.
    operacional_por: null, operacional_em: null, operacional_motivo: null,
    // O que a etapa que devolveu (e as seguintes) tinham carimbado.
    sst_data_exame: null, sst_hora_exame: null, sst_local_exame: null,
    sst_maps_url: null, sst_observacao: null, sst_por: null, sst_em: null,
    rh_por: null, rh_em: null, rh_observacao: null, rh_ultima_data_trabalhada: null,
  };
}

/** "Devolvida pelo RH em 02/09/2026" — a devolução em uma linha. */
export function resumoDevolucao(s: {
  devolvido_de?: string | null; devolvido_por?: string | null; devolvido_em?: string | null;
}): string | null {
  if (!s.devolvido_em) return null;
  const de = s.devolvido_de === "sst" ? "pelo SST" : s.devolvido_de === "rh" ? "pelo RH" : "";
  const por = s.devolvido_por ? ` (${s.devolvido_por})` : "";
  return `Devolvida ${de}${por} em ${fmtDataHora(s.devolvido_em)}`.replace("  ", " ");
}

/**
 * Link para abrir o local do ASO no Google Maps — a mesma regra do ASO de
 * admissão: vale o link exato que o SST colou; sem ele, cai na busca pelo
 * texto do local. Null quando não há nem um nem outro.
 */
export function linkDoLocalASO(s: {
  sst_maps_url?: string | null; sst_local_exame?: string | null;
}): string | null {
  const url = String(s.sst_maps_url ?? "").trim();
  if (url) return url;
  const local = String(s.sst_local_exame ?? "").trim();
  return local ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(local)}` : null;
}

/** "12/03/2026 às 09:00 · Clínica X" — o ASO em uma linha. */
export function resumoDoASO(s: {
  sst_data_exame?: string | null; sst_hora_exame?: string | null; sst_local_exame?: string | null;
}): string {
  if (!s.sst_data_exame) return "—";
  const hora = s.sst_hora_exame ? ` às ${s.sst_hora_exame}` : "";
  const local = s.sst_local_exame ? ` · ${s.sst_local_exame}` : "";
  return `${fmtData(s.sst_data_exame)}${hora}${local}`;
}

/** (00) 00000-0000 enquanto digita — o banco guarda o que aparece na tela. */
export function mascaraTelefone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.replace(/^(\d{0,2})/, "($1");
  if (d.length <= 6) return d.replace(/^(\d{2})(\d{0,4})/, "($1) $2");
  if (d.length <= 10) return d.replace(/^(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3");
  return d.replace(/^(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3");
}

export const telefoneCompleto = (v: string) => v.replace(/\D/g, "").length >= 10;
export const emailValido = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

// ── Cancelar (reconsiderar) pelo encarregado ─────────────────────────
/**
 * O encarregado PEDE o cancelamento e o RH aprova (25/09/2026, mig 239).
 * Até então o botão cancelava na hora, e só até o ASO ser agendado. Como
 * quem decide agora é o RH — que já cancelava com o ASO agendado ou válido
 * —, o pedido vale em qualquer etapa em aberto (a RPC demissao_cancelar
 * repete a regra). `motivo` é o que a tela mostra ao clicar quando não pode.
 */
export const MOTIVO_CANCELAMENTO_MIN = 10;
export function podeCancelarDemissao(s: Pick<SolicitacaoDemissao, "status">): { ok: boolean; motivo?: string } {
  if (s.status === STATUS_CANCELAMENTO_SOLICITADO) return { ok: false, motivo: "O cancelamento já foi pedido e está com o RH para aprovar." };
  if (s.status === "Cancelada") return { ok: false, motivo: "Esta solicitação já foi cancelada." };
  if (s.status === "Reprovada") return { ok: false, motivo: "Esta solicitação foi reprovada — não há o que cancelar." };
  if (s.status === "Concluída") return { ok: false, motivo: "Esta demissão já foi concluída." };
  return { ok: true };
}

/** O encarregado pediu o cancelamento e o RH tem que decidir (25/09/2026)? */
export const temPedidoDeCancelamento = (s: Pick<SolicitacaoDemissao, "status">): boolean =>
  s.status === STATUS_CANCELAMENTO_SOLICITADO;

// ── Cancelar (reconsideração) pelo RH ────────────────────────────────
/**
 * Onde o RH cancela: na etapa dele (Pendente RH, 18/09/2026) E nas do SST
 * (21/09/2026) — Pendente SST, recebida e até com o ASO já agendado. A
 * reconsideração costuma chegar depois que o RH liberou; cancelando no SST,
 * a RPC avisa quem cuida do ASO Demissional para desmarcar o exame (mig 198).
 * "ASO válido" (o verde) também cancela desde a mig 200 — a reconsideração
 * pode chegar depois do SST concluir; aí não há exame a desmarcar e o SST
 * não é avisado (cancelarAvisaSST continua só com os três de cima).
 * Antes do RH é do Operacional/Diretoria. A RPC demissao_cancelar repete a
 * regra com has_screen_access('rh_demissoes','aprovar').
 */
export const STATUS_RH_CANCELA_NO_SST: string[] = ["Pendente SST", STATUS_SST_RECEBIDA, STATUS_SST_AGENDADO];
/** O cancelamento do RH, nesse status, vai gerar aviso pro SST desmarcar o ASO? */
export const cancelarAvisaSST = (status: string) => STATUS_RH_CANCELA_NO_SST.includes(status);
export function podeCancelarDemissaoRH(s: Pick<SolicitacaoDemissao, "status">): { ok: boolean; motivo?: string } {
  if (s.status === "Pendente RH" || cancelarAvisaSST(s.status) || s.status === STATUS_SST_ASO_VALIDO) return { ok: true };
  const geral = podeCancelarDemissao(s);
  if (!geral.ok) return geral;
  return { ok: false, motivo: `O RH cancela a partir do Pendente RH (agora está ${s.status}).` };
}

/** Caminho no bucket demissoes-docs de um arquivo anexado ao cancelar. */
export const caminhoAnexoCancelamento = (id: number, nome: string, agora = Date.now()): string =>
  `${id}/${agora}-cancelamento-${nome.replace(/[^\w.-]+/g, "_")}`;
