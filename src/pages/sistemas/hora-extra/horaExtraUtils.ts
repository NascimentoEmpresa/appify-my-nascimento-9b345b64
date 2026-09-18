import type {
  ChamadoHoraExtra,
  EscalaHoraExtra,
  PontoDia,
  SolicitacaoHoraExtra,
  StatusExecucao,
  StatusHoraExtra,
} from "./types";

export function mensagemErro(erro: unknown, fallback: string): string {
  // O Supabase nem sempre devolve um Error de verdade: dependendo da versão
  // do postgrest-js o erro vem como objeto simples com `message`. Sem este
  // segundo caminho a tela engolia o texto do banco (ex. "O chamado já foi
  // designado a outro usuário") e mostrava só a mensagem genérica.
  if (erro instanceof Error && erro.message) return erro.message;
  if (erro && typeof erro === "object") {
    const texto = (erro as { message?: unknown }).message;
    if (typeof texto === "string" && texto.trim()) return texto;
  }
  return fallback;
}

export function paraMinutos(horario?: string | null): number {
  if (!horario) return 0;
  const [horas, minutos] = horario.slice(0, 5).split(":").map(Number);
  return horas * 60 + minutos;
}

export function formatarDuracao(minutos?: number | null, curto = false): string {
  const total = Math.max(0, Math.round(Number(minutos) || 0));
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  return curto ? `${horas}h${String(resto).padStart(2, "0")}` : `${horas}h ${String(resto).padStart(2, "0")}min`;
}

export function dataLocalISO(data = new Date()): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

export function formatarQuantidadeChamados(quantidade: number): string {
  return `${quantidade} ${quantidade === 1 ? "chamado" : "chamados"}`;
}

export function totalHe(inicio?: string | null, fim?: string | null): number {
  if (!inicio || !fim) return 0;
  const a = paraMinutos(inicio);
  let b = paraMinutos(fim);
  if (b < a) b += 24 * 60;
  return b - a;
}

// ---------------------------------------------------------------------
// Cálculo da hora extra (16/09/2026)
//
// Hora extra não é mais a janela que o usuário digita: é o tempo que
// passou da jornada da escala de trabalho. A escala da empresa é
// 07:30-12:00-13:00-17:18, ou seja 8h48. Quem bate 08:00-12:00-13:00-19:30
// trabalhou 10h30 e tem 1h42 de HE, começando às 17:48. Quem bate
// 08:10-11:55-13:05-18:00 trabalhou 8h40 e não tem hora extra nenhuma.
// ---------------------------------------------------------------------

export const JORNADA_PADRAO_MIN = 528;

/** Minutos entre dois horários, virando o dia quando o fim é menor. */
export function minutosEntre(inicio?: string | null, fim?: string | null): number {
  return (((paraMinutos(fim) - paraMinutos(inicio)) % 1440) + 1440) % 1440;
}

export function minutosTrabalhados(ponto: PontoDia): number {
  return (
    minutosEntre(ponto.entrada, ponto.saida_intervalo) + minutosEntre(ponto.retorno_intervalo, ponto.saida)
  );
}

export function minutosJornada(escala?: Pick<EscalaHoraExtra, keyof PontoDia> | null): number {
  return escala ? minutosTrabalhados(escala) : JORNADA_PADRAO_MIN;
}

export function minutosParaHorario(minutos: number): string {
  const total = ((Math.round(minutos) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export interface CalculoHoraExtra {
  trabalhado: number;
  excedente: number;
  inicio: string;
  fim: string;
}

/**
 * Espelha `hora_extra_excedente` e `hora_extra_inicio` do banco. O início
 * é contado para trás a partir da saída; se o excedente for maior que o
 * turno da tarde, o que sobra veio da manhã.
 */
export function calcularHoraExtra(ponto: PontoDia, jornadaMinutos = JORNADA_PADRAO_MIN): CalculoHoraExtra {
  const trabalhado = minutosTrabalhados(ponto);
  const excedente = Math.max(0, trabalhado - Math.max(0, jornadaMinutos || 0));
  const tarde = minutosEntre(ponto.retorno_intervalo, ponto.saida);
  const inicio =
    excedente <= 0
      ? ponto.saida
      : excedente <= tarde
        ? minutosParaHorario(paraMinutos(ponto.saida) - excedente)
        : minutosParaHorario(paraMinutos(ponto.saida_intervalo) - (excedente - tarde));
  return { trabalhado, excedente, inicio, fim: ponto.saida };
}

export interface DadosValidacaoSolicitacao {
  chamados: Array<{ percentual_previsto: number | string | null }>;
  ponto: PontoDia;
  jornadaMinutos: number;
}

const ERRO_PERCENTUAL = "A expectativa de conclusão de cada chamado deve ficar entre 0% e 100%.";

function erroSemHoraExtra(trabalhado: number, jornadaMinutos: number): string {
  return (
    `Os horários informados somam ${formatarDuracao(trabalhado, true)}, ` +
    `dentro da jornada de ${formatarDuracao(jornadaMinutos, true)}. Não há hora extra.`
  );
}

export function validarSolicitacao(dados: DadosValidacaoSolicitacao): string[] {
  const erros: string[] = [];
  if (!dados.chamados.length) erros.push("Adicione pelo menos um chamado.");
  const forade = dados.chamados.some((chamado) => {
    const valor = Number(chamado.percentual_previsto);
    return !Number.isFinite(valor) || valor < 0 || valor > 100;
  });
  if (forade) erros.push(ERRO_PERCENTUAL);
  const calculo = calcularHoraExtra(dados.ponto, dados.jornadaMinutos);
  if (calculo.excedente <= 0) erros.push(erroSemHoraExtra(calculo.trabalhado, dados.jornadaMinutos));
  return erros;
}

export function validarConclusao(ponto: PontoDia, jornadaMinutos: number): string[] {
  const calculo = calcularHoraExtra(ponto, jornadaMinutos);
  return calculo.excedente <= 0 ? [erroSemHoraExtra(calculo.trabalhado, jornadaMinutos)] : [];
}

export function sobrepoe(inicioA: string, fimA: string, inicioB: string, fimB: string): boolean {
  const normalizar = (inicio: string, fim: string) => {
    const a = paraMinutos(inicio);
    let b = paraMinutos(fim);
    if (b <= a) b += 1440;
    return [a, b] as const;
  };
  const [a1, a2] = normalizar(inicioA, fimA);
  const [b1, b2] = normalizar(inicioB, fimB);
  return a1 < b2 && b1 < a2;
}

function dataLocal(data: string): Date {
  return new Date(`${data.slice(0, 10)}T12:00:00`);
}

export function statusExibicao(
  status: StatusHoraExtra,
  dataHe: string,
  hoje = new Date(),
): { label: string; classe: string; icone: "ampulheta" | "check" | "relogio" | "x" } {
  if (status === "aguardando_liberacao")
    return { label: "Aguardando liberação", classe: "bg-amber-100 text-amber-700", icone: "ampulheta" };
  if (status === "reprovada") return { label: "Reprovada", classe: "bg-red-100 text-red-700", icone: "x" };
  if (status === "concluida") return { label: "Concluída", classe: "bg-emerald-100 text-emerald-700", icone: "check" };
  const limite = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  if (status === "aprovada" && dataLocal(dataHe) < limite)
    return { label: "Pendente de conclusão", classe: "bg-blue-100 text-blue-700", icone: "relogio" };
  return { label: "Aprovada para execução", classe: "bg-emerald-100 text-emerald-700", icone: "check" };
}

export function conclusaoExibicao(
  status: StatusHoraExtra,
  dataHe?: string,
  hoje = new Date(),
): { label: string; classe: string } {
  if (status === "aguardando_validacao")
    return { label: "Enviada para validação", classe: "bg-blue-100 text-blue-700" };
  if (status === "concluida") return { label: "Finalizada", classe: "bg-emerald-100 text-emerald-700" };
  if (status === "aprovada") {
    const limite = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    if (dataHe && dataLocal(dataHe) >= limite) return { label: "Não iniciada", classe: "bg-red-100 text-red-700" };
    return { label: "Pendente de preenchimento", classe: "bg-amber-100 text-amber-700" };
  }
  return { label: "Não iniciada", classe: "bg-red-100 text-red-700" };
}

/** Campo de porcentagem: nunca sai de 0 a 100, nem por digitação. */
export function limitarPercentual(valor: number | string): number {
  const numero = Math.round(Number(valor));
  if (!Number.isFinite(numero)) return 0;
  return Math.min(100, Math.max(0, numero));
}

export function statusExecucaoPorPercentual(percentual: number): StatusExecucao {
  if (percentual >= 100) return "concluido";
  if (percentual <= 0) return "nao_iniciado";
  return "parcial";
}

export function mediaConclusao(valores: Array<number | null | undefined>): number {
  if (!valores.length) return 0;
  return Math.round(valores.reduce((soma, valor) => soma + Number(valor || 0), 0) / valores.length);
}

export function diaSemana(data: string): string {
  const nome = new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(dataLocal(data));
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

export function formatarData(data?: string | null): string {
  if (!data) return "—";
  return new Intl.DateTimeFormat("pt-BR").format(dataLocal(data));
}

export function formatarDataHora(data?: string | null): string {
  if (!data) return "—";
  // Data e hora em dois formatadores de propósito: `dateStyle` não pode ser
  // combinado com `hour`/`minute` — o navegador lança "Invalid option : option"
  // e derrubou a tela inteira de Hora Extra em produção (15/09/2026).
  const valor = new Date(data);
  const dia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(valor);
  const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(valor);
  return `${dia} ${hora}`;
}

export function somenteHora(valor?: string | null): string {
  return valor ? valor.slice(0, 5) : "—";
}

/**
 * Quem pode editar a solicitação: o próprio dono, com a ação "alterar", e
 * somente enquanto a HE ainda não foi liberada. A reprovada entra na regra
 * porque salvar de novo a devolve para a fila de liberação — antes o único
 * caminho era excluir e digitar tudo outra vez.
 */
export function podeEditarHoraExtra(entrada: {
  status: string;
  ehDono: boolean;
  podeAlterar: boolean;
}): boolean {
  return (
    entrada.podeAlterar && entrada.ehDono && ["aguardando_liberacao", "reprovada"].includes(entrada.status)
  );
}

/**
 * Nas etapas de liberação e validação o gestor pode corrigir o ponto de outra
 * pessoa antes de aprovar. A ação `alterar` continua sendo a chave: as RPCs
 * também exigem `aprovar`, mas esse segundo requisito já é o que permite abrir
 * a análise.
 */
export function podeAlterarHorariosNaLiberacao(entrada: { status: string; podeAlterar: boolean }): boolean {
  return entrada.podeAlterar && ["aguardando_liberacao", "aguardando_validacao"].includes(entrada.status);
}

/** Em que etapa o arquivo foi anexado, para a lista de anexos. */
export function rotuloFaseAnexo(fase: string): string {
  return fase === "conclusao" ? "Conclusão" : "Solicitação";
}

export function linhasExcel(solicitacoes: SolicitacaoHoraExtra[]) {
  return solicitacoes.flatMap((solicitacao) => {
    const chamados = solicitacao.chamados?.length ? solicitacao.chamados : [null];
    return chamados.map((chamado: ChamadoHoraExtra | null) => ({
      "ID da HE": solicitacao.numero,
      Colaborador: solicitacao.colaborador_nome,
      Cargo: solicitacao.colaborador_cargo ?? "",
      Setor: solicitacao.setor ?? "",
      Empresa: solicitacao.empresa ?? "",
      "Data da HE": formatarData(solicitacao.data_he),
      "Tipo de HE": solicitacao.tipo === "emergencial" ? "Emergencial" : "Normal",
      "Horário previsto": `${somenteHora(solicitacao.he_inicio_previsto)} - ${somenteHora(solicitacao.he_fim_previsto)}`,
      "Total previsto": formatarDuracao(solicitacao.total_previsto_min, true),
      "Total real": solicitacao.total_real_min == null ? "" : formatarDuracao(solicitacao.total_real_min, true),
      Status: statusExibicao(solicitacao.status, solicitacao.data_he).label,
      Chamado: chamado?.chamado_numero ?? "",
      "Assunto do chamado": chamado?.chamado_assunto ?? "",
      Adicional: chamado?.adicional ? "Sim" : "Não",
      "Percentual previsto": chamado?.percentual_previsto ?? "",
      "Percentual concluído": chamado?.percentual_concluido ?? "",
    }));
  });
}
