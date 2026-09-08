// Solicitação de Demissão — as regras que as telas compartilham.
//
// O encarregado abre → o ANALISTA aprova → o RH libera → o SST agenda o ASO
// demissional:
//
//   Pendente Analista → Pendente RH → Pendente SST
//        → Solicitação de agendamento de DEMISSIONAL recebida
//        → Agendamento concluído
//          ↘ Reprovada
//
// DUAS MUDANÇAS EM 02/09/2026, no mesmo movimento que criou o submódulo
// "Analistas Validações" em Licitações:
//
//   1. Quem decide a etapa 1 passou a ser o ANALISTA, não o Operacional.
//      "Pendente Operacional" virou "Pendente Analista". O Operacional
//      continua com a tela, só que para ACOMPANHAR — abre o card e lê, sem
//      botão de decidir. Mesmo desenho da Gestão Recrutamento.
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

export type Status =
  | "Pendente Analista"
  | "Reprovada"
  | "Pendente RH"
  | "Pendente SST"
  | typeof STATUS_SST_RECEBIDA
  | typeof STATUS_SST_AGENDADO
  | "Concluída"
  | "Cancelada";

/** Na ordem do fluxo, que é a ordem em que fazem sentido em qualquer filtro. */
export const STATUS_TODOS: Status[] = [
  "Pendente Analista", "Pendente RH", "Pendente SST",
  STATUS_SST_RECEBIDA, STATUS_SST_AGENDADO,
  "Concluída", "Reprovada", "Cancelada",
];

/**
 * O fim da linha.
 *
 * "Concluída" continua aqui por causa das solicitações fechadas no desenho
 * antigo, em que quem fechava era o RH. Nada novo cai nele — hoje o fluxo
 * termina no SST, com o agendamento feito.
 */
export const STATUS_FINAIS: string[] = [STATUS_SST_AGENDADO, "Concluída"];

/** Cor do selo de status — a mesma régua nas três telas. */
export function corDoStatus(status: string): string {
  const cores: Record<string, string> = {
    "Pendente Analista": "bg-yellow-100 text-yellow-800 border-yellow-200",
    "Pendente RH": "bg-purple-100 text-purple-700 border-purple-200",
    "Pendente SST": "bg-cyan-100 text-cyan-800 border-cyan-200",
    // Os dois do SST puxam para o mesmo lado do círculo cromático que
    // "Pendente SST" — quem olha a fila vê que são a mesma etapa —, mas o
    // agendado já é verde: é o fim da linha.
    [STATUS_SST_RECEBIDA]: "bg-sky-100 text-sky-800 border-sky-200",
    [STATUS_SST_AGENDADO]: "bg-emerald-100 text-emerald-700 border-emerald-200",
    "Concluída": "bg-green-100 text-green-700 border-green-200",
    "Reprovada": "bg-red-100 text-red-700 border-red-200",
    "Cancelada": "bg-slate-100 text-slate-600 border-slate-200",
  };
  return cores[status] ?? "bg-blue-100 text-blue-700 border-blue-200";
}

/** O que ainda falta acontecer, em uma frase, para quem só acompanha. */
export function explicaStatus(status: string): string {
  const textos: Record<string, string> = {
    "Pendente Analista": "Aguardando a aprovação do analista.",
    "Pendente RH": "Aprovada pelo analista. Aguardando o RH liberar.",
    "Pendente SST": "Liberada pelo RH. Aguardando o SST receber a solicitação.",
    [STATUS_SST_RECEBIDA]: "O SST recebeu a solicitação e está agendando o ASO demissional.",
    [STATUS_SST_AGENDADO]: "ASO demissional agendado — a data, a hora e o local estão na solicitação.",
    "Concluída": "O RH confirmou. Desligamento concluído.",
    "Reprovada": "O analista reprovou — veja o motivo.",
    "Cancelada": "A solicitação foi cancelada.",
  };
  return textos[status] ?? "";
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

  motivo_solicitacao: string | null;
  motivo_pedido: string | null;
  relato: string | null;

  termino_experiencia: string | null;
  data_aviso: string | null;
  modelo_aviso: string | null;

  status: string;
  /**
   * A decisão da ETAPA 1. As colunas mantêm o nome `operacional_*` de
   * propósito: desde 02/09/2026 quem decide ali é o analista, mas renomear
   * três colunas com histórico gravado só para acertar o rótulo trocaria uma
   * confusão de nome por uma migração de dados — e o painel já mostra
   * "Analista" na tela, que é onde alguém lê.
   */
  operacional_por: string | null;
  operacional_em: string | null;
  operacional_motivo: string | null;
  rh_por: string | null;
  rh_em: string | null;
  rh_observacao: string | null;

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
   * A DEVOLUÇÃO ao analista (02/09/2026).
   *
   * O erro na solicitação costuma aparecer no fim — o RH é a última etapa e é
   * lá que se percebe que o aviso está errado, que falta documento, que a
   * data não bate. Antes disso as únicas saídas eram concluir um desligamento
   * errado ou abandonar o card.
   *
   * Devolver leva de volta para `Pendente Analista`, e não para o
   * Operacional: o Operacional acompanha a demissão mas não decide nada nela,
   * então um card devolvido para lá ficaria encalhado onde ninguém pode
   * mexer. Ver o cabeçalho da migration 20260930000045.
   *
   * Colunas próprias, e não `operacional_motivo`: aquela é do analista, e
   * escrever a devolução do RH lá faria o histórico mentir sobre quem recusou.
   */
  devolvido_por: string | null;
  devolvido_em: string | null;
  devolvido_motivo: string | null;
  /** De qual etapa a devolução partiu: 'sst' ou 'rh'. */
  devolvido_de: string | null;

  criado_em: string | null;
  atualizado_em: string | null;
}

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

// ── Devolução ────────────────────────────────────────────────────────

/** As etapas que podem mandar a solicitação de volta para o analista. */
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
 * O status volta para o começo da linha de decisão — `Pendente Analista` — e
 * os carimbos das etapas seguintes são LIMPOS: se o SST tinha marcado o ASO e
 * a solicitação voltou, aquele exame não vale mais como etapa cumprida. Sem
 * isso a solicitação voltaria ao analista já "meio aprovada", e ao seguir de
 * novo pularia o SST.
 */
export function patchDevolucao(
  etapa: EtapaQueDevolve,
  quem: string,
  motivo: string,
): Record<string, unknown> {
  return {
    status: "Pendente Analista" as Status,
    devolvido_por: quem,
    devolvido_em: new Date().toISOString(),
    devolvido_motivo: motivo.trim(),
    devolvido_de: etapa,
    // A decisão do analista também sai: ele vai decidir de novo, e manter a
    // anterior faria a tela mostrar "aprovado por" numa solicitação pendente.
    operacional_por: null, operacional_em: null, operacional_motivo: null,
    // O que a etapa que devolveu (e as seguintes) tinham carimbado.
    sst_data_exame: null, sst_hora_exame: null, sst_local_exame: null,
    sst_maps_url: null, sst_observacao: null, sst_por: null, sst_em: null,
    rh_por: null, rh_em: null, rh_observacao: null,
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
