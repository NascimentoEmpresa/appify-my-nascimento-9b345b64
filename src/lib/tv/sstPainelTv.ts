// =====================================================================
// TV › SST — painel gerencial automático (SIS-2026-0816, mig 20261121110000)
//
// Os 4 blocos que o SST pediu, girando dentro do item 'sst-painel' da
// playlist "TV SST": Treinamentos (NR + online + turmas), ASOs, Afastamentos
// e atestados, Acidentes. As contas moram no banco (tv_sst_painel_dados);
// aqui ficam o tom de cada número e as séries dos gráficos. Testado em
// src/test/tv-sst-painel.test.ts.
// =====================================================================

import type { TipoAso } from "@/lib/sst/asoHistorico";
import type { OnlineResumo } from "@/lib/sst/treinamentosNr";

export interface DadosSstPainelTv {
  treinamentos: {
    nr: { total: number; em_dia: number; proximos: number; vencidos: number; pendentes: number; contratos: number;
          por_contrato: { contrato: string; total: number; vencidos: number; pendentes: number; proximos: number }[] };
    online: OnlineResumo;
    turmas: { realizadas_ano: number; participantes_ano: number; previstas_30d: number;
              proxima: { data: string; contrato: string; nrs: string | null } | null;
              mensal: { mes: string; turmas: number; participantes: number }[] };
  };
  asos: {
    ano: { total: number; por_tipo: Partial<Record<TipoAso, number>> };
    mes: number;
    mes_anterior: number;
    mensal: ({ mes: string } & Record<TipoAso, number>)[];
    pendentes: { admissional: number; demissional: number; troca_funcao: number; retorno: number; periodico: number };
    periodicos: { realizados_ano: number; vencidos: number; proximos: number; aguardando: number; agendados: number; em_dia: number; afastados: number; dias_aviso: number };
  };
  afastamentos: {
    ativos: number; auxilio_doenca: number; licenca_maternidade: number; acidente_trabalho: number;
    retornos_30d: number; retorno_atrasado: number;
    por_motivo: { motivo: string; qtd: number }[];
    retornos_semanas: { de: string; qtd: number }[];
    atestados: {
      mes: { qtd: number; dias: number }; mes_anterior: { qtd: number; dias: number }; ano: { qtd: number; dias: number };
      mensal: { mes: string; qtd: number; dias: number }[];
    };
  };
  acidentes: {
    ano: { total: number; tipicos: number; trajeto: number; nao_informado: number; com_afastamento: number; dias_afastamento: number; com_cat: number };
    mes: number;
    ano_anterior: number;
    dias_sem_acidente: number | null;
    mensal: { mes: string; tipicos: number; trajeto: number; nao_informado: number; acumulado: number }[];
  };
  gerado_em?: string;
}

export const PAGINAS_SST = [
  { chave: "treinamentos", titulo: "Treinamentos obrigatórios" },
  { chave: "asos", titulo: "ASOs" },
  { chave: "afastamentos", titulo: "Afastamentos e atestados" },
  { chave: "acidentes", titulo: "Acidentes de trabalho" },
] as const;
export type PaginaSst = (typeof PAGINAS_SST)[number]["chave"];

/** Cada bloco fica 20 s; o item da playlist tem 80 s (os 4 blocos uma vez). */
export const SEGUNDOS_POR_PAGINA_SST = 20;

export type Tom = "bom" | "atencao" | "critico" | "neutro";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "2026-11" → "nov/26". */
export const rotuloMes = (ym: string): string => `${MESES[Number(ym.slice(5, 7)) - 1] ?? "?"}/${ym.slice(2, 4)}`;

export const pctDe = (parte: number, total: number): number | null => (total > 0 ? Math.round((100 * parte) / total) : null);

/** Variação do mês contra o anterior, em % (null sem base). */
export const variacao = (atual: number, anterior: number): number | null =>
  anterior > 0 ? Math.round((100 * (atual - anterior)) / anterior) : null;

/** Zero é bom; até `atencao` é atenção; acima, crítico. */
export const tomContagem = (n: number, atencao = 0): Tom => (n <= 0 ? "bom" : n <= atencao ? "atencao" : "critico");

/** % concluído: ≥ 90 bom, ≥ 70 atenção. Sem obrigatório, neutro. */
export const tomPct = (p: number | null): Tom => (p == null ? "neutro" : p >= 90 ? "bom" : p >= 70 ? "atencao" : "critico");

/** As séries mensais no formato do GraficoMensal (rótulo + total para o número no topo da pilha). */
export function serieAsos(m: DadosSstPainelTv["asos"]["mensal"]) {
  return m.map((x) => ({
    rotulo: rotuloMes(x.mes), admissional: x.admissional, periodico: x.periodico, retorno: x.retorno, troca_funcao: x.troca_funcao,
    demissional: x.demissional, __total: x.admissional + x.periodico + x.retorno + x.troca_funcao + x.demissional,
  }));
}
export const serieAtestados = (m: DadosSstPainelTv["afastamentos"]["atestados"]["mensal"]) =>
  m.map((x) => ({ rotulo: rotuloMes(x.mes), qtd: x.qtd, dias: x.dias }));
export const serieAcidentes = (m: DadosSstPainelTv["acidentes"]["mensal"]) =>
  m.map((x) => ({ rotulo: rotuloMes(x.mes), tipicos: x.tipicos, trajeto: x.trajeto, nao_informado: x.nao_informado,
                  __total: x.tipicos + x.trajeto + x.nao_informado, acumulado: x.acumulado }));
export const serieTurmas = (m: DadosSstPainelTv["treinamentos"]["turmas"]["mensal"]) =>
  m.map((x) => ({ rotulo: rotuloMes(x.mes), turmas: x.turmas, participantes: x.participantes }));

/** O total de pendências de ASO que o SST tem para agir (periódico = vencidos + aguardando agendamento). */
export const totalPendentesAso = (p: DadosSstPainelTv["asos"]["pendentes"]): number =>
  p.admissional + p.demissional + p.troca_funcao + p.retorno + p.periodico;

/** "Onde agir" de cada bloco: só o que tem número. */
export function alertas(d: DadosSstPainelTv): Record<PaginaSst, { texto: string; valor: number }[]> {
  const so = (l: { texto: string; valor: number }[]) => l.filter((x) => x.valor > 0);
  return {
    treinamentos: so([
      { texto: "Treinamentos NR vencidos", valor: d.treinamentos.nr.vencidos },
      { texto: "Obrigatórios sem nenhum registro", valor: d.treinamentos.nr.pendentes },
      { texto: "Vencem nos próximos 30 dias", valor: d.treinamentos.nr.proximos },
      { texto: "Cursos online pendentes (pessoa × curso)", valor: d.treinamentos.online.pendentes },
    ]),
    asos: so([
      { texto: "Periódicos vencidos", valor: d.asos.periodicos.vencidos },
      { texto: "Periódicos aguardando agendamento", valor: d.asos.periodicos.aguardando },
      { texto: "Admissionais pendentes", valor: d.asos.pendentes.admissional },
      { texto: "Demissionais pendentes", valor: d.asos.pendentes.demissional },
      { texto: "Mudança de função aguardando ASO", valor: d.asos.pendentes.troca_funcao },
      { texto: "Retornos aguardando ASO", valor: d.asos.pendentes.retorno },
    ]),
    afastamentos: so([
      { texto: "Retorno previsto já passou", valor: d.afastamentos.retorno_atrasado },
      { texto: "Retornos nos próximos 30 dias", valor: d.afastamentos.retornos_30d },
    ]),
    acidentes: so([
      { texto: "Acidentes no mês", valor: d.acidentes.mes },
      { texto: "Com afastamento no ano", valor: d.acidentes.ano.com_afastamento },
    ]),
  };
}
