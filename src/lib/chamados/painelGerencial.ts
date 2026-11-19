// =====================================================================
// PRESIDÊNCIA › ACOMPANHAMENTO DE CHAMADOS (SIS-2026-0923, mig 20261116230000)
//
// Lógica pura do painel gerencial: em que aba cada chamado cai, o que conta
// como atrasado, os indicadores de rendimento por responsável e o espelho das
// regras de "Solicitar ação" (as RPCs chamado_gestao_acao_* são quem manda —
// aqui é só para a tela não oferecer o que o banco recusa).
// Testado em src/test/chamados-painel-gerencial.test.ts.
//
// Decisões (o pedido não define — escolhida a mais segura, ver a migration):
//   · "Aguardando validação" = concluído pelo dev e ainda sem o OK de quem
//     valida: a Presidência (etapa validacao_presidencia, mig 266) ou o
//     solicitante (conclusao_confirmada_em vazio). Concluído "sem retorno"
//     (o solicitante sumiu, mig 20261114130000) já conta como concluído.
//   · "Atrasado" = a previsão que o DEV gravou (prazo_conclusao_em) venceu e o
//     chamado ainda está ativo — o mesmo prazoVencido do Painel do
//     Desenvolvedor. O "prazo esperado" do solicitante é desejo, não
//     compromisso, e não entra.
//   · "Quem entrega mais rápido" usa o tempo do INÍCIO do desenvolvimento até
//     a conclusão: o tempo parado na fila depende da ordem que a coordenação
//     deu, não do dev. O tempo total (abertura → conclusão) aparece ao lado.
// =====================================================================
import { diaLocal, prazoVencido } from "@/lib/chamados/prazoDesenvolvimento";

/** Linha da RPC chamado_gerencial_listar. */
export interface ChamadoGerencial {
  id: string;
  numero: string;
  assunto: string;
  descricao: string | null;
  prioridade: string;
  status: string;
  setor: string | null;
  solicitante_id: string | null;
  solicitante_nome: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  posicao_dev: number | null;
  modulo_sistema: string | null;
  modulo_sistema_outro: string | null;
  created_at: string;
  concluido_em: string | null;
  cancelado_em: string | null;
  conclusao_confirmada_em: string | null;
  concluido_sem_retorno: boolean | null;
  gestao_finalizada_em: string | null;
  desenvolvimento_iniciado_em: string | null;
  prazo_conclusao_em: string | null;
  prazo_solicitante: string | null;
  concluido_no_prazo: boolean | null;
  horas_gastas: number | null;
  etapa_validacao: string | null;
  avaliacao_nota: number | null;
  avaliacao_comentario: string | null;
  acoes_pendentes: number | null;
  /** Entrega do dev ao Gestor de Sistemas (mig 20261120170000 devolve na RPC). */
  desenvolvimento_entregue_em?: string | null;
}

// ---- Abas -------------------------------------------------------------

export type GrupoGerencial = "andamento" | "validacao" | "concluido" | "encerrado";

export const GRUPOS_GERENCIAL: Record<GrupoGerencial, { label: string }> = {
  andamento: { label: "Em andamento" },
  validacao: { label: "Aguardando validação" },
  concluido: { label: "Concluídos" },
  encerrado: { label: "Cancelados / reprovados" },
};

const ENCERRADOS = ["concluido", "reprovado", "cancelado"];
export const ativoGerencial = (status: string) => !ENCERRADOS.includes(status);

export function grupoGerencial(c: Pick<ChamadoGerencial,
  "status" | "etapa_validacao" | "conclusao_confirmada_em" | "concluido_sem_retorno">): GrupoGerencial {
  if (ativoGerencial(c.status)) return "andamento";
  if (c.status === "concluido") {
    if (c.etapa_validacao === "validacao_presidencia") return "validacao";
    if (!c.conclusao_confirmada_em && !c.concluido_sem_retorno) return "validacao";
    return "concluido";
  }
  return "encerrado";
}

/** Previsão do dev vencida com o chamado ainda ativo (mesma regra do Painel do Desenvolvedor). */
export const atrasadoGerencial = (c: Pick<ChamadoGerencial, "status" | "prazo_conclusao_em" | "desenvolvimento_entregue_em">, agora = new Date()) =>
  prazoVencido(c, agora);

/**
 * Data que o filtro de período olha: abertura para o que está em andamento,
 * conclusão para o que foi entregue, cancelamento para o cancelado.
 */
export function dataReferencia(c: Pick<ChamadoGerencial, "status" | "created_at" | "concluido_em" | "cancelado_em">): string {
  if (c.status === "concluido" && c.concluido_em) return c.concluido_em;
  if (c.status === "cancelado" && c.cancelado_em) return c.cancelado_em;
  return c.created_at;
}

// ---- Filtros ----------------------------------------------------------

export interface FiltrosGerencial {
  setor?: string;
  responsavelId?: string;
  prioridade?: string;
  /** AAAA-MM-DD, inclusivo. */
  de?: string;
  ate?: string;
  busca?: string;
}

export const SEM_RESPONSAVEL = "__sem__";

export function noPeriodo(data: string | null | undefined, de?: string, ate?: string): boolean {
  if (!de && !ate) return true;
  if (!data) return false;
  const dia = diaLocal(data);
  return (!de || dia >= de) && (!ate || dia <= ate);
}

export function filtrarChamados<T extends ChamadoGerencial>(lista: readonly T[], f: FiltrosGerencial): T[] {
  const q = (f.busca ?? "").trim().toLowerCase();
  return lista.filter((c) =>
    (!f.setor || (c.setor ?? "") === f.setor)
    && (!f.responsavelId || (f.responsavelId === SEM_RESPONSAVEL ? !c.responsavel_id : c.responsavel_id === f.responsavelId))
    && (!f.prioridade || c.prioridade === f.prioridade)
    && noPeriodo(dataReferencia(c), f.de, f.ate)
    && (!q || [c.numero, c.assunto, c.setor, c.responsavel_nome, c.solicitante_nome]
      .some((x) => (x ?? "").toLowerCase().includes(q))));
}

/** Em andamento: por responsável e posição na fila; os demais, do mais recente. */
export function ordenarParaAba<T extends ChamadoGerencial>(lista: readonly T[], grupo: GrupoGerencial): T[] {
  const copia = [...lista];
  if (grupo === "andamento") {
    return copia.sort((a, b) =>
      (a.responsavel_nome ?? "￿").localeCompare(b.responsavel_nome ?? "￿", "pt-BR")
      || (a.posicao_dev ?? Number.MAX_SAFE_INTEGER) - (b.posicao_dev ?? Number.MAX_SAFE_INTEGER)
      || +new Date(a.created_at) - +new Date(b.created_at));
  }
  return copia.sort((a, b) => +new Date(dataReferencia(b)) - +new Date(dataReferencia(a)));
}

// ---- Indicadores ------------------------------------------------------

const DIA_MS = 86_400_000;

/** Dias corridos (com fração) entre duas datas; null se faltar alguma ou vier invertido. */
export function diasEntre(de: string | null | undefined, ate: string | null | undefined): number | null {
  if (!de || !ate) return null;
  const d = (+new Date(ate) - +new Date(de)) / DIA_MS;
  return Number.isFinite(d) && d >= 0 ? d : null;
}

export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function media(valores: readonly number[]): number | null {
  return valores.length ? valores.reduce((s, x) => s + x, 0) / valores.length : null;
}

export interface KpisGerencial {
  andamento: number;
  validacao: number;
  concluidos: number;
  encerrados: number;
  atrasados: number;
  acoesPendentes: number;
}

export function kpisGerencial(lista: readonly ChamadoGerencial[], acoesPendentes: number, agora = new Date()): KpisGerencial {
  const k: KpisGerencial = { andamento: 0, validacao: 0, concluidos: 0, encerrados: 0, atrasados: 0, acoesPendentes };
  for (const c of lista) {
    const g = grupoGerencial(c);
    if (g === "andamento") k.andamento++;
    else if (g === "validacao") k.validacao++;
    else if (g === "concluido") k.concluidos++;
    else k.encerrados++;
    if (atrasadoGerencial(c, agora)) k.atrasados++;
  }
  return k;
}

export interface RendimentoResponsavel {
  responsavelId: string;
  nome: string;
  emAndamento: number;
  atrasados: number;
  /** status 'concluido' (inclui os que aguardam validação: o dev já entregou). */
  concluidos: number;
  /** Abertura → conclusão (dias corridos). */
  tempoTotalMedianoDias: number | null;
  tempoTotalMedioDias: number | null;
  /** Início do desenvolvimento → conclusão (dias corridos). */
  tempoDevMedianoDias: number | null;
  avaliacaoMedia: number | null;
  avaliacoes: number;
  entreguesNoPrazo: number;
  entreguesComAtraso: number;
  /** % no prazo entre os concluídos que tinham prazo; null sem base. */
  pctNoPrazo: number | null;
}

/**
 * Rendimento por responsável sobre a lista já filtrada. Ordem: mais
 * concluídos primeiro; empate, quem entrega mais rápido (tempo de dev).
 */
export function rendimentoPorResponsavel(lista: readonly ChamadoGerencial[], agora = new Date()): RendimentoResponsavel[] {
  const porDev = new Map<string, ChamadoGerencial[]>();
  for (const c of lista) {
    if (!c.responsavel_id) continue;
    const arr = porDev.get(c.responsavel_id) ?? [];
    arr.push(c);
    porDev.set(c.responsavel_id, arr);
  }

  const linhas: RendimentoResponsavel[] = [];
  porDev.forEach((chamados, id) => {
    const concl = chamados.filter((c) => c.status === "concluido");
    const total = concl.map((c) => diasEntre(c.created_at, c.concluido_em)).filter((x): x is number => x != null);
    const dev = concl.map((c) => diasEntre(c.desenvolvimento_iniciado_em, c.concluido_em)).filter((x): x is number => x != null);
    const notas = chamados.map((c) => c.avaliacao_nota).filter((x): x is number => x != null).map(Number);
    const noPrazo = concl.filter((c) => c.concluido_no_prazo === true).length;
    const comAtraso = concl.filter((c) => c.concluido_no_prazo === false).length;
    linhas.push({
      responsavelId: id,
      nome: chamados.find((c) => c.responsavel_nome)?.responsavel_nome ?? "—",
      emAndamento: chamados.filter((c) => ativoGerencial(c.status)).length,
      atrasados: chamados.filter((c) => atrasadoGerencial(c, agora)).length,
      concluidos: concl.length,
      tempoTotalMedianoDias: mediana(total),
      tempoTotalMedioDias: media(total),
      tempoDevMedianoDias: mediana(dev),
      avaliacaoMedia: media(notas),
      avaliacoes: notas.length,
      entreguesNoPrazo: noPrazo,
      entreguesComAtraso: comAtraso,
      pctNoPrazo: noPrazo + comAtraso > 0 ? Math.round((noPrazo / (noPrazo + comAtraso)) * 100) : null,
    });
  });

  return linhas.sort((a, b) =>
    b.concluidos - a.concluidos
    || (a.tempoDevMedianoDias ?? Number.MAX_VALUE) - (b.tempoDevMedianoDias ?? Number.MAX_VALUE)
    || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Contagem por uma chave (setor, responsável…), maior primeiro; vazios viram `vazio`. */
export function contarPor<T>(lista: readonly T[], chave: (x: T) => string | null | undefined, vazio = "Não informado"): { nome: string; total: number }[] {
  const m = new Map<string, number>();
  for (const x of lista) {
    const k = (chave(x) ?? "").trim() || vazio;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * Dobra a cauda de uma contagem em "Outros" — cor não é gerada para a 9ª
 * categoria (skill dataviz: categorias além do limite viram "Outros").
 */
export function agruparOutros(itens: readonly { nome: string; total: number }[], limite = 8): { nome: string; total: number }[] {
  if (itens.length <= limite) return [...itens];
  const cabeca = itens.slice(0, limite - 1);
  const resto = itens.slice(limite - 1).reduce((s, x) => s + x.total, 0);
  return [...cabeca, { nome: "Outros", total: resto }];
}

/** "3,5 dias", "18 h" para menos de um dia, "—" sem dado. */
export function rotuloDias(d: number | null | undefined): string {
  if (d == null) return "—";
  if (d < 1) return `${Math.max(1, Math.round(d * 24))} h`;
  const r = Math.round(d * 10) / 10;
  return `${r.toLocaleString("pt-BR")} ${r === 1 ? "dia" : "dias"}`;
}

// ---- Solicitações de ação (espelho da mig 20261116230000) -------------

export type TipoAcaoGestao = "prioridade" | "ordem_fila" | "cancelamento" | "revisao" | "informacoes";
export type StatusAcaoGestao = "pendente" | "aceita" | "recusada" | "cancelada";

export const TIPOS_ACAO_GESTAO: Record<TipoAcaoGestao, { label: string; curto: string; explica: string; placeholder: string }> = {
  prioridade: {
    label: "Mudar a prioridade", curto: "Prioridade",
    explica: "Sistemas analisa o pedido. A prioridade só muda se for aceito.",
    placeholder: "Explique o impacto e a urgência da mudança de prioridade…",
  },
  ordem_fila: {
    label: "Alterar ordem da fila", curto: "Ordem da fila",
    explica: "Indique a posição pretendida na fila do desenvolvedor. A ordem não muda automaticamente.",
    placeholder: "Explique o impacto e a urgência da mudança de ordem…",
  },
  cancelamento: {
    label: "Solicitar cancelamento do chamado", curto: "Cancelamento",
    explica: "O chamado continua como está até Sistemas decidir. Aceito, ele é cancelado e o solicitante é avisado.",
    placeholder: "Explique por que o chamado não é mais necessário…",
  },
  revisao: {
    label: "Reprovar a entrega / solicitar revisão", curto: "Revisão",
    explica: "Para chamado já concluído: aceito, ele volta ao desenvolvimento com o mesmo desenvolvedor.",
    placeholder: "Conte o que não ficou como deveria na entrega…",
  },
  informacoes: {
    label: "Solicitar informações / atualização", curto: "Informações",
    explica: "Descreva o que deseja saber. Sistemas responde por aqui, sem mexer no chamado.",
    placeholder: "Especifique quais informações ou esclarecimentos deseja receber…",
  },
};

export const STATUS_ACAO_GESTAO: Record<StatusAcaoGestao, { label: string; cls: string }> = {
  pendente: { label: "Pendente", cls: "border-warning/30 bg-warning/10 text-warning" },
  aceita: { label: "Aceita", cls: "border-success/30 bg-success/10 text-success" },
  recusada: { label: "Recusada", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
  cancelada: { label: "Retirada", cls: "border-muted-foreground/30 bg-muted text-muted-foreground" },
};

/** "Aceita" num pedido de informações é "Respondida". */
export const rotuloStatusAcao = (a: { tipo: string; status: string }) =>
  a.tipo === "informacoes" && a.status === "aceita"
    ? "Respondida"
    : STATUS_ACAO_GESTAO[a.status as StatusAcaoGestao]?.label ?? a.status;

/** Linha da RPC chamado_gestao_acoes_listar. */
export interface AcaoGestao {
  id: number;
  chamado_id: string;
  numero: string;
  assunto: string;
  setor: string | null;
  prioridade: string;
  status_chamado_atual: string;
  tipo: TipoAcaoGestao;
  justificativa: string;
  valor_atual: string | null;
  valor_solicitado: string | null;
  status_chamado: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  solicitado_por: string | null;
  solicitado_por_nome: string | null;
  status: StatusAcaoGestao;
  resposta: string | null;
  decidido_por: string | null;
  decidido_por_nome: string | null;
  decidido_em: string | null;
  created_at: string;
}

export const MIN_JUSTIFICATIVA = 10;
export const MIN_RESPOSTA = 5;
export const justificativaValida = (t: string | null | undefined) => (t ?? "").trim().length >= MIN_JUSTIFICATIVA;
export const respostaValida = (t: string | null | undefined) => (t ?? "").trim().length >= MIN_RESPOSTA;

const ROTULO_PRIORIDADE: Record<string, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

/** "Alta → Baixa", "3º → 1º", "Pedido de cancelamento"… */
export function detalheAcao(a: Pick<AcaoGestao, "tipo" | "valor_atual" | "valor_solicitado">): string {
  switch (a.tipo) {
    case "prioridade":
      return `${ROTULO_PRIORIDADE[a.valor_atual ?? ""] ?? a.valor_atual ?? "—"} → ${ROTULO_PRIORIDADE[a.valor_solicitado ?? ""] ?? a.valor_solicitado ?? "—"}`;
    case "ordem_fila":
      return `Posição ${a.valor_atual ?? "—"}º → ${a.valor_solicitado ?? "—"}º`;
    case "cancelamento":
      return "Pedido de cancelamento";
    case "revisao":
      return "Revisão da entrega";
    default:
      return "Pedido de informações";
  }
}

/**
 * Ações que fazem sentido para o chamado no estado de hoje — as mesmas
 * checagens de chamado_gestao_acao_solicitar.
 */
export function tiposAcaoPermitidos(c: Pick<ChamadoGerencial, "status" | "responsavel_id" | "posicao_dev">): TipoAcaoGestao[] {
  if (ativoGerencial(c.status)) {
    const t: TipoAcaoGestao[] = [];
    if (c.responsavel_id && c.posicao_dev != null) t.push("ordem_fila");
    t.push("prioridade", "cancelamento", "informacoes");
    return t;
  }
  if (c.status === "concluido") return ["revisao", "informacoes"];
  return ["informacoes"];
}

export interface PedidoAcao {
  tipo: TipoAcaoGestao;
  justificativa: string;
  prioridade?: string | null;
  posicao?: number | null;
}

/** Mensagem do primeiro problema do pedido, ou null quando pode enviar. */
export function validarPedidoAcao(
  c: Pick<ChamadoGerencial, "status" | "prioridade" | "responsavel_id" | "posicao_dev">,
  p: PedidoAcao,
  tamanhoFila: number,
): string | null {
  if (!tiposAcaoPermitidos(c).includes(p.tipo)) return "Essa ação não se aplica ao chamado no estado atual.";
  if (p.tipo === "prioridade") {
    if (!p.prioridade || !(p.prioridade in ROTULO_PRIORIDADE)) return "Escolha a nova prioridade.";
    if (p.prioridade === c.prioridade) return "O chamado já está com essa prioridade.";
  }
  if (p.tipo === "ordem_fila") {
    const n = p.posicao;
    if (n == null || !Number.isInteger(n) || n < 1 || n > Math.max(1, tamanhoFila)) {
      return `Informe uma posição entre 1 e ${Math.max(1, tamanhoFila)}.`;
    }
    if (n === c.posicao_dev) return "A posição pedida deve ser diferente da atual.";
  }
  if (!justificativaValida(p.justificativa)) return `Escreva a justificativa com pelo menos ${MIN_JUSTIFICATIVA} caracteres.`;
  return null;
}

/** Recusar sempre pede resposta; aceitar só no pedido de informações (a resposta é o atendimento). */
export const respostaObrigatoria = (tipo: TipoAcaoGestao, aceitar: boolean) => !aceitar || tipo === "informacoes";

/** Tamanho da fila de cada responsável (chamados ativos com posição). */
export function tamanhoFilas(lista: readonly ChamadoGerencial[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const c of lista) {
    if (c.responsavel_id && ativoGerencial(c.status)) m[c.responsavel_id] = (m[c.responsavel_id] ?? 0) + 1;
  }
  return m;
}
