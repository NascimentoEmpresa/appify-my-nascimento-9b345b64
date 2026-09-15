import type { ChamadoHoraExtra, SolicitacaoHoraExtra, StatusExecucao, StatusHoraExtra } from "./types";

export function mensagemErro(erro: unknown, fallback: string): string {
  return erro instanceof Error ? erro.message : fallback;
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

export interface DadosValidacaoSolicitacao {
  chamados: Array<{ percentual_previsto: number | string | null }>;
  ponto_entrada: string;
  ponto_saida: string;
  he_inicio_previsto: string;
  he_fim_previsto: string;
}

export interface HorariosConclusao {
  he_inicio_real: string;
  he_fim_real: string;
}

const ERRO_HORARIOS_IGUAIS = "O início e o término da HE não podem ser iguais.";

export function validarSolicitacao(dados: DadosValidacaoSolicitacao): string[] {
  const erros: string[] = [];
  if (!dados.chamados.length) erros.push("Adicione pelo menos um chamado.");
  const soma = dados.chamados.reduce((total, chamado) => total + Number(chamado.percentual_previsto || 0), 0);
  if (dados.chamados.length && soma !== 100) erros.push("A expectativa de conclusão deve totalizar 100%.");
  const inicioHe = paraMinutos(dados.he_inicio_previsto);
  const fimHe = paraMinutos(dados.he_fim_previsto);
  const entrada = paraMinutos(dados.ponto_entrada);
  const saida = paraMinutos(dados.ponto_saida);
  if (inicioHe === fimHe) erros.push(ERRO_HORARIOS_IGUAIS);
  if (!(inicioHe >= saida || fimHe <= entrada)) erros.push("O horário da HE deve ficar fora da jornada informada.");
  return erros;
}

export function validarConclusao(horarios: HorariosConclusao): string[] {
  return paraMinutos(horarios.he_inicio_real) === paraMinutos(horarios.he_fim_real) ? [ERRO_HORARIOS_IGUAIS] : [];
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
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", hour: "2-digit", minute: "2-digit" }).format(
    new Date(data),
  );
}

export function somenteHora(valor?: string | null): string {
  return valor ? valor.slice(0, 5) : "—";
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
