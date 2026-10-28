// =====================================================================
// INÍCIO DO DESENVOLVIMENTO + PRAZO (28/10/2026, mig 20261028001400).
//
// Pedido do Pablo: o dev marca "Em desenvolvimento" e, antes de confirmar o
// início, informa o PRAZO — em horas ou em dias. "Cada chamado tem que ter
// sua data. Não posso colocar a mesma data em dois chamados. Mas nada pode
// impedir também, só tem que dar um aviso e deixar como opcional."
//
// Por isso:
//   · o prazo é obrigatório para iniciar (a RPC chamado_iniciar_desenvolvimento
//     recusa sem prazo ou com prazo no passado);
//   · mesma DATA (dia) em outro chamado ativo do mesmo dev é só AVISO —
//     `chamadosComMesmaData` lista quais, e a tela deixa seguir assim mesmo.
//
// Lógica pura (sem React) para a tela e os testes concordarem.
// =====================================================================

export type UnidadePrazo = "horas" | "dias";

export const UNIDADES_PRAZO: { value: UnidadePrazo; label: string }[] = [
  { value: "horas", label: "Horas" },
  { value: "dias", label: "Dias úteis" },
];

/**
 * Prazo a partir de agora. Horas = corridas (chamado de 3 h vence hoje).
 * Dias = úteis: pula sábado e domingo, mantendo a hora — o mesmo jeito que o
 * formulário de abertura fala de urgência ("até 3 dias úteis").
 */
export function calcularPrazo(agora: Date, quantidade: number, unidade: UnidadePrazo): Date | null {
  if (!Number.isFinite(quantidade) || quantidade <= 0) return null;
  const d = new Date(agora.getTime());
  if (unidade === "horas") {
    d.setTime(d.getTime() + Math.round(quantidade * 60) * 60_000);
    return d;
  }
  let falta = Math.ceil(quantidade);
  while (falta > 0) {
    d.setDate(d.getDate() + 1);
    const dia = d.getDay();
    if (dia !== 0 && dia !== 6) falta--;
  }
  return d;
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** Dia (AAAA-MM-DD) no fuso do navegador — é o "dia" que o dev vê. */
export function diaLocal(d: Date | string): string {
  // Coluna date (prazo_previsto) já vem como AAAA-MM-DD: não passa por Date,
  // senão vira meia-noite UTC e cai no dia anterior em Brasília.
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${doisDigitos(x.getMonth() + 1)}-${doisDigitos(x.getDate())}`;
}

/** Valor para <input type="datetime-local"> (hora local, sem segundos). */
export function paraInputDataHora(d: Date | null | undefined): string {
  if (!d) return "";
  return `${diaLocal(d)}T${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

/** Lê o valor do <input type="datetime-local"> (hora local). Vazio/ruim = null. */
export function lerInputDataHora(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ChamadoComPrazo {
  id: string;
  numero: string;
  assunto?: string;
  prazo_conclusao_em?: string | null;
  prazo_previsto?: string | null;
}

/** O dia do prazo do chamado: o informado ao iniciar; sem ele, o prazo_previsto antigo. */
export const diaDoPrazo = (c: Pick<ChamadoComPrazo, "prazo_conclusao_em" | "prazo_previsto">): string | null =>
  c.prazo_conclusao_em ? diaLocal(c.prazo_conclusao_em) : c.prazo_previsto ? diaLocal(c.prazo_previsto) : null;

/**
 * Outros chamados (do mesmo dev, ainda ativos — quem chama filtra) com prazo
 * no MESMO DIA. Só aviso: a tela mostra e deixa seguir.
 */
export function chamadosComMesmaData<T extends ChamadoComPrazo>(prazo: Date | null, outros: readonly T[], idAtual?: string): T[] {
  if (!prazo) return [];
  const dia = diaLocal(prazo);
  return outros.filter((c) => c.id !== idAtual && diaDoPrazo(c) === dia);
}

export type SituacaoDesenvolvimento = "na_fila" | "em_desenvolvimento" | null;

/**
 * Em andamento com início marcado = "Em desenvolvimento"; sem início =
 * "Na fila" (direcionado ao dev, que ainda não começou). Outros status: null.
 */
export function situacaoDesenvolvimento(
  c: { status: string; desenvolvimento_iniciado_em?: string | null },
): SituacaoDesenvolvimento {
  if (c.status === "em_andamento") return c.desenvolvimento_iniciado_em ? "em_desenvolvimento" : "na_fila";
  return null;
}

/** ESPELHA a RPC: iniciar só com chamado aberto/em andamento, com responsável, ainda não iniciado. */
export const podeIniciarDesenvolvimento = (
  c: { status: string; responsavel_id: string | null; desenvolvimento_iniciado_em?: string | null },
) => !c.desenvolvimento_iniciado_em && !!c.responsavel_id && (c.status === "aberto" || c.status === "em_andamento");

/** Prazo estourado: tem prazo, ainda não concluiu e já passou. */
export const prazoVencido = (
  c: { status: string; prazo_conclusao_em?: string | null }, agora = new Date(),
) => !!c.prazo_conclusao_em && !["concluido", "reprovado", "cancelado"].includes(c.status)
  && new Date(c.prazo_conclusao_em).getTime() < agora.getTime();
