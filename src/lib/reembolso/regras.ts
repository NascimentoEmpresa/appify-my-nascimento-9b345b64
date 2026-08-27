// =====================================================================
// SOLICITAR REEMBOLSO — as regras, longe do React.
//
// Portado do bot de Discord (`remb.js`, ~3.4k linhas, SQLite + DM). O fluxo de
// negócio é o mesmo: o colaborador informa a viagem (PIX, distância, data,
// saída e chegada), lança uma despesa por tipo com valor e comprovante
// obrigatórios, conclui, e a solicitação vai para o líder do setor aprovar ou
// reprovar com motivo.
//
// O QUE MUDOU EM RELAÇÃO AO BOT, e por quê:
//
// 1. Lá o poder saía do CARGO do Discord (`SETOR_ROLE_MAP`, `hasRole`): quem
//    tinha a role de líder aprovava. Aqui NÃO — este ERP concede acesso por
//    usuário, nunca por cargo/papel (ver README.md da raiz). Cada capacidade
//    virou um menu em `app_menu`, liberado em Administração › Acesso por
//    Usuário. O setor do solicitante continua vindo de EMPREGADOS, mas ele
//    decide só PARA QUEM a solicitação vai, não quem tem direito de aprovar.
//
// 2. O catálogo de tipos era uma constante no código — `ressarcimentos`, com
//    o comentário literal "sem limite de valor". Agora é tabela: cada tipo tem
//    teto de valor e janela de horário, editáveis por quem tem a permissão de
//    configuração. Os dois são o diferencial pedido em cima do bot.
//
// 3. Valores em CENTAVOS na hora de somar. O bot já fazia isso
//    (`Math.round(x*100)`) e por bom motivo: somar `0.1 + 0.2` em float dá
//    `0.30000000000000004`, e reembolso que não fecha centavo vira discussão
//    no financeiro.
//
// As mesmas regras estão repetidas em trigger no banco. Não é descuido: aqui
// elas avisam o usuário ANTES de ele preencher tudo; lá são a barreira de
// verdade, porque o front fala direto com o Supabase e ninguém impede um POST
// na mão.
//
// Testado em src/test/reembolso.test.ts.
// =====================================================================

/** Um tipo de despesa reembolsável, como está no banco. */
export interface TipoReembolso {
  codigo: string;
  nome: string;
  /** Teto em centavos. `null` = sem teto (era o comportamento do bot). */
  valor_maximo_centavos: number | null;
  /** Início da janela em que a despesa é aceita, "HH:MM". `null` = dia todo. */
  hora_inicio: string | null;
  /** Fim da janela, "HH:MM". `null` = dia todo. */
  hora_fim: string | null;
  ativo: boolean;
  ordem: number;
}

export type StatusReembolso = "pendente" | "aprovado" | "reprovado" | "cancelado";

export const STATUS_TODOS: StatusReembolso[] = ["pendente", "aprovado", "reprovado", "cancelado"];

export const ROTULO_STATUS: Record<StatusReembolso, string> = {
  pendente: "Aguardando aprovação",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  cancelado: "Cancelado",
};

/** O status que cada ação produz. */
const DESTINO = {
  aprovar: "aprovado",
  reprovar: "reprovado",
  cancelar: "cancelado",
} as const;

export type AcaoReembolso = keyof typeof DESTINO;

/**
 * De quais status cada ação pode partir.
 *
 * Cancelar é do solicitante e só vale enquanto ninguém decidiu: depois de
 * aprovada, a solicitação já entrou na fila de pagamento e sumir com ela
 * esconderia dinheiro comprometido.
 */
const ORIGENS: Record<AcaoReembolso, StatusReembolso[]> = {
  aprovar: ["pendente"],
  reprovar: ["pendente"],
  cancelar: ["pendente"],
};

/** Para onde vai, ou null quando a ação não vale no estado atual. */
export function proximoStatus(atual: StatusReembolso, acao: AcaoReembolso): StatusReembolso | null {
  return ORIGENS[acao].includes(atual) ? DESTINO[acao] : null;
}

// ── Horário ──────────────────────────────────────────────────────────
/**
 * Aceita "8", "0830", "08:30" e devolve sempre "HH:MM".
 *
 * O bot aceitava as três formas porque a pessoa digita no celular, com pressa,
 * e "8" para as 8h é o que sai naturalmente. Manter isso é a diferença entre o
 * formulário ser preenchido e ser abandonado.
 */
export function normalizaHora(bruto: string): string | null {
  const s = String(bruto ?? "").replace(/\s/g, "");
  if (!s) return null;

  let h: number;
  let m: number;
  if (/^\d{1,2}$/.test(s)) {
    h = Number(s);
    m = 0;
  } else if (/^\d{3,4}$/.test(s)) {
    const p = s.padStart(4, "0");
    h = Number(p.slice(0, 2));
    m = Number(p.slice(2));
  } else if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [a, b] = s.split(":");
    h = Number(a);
    m = Number(b);
  } else {
    return null;
  }

  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" → minutos desde a meia-noite. */
export function emMinutos(hora: string): number | null {
  const n = normalizaHora(hora);
  if (!n) return null;
  const [h, m] = n.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Um intervalo vira um ou DOIS segmentos de minutos.
 *
 * Viagem que sai 22:00 e chega 02:00 atravessa a meia-noite — tratar como um
 * par único [1320, 120] daria intervalo negativo e a comparação sairia errada.
 * Vira [1320,1439] + [0,120].
 */
function segmentos(iniMin: number, fimMin: number): Array<[number, number]> {
  if (fimMin >= iniMin) return [[iniMin, fimMin]];
  return [
    [iniMin, 24 * 60 - 1],
    [0, fimMin],
  ];
}

/**
 * A viagem passou pela janela do tipo?
 *
 * A regra pedida: "das 11 às 13 pode pedir reembolso de almoço; se saiu às 14h
 * não pode mais". Ou seja, não basta a despesa existir — a pessoa precisa ter
 * ESTADO EM VIAGEM durante a janela daquela refeição. Quem saiu às 14h não
 * estava na rua na hora do almoço, então almoço não se justifica.
 *
 * É interseção de intervalos, e não "a saída está dentro da janela": quem saiu
 * às 09h e voltou às 15h atravessou o almoço inteiro e tem direito, apesar de
 * a saída estar fora da janela.
 */
export function viagemAlcancaJanela(
  saida: string,
  chegada: string,
  horaInicio: string | null,
  horaFim: string | null,
): boolean {
  // Tipo sem janela vale o dia todo — é como o bot se comportava, e é o
  // default de quem cadastra um tipo sem pensar em horário (estacionamento,
  // hospedagem).
  if (!horaInicio || !horaFim) return true;

  const s = emMinutos(saida);
  const c = emMinutos(chegada);
  const ji = emMinutos(horaInicio);
  const jf = emMinutos(horaFim);
  if (s === null || c === null || ji === null || jf === null) return false;

  const daViagem = segmentos(s, c);
  const daJanela = segmentos(ji, jf);
  return daViagem.some(([a, b]) => daJanela.some(([x, y]) => a <= y && x <= b));
}

// ── Valor ────────────────────────────────────────────────────────────
/**
 * Converte o que a pessoa digitou em centavos.
 *
 * Aceita "12,50", "12.50" e "1.234,56" — o mesmo tratamento do bot, que tirava
 * o ponto de milhar antes de trocar a vírgula por ponto. Sem isso "1.234,56"
 * vira 1.23 e o reembolso sai errado em duas ordens de grandeza.
 */
export function valorEmCentavos(bruto: string): number | null {
  const s = String(bruto ?? "").replace(/\s/g, "").replace(/^R\$/i, "");
  if (!s) return null;
  const normalizado = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^\d+(\.\d+)?$/.test(normalizado)) return null;
  const n = Number(normalizado);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function fmtBRL(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Soma sempre em centavos — ver o item 3 do cabeçalho. */
export function totalEmCentavos(itens: Array<{ valor_centavos: number }>): number {
  return itens.reduce((acc, i) => acc + (Number(i.valor_centavos) || 0), 0);
}

// ── A pergunta que a tela faz ────────────────────────────────────────
export type MotivoRecusa = "tipo_inativo" | "fora_da_janela" | "acima_do_teto" | "valor_invalido";

export interface Veredito {
  ok: boolean;
  motivo?: MotivoRecusa;
  /** Frase pronta para o toast — a tela não remonta texto de erro. */
  mensagem?: string;
}

const OK: Veredito = { ok: true };

/**
 * Esta despesa pode entrar nesta viagem, com este valor?
 *
 * Três perguntas, nesta ordem de propósito: o tipo existe e está ligado; a
 * viagem alcançou a janela dele; o valor cabe no teto. A ordem importa para a
 * mensagem — dizer "acima do teto" para um tipo que a pessoa nem podia pedir
 * manda ela corrigir a coisa errada.
 */
export function podeLancar(
  tipo: TipoReembolso | undefined,
  valorCentavos: number | null,
  saida: string,
  chegada: string,
): Veredito {
  if (!tipo || !tipo.ativo) {
    return { ok: false, motivo: "tipo_inativo", mensagem: "Esse tipo de despesa não está disponível." };
  }

  if (!viagemAlcancaJanela(saida, chegada, tipo.hora_inicio, tipo.hora_fim)) {
    return {
      ok: false,
      motivo: "fora_da_janela",
      mensagem:
        `${tipo.nome} vale para viagem que passe entre ${tipo.hora_inicio} e ${tipo.hora_fim}. ` +
        `A sua foi de ${saida} às ${chegada}.`,
    };
  }

  if (valorCentavos === null || valorCentavos <= 0) {
    return { ok: false, motivo: "valor_invalido", mensagem: "Informe um valor maior que zero." };
  }

  if (tipo.valor_maximo_centavos !== null && valorCentavos > tipo.valor_maximo_centavos) {
    return {
      ok: false,
      motivo: "acima_do_teto",
      mensagem:
        `${tipo.nome} tem teto de ${fmtBRL(tipo.valor_maximo_centavos)}. ` +
        `Você lançou ${fmtBRL(valorCentavos)}.`,
    };
  }

  return OK;
}

/**
 * Quais tipos a tela oferece para ESTA viagem.
 *
 * O bot listava os seis sempre e só reclamava depois. Filtrar antes evita a
 * pessoa preencher valor e anexar comprovante de um almoço que ela nunca
 * poderia pedir.
 */
export function tiposDisponiveis(tipos: TipoReembolso[], saida: string, chegada: string): TipoReembolso[] {
  return tipos
    .filter((t) => t.ativo && viagemAlcancaJanela(saida, chegada, t.hora_inicio, t.hora_fim))
    .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Como a janela aparece na tela de configuração e no aviso do formulário. */
export function descreveJanela(tipo: Pick<TipoReembolso, "hora_inicio" | "hora_fim">): string {
  if (!tipo.hora_inicio || !tipo.hora_fim) return "Qualquer horário";
  return `${tipo.hora_inicio} às ${tipo.hora_fim}`;
}

export function descreveTeto(tipo: Pick<TipoReembolso, "valor_maximo_centavos">): string {
  return tipo.valor_maximo_centavos === null ? "Sem teto" : fmtBRL(tipo.valor_maximo_centavos);
}

// ── Data ─────────────────────────────────────────────────────────────
/** Aceita "01012026" e "01/01/2026"; devolve ISO "2026-01-01" ou null. */
export function dataParaISO(bruto: string): string | null {
  const s = String(bruto ?? "").replace(/\s/g, "");
  const m = /^(\d{2})\/?(\d{2})\/?(\d{4})$/.exec(s);
  if (!m) return null;
  const [, dd, mm, aaaa] = m;
  const d = Number(dd);
  const mo = Number(mm);
  const a = Number(aaaa);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Rejeita 31/02: o Date normaliza para 03/03 em silêncio, e o bot deixava
  // passar. Data de viagem errada bagunça o fechamento do mês.
  const teste = new Date(a, mo - 1, d);
  if (teste.getFullYear() !== a || teste.getMonth() !== mo - 1 || teste.getDate() !== d) return null;
  return `${aaaa}-${mm}-${dd}`;
}

/** "2026-01-31" → "31/01/2026", para exibir. */
export function dataParaBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? "");
}

/** Competência "AAAA-MM" a partir da data da viagem — é como o mês fecha. */
export function competenciaDe(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[1]}-${m[2]}` : "";
}

/** "2026-01" → "Janeiro/2026", para os seletores de mês. */
export function competenciaLegivel(competencia: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(competencia ?? ""));
  if (!m) return String(competencia ?? "");
  const meses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  return `${meses[Number(m[2]) - 1] ?? m[2]}/${m[1]}`;
}
