// =====================================================================
// PRAZO DO DESENVOLVEDOR (28/10/2026 — migs 20261028001400 e 20261028001410,
// chamado SIS-2026-0763).
//
// Pedido do Pablo: "Ao receber a tarefa o desenvolvedor deve definir o prazo
// de acordo com as suas prioridades, esse prazo não poderá ser alterado,
// somente se a tarefa descer de prioridade. Ao concluir a tarefa deve ficar
// com o status de concluída dentro do prazo ou concluída com atraso."
// Antes (mesmo dia): "cada chamado tem que ter sua data. Não posso colocar a
// mesma data em dois chamados. Mas nada pode impedir também, só tem que dar
// um aviso" — o aviso de data repetida continua aqui (chamadosComMesmaData).
//
// Modelo:
//   · prazo = quantidade (prazo_dias) + unidade (horas, dias úteis ou
//     semanas — mig 20261028001900), obrigatório para iniciar, TRAVADO
//     depois de definido — só destrava quando a posição na fila MUDA, para
//     cima ou para baixo (posicao_dev ≠ prazo_posicao_fila);
//   · previsão de entrega: iniciado = início + prazo_dias (gravada pelo banco
//     em prazo_conclusao_em); não iniciado = PROJEÇÃO pela fila — começa
//     quando as tarefas da frente terminam (`projetarPrevisoes`);
//   · situação: No prazo / Risco / Atrasado e, concluído, Concluído no prazo
//     / Concluído com atraso (concluido_no_prazo, gravado pelo banco).
//
// Dias úteis: sem sábado, domingo e feriado nacional do tipo "Feriado" de
// feriadosNacionais — o MESMO calendário de public.chamado_feriado (mig
// 20261028001410). Mudar um = mudar o outro.
// =====================================================================
import { feriadosNacionais } from "@/lib/feriadosNacionais";

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** Dia (AAAA-MM-DD) no fuso do navegador — é o "dia" que o dev vê. */
export function diaLocal(d: Date | string): string {
  // Coluna date (prazo_previsto) já vem como AAAA-MM-DD: não passa por Date,
  // senão vira meia-noite UTC e cai no dia anterior em Brasília.
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${doisDigitos(x.getMonth() + 1)}-${doisDigitos(x.getDate())}`;
}

/** AAAA-MM-DD → Date à meia-noite local. */
const dataDoDia = (dia: string) => { const [a, m, d] = dia.split("-").map(Number); return new Date(a, m - 1, d); };

const feriadosPorAno = new Map<number, Set<string>>();
function feriadosDoAno(ano: number): Set<string> {
  let s = feriadosPorAno.get(ano);
  if (!s) {
    s = new Set(feriadosNacionais(ano).filter((f) => f.tipo === "Feriado").map((f) => f.data));
    feriadosPorAno.set(ano, s);
  }
  return s;
}

/** Dia útil = segunda a sexta, fora feriado nacional. */
export function ehDiaUtil(d: Date): boolean {
  const dia = d.getDay();
  if (dia === 0 || dia === 6) return false;
  return !feriadosDoAno(d.getFullYear()).has(diaLocal(d));
}

/**
 * O dia que fica N dias úteis depois de `base` (o dia da base não conta).
 * Espelha public.chamado_somar_dias_uteis.
 */
export function somarDiasUteis(base: Date, dias: number): Date {
  const d = dataDoDia(diaLocal(base));
  let falta = Math.max(0, Math.floor(dias || 0));
  while (falta > 0) {
    d.setDate(d.getDate() + 1);
    if (ehDiaUtil(d)) falta--;
  }
  return d;
}

/** Dias úteis de `de` (exclusive) até `ate` (inclusive). Negativo se `ate` já passou. */
export function diasUteisAte(de: Date, ate: Date): number {
  const a = diaLocal(de), b = diaLocal(ate);
  if (a === b) return 0;
  const passou = b < a;
  const ini = dataDoDia(passou ? b : a), fim = passou ? a : b;
  let n = 0;
  while (diaLocal(ini) < fim) { ini.setDate(ini.getDate() + 1); if (ehDiaUtil(ini)) n++; }
  return passou ? -n : n;
}

// ---- Chamado com prazo ------------------------------------------------

/**
 * Unidade do prazo (mig 20261028001900): "determinar se o prazo vai ser em
 * dias, horas, semanas" (Pablo). Horas = corridas, com hora exata; dias =
 * úteis; semanas = 5 dias úteis cada. A quantidade mora em prazo_dias (o
 * nome é da versão só em dias).
 */
export type UnidadePrazo = "horas" | "dias" | "semanas";

export const UNIDADES_PRAZO: { value: UnidadePrazo; label: string; curto: (n: number) => string }[] = [
  { value: "horas",   label: "Horas",      curto: (n) => `${n} h` },
  { value: "dias",    label: "Dias úteis", curto: (n) => `${n} ${n === 1 ? "dia" : "dias"}` },
  { value: "semanas", label: "Semanas",    curto: (n) => `${n} sem` },
];

/** Limite por unidade — o mesmo de public.chamado_prazo_valido. */
export const LIMITE_PRAZO: Record<UnidadePrazo, number> = { horas: 720, dias: 120, semanas: 24 };

export const prazoValido = (quantidade: number, unidade: UnidadePrazo) =>
  Number.isInteger(quantidade) && quantidade >= 1 && quantidade <= (LIMITE_PRAZO[unidade] ?? 0);

/** "4 h", "2 dias", "1 sem". */
export const rotuloPrazo = (quantidade: number | null | undefined, unidade: string | null | undefined) =>
  quantidade == null ? "—" : (UNIDADES_PRAZO.find((u) => u.value === (unidade ?? "dias")) ?? UNIDADES_PRAZO[1]).curto(quantidade);

/**
 * Previsão a partir de `inicio`. Espelha public.chamado_previsao_entrega:
 * horas → início + N h; dias → N dias úteis (até o fim do dia); semanas →
 * N × 5 dias úteis (até o fim do dia).
 */
export function calcularPrevisao(inicio: Date, quantidade: number, unidade: UnidadePrazo | string | null | undefined): Date {
  if (unidade === "horas") return new Date(inicio.getTime() + Math.max(0, quantidade) * 3_600_000);
  const dias = unidade === "semanas" ? quantidade * 5 : quantidade;
  const d = somarDiasUteis(inicio, dias);
  d.setHours(23, 59, 59, 0);
  return d;
}

export interface ChamadoPrazo {
  id: string;
  status: string;
  responsavel_id: string | null;
  posicao_dev?: number | null;
  created_at?: string;
  desenvolvimento_iniciado_em?: string | null;
  prazo_conclusao_em?: string | null;
  prazo_previsto?: string | null;
  prazo_dias?: number | null;
  prazo_unidade?: string | null;
  prazo_definido_em?: string | null;
  prazo_posicao_fila?: number | null;
  concluido_no_prazo?: boolean | null;
}

const ENCERRADOS = ["concluido", "reprovado", "cancelado"];
const ativo = (s: string) => !ENCERRADOS.includes(s);

/**
 * A posição na fila mudou desde que o prazo foi definido — desceu (5º → 6º)
 * ou subiu (6º → 5º)? ESPELHA a trava de chamado_definir_prazo: é o que
 * libera ajustar o prazo (mig 20261028001900; antes só quando descia).
 */
export const mudouNaFila = (c: ChamadoPrazo) =>
  ativo(c.status) && c.prazo_dias != null && c.posicao_dev != null && c.prazo_posicao_fila != null
  && c.posicao_dev !== c.prazo_posicao_fila;

/** Desceu (posição maior que a de quando definiu o prazo). */
export const desceuNaFila = (c: ChamadoPrazo) => mudouNaFila(c) && c.posicao_dev! > c.prazo_posicao_fila!;

/** Pode definir o prazo agora? Primeira vez, ou ajustar porque a posição mudou. */
export const podeDefinirPrazo = (c: ChamadoPrazo) =>
  ativo(c.status) && !!c.responsavel_id && (c.prazo_dias == null || mudouNaFila(c));

/** ESPELHA chamado_iniciar_desenvolvimento: aberto/em andamento, com responsável, ainda não iniciado. */
export const podeIniciarDesenvolvimento = (
  c: { status: string; responsavel_id: string | null; desenvolvimento_iniciado_em?: string | null },
) => !c.desenvolvimento_iniciado_em && !!c.responsavel_id && (c.status === "aberto" || c.status === "em_andamento");

/** `comHora`: prazo em horas — a previsão tem hora certa, não só o dia. */
export interface Previsao { data: Date; projetada: boolean; comHora?: boolean }

/**
 * Previsão de entrega de cada tarefa da fila de UM dev. A fila vai na ordem
 * de execução (posicao_dev). Iniciada = a previsão gravada (início + prazo).
 * Não iniciada = começa quando a tarefa da frente termina (ou agora) e soma o
 * prazo na unidade dela — muda sozinha quando a fila muda. Sem prazo: sem
 * previsão, e não empurra as de trás.
 */
export function projetarPrevisoes(fila: readonly ChamadoPrazo[], agora = new Date()): Record<string, Previsao> {
  const ordem = [...fila].filter((c) => ativo(c.status))
    .sort((a, b) => (a.posicao_dev ?? Number.MAX_SAFE_INTEGER) - (b.posicao_dev ?? Number.MAX_SAFE_INTEGER)
      || +new Date(a.created_at ?? 0) - +new Date(b.created_at ?? 0));
  const r: Record<string, Previsao> = {};
  let cursor = new Date(agora.getTime());
  for (const c of ordem) {
    const comHora = c.prazo_unidade === "horas";
    if (c.desenvolvimento_iniciado_em && c.prazo_conclusao_em) {
      const d = new Date(c.prazo_conclusao_em);
      r[c.id] = { data: d, projetada: false, comHora };
      if (d > cursor) cursor = d;
    } else if (c.prazo_dias) {
      const d = calcularPrevisao(cursor, c.prazo_dias, c.prazo_unidade);
      r[c.id] = { data: d, projetada: true, comHora };
      cursor = d;
    }
  }
  return r;
}

export type SituacaoPrazo =
  | "no_prazo" | "risco" | "atrasado" | "sem_prazo"
  | "concluido_no_prazo" | "concluido_atraso" | "concluido";

export const SITUACOES_PRAZO: Record<SituacaoPrazo, { label: string; cls: string; cor: string }> = {
  no_prazo:           { label: "No prazo",               cls: "border-success/30 bg-success/10 text-success",             cor: "hsl(var(--success))" },
  risco:              { label: "Risco",                  cls: "border-warning/40 bg-warning/10 text-warning",             cor: "hsl(var(--warning))" },
  atrasado:           { label: "Atrasado",               cls: "border-destructive/40 bg-destructive text-destructive-foreground", cor: "hsl(var(--destructive))" },
  sem_prazo:          { label: "Definir prazo",          cls: "border-muted-foreground/30 bg-muted text-muted-foreground", cor: "hsl(var(--muted-foreground))" },
  concluido_no_prazo: { label: "Concluído no prazo",     cls: "border-success/30 bg-success/10 text-success",             cor: "hsl(var(--primary))" },
  concluido_atraso:   { label: "Concluído com atraso",   cls: "border-destructive/30 bg-destructive/10 text-destructive", cor: "hsl(var(--destructive))" },
  concluido:          { label: "Concluído",              cls: "border-muted-foreground/30 bg-muted text-muted-foreground", cor: "hsl(var(--muted-foreground))" },
};

/**
 * Situação do prazo. Concluído: o que o banco gravou ao concluir. Ativo,
 * prazo em dias/semanas: passou do dia da previsão = Atrasado; vence hoje ou
 * no próximo dia útil = Risco. Prazo em horas: passou da hora = Atrasado;
 * faltam 2 horas ou menos = Risco. Senão No prazo. Sem prazo = "Definir prazo".
 */
export function situacaoPrazo(c: ChamadoPrazo, previsao: Previsao | null | undefined, agora = new Date()): SituacaoPrazo | null {
  if (c.status === "concluido") {
    return c.concluido_no_prazo === true ? "concluido_no_prazo"
      : c.concluido_no_prazo === false ? "concluido_atraso" : "concluido";
  }
  if (!ativo(c.status)) return null;
  if (!c.prazo_dias || !previsao) return "sem_prazo";
  if (c.prazo_unidade === "horas") {
    const ms = previsao.data.getTime() - agora.getTime();
    if (ms < 0) return "atrasado";
    return ms <= 2 * 3_600_000 ? "risco" : "no_prazo";
  }
  if (diaLocal(previsao.data) < diaLocal(agora)) return "atrasado";
  return diasUteisAte(agora, previsao.data) <= 1 ? "risco" : "no_prazo";
}

// ---- Aviso de data repetida (pedido de 28/10, continua valendo) -------

export interface ChamadoComPrazo {
  id: string;
  numero: string;
  assunto?: string;
  prazo_conclusao_em?: string | null;
  prazo_previsto?: string | null;
}

/** O dia do prazo do chamado: o gravado ao iniciar; sem ele, o prazo_previsto antigo. */
export const diaDoPrazo = (c: Pick<ChamadoComPrazo, "prazo_conclusao_em" | "prazo_previsto">): string | null =>
  c.prazo_conclusao_em ? diaLocal(c.prazo_conclusao_em) : c.prazo_previsto ? diaLocal(c.prazo_previsto) : null;

/**
 * Outros chamados (do mesmo dev, ainda ativos — quem chama filtra) com
 * previsão no MESMO DIA. Só aviso: a tela mostra e deixa seguir.
 */
export function chamadosComMesmaData<T extends ChamadoComPrazo>(prazo: Date | null, outros: readonly T[], idAtual?: string): T[] {
  if (!prazo) return [];
  const dia = diaLocal(prazo);
  return outros.filter((c) => c.id !== idAtual && diaDoPrazo(c) === dia);
}

// ---- Selo do andamento ------------------------------------------------

export type SituacaoDesenvolvimento = "na_fila" | "em_desenvolvimento" | null;

/** Em andamento com início marcado = "Em desenvolvimento"; sem início = "Na fila". */
export function situacaoDesenvolvimento(
  c: { status: string; desenvolvimento_iniciado_em?: string | null },
): SituacaoDesenvolvimento {
  if (c.status === "em_andamento") return c.desenvolvimento_iniciado_em ? "em_desenvolvimento" : "na_fila";
  return null;
}

/** Previsão estourada: tem previsão gravada, ainda não concluiu e o dia já passou. */
export const prazoVencido = (
  c: { status: string; prazo_conclusao_em?: string | null }, agora = new Date(),
) => !!c.prazo_conclusao_em && ativo(c.status) && diaLocal(c.prazo_conclusao_em) < diaLocal(agora);

// ---- Prazo do solicitante (mig 20261028001420) --------------------------

/**
 * Sugestão de "prazo esperado" a partir da urgência marcada na abertura —
 * o solicitante pode trocar a data. "Mais de 5 dias úteis" sugere 10.
 */
export function sugestaoPrazoSolicitante(urgencia: string, hoje = new Date()): string | null {
  const dias: Record<string, number> = { ate_1h: 0, ate_1d: 1, ate_3d: 3, ate_5d: 5, mais_5d: 10 };
  if (!(urgencia in dias)) return null;
  return diaLocal(somarDiasUteis(hoje, dias[urgencia]));
}

/** Prazo esperado válido: data (AAAA-MM-DD) de hoje em diante. Espelha o gatilho do banco. */
export const prazoSolicitanteValido = (v: string, hoje = new Date()) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= diaLocal(hoje);

// ---- Painel do Desenvolvedor (layout do mockup, SIS-2026-0763) ---------

export type StatusPainel = "em_desenvolvimento" | "em_analise" | "aguardando_retorno" | "concluido" | "reprovado" | "cancelado";

/**
 * Status como o Painel do Desenvolvedor mostra: em andamento com início
 * marcado = "Em desenvolvimento"; aberto ou na fila sem início = "Em análise".
 */
export function statusPainel(c: { status: string; desenvolvimento_iniciado_em?: string | null }): StatusPainel {
  if (c.status === "em_andamento" && c.desenvolvimento_iniciado_em) return "em_desenvolvimento";
  if (c.status === "aberto" || c.status === "em_andamento") return "em_analise";
  return c.status as StatusPainel;
}

export const STATUS_PAINEL: Record<StatusPainel, { label: string; cls: string; cor: string }> = {
  em_desenvolvimento: { label: "Em desenvolvimento", cls: "border-info/30 bg-info/10 text-info",                   cor: "hsl(var(--info))" },
  em_analise:         { label: "Em análise",         cls: "border-muted-foreground/20 bg-muted text-muted-foreground", cor: "hsl(var(--warning))" },
  aguardando_retorno: { label: "Aguardando retorno", cls: "border-warning/40 bg-warning/10 text-warning",          cor: "hsl(var(--destructive))" },
  concluido:          { label: "Concluído",          cls: "border-success/30 bg-success/10 text-success",          cor: "hsl(var(--success))" },
  reprovado:          { label: "Reprovado",          cls: "border-destructive/30 bg-destructive/10 text-destructive", cor: "hsl(var(--destructive))" },
  cancelado:          { label: "Cancelado",          cls: "border-muted-foreground/30 bg-muted text-muted-foreground", cor: "hsl(var(--muted-foreground))" },
};

/** Variação percentual (arredondada) de `anterior` para `atual`; null sem base. */
export function variacaoPercentual(atual: number | null, anterior: number | null): number | null {
  if (atual == null || anterior == null || anterior === 0) return null;
  return Math.round(((atual - anterior) / anterior) * 100);
}
