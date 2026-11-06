// =====================================================================
// HORA EXTRA — horário de ponto do dia puxado da Senior (Pablo, 05/11/2026)
//
// "deixa o sistema puxar os pontos da senior de HOJE, vai preencher os 3
// primeiros pontos geralmente, a entrada, saída e retorno, não é regra, mas se
// tiver o sistema já puxa automatico, se não deixa preenchendo manualmente
// mesmo."
//
// DE ONDE VEM: as batidas já chegam na tela pela RPC hora_extra_ponto_mes (mig
// 20261104010000), a mesma do limite de 48h — [dia, minuto do dia] de
// espelho."BiMarcacoes", só da pessoa selecionada e com o mesmo gate. Não
// precisou de RPC nova.
//
// A REGRA
//   · Batidas do dia em ordem: 1ª Entrada, 2ª Saída (intervalo), 3ª Retorno,
//     4ª Saída. Com mais de quatro (pausa extra), a Saída é a última batida de
//     número par; com número ímpar a pessoa ainda está dentro, e a Saída fica
//     na 4ª.
//   · Campo sem batida fica como está (o horário da escala) — preenche à mão.
//   · Campo que o usuário editou não é mais tocado, nem trocando data ou
//     colaborador.
//   · Campo que veio da Senior e não tem batida na nova data/pessoa volta para
//     o horário da escala; senão ficaria a batida de outro dia na tela.
//
// NA CONCLUSÃO (Pablo, 06/11/2026): "quando eu concluir a H.E tem que puxar o
// ponto da senior também, corrigindo automaticamente, claro se não tiver
// ajustamos manualmente". Mesma regra, com três diferenças que só a conclusão
// tem, porque ali o dia já aconteceu:
//   · marcacoesDaJornada: a saída depois da meia-noite vem do dia seguinte, e a
//     saída da madrugada de ontem não vira a entrada de hoje.
//   · Dia marcado "sem intervalo": primeira batida é a Entrada e a última é a
//     Saída. Os campos do intervalo nem são editáveis nesse caso.
//   · Horário já salvo (HE devolvida para ajuste) conta como editado: alguém
//     conferiu aquele valor, então só muda se a pessoa pedir pelo botão.
//
// Lógica pura, testada em src/test/hora-extra-ponto-senior.test.ts.
// =====================================================================

import type { Batida } from "@/lib/gestaoPonto";
import { MINUTOS_POR_DIA, parseMinutos } from "@/lib/ponto";

export const CAMPOS_PONTO = [
  "ponto_entrada",
  "ponto_saida_intervalo",
  "ponto_retorno_intervalo",
  "ponto_saida",
] as const;
export type CampoPonto = (typeof CAMPOS_PONTO)[number];
export type ValoresPonto = Record<CampoPonto, string>;

export const ROTULO_CAMPO_PONTO: Record<CampoPonto, string> = {
  ponto_entrada: "Entrada",
  ponto_saida_intervalo: "Saída (intervalo)",
  ponto_retorno_intervalo: "Retorno",
  ponto_saida: "Saída",
};

const hhmm = (minutos: number) => {
  const m = ((minutos % MINUTOS_POR_DIA) + MINUTOS_POR_DIA) % MINUTOS_POR_DIA;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Batidas de uma data, em ordem e sem repetição (o relógio repete batida). */
export function marcacoesDoDia(batidas: Batida[] | null | undefined, data: string): string[] {
  const minutos = new Set<number>();
  for (const [dia, valor] of batidas ?? []) {
    if (String(dia).slice(0, 10) !== data) continue;
    const v = parseMinutos(valor);
    if (v != null) minutos.add(v);
  }
  return [...minutos].sort((a, b) => a - b).map(hhmm);
}

/** Até aqui, uma batida pode ser a saída da noite anterior. */
const FIM_DA_MADRUGADA = "06:00";

function diaVizinho(data: string, dias: number): string {
  const d = new Date(`${data.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * As batidas da jornada que começou nesta data. Número ímpar de batidas quer
 * dizer que a pessoa não saiu no mesmo dia: se a primeira do dia seguinte é de
 * madrugada, é a saída dela. Fora da madrugada é esquecimento, e a batida é a
 * entrada do outro dia. hora_extra_ponto_mes traz um dia a mais em cada ponta
 * do mês, então isto funciona na virada do mês também.
 */
export function marcacoesDaJornada(batidas: Batida[] | null | undefined, data: string): string[] {
  const deMadrugada = (hora: string | undefined) => hora != null && hora < FIM_DA_MADRUGADA;
  let marcacoes = marcacoesDoDia(batidas, data);
  if (marcacoesDoDia(batidas, diaVizinho(data, -1)).length % 2 === 1 && deMadrugada(marcacoes[0])) {
    marcacoes = marcacoes.slice(1);
  }
  if (marcacoes.length % 2 === 1) {
    const proxima = marcacoesDoDia(batidas, diaVizinho(data, 1))[0];
    if (deMadrugada(proxima)) marcacoes = [...marcacoes, proxima];
  }
  return marcacoes;
}

/** Qual batida vai em qual campo. Só aparecem os campos que têm batida. */
export function mapearMarcacoesNosCampos(marcacoes: string[], semIntervalo = false): Partial<ValoresPonto> {
  if (semIntervalo) {
    const r: Partial<ValoresPonto> = {};
    if (marcacoes.length) r.ponto_entrada = marcacoes[0];
    if (marcacoes.length > 1) r.ponto_saida = marcacoes[marcacoes.length - 1];
    return r;
  }
  const [entrada, saidaIntervalo, retorno] = marcacoes;
  const saida =
    marcacoes.length < 4
      ? undefined
      : marcacoes.length % 2 === 0
        ? marcacoes[marcacoes.length - 1]
        : marcacoes[3];
  const r: Partial<ValoresPonto> = {};
  if (entrada) r.ponto_entrada = entrada;
  if (saidaIntervalo) r.ponto_saida_intervalo = saidaIntervalo;
  if (retorno) r.ponto_retorno_intervalo = retorno;
  if (saida) r.ponto_saida = saida;
  return r;
}

export interface AplicarMarcacoesEntrada {
  /** O que está nos campos agora. */
  atual: ValoresPonto;
  /** Horário da escala: para onde volta um campo da Senior que perdeu a batida. */
  padrao: ValoresPonto;
  marcacoes: string[];
  /** Campos que o usuário mexeu à mão: nunca são sobrescritos. */
  editados: ReadonlySet<CampoPonto>;
  /** Campos que estão com valor vindo da Senior. */
  daSenior: ReadonlySet<CampoPonto>;
  /** Dia sem intervalo: só Entrada e Saída vêm das batidas. */
  semIntervalo?: boolean;
}

export function aplicarMarcacoesSenior({ atual, padrao, marcacoes, editados, daSenior, semIntervalo }: AplicarMarcacoesEntrada): {
  valores: ValoresPonto;
  daSenior: Set<CampoPonto>;
} {
  const mapa = mapearMarcacoesNosCampos(marcacoes, semIntervalo);
  const valores = { ...atual };
  const novos = new Set<CampoPonto>();
  for (const campo of CAMPOS_PONTO) {
    if (editados.has(campo)) continue;
    const batida = mapa[campo];
    if (batida) {
      valores[campo] = batida;
      novos.add(campo);
    } else if (daSenior.has(campo)) {
      valores[campo] = padrao[campo];
    }
  }
  return { valores, daSenior: novos };
}
