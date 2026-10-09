// =====================================================================
// CHAMADOS DE SISTEMAS — Validação da Presidência + Treinamento (mig 266)
//
// Chamado marcado "Enviar à Presidência" na coordenação ganha uma linha em
// "CHAMADO_SISTEMA_VALIDACAO". Depois que o dev conclui, a Presidência
// valida o desenvolvimento e, aprovado, dev e solicitante confirmam o
// treinamento. O status do chamado em si (CHAMADO_SISTEMA.status) não muda:
// a validação é uma camada por cima do 'concluido'.
//
// Aqui fica a lógica pura (sem React) — etapas, quem confirma o quê e a
// linha do tempo do botão "Status" — para as telas e os testes concordarem.
// =====================================================================
import type { Chamado } from "./types";

/** Espelho do CHECK de etapa na tabela (mig 20260930000266). */
export const ETAPAS_VALIDACAO = {
  desenvolvimento:       { label: "Aguardando conclusão do dev",   cls: "border-info/30 bg-info/10 text-info" },
  validacao_presidencia: { label: "Validação da Presidência",      cls: "border-warning/30 bg-warning/10 text-warning" },
  treinamento:           { label: "Treinamento pendente",          cls: "border-primary/30 bg-primary/10 text-primary" },
  finalizado:            { label: "Finalizado",                    cls: "border-success/30 bg-success/10 text-success" },
} as const;

export type EtapaValidacao = keyof typeof ETAPAS_VALIDACAO;

export interface ValidacaoChamado {
  chamado_id: string;
  etapa: EtapaValidacao;
  enviado_por: string | null;
  enviado_em: string;
  observacao_envio: string | null;
  desenvolvedor_id: string | null;
  desenvolvimento_concluido_em: string | null;
  devolucoes: number;
  presidencia_por: string | null;
  presidencia_em: string | null;
  presidencia_aprovado: boolean | null;
  presidencia_parecer: string | null;
  treinamento_dev_por: string | null;
  treinamento_dev_em: string | null;
  treinamento_dev_obs: string | null;
  treinamento_solic_por: string | null;
  treinamento_solic_em: string | null;
  treinamento_solic_obs: string | null;
  finalizado_em: string | null;
  created_at: string;
  updated_at: string;
}

/** Quem é o "desenvolvedor" que confirma o treinamento: quem concluiu; sem registro, o responsável. */
export const desenvolvedorDaValidacao = (
  v: Pick<ValidacaoChamado, "desenvolvedor_id">,
  c: Pick<Chamado, "responsavel_id">,
) => v.desenvolvedor_id ?? c.responsavel_id ?? null;

/**
 * O usuário pode ENVIAR o treinamento deste chamado? ESPELHA a RPC
 * chamado_treinamento_enviar (mig 269): etapa 'treinamento', ainda não
 * enviado, e quem envia é o dev que concluiu — ou a gestão de chamados
 * (`gestao`, o "gerente do dev", pelo Painel de Distribuição) por ele.
 */
export function podeEnviarTreinamento(
  v: ValidacaoChamado | null | undefined,
  c: Pick<Chamado, "responsavel_id">,
  userId: string | null | undefined,
  opts: { gestao?: boolean } = {},
): boolean {
  if (!v || !userId || v.etapa !== "treinamento" || v.treinamento_dev_em) return false;
  return desenvolvedorDaValidacao(v, c) === userId || !!opts.gestao;
}

/** Participante do treinamento (CHAMADO_TREINAMENTO_DESTINATARIO, mig 269). */
export interface DestinatarioTreinamento {
  chamado_id: string; user_id: string; origem: "usuario" | "setor"; setor: string | null;
  confirmado_em: string | null; confirmado_obs: string | null; created_at: string;
}

/** Resumo do andamento: quantos participantes e quantos já confirmaram. */
export const resumoParticipantes = (ds: Pick<DestinatarioTreinamento, "confirmado_em">[] | null | undefined) =>
  ({ total: ds?.length ?? 0, confirmados: (ds ?? []).filter((d) => !!d.confirmado_em).length });

/**
 * A avaliação do atendimento já pode ser feita? ESPELHA o trigger
 * chamado_avaliacao_exige_presidencia (mig 269): no fluxo da Presidência,
 * o solicitante avalia depois que ela aprova. O treinamento não trava mais a
 * avaliação — ele é confirmado pelos participantes, em Treinamentos Sistemas.
 */
// Retorno "achatado" (motivo null quando liberada) de propósito: o projeto
// compila sem strictNullChecks, e aí a união discriminada por `liberada` não
// estreita — `motivo` não existia no tipo e o job "tipos" da PR #732 caiu.
export function avaliacaoLiberada(
  v: Pick<ValidacaoChamado, "etapa"> | null | undefined,
): { liberada: boolean; motivo: "presidencia" | null } {
  if (v && (v.etapa === "desenvolvimento" || v.etapa === "validacao_presidencia")) return { liberada: false, motivo: "presidencia" };
  return { liberada: true, motivo: null };
}

/** Linha de chamados_meus_avaliacoes_pendentes (mig 269): o que trava abrir outro chamado. */
export interface PendenciaSolicitante {
  id: string; numero: string; assunto: string; concluido_em: string | null;
  /** avaliacao_participante: participante extra (mig 20261009000003) — mesma trava. */
  pendencia: "avaliacao" | "avaliacao_participante";
}

// ---- Linha do tempo do botão "Status" ---------------------------------

export type SituacaoPasso = "feito" | "atual" | "pendente" | "interrompido";

export interface PassoStatus {
  key: string;
  titulo: string;
  situacao: SituacaoPasso;
  quando?: string | null;
  detalhe?: string | null;
  /** Sub-itens (ex.: as duas confirmações do treinamento). */
  itens?: Array<{ titulo: string; feito: boolean; quando?: string | null; detalhe?: string | null }>;
}

type ChamadoStatus = Pick<Chamado,
  "status" | "created_at" | "responsavel_id" | "concluido_em" | "motivo_reprovacao" | "motivo_cancelamento" | "cancelado_em" | "updated_at">;

/**
 * Monta os passos da solicitação, do jeito que o solicitante entende:
 * Aberta → Em desenvolvimento → Concluída pelo dev → [Presidência →
 * Treinamento → Finalizada]. Os três últimos só existem quando o chamado foi
 * enviado à Presidência.
 */
export function montarLinhaDoTempo(
  c: ChamadoStatus,
  v: ValidacaoChamado | null | undefined,
  nomeDe: (id: string | null) => string = () => "—",
  /** Andamento dos participantes (resumoParticipantes), quando a tela já leu. */
  participantes?: { total: number; confirmados: number } | null,
): PassoStatus[] {
  const passos: PassoStatus[] = [];
  const encerradoSemEntrega = c.status === "reprovado" || c.status === "cancelado";
  const concluido = c.status === "concluido";
  const etapa = v?.etapa;
  // Com Presidência, "desenvolvimento concluído" é a etapa ter saído de 'desenvolvimento'.
  const devConcluiu = v ? etapa !== "desenvolvimento" : concluido;

  passos.push({ key: "aberto", titulo: "Solicitação aberta", situacao: "feito", quando: c.created_at });

  // Em desenvolvimento
  const temResponsavel = !!c.responsavel_id;
  let situacaoDev: SituacaoPasso;
  if (devConcluiu) situacaoDev = "feito";
  else if (encerradoSemEntrega) situacaoDev = "interrompido";
  else situacaoDev = temResponsavel || c.status !== "aberto" ? "atual" : "pendente";
  const detalhesDev: string[] = [];
  if (temResponsavel) detalhesDev.push(`Responsável: ${nomeDe(c.responsavel_id)}`);
  else if (!devConcluiu) detalhesDev.push("Aguardando a coordenação direcionar a um desenvolvedor");
  if (c.status === "aguardando_retorno") detalhesDev.push("O time pediu mais informações ao solicitante");
  if (v && v.devolucoes > 0 && etapa === "desenvolvimento" && v.presidencia_aprovado === false) {
    detalhesDev.push(`Devolvido pela Presidência: ${v.presidencia_parecer ?? "—"}`);
  }
  passos.push({
    key: "desenvolvimento", titulo: "Em desenvolvimento", situacao: situacaoDev,
    detalhe: detalhesDev.join(" · ") || null,
  });

  if (encerradoSemEntrega) {
    passos.push({
      key: "encerrado",
      titulo: c.status === "reprovado" ? "Chamado reprovado" : "Chamado cancelado",
      situacao: "interrompido",
      quando: c.status === "cancelado" ? c.cancelado_em : c.updated_at,
      detalhe: c.status === "reprovado" ? c.motivo_reprovacao : c.motivo_cancelamento,
    });
    return passos;
  }

  // Conclusão pelo dev
  passos.push({
    key: "concluido",
    titulo: v ? "Desenvolvimento concluído" : "Chamado concluído",
    situacao: devConcluiu ? "feito" : "pendente",
    quando: v ? v.desenvolvimento_concluido_em : c.concluido_em,
    detalhe: v && devConcluiu && v.desenvolvedor_id ? `Por ${nomeDe(v.desenvolvedor_id)}` : null,
  });

  if (!v) return passos;

  // Presidência
  const presidenciaFeita = etapa === "treinamento" || etapa === "finalizado";
  passos.push({
    key: "presidencia",
    titulo: "Validação da Presidência",
    situacao: presidenciaFeita ? "feito" : etapa === "validacao_presidencia" ? "atual" : "pendente",
    quando: presidenciaFeita ? v.presidencia_em : null,
    detalhe: presidenciaFeita
      ? [`Aprovado por ${nomeDe(v.presidencia_por)}`, v.presidencia_parecer].filter(Boolean).join(" — ")
      : etapa === "validacao_presidencia" ? "A direção está conferindo se o desenvolvimento está OK" : null,
  });

  // Treinamento
  const treinoFeito = etapa === "finalizado";
  passos.push({
    key: "treinamento",
    titulo: "Treinamento",
    situacao: treinoFeito ? "feito" : etapa === "treinamento" ? "atual" : "pendente",
    detalhe: etapa === "treinamento"
      ? (v.treinamento_dev_em
          ? "Os participantes confirmam em Central de Serviços › Treinamentos › Treinamentos Sistemas"
          : "O desenvolvedor escolhe quem recebe o treinamento e o envia")
      : null,
    itens: [
      {
        titulo: v.treinamento_dev_em ? `Treinamento enviado por ${nomeDe(v.treinamento_dev_por)}` : "Treinamento enviado",
        feito: !!v.treinamento_dev_em, quando: v.treinamento_dev_em, detalhe: v.treinamento_dev_obs,
      },
      {
        titulo: participantes && participantes.total > 0
          ? `Participantes confirmaram (${participantes.confirmados} de ${participantes.total})`
          : "Participantes confirmaram",
        feito: treinoFeito,
      },
    ],
  });

  passos.push({
    key: "finalizado", titulo: "Solicitação finalizada",
    situacao: treinoFeito ? "feito" : "pendente", quando: v.finalizado_em,
  });

  return passos;
}

/** Rótulo curto da situação atual — o que aparece no botão "Status". */
export function resumoStatus(c: Pick<Chamado, "status">, v: ValidacaoChamado | null | undefined): string {
  if (c.status === "reprovado") return "Reprovado";
  if (c.status === "cancelado") return "Cancelado";
  if (v && v.etapa !== "desenvolvimento") return ETAPAS_VALIDACAO[v.etapa].label;
  if (c.status === "concluido") return "Concluído";
  if (c.status === "aguardando_retorno") return "Aguardando retorno";
  if (c.status === "em_andamento") return "Em desenvolvimento";
  return "Aberto";
}
