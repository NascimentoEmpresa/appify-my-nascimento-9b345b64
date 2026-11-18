/**
 * Indisponibilidade de veículo É UM PERÍODO, não um estado (SIS-2026-0930).
 *
 * O Patrimônio guarda a indisponibilidade em três colunas de `sup_patrimonio`:
 * `em_manutencao` (a chave), `data_inicio_manutencao` e `data_previsao_fim`.
 * Até 17/11/2026 a leitura delas ignorava a data de início: bastava a chave
 * ligada para o carro sumir da agenda até a previsão de fim — ou para sempre,
 * sem previsão. Resultado do chamado: o gestor marcou os carros indisponíveis
 * "de 13 a 17" para levar para lavar e ninguém mais conseguiu agendar NENHUM
 * dia, nem antes do dia 13.
 *
 * A leitura certa, e a que o banco faz igual em
 * `cs_veiculo_motivo_indisponivel()` / `cs_veic_checar_agendamento()`
 * (migration 20261118170000):
 *
 *   - o período vai de `data_inicio_manutencao` a `data_previsao_fim`,
 *     com as duas pontas INCLUÍDAS;
 *   - ponta vazia é ponta aberta: sem início = "desde sempre", sem fim =
 *     "por tempo indeterminado";
 *   - um agendamento só é recusado se o período DELE cruzar o período da
 *     indisponibilidade; fora disso o carro agenda normal;
 *   - "indisponível hoje" = hoje cai dentro do período.
 *
 * Datas sempre em ISO `AAAA-MM-DD`: a comparação de texto já é a de datas,
 * sem `new Date()` e sem o fuso trocando o dia.
 */

/** O recorte de `VeiculoFrota`/`Bem` que esta regra precisa. */
export interface VeiculoComIndisponibilidade {
  em_manutencao: boolean;
  motivo_indisponivel?: string | null;
  motivo_detalhe?: string | null;
  data_inicio_manutencao: string | null;
  data_previsao_fim: string | null;
}

export interface PeriodoIndisponivel {
  /** null = sem início (vale desde sempre). */
  inicio: string | null;
  /** null = sem previsão de fim (tempo indeterminado). */
  fim: string | null;
}

export interface Disponibilidade {
  /** Livre no período consultado (por padrão, hoje). */
  disponivel: boolean;
  /**
   * Dá para agendar o carro em ALGUMA data a partir de hoje. Só é false
   * quando a indisponibilidade já começou e não tem previsão de fim — aí
   * não existe data que funcione e o card não deve nem deixar escolher.
   */
  agendavel: boolean;
  rotulo: string;
  detalhe: string | null;
}

const SEMPRE_INICIO = "0000-01-01";
const SEMPRE_FIM = "9999-12-31";

/** Corta hora/fuso de um valor vindo do banco ("2026-11-13" ou "2026-11-13T00:00:00"). */
function soData(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t.slice(0, 10) : null;
}

/** O período em que o veículo não pode rodar, ou null se não há nenhum registrado. */
export function periodoIndisponivel(v: VeiculoComIndisponibilidade): PeriodoIndisponivel | null {
  if (!v.em_manutencao) return null;
  return { inicio: soData(v.data_inicio_manutencao), fim: soData(v.data_previsao_fim) };
}

/**
 * Dois períodos fechados se cruzam quando cada um começa antes de o outro
 * terminar (pontas incluídas). Ponta null = aberta.
 */
export function periodosSeCruzam(
  aInicio: string | null,
  aFim: string | null,
  bInicio: string | null,
  bFim: string | null,
): boolean {
  return (aInicio ?? SEMPRE_INICIO) <= (bFim ?? SEMPRE_FIM)
      && (bInicio ?? SEMPRE_INICIO) <= (aFim ?? SEMPRE_FIM);
}

/** O veículo está bloqueado em algum dia de [dataInicio, dataFim]? */
export function indisponivelNoPeriodo(
  v: VeiculoComIndisponibilidade,
  dataInicio: string,
  dataFim: string = dataInicio,
): boolean {
  const p = periodoIndisponivel(v);
  return !!p && periodosSeCruzam(p.inicio, p.fim, dataInicio, dataFim);
}

/** Status "pela data": indisponível NESTE dia (por padrão, hoje). */
export function indisponivelNoDia(v: VeiculoComIndisponibilidade, dia: string): boolean {
  return indisponivelNoPeriodo(v, dia, dia);
}

/** Primeiro dia em que o carro volta a ser agendável, ou null se não há previsão. */
export function liberadoAPartirDe(v: VeiculoComIndisponibilidade): string | null {
  const fim = periodoIndisponivel(v)?.fim;
  return fim ? somarDias(fim, 1) : null;
}

export function somarDias(isoData: string, dias: number): string {
  const [a, m, d] = isoData.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

export function dataBR(isoData: string): string {
  const [a, m, d] = isoData.split("-");
  return `${d}/${m}/${a}`;
}

/** "de 13/11/2026 a 17/11/2026", "até 17/11/2026", "a partir de 13/11/2026 (sem previsão de fim)"… */
export function descreverPeriodo(p: PeriodoIndisponivel): string {
  if (p.inicio && p.fim) {
    return p.inicio === p.fim ? `em ${dataBR(p.inicio)}` : `de ${dataBR(p.inicio)} a ${dataBR(p.fim)}`;
  }
  if (p.fim) return `até ${dataBR(p.fim)}`;
  if (p.inicio) return `a partir de ${dataBR(p.inicio)}, sem previsão de fim`;
  return "por tempo indeterminado";
}

/** "Em manutenção" / "Em contrato" / o texto escrito à mão. */
export function porqueIndisponivel(v: VeiculoComIndisponibilidade): string {
  // Registro antigo veio sem motivo gravado: era manutenção, o único que
  // existia antes de 17/08/2026.
  if (v.motivo_indisponivel === "contrato") return "Em contrato";
  if (v.motivo_indisponivel === "outro") return v.motivo_detalhe?.trim() || "Indisponível";
  return "Em manutenção";
}

/** Rótulo para um período que ainda vai começar: "Manutenção agendada", "Contrato agendado"… */
function porqueAgendado(v: VeiculoComIndisponibilidade): string {
  if (v.motivo_indisponivel === "contrato") return "Vai para contrato";
  if (v.motivo_indisponivel === "outro") return `Indisponível (${v.motivo_detalhe?.trim() || "outro motivo"})`;
  return "Manutenção agendada";
}

/**
 * A leitura que pinta o card, o Status Rápido e o calendário, e que trava o
 * passo de data. Consulta [dataInicio, dataFim] — por padrão, só `hoje`.
 *
 * Repete de propósito a regra do banco (a tela precisa pintar antes de ir ao
 * servidor); se as duas discordarem, o trigger ganha.
 */
export function disponibilidadeDoVeiculo(
  v: VeiculoComIndisponibilidade,
  hoje: string,
  dataInicio: string = hoje,
  dataFim: string = dataInicio,
): Disponibilidade {
  const p = periodoIndisponivel(v);
  if (!p) return { disponivel: true, agendavel: true, rotulo: "Livre", detalhe: null };

  const porque = porqueIndisponivel(v);
  // Só não há data possível quando o bloqueio já começou (ou começa hoje) e
  // não tem fim previsto. Sem início, "já começou".
  const agendavel = p.fim !== null || (p.inicio !== null && p.inicio > hoje);

  if (periodosSeCruzam(p.inicio, p.fim, dataInicio, dataFim)) {
    const sugestao = p.fim ? ` Agende a partir de ${dataBR(somarDias(p.fim, 1))}.` : "";
    return {
      disponivel: false,
      agendavel,
      rotulo: "Indisponível",
      detalhe: `${porque} ${descreverPeriodo(p)}.${sugestao}`,
    };
  }

  // Livre no período pedido. Ainda assim, avisa do bloqueio que existe.
  if (p.inicio && p.inicio > dataFim) {
    return {
      disponivel: true,
      agendavel,
      rotulo: "Livre",
      detalhe: `${porqueAgendado(v)} ${descreverPeriodo(p)}`,
    };
  }
  // Período já passou para a data consultada (o fim existe e é anterior).
  const comoVolta = v.motivo_indisponivel === "contrato" ? "Volta do contrato"
    : v.motivo_indisponivel === "outro" ? "Liberado" : "Retorna";
  return {
    disponivel: true,
    agendavel,
    rotulo: "Livre",
    detalhe: p.fim ? `${comoVolta} em ${dataBR(p.fim)}` : null,
  };
}

/**
 * O período registrado ainda importa a partir de `hoje`? (Serve para listar
 * "fora de operação" e para o calendário: período que já acabou não aparece.)
 */
export function periodoVigenteOuFuturo(v: VeiculoComIndisponibilidade, hoje: string): PeriodoIndisponivel | null {
  const p = periodoIndisponivel(v);
  if (!p) return null;
  if (p.fim && p.fim < hoje) return null;
  return p;
}
