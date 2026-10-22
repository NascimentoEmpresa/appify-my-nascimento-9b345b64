import type { PrazoPagamentoModo, PrazoPagamentoUnidade } from "@/hooks/useMaloteConfig";

// Exemplos em linguagem do dia a dia para as Regras Gerais do Malote (Configurações), sempre com a DATA DE HOJE: o "No dia de hoje" e o
// "Em até N dias" ficavam confusos sem uma data concreta. As contas seguem malote_prazo_normal_inclusao (migration 20260930000010): passou do
// horário 1.1, hoje deixa de ser a base e a base vira o dia seguinte; "dias úteis" pula fim de semana e dias bloqueados.

export type NumeroPrazo = "1.1" | "1.2";

export interface ExemploPrazoArgs {
  numero: NumeroPrazo;
  /** Qual situação exemplificar: a opção "No dia de hoje" ou a "Em até N dias". */
  modo: PrazoPagamentoModo;
  horario: string;
  dias: number;
  unidade: PrazoPagamentoUnidade;
  hoje: Date;
  /** dia bloqueado (fim de semana bloqueado, feriado, recesso…) — conta como não útil */
  bloqueado: (d: Date) => boolean;
  /** só no 1.2: o reagendamento automático das despesas paradas está ligado? */
  reagendamentoAtivo?: boolean;
}

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function soData(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function somarDias(d: Date, n: number): Date {
  const r = soData(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** "22/10 (qui)" */
export function rotuloDia(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm} (${DIAS_SEMANA[d.getDay()]})`;
}

/** "12:00" → "12:00"; vazio vira "—" para a frase não ficar quebrada. */
function rotuloHorario(h: string): string {
  return /^\d{2}:\d{2}/.test(h) ? h.slice(0, 5) : "—";
}

export function proximoDiaUtil(d: Date, bloqueado: (x: Date) => boolean): Date {
  let r = somarDias(d, 1);
  for (let i = 0; i < 60 && bloqueado(r); i++) r = somarDias(r, 1);
  return r;
}

/** base + N dias (corridos ou úteis), como a função do banco: o dia da base não conta, o primeiro dia contado é o seguinte. */
export function somarPrazo(base: Date, dias: number, unidade: PrazoPagamentoUnidade, bloqueado: (x: Date) => boolean): Date {
  if (unidade === "corrido") return somarDias(base, dias);
  let r = soData(base);
  let contados = 0;
  for (let i = 0; i < 400 && contados < dias; i++) {
    r = somarDias(r, 1);
    if (!bloqueado(r)) contados += 1;
  }
  return r;
}

const textoPrazo = (dias: number, unidade: PrazoPagamentoUnidade) => `${dias} dia${dias === 1 ? "" : "s"} ${unidade === "util" ? (dias === 1 ? "útil" : "úteis") : (dias === 1 ? "corrido" : "corridos")}`;

export function exemploPrazo(a: ExemploPrazoArgs): string[] {
  const hoje = soData(a.hoje);
  const h = rotuloHorario(a.horario);
  const amanha = somarDias(hoje, 1);
  const linhas: string[] = [];

  if (a.numero === "1.1") {
    if (a.modo === "hoje") {
      linhas.push(`Hoje é ${rotuloDia(hoje)}. Com esta configuração, a despesa lançada até as ${h} de hoje tem o pagamento normal no mesmo dia (${rotuloDia(hoje)}).`);
      linhas.push(`Lançada depois das ${h}, hoje deixa de contar: o pagamento normal passa para o dia seguinte (${rotuloDia(amanha)}).`);
      if (a.bloqueado(amanha)) linhas.push(`${rotuloDia(amanha)} é dia bloqueado: nesse caso a data precisa ser a do próximo dia útil (${rotuloDia(proximoDiaUtil(hoje, a.bloqueado))}).`);
    } else {
      const ate = somarPrazo(hoje, a.dias, a.unidade, a.bloqueado);
      const depois = somarPrazo(amanha, a.dias, a.unidade, a.bloqueado);
      linhas.push(`Hoje é ${rotuloDia(hoje)}. Com esta configuração, a despesa lançada até as ${h} de hoje tem o pagamento normal em até ${textoPrazo(a.dias, a.unidade)}: ${rotuloDia(ate)}.`);
      linhas.push(`Lançada depois das ${h}, a contagem começa no dia seguinte: o pagamento normal fica em ${rotuloDia(depois)}.`);
    }
    linhas.push("Pedir pagamento antes dessa data exige marcar Exceção, e a exceção pede a chave (senha).");
    linhas.push(`O Nível 1 que tentar aprovar depois das ${h} uma despesa para pagar hoje (ou já vencida) só consegue com a chave de uma exceção de aprovação. Despesa com pagamento de amanhã em diante aprova normalmente, sem chave.`);
    return linhas;
  }

  // 1.2 — conferência e aprovação
  if (a.modo === "hoje") {
    linhas.push(`Hoje é ${rotuloDia(hoje)}. Com esta configuração, a despesa aprovada até as ${h} de hoje é paga no mesmo dia (${rotuloDia(hoje)}).`);
  } else {
    const ate = somarPrazo(hoje, a.dias, a.unidade, a.bloqueado);
    linhas.push(`Hoje é ${rotuloDia(hoje)}. Com esta configuração, a despesa aprovada até as ${h} de hoje é paga em até ${textoPrazo(a.dias, a.unidade)} após a aprovação: ${rotuloDia(ate)}.`);
  }
  linhas.push(`Depois das ${h}, o Nível 1 só aprova com uma justificativa, e só quando o pagamento é hoje ou já está vencido.`);
  const proximo = proximoDiaUtil(hoje, a.bloqueado);
  linhas.push(
    a.reagendamentoAtivo
      ? `Do Nível 2 em diante, a despesa que continuar parada depois das ${h} (ou já vencida) tem o pagamento reagendado para o próximo dia útil (${rotuloDia(proximo)}).`
      : "O reagendamento automático está desligado: despesa parada no Nível 2 em diante não muda de data sozinha.",
  );
  return linhas;
}
