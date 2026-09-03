// =====================================================================
// PONTO — minutos do dia ↔ hora legível
//
// POR QUE ESTE ARQUIVO EXISTE
//
// A tabela de marcações do relógio de ponto (`espelho."BiMarcacoes"`, espelho
// do MySQL da Hagg) NÃO guarda hora: guarda o MINUTO DO DIA em que a batida
// aconteceu. Um dia de trabalho comum chega assim:
//
//     420, 600, 615, 780
//
// que é 07:00, 10:00, 10:15 e 13:00. Nada na coluna diz isso — é convenção do
// relógio, e todo lugar que mostrar ponto para gente precisa desfazer a
// conversão. Fazer isso inline em cada tela é como nasce o bug de meia-noite
// (`24:00`), o de turno noturno (minuto 1500) e o de AM/PM às 12h.
//
// Então a regra mora AQUI, uma vez, com teste — e a tela só formata.
//
// AS TRÊS ARMADILHAS QUE ESTE ARQUIVO RESOLVE
//
//   1. TURNO QUE VIRA O DIA. O relógio não zera à meia-noite quando a jornada
//      atravessa: a saída de quem entrou 22:00 e saiu 02:00 vem como 1560
//      (26 × 60), não como 120. Tratar 1560 como "hora inválida" apaga a
//      batida; tratar como 1560 min = 26:00 imprime hora que não existe. O
//      certo é o resto por 1440 (→ 02:00) e marcar que caiu no dia seguinte.
//
//   2. MEIA-NOITE E MEIO-DIA NO AM/PM. Em 12 horas, 0h é "12:00 AM" e 12h é
//      "12:00 PM" — não "00:00 AM" nem "0:00 PM". É o erro clássico de
//      `h % 12` sem o `|| 12`.
//
//   3. LIXO NA COLUNA. Espelho de banco legado devolve null, string vazia,
//      texto e número quebrado. Nada disso pode derrubar a tela: vira null e
//      a tela mostra "—".
//
// O usuário pediu os dois formatos: 24h (`00:00`–`23:59`) e AM/PM. Os dois
// saem da MESMA normalização, para não divergirem.
// =====================================================================

/** Minutos em um dia. Toda a normalização gira em torno desta constante. */
export const MINUTOS_POR_DIA = 24 * 60;

/** Uma batida do relógio, já traduzida para hora de gente. */
export interface MarcacaoNormalizada {
  /** O valor cru que veio do banco, preservado para rastreio/conferência. */
  minutosOriginais: number;
  /** Minuto do dia já reduzido à faixa 0–1439. */
  minutosNoDia: number;
  /** Hora cheia, 0–23. */
  hora: number;
  /** Minuto, 0–59. */
  minuto: number;
  /**
   * Quantos dias o valor cru passou de 1440. Turno noturno que atravessa a
   * meia-noite vem com 1, e é isso que permite a tela escrever "(dia seguinte)"
   * em vez de mostrar uma saída "antes" da entrada.
   */
  diasAdiante: number;
  /** `07:00`, `13:00`, `00:00`. Sempre com dois dígitos nos dois lados. */
  hora24: string;
  /** `7:00 AM`, `1:00 PM`, `12:00 AM`. */
  hora12: string;
}

/**
 * Aceita o que o espelho realmente devolve — number, string numérica,
 * null/undefined, lixo — e responde com um número de minutos ou null.
 *
 * Rejeita explicitamente:
 *   • não-finito (NaN, Infinity), que `Number("")` e `Number("abc")` produzem;
 *   • negativo, que não tem leitura possível como minuto do dia;
 *   • string vazia ou só espaços, que `Number()` converteria para 0 — e 0 é
 *     uma batida VÁLIDA (meia-noite em ponto), então deixar passar
 *     transformaria célula vazia em "bateu ponto 00:00".
 */
export function parseMinutos(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "string" && valor.trim() === "") return null;
  const n = typeof valor === "number" ? valor : Number(String(valor).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

/**
 * Coração do arquivo: minuto do dia → hora, nos dois formatos.
 *
 * Devolve null (em vez de lançar) para valor inválido, porque a origem é um
 * espelho de banco legado: uma linha suja não pode derrubar a ficha inteira
 * de um colaborador.
 */
export function minutosParaHora(valor: unknown): MarcacaoNormalizada | null {
  const bruto = parseMinutos(valor);
  if (bruto === null) return null;

  const diasAdiante = Math.floor(bruto / MINUTOS_POR_DIA);
  const minutosNoDia = bruto % MINUTOS_POR_DIA;
  const hora = Math.floor(minutosNoDia / 60);
  const minuto = minutosNoDia % 60;

  const dd = (n: number) => String(n).padStart(2, "0");
  // 0h → 12 AM e 12h → 12 PM. O `|| 12` é o que salva as duas pontas.
  const h12 = hora % 12 || 12;
  const periodo = hora < 12 ? "AM" : "PM";

  return {
    minutosOriginais: bruto,
    minutosNoDia,
    hora,
    minuto,
    diasAdiante,
    hora24: `${dd(hora)}:${dd(minuto)}`,
    hora12: `${h12}:${dd(minuto)} ${periodo}`,
  };
}

/** `420` → `"07:00"`. Traço quando não dá para ler — nunca string vazia. */
export function formatarHora24(valor: unknown, vazio = "—"): string {
  return minutosParaHora(valor)?.hora24 ?? vazio;
}

/** `780` → `"1:00 PM"`. */
export function formatarHora12(valor: unknown, vazio = "—"): string {
  return minutosParaHora(valor)?.hora12 ?? vazio;
}

/**
 * O formato que a ficha mostra: `07:00 (7:00 AM)`.
 *
 * Os dois juntos porque o pedido foi explícito — quem confere ponto lê em 24h,
 * quem só olha de passagem lê em AM/PM.
 */
export function formatarHoraCompleta(valor: unknown, vazio = "—"): string {
  const m = minutosParaHora(valor);
  if (!m) return vazio;
  const sufixo = m.diasAdiante > 0 ? " (dia seguinte)" : "";
  return `${m.hora24} (${m.hora12})${sufixo}`;
}

/**
 * Ordena e limpa as batidas de UM dia.
 *
 * Ordenar pelo valor CRU, não pelo minuto normalizado: a saída 1560 (02:00 do
 * dia seguinte) tem que ficar DEPOIS da entrada 1320 (22:00). Normalizando
 * primeiro, 02:00 < 22:00 e o par de horas sairia negativo.
 *
 * Duplicata some: o relógio registra a mesma batida duas vezes quando o
 * colaborador passa o crachá de novo por não ter visto o beep.
 */
export function normalizarMarcacoesDoDia(valores: unknown[]): MarcacaoNormalizada[] {
  const vistos = new Set<number>();
  const out: MarcacaoNormalizada[] = [];
  for (const v of valores) {
    const m = minutosParaHora(v);
    if (!m || vistos.has(m.minutosOriginais)) continue;
    vistos.add(m.minutosOriginais);
    out.push(m);
  }
  return out.sort((a, b) => a.minutosOriginais - b.minutosOriginais);
}

/**
 * Soma as horas trabalhadas de um dia, em minutos.
 *
 * Batidas são pares entrada/saída: (1ª,2ª) é o turno da manhã, (3ª,4ª) o da
 * tarde. Um número ÍMPAR de batidas é o caso real de quem esqueceu de bater a
 * saída — a última fica sem par e é ignorada, não estimada. Inventar uma saída
 * aqui é inventar hora trabalhada, e essa conta vira folha de pagamento.
 */
export function minutosTrabalhadosNoDia(valores: unknown[]): number {
  const m = normalizarMarcacoesDoDia(valores);
  let total = 0;
  for (let i = 0; i + 1 < m.length; i += 2) {
    total += m[i + 1].minutosOriginais - m[i].minutosOriginais;
  }
  return total;
}

/** `510` → `"8h30"`. Formato de duração, não de relógio: pode passar de 24h. */
export function formatarDuracao(minutos: number, vazio = "—"): string {
  if (!Number.isFinite(minutos) || minutos <= 0) return vazio;
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** Marcações ímpares = alguém esqueceu de bater. A ficha sinaliza o dia. */
export function temBatidaIncompleta(valores: unknown[]): boolean {
  return normalizarMarcacoesDoDia(valores).length % 2 === 1;
}
