// =====================================================================
// COMITÊ DE ÉTICA — derivação dos indicadores
//
// Nada aqui é coluna no banco, de propósito. "Dias de conclusão", "dentro do
// SLA" e "reincidente" gravados viram mentira no dia seguinte: o SLA muda, um
// caso novo entra e a reincidência de ontem deixa de valer. Derivar na
// leitura custa nada no volume de um comitê e nunca desatualiza.
//
// A ficha (Denuncias.tsx) e o painel (Indicadores.tsx) usam as MESMAS funções
// — senão a lista diz "no prazo" e o painel conta como vencida.
// =====================================================================

import { SITUACOES_CONCLUIDAS, MEDIDAS_DISCIPLINARES, CAUSAS_SISTEMICAS } from "./vocabulario";

export interface Denuncia {
  id: string; protocolo: string; identificado: boolean;
  nome_completo: string | null; cpf: string | null; email: string | null;
  data_nascimento: string | null; telefone_fixo: string | null; celular: string | null;
  relacao: string; tipo_denuncia: string; local_ocorrencia: string | null; como_soube: string;
  lideranca_ciente: string | null; lideranca_envolvida: string | null; lideranca_ocultou: string | null;
  lideranca_ciente_quem: string | null; lideranca_envolvida_quem: string | null; lideranca_ocultou_quem: string | null;
  /** Assunto dado pelo comitê (o relato em si continua imutável). */
  titulo: string | null;
  descricao: string; testemunhas: string | null; evidencias: string | null;
  valor_financeiro: string | null; sugestao: string | null;

  // Ficha de apuração (migration 20260901000003)
  origem: string | null; tipo_classificado: string | null;
  gravidade: string | null; sigilo: string | null;
  denunciado_nome: string | null; denunciado_empregado_id: number | null;
  lider_nome: string | null; lider_empregado_id: number | null;
  diretoria: string | null; contrato: string | null; setor: string | null;
  unidade: string | null; cidade: string | null;
  apuracao_responsavel: string | null; apuracao_inicio: string | null; apuracao_fim: string | null;
  primeira_providencia_em: string | null;
  resultado: string | null; medidas: string[] | null;
  houve_recurso: boolean | null; recurso_resultado: string | null; recurso_data: string | null;
  causa_raiz: string | null; causa_raiz_detalhe: string | null;
  acoes_preventivas: string | null; acoes_corretivas: string | null;
  sla_dias_override: number | null;

  status: string; parecer_interno: string | null; retorno_denunciante: string | null;
  concluido_em: string | null; created_at: string; updated_at: string;
}

export interface RegraSla {
  gravidade: string; dias: number; dias_primeira_providencia: number;
}

/** SLA usado quando a gravidade ainda não foi classificada. */
const SLA_PADRAO = { dias: 30, dias_primeira_providencia: 3 };

const DIA = 86_400_000;

/** Dias corridos entre duas datas, arredondando para baixo. */
export const diasEntre = (de: string | Date, ate: string | Date): number => {
  const a = new Date(de).getTime(), b = new Date(ate).getTime();
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.floor((b - a) / DIA);
};

export const concluida = (d: Denuncia) => SITUACOES_CONCLUIDAS.includes(d.status);

/** O tipo que vale no indicador é o do comitê; o do denunciante é o palpite. */
export const tipoEfetivo = (d: Denuncia) => d.tipo_classificado || d.tipo_denuncia;

/** Regra de prazo deste caso: override do caso > SLA da gravidade > padrão. */
export function regraDe(d: Denuncia, slas: RegraSla[]) {
  const r = slas.find((s) => s.gravidade === d.gravidade);
  return {
    dias: d.sla_dias_override ?? r?.dias ?? SLA_PADRAO.dias,
    diasPrimeira: r?.dias_primeira_providencia ?? SLA_PADRAO.dias_primeira_providencia,
  };
}

/**
 * Dias que o caso levou (concluído) ou já leva (em aberto). O caso aberto
 * conta até hoje — é o que faz um processo esquecido aparecer como vencido
 * em vez de sumir da conta por não ter data de fim.
 */
export const diasDeTratamento = (d: Denuncia, hoje: Date = new Date()) =>
  diasEntre(d.created_at, concluida(d) ? (d.concluido_em ?? d.updated_at) : hoje);

/** Dias até a primeira providência; null enquanto não houve nenhuma. */
export const diasAtePrimeiraProvidencia = (d: Denuncia) =>
  d.primeira_providencia_em ? diasEntre(d.created_at, d.primeira_providencia_em) : null;

/** true/false para caso concluído; null para quem ainda está correndo. */
export function dentroDoSla(d: Denuncia, slas: RegraSla[]): boolean | null {
  if (!concluida(d)) return null;
  return diasDeTratamento(d) <= regraDe(d, slas).dias;
}

/** Em aberto e já passou do prazo — é a fila que a dona quer ver primeiro. */
export function vencida(d: Denuncia, slas: RegraSla[], hoje: Date = new Date()): boolean {
  if (concluida(d)) return false;
  return diasDeTratamento(d, hoje) > regraDe(d, slas).dias;
}

/** Dias que faltam para vencer (negativo = já venceu). Null se concluída. */
export function diasRestantes(d: Denuncia, slas: RegraSla[], hoje: Date = new Date()): number | null {
  if (concluida(d)) return null;
  return regraDe(d, slas).dias - diasDeTratamento(d, hoje);
}

export const temMedidaDisciplinar = (d: Denuncia) =>
  (d.medidas ?? []).some((m) => MEDIDAS_DISCIPLINARES.includes(m));

export const gerouTreinamento = (d: Denuncia) => (d.medidas ?? []).includes("treinamento");

export const causaSistemica = (d: Denuncia) =>
  !!d.causa_raiz && CAUSAS_SISTEMICAS.includes(d.causa_raiz);

/** Procedente no todo ou em parte — o que conta como "confirmada". */
export const procedente = (d: Denuncia) =>
  d.resultado === "procedente" || d.resultado === "parcialmente_procedente";

// ---------------------------------------------------------------- agregação

export interface Contagem { chave: string; label: string; total: number; }

/**
 * Conta por uma chave qualquer. Quem não tem o campo preenchido cai em
 * "Não informado" em vez de sumir — indicador que esconde o buraco do
 * cadastro é pior do que indicador nenhum.
 */
export function contarPor(
  itens: Denuncia[],
  chave: (d: Denuncia) => string | null | undefined,
  rotulo: (k: string) => string = (k) => k,
): Contagem[] {
  const m = new Map<string, number>();
  itens.forEach((d) => {
    const k = (chave(d) ?? "").toString().trim() || "__vazio__";
    m.set(k, (m.get(k) ?? 0) + 1);
  });
  return [...m.entries()]
    .map(([chave, total]) => ({
      chave,
      label: chave === "__vazio__" ? "Não informado" : rotulo(chave),
      total,
    }))
    .sort((a, b) => b.total - a.total);
}

/** Série mensal contínua: mês sem denúncia entra com zero, senão a linha
 *  de tendência "pula" o mês vazio e sugere queda que não houve. */
export function serieMensal(itens: Denuncia[], meses = 12): { mes: string; label: string; total: number }[] {
  const hoje = new Date();
  const saida: { mes: string; label: string; total: number }[] = [];
  const contagem = new Map<string, number>();
  itens.forEach((d) => {
    const k = String(d.created_at).slice(0, 7);
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
  });
  for (let i = meses - 1; i >= 0; i--) {
    const dt = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    saida.push({
      mes: k,
      label: dt.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
      total: contagem.get(k) ?? 0,
    });
  }
  return saida;
}

export interface Reincidencia {
  chave: string; label: string; total: number;
  procedentes: number;
  /** Casos que entraram DEPOIS de uma medida já aplicada a esta mesma chave. */
  aposMedida: number;
  ultima: string;
}

/**
 * Reincidência: quem aparece em mais de um caso. `aposMedida` é o número que
 * responde "as medidas estão sendo eficazes" — conta só os casos abertos
 * DEPOIS da conclusão de um caso anterior que aplicou medida disciplinar.
 */
export function reincidencias(
  itens: Denuncia[],
  chave: (d: Denuncia) => string | null | undefined,
  rotulo: (d: Denuncia) => string,
): Reincidencia[] {
  const grupos = new Map<string, Denuncia[]>();
  itens.forEach((d) => {
    const k = (chave(d) ?? "").toString().trim();
    if (!k) return;                       // sem identificação não há reincidência a apurar
    grupos.set(k, [...(grupos.get(k) ?? []), d]);
  });

  return [...grupos.entries()]
    .filter(([, ds]) => ds.length > 1)
    .map(([k, ds]) => {
      const ordenados = [...ds].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
      // Marco: fim do primeiro caso que aplicou medida disciplinar.
      const comMedida = ordenados.filter((d) => temMedidaDisciplinar(d) && concluida(d));
      const marco = comMedida.length
        ? new Date(comMedida[0].concluido_em ?? comMedida[0].updated_at).getTime()
        : null;
      return {
        chave: k,
        label: rotulo(ordenados[ordenados.length - 1]),
        total: ds.length,
        procedentes: ds.filter(procedente).length,
        aposMedida: marco === null ? 0 : ds.filter((d) => +new Date(d.created_at) > marco).length,
        ultima: ordenados[ordenados.length - 1].created_at,
      };
    })
    .sort((a, b) => b.total - a.total || b.procedentes - a.procedentes);
}

export interface Antecedente { rotulo: string; total: number; procedentes: number; }

/**
 * Ocorrências ANTERIORES ligadas a este caso — por pessoa, líder, setor e
 * contrato. É a reincidência vista de dentro do processo: quem abre a ficha
 * precisa saber, ali, que o denunciado já respondeu a outros casos.
 *
 * Conta só o que veio antes: um caso posterior não é antecedente deste.
 */
export function antecedentesDe(d: Denuncia, todas: Denuncia[]): Antecedente[] {
  const antes = todas.filter((o) => o.id !== d.id && new Date(o.created_at) < new Date(d.created_at));
  const resumo = (rotulo: string, filtro: (o: Denuncia) => boolean): Antecedente | null => {
    const hits = antes.filter(filtro);
    return hits.length ? { rotulo, total: hits.length, procedentes: hits.filter(procedente).length } : null;
  };
  const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

  return [
    // Pessoa só por id do RH: por nome digitado, duas grafias viram duas
    // pessoas e a reincidência real passa despercebida.
    d.denunciado_empregado_id
      ? resumo("Este denunciado", (o) => o.denunciado_empregado_id === d.denunciado_empregado_id) : null,
    d.lider_empregado_id
      ? resumo("Este líder", (o) => o.lider_empregado_id === d.lider_empregado_id) : null,
    norm(d.setor)
      ? resumo("Este setor", (o) => norm(o.setor) === norm(d.setor)) : null,
    norm(d.contrato)
      ? resumo("Este contrato", (o) => norm(o.contrato) === norm(d.contrato)) : null,
  ].filter((x): x is Antecedente => x !== null);
}

/** Média que devolve null em vez de NaN quando não há amostra. */
export function media(ns: number[]): number | null {
  if (!ns.length) return null;
  return ns.reduce((s, n) => s + n, 0) / ns.length;
}

export const pct = (parte: number, total: number): number | null =>
  total === 0 ? null : (parte / total) * 100;

export const fmtPct = (v: number | null, casas = 0) =>
  v === null ? "—" : `${v.toFixed(casas)}%`;

export const fmtDias = (v: number | null, casas = 1) =>
  v === null ? "—" : `${v.toFixed(casas)} d`;
