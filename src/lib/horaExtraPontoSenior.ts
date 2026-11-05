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

/** Qual batida vai em qual campo. Só aparecem os campos que têm batida. */
export function mapearMarcacoesNosCampos(marcacoes: string[]): Partial<ValoresPonto> {
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
}

export function aplicarMarcacoesSenior({ atual, padrao, marcacoes, editados, daSenior }: AplicarMarcacoesEntrada): {
  valores: ValoresPonto;
  daSenior: Set<CampoPonto>;
} {
  const mapa = mapearMarcacoesNosCampos(marcacoes);
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
