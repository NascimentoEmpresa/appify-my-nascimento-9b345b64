import type { NovaReuniao } from "./useReunioes";
import { TIPO_REUNIAO_DURACAO_PADRAO, type Reuniao, type ReuniaoConvidado, type TipoLocalReuniao } from "./types";

/**
 * SIS-2026-0373: transferir um item de pauta pra outra reunião ("próxima
 * reunião já marcada" ou "criar uma extraordinária"). A transferência em si
 * é a RPC transferir_pauta_reuniao (cria o item no destino e deixa o rastro
 * na origem); aqui ficam só as regras puras, testáveis sem Supabase.
 */

const ERROS_TRANSFERENCIA: Record<string, string> = {
  pauta_ja_transferida: "Esta pauta já foi transferida para outra reunião.",
  pauta_nao_encontrada: "Esta pauta não existe mais.",
  sem_permissao_reuniao_origem: "Só quem organiza esta reunião (criador, organizador ou responsável pela ata) pode transferir a pauta.",
  sem_permissao_reuniao_destino: "Você só pode transferir para reuniões que você organiza.",
  reuniao_destino_nao_encontrada: "A reunião de destino não foi encontrada.",
  reuniao_destino_nao_agendada: "A reunião de destino precisa estar agendada (ainda não iniciada).",
  mesma_reuniao: "Escolha uma reunião diferente da atual.",
};

/** Traduz o código levantado pela RPC (vem dentro da mensagem do PostgREST) — erro desconhecido passa como veio. */
export function mensagemErroTransferencia(mensagem: string): string {
  const codigo = Object.keys(ERROS_TRANSFERENCIA).find((c) => mensagem.includes(c));
  return codigo ? ERROS_TRANSFERENCIA[codigo] : mensagem;
}

export function tituloReuniaoExtraordinaria(tituloPauta: string): string {
  return `Reunião extraordinária — ${tituloPauta.trim()}`;
}

export const JUSTIFICATIVA_DURACAO_EXTRAORDINARIA = "Reunião extraordinária criada a partir da transferência de uma pauta.";

/**
 * Monta a reunião extraordinária herdando da reunião de origem tudo que não
 * é data/hora/local (decisão do desenvolvedor: "diálogo rápido"). A pauta vai
 * vazia — o item entra depois, pela RPC de transferência, pra ganhar o rastro.
 */
export function montarReuniaoExtraordinaria(p: {
  origem: Pick<Reuniao, "numero" | "organizador_user_id" | "responsavel_preenchimento_user_id" | "tipo_reuniao" | "finalidade" | "resultado_esperado" | "notificar_por" | "setor_responsavel">;
  convidadosOrigem: Pick<ReuniaoConvidado, "user_id" | "papel">[];
  tituloPauta: string;
  titulo: string;
  dataHoraIso: string;
  duracaoMinutos: number;
  tipoLocal: TipoLocalReuniao;
  localOuLink: string;
  linkOnline: string | null;
}): NovaReuniao {
  const duracaoPadrao = p.origem.tipo_reuniao ? TIPO_REUNIAO_DURACAO_PADRAO[p.origem.tipo_reuniao] : null;
  const convidados = [...new Set(p.convidadosOrigem.filter((c) => c.papel === "convidado").map((c) => c.user_id))];
  const observadores = [...new Set(p.convidadosOrigem.filter((c) => c.papel === "observador").map((c) => c.user_id))]
    .filter((id) => !convidados.includes(id));

  return {
    titulo: p.titulo.trim() || tituloReuniaoExtraordinaria(p.tituloPauta),
    objetivo: `Tratar a pauta "${p.tituloPauta.trim()}", transferida da reunião ${p.origem.numero}.`,
    data_hora: p.dataHoraIso,
    duracao_minutos: p.duracaoMinutos,
    justificativa_alteracao_duracao:
      duracaoPadrao !== null && duracaoPadrao !== p.duracaoMinutos ? JUSTIFICATIVA_DURACAO_EXTRAORDINARIA : null,
    tipo_local: p.tipoLocal,
    local_ou_link: p.localOuLink,
    link_online: p.tipoLocal === "hibrido" ? p.linkOnline : null,
    organizador_user_id: p.origem.organizador_user_id,
    responsavel_preenchimento_user_id: p.origem.responsavel_preenchimento_user_id,
    tipo_reuniao: p.origem.tipo_reuniao,
    finalidade: p.origem.finalidade ?? [],
    resultado_esperado: p.origem.resultado_esperado ?? [],
    notificar_por: p.origem.notificar_por?.length ? p.origem.notificar_por : ["erp"],
    setor_responsavel: p.origem.setor_responsavel,
    pauta: [],
    convidados,
    observadores,
  };
}

/**
 * Quem trava a criação por conflito de horário/bloqueio de agenda — mesma
 * regra do ReuniaoFormCriar: organizador, responsável e convidados;
 * observador fica de fora (é opcional/informativo, igual no banco).
 */
export function pessoasObrigatoriasReuniao(
  nova: Pick<NovaReuniao, "organizador_user_id" | "responsavel_preenchimento_user_id" | "convidados">,
): string[] {
  return [...new Set([nova.organizador_user_id, nova.responsavel_preenchimento_user_id, ...nova.convidados].filter(Boolean))];
}
