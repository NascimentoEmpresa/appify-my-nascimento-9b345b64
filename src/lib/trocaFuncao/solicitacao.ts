// =====================================================================
// TROCA DE FUNÇÃO — o fluxo, longe do React
//
// Encarregado abre → ANALISTA valida → o Operacional aprova → SST → RH
// altera na Senior.
//
//                            ┌─ Pendente Operacional ─┐
//   Pendente Analista ──────┤                         ├→ Pendente SST
//                            └─ Pendente Escritório ──┘      ↓
//                                                      Pendente RH
//                                                            ↓
//                                                       Concluída
//          ↘ Reprovada (em qualquer uma das três filas de decisão)
//
// A ETAPA DO ANALISTA entrou em 02/09/2026, junto com o submódulo
// "Analistas Validações" em Licitações. Ela é a PRIMEIRA porta: nada chega
// ao Operacional sem passar por ela. O analista enxerga as DUAS origens —
// foi o mesmo movimento que tirou a aprovação do escritório do RH, que ficou
// só com a etapa final (alterar o cargo na Senior).
//
// CONTRATO x ESCRITÓRIO não é mais tela separada (25/08/2026). Eram duas
// telas idênticas com o mesmo painel, e quem tinha as duas permissões
// trocava de menu para ver a mesma fila em pedaços. Agora é UMA tela de
// aprovação; a origem virou FILTRO e quem decide o que cada um enxerga é a
// permissão, não a rota:
//
//   operacional_troca_funcao → vê as de contrato
//   escritorio_troca_funcao  → vê as de escritório
//
// Quem tem as duas vê tudo e filtra; quem tem uma vê só a sua e nem sabe
// que o filtro existe. As duas rotas continuam de pé apontando para a
// mesma tela, para ninguém perder o item de menu que já tinha.
//
// O SST pode DISPENSAR o ASO: nem toda troca de função exige exame novo, e
// antes disso o card ficava parado esperando uma data que não ia existir.
// Dispensar segue para o RH igual, só sem data.
//
// Testado em src/test/troca-funcao.test.ts.
// =====================================================================

export const TABELA = "SISTEMA_SOLICITACOES_TROCA_FUNCAO";

export type StatusTroca =
  | "Pendente Analista"
  | "Pendente Operacional"
  | "Pendente Escritório"
  | "Pendente SST"
  | "Pendente RH"
  | "Concluída"
  | "Reprovada";

/**
 * A etapa é o papel de quem está olhando a fila.
 *
 * `analista`  → a primeira validação, em Licitações › Analistas Validações.
 *               Vê as DUAS origens: foi para cá que veio a aprovação do
 *               escritório quando ela saiu do RH.
 * `aprovacao` → cobre o que eram DUAS etapas ("operacional" e "escritorio").
 *               O que separa uma da outra não é mais a tela, é a permissão de
 *               quem abriu — ver `origensVisiveis`.
 */
export type Etapa = "analista" | "aprovacao" | "sst" | "rh";

/** De onde a solicitação veio. É o filtro da tela de aprovação. */
export type Origem = "contrato" | "escritorio";

export const origemDa = (s: Pick<SolicitacaoTroca, "e_escritorio">): Origem =>
  s.e_escritorio ? "escritorio" : "contrato";

export const ROTULO_ORIGEM: Record<Origem, string> = {
  contrato: "Contrato",
  escritorio: "Escritório / administrativo",
};

/**
 * O que a pessoa pode enxergar, a partir dos menus que ela tem.
 *
 * É a tradução direta do pedido "a permissão continua: quem pode ver
 * mudança de função escritório". Os dois menus antigos viraram chave de
 * ORIGEM em vez de chave de TELA.
 */
export function origensVisiveis(podeContrato: boolean, podeEscritorio: boolean): Origem[] {
  const r: Origem[] = [];
  if (podeContrato) r.push("contrato");
  if (podeEscritorio) r.push("escritorio");
  return r;
}

export interface SolicitacaoTroca {
  id: number;
  solicitante_nome: string | null;
  solicitante_email: string | null;
  colaborador_id: number | null;
  colaborador_nome: string | null;
  colaborador_cpf: string | null;
  colaborador_admissao: string | null;
  /** Cargo de hoje, puxado de EMPREGADOS — o encarregado não digita. */
  cargo_atual: string | null;
  cargo_novo: string | null;
  local: string | null;
  posto: string | null;
  filial: string | null;
  /** true = escritório (aprova a dupla do administrativo); false = contrato. */
  e_escritorio: boolean;
  /**
   * Opcional, escolhido no pedido. Não roteia nada — é só para o gerente
   * filtrar a fila por setor, do mesmo jeito que já filtra por contrato.
   */
  setor: string | null;
  motivo: string | null;
  data_pretendida: string | null;
  status: StatusTroca;
  aprovador_nome: string | null;
  aprovador_em: string | null;
  aprovador_motivo: string | null;
  sst_por: string | null;
  sst_em: string | null;
  sst_aso_data: string | null;
  /** O SST passou a troca adiante SEM exame — ver o cabeçalho. */
  sst_aso_dispensado: boolean;
  sst_observacao: string | null;
  rh_por: string | null;
  rh_em: string | null;
  rh_observacao: string | null;
  criado_em: string;
  atualizado_em: string | null;
}

/**
 * Locais que contam como ESCRITÓRIO.
 *
 * Sai da coluna "Descrição do Local" da EMPREGADOS. Conferido no banco em
 * 25/08/2026: 61 pessoas em ADMINISTRATIVO e 18 em "ESCRITÓRI0" — que está
 * grafado com ZERO no lugar do O, erro de digitação do cadastro que não dá
 * para corrigir daqui (a EMPREGADOS é espelho do Senior). Por isso a
 * comparação normaliza acento e caixa E trata o zero: escrever a variação
 * errada na lista resolveria hoje e quebraria no dia em que alguém
 * corrigisse o cadastro.
 *
 * Todo o resto — UFRGS, SAMU, prefeituras, hospitais — é contrato.
 */
const LOCAIS_ESCRITORIO = ["ADMINISTRATIVO", "ESCRITORIO"];

/** Sem acento, sem espaço sobrando, maiúsculo, e com 0 lido como O. */
export function normalizarLocal(local?: string | null): string {
  return String(local ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/0/g, "O")
    .replace(/\s+/g, " ")
    .trim();
}

export function localEhEscritorio(local?: string | null): boolean {
  const n = normalizarLocal(local);
  if (!n) return false;   // sem local, trata como contrato (é a maioria)
  return LOCAIS_ESCRITORIO.some(x => n === x || n.startsWith(`${x} `));
}

/**
 * Onde a solicitação nasce.
 *
 * Quem responde é o CHECKBOX do formulário, não mais o cadastro. A leitura
 * automática do local vivia errando nos dois sentidos (o cadastro é espelho
 * do Senior e tem gente de escritório marcada em contrato), e o encarregado
 * não tinha como consertar: a solicitação nascia na fila errada e alguém
 * tinha que ir no banco. `localEhEscritorio` continua aqui, mas só para a
 * tela sugerir — ver SolicitarTrocaFuncao.
 */
export function statusInicial(_eEscritorio: boolean): StatusTroca {
  return "Pendente Analista";
}

/**
 * Para qual fila de aprovação a solicitação vai DEPOIS do analista.
 *
 * A origem deixou de escolher onde a solicitação NASCE e passou a escolher
 * para onde ela vai quando o analista libera — o checkbox do formulário
 * continua valendo, só que um passo adiante.
 */
export function statusAposAnalista(eEscritorio: boolean): StatusTroca {
  return eEscritorio ? "Pendente Escritório" : "Pendente Operacional";
}

/**
 * Os status em que a etapa TEM trabalho a fazer.
 *
 * Aprovação tem dois porque é uma tela só para as duas origens: quem abre
 * age no que for da SUA origem, e é a permissão que decide qual é
 * (ver `podeAgirEm`).
 */
const STATUS_DE_ACAO: Record<Etapa, StatusTroca[]> = {
  analista:  ["Pendente Analista"],
  aprovacao: ["Pendente Operacional", "Pendente Escritório"],
  sst:       ["Pendente SST"],
  rh:        ["Pendente RH"],
};

export const statusDeAcao = (etapa: Etapa): StatusTroca[] => STATUS_DE_ACAO[etapa];

/**
 * O que cada fila enxerga.
 *
 * Quem aprova vê a própria fila do começo ao fim (a pergunta que mais chega
 * é "e a do fulano, andou?"). SST e RH não enxergam o que ainda está em
 * aprovação nem o que foi reprovado: para eles a solicitação só existe
 * depois de aprovada.
 */
const STATUS_VISIVEIS: Record<Etapa, StatusTroca[]> = {
  // O analista é a primeira porta: acompanha do começo ao fim o que ele
  // mesmo liberou, que é a pergunta que sobra na mesa dele.
  analista:  ["Pendente Analista", "Pendente Operacional", "Pendente Escritório", "Pendente SST", "Pendente RH", "Concluída", "Reprovada"],
  // O Operacional vê o que ainda está com o analista para saber o que vem
  // pela frente, mas `podeAgirEm` não deixa ele decidir nada lá.
  aprovacao: ["Pendente Analista", "Pendente Operacional", "Pendente Escritório", "Pendente SST", "Pendente RH", "Concluída", "Reprovada"],
  sst:       ["Pendente SST", "Pendente RH", "Concluída"],
  rh:        ["Pendente RH", "Concluída"],
};

export const statusVisiveis = (etapa: Etapa) => STATUS_VISIVEIS[etapa];

/**
 * A linha entra na tela desta pessoa?
 *
 * Duas perguntas, não uma: o status tem que caber na etapa E a origem tem
 * que estar entre as que a permissão libera. Sem a segunda, juntar as duas
 * telas em uma daria ao Operacional a fila do administrativo de brinde.
 */
export function pertenceAFila(
  s: Pick<SolicitacaoTroca, "status" | "e_escritorio">,
  etapa: Etapa,
  origens: Origem[],
): boolean {
  if (!STATUS_VISIVEIS[etapa].includes(s.status)) return false;
  return origens.includes(origemDa(s));
}

/**
 * Esta pessoa pode DECIDIR esta linha agora?
 *
 * Ver não é decidir: na tela de aprovação alguém pode acompanhar o que já
 * saiu da mão dele, e no SST/RH a origem não separa ninguém.
 */
export function podeAgirEm(
  s: Pick<SolicitacaoTroca, "status" | "e_escritorio">,
  etapa: Etapa,
  origens: Origem[],
): boolean {
  if (!STATUS_DE_ACAO[etapa].includes(s.status)) return false;
  return origens.includes(origemDa(s));
}

export type Acao = "aprovar" | "reprovar" | "aso" | "dispensar_aso" | "concluir";

/**
 * Para onde a solicitação vai. Devolve null quando a ação não vale no
 * estado atual — a tela não deve nem oferecer, mas quem garante é isto.
 */
export function proximoStatus(
  atual: StatusTroca,
  acao: Acao,
  eEscritorio = false,
): StatusTroca | null {
  const emAprovacao = atual === "Pendente Operacional" || atual === "Pendente Escritório";
  // O analista libera para a fila da ORIGEM — é o único ponto do fluxo em que
  // contrato e escritório se separam.
  if (acao === "aprovar" && atual === "Pendente Analista") return statusAposAnalista(eEscritorio);
  if (acao === "aprovar")  return emAprovacao ? "Pendente SST" : null;
  if (acao === "reprovar") return (emAprovacao || atual === "Pendente Analista") ? "Reprovada" : null;
  // Marcar o ASO e dispensar o ASO levam ao MESMO lugar de propósito: para o
  // RH os dois querem dizer "o SST já olhou, pode alterar na Senior". O que
  // muda é só o que fica registrado.
  if (acao === "aso" || acao === "dispensar_aso") return atual === "Pendente SST" ? "Pendente RH" : null;
  if (acao === "concluir") return atual === "Pendente RH" ? "Concluída" : null;
  return null;
}

/** Cor do selo. Mesma paleta das outras solicitações do encarregado. */
export function corDoStatus(s: StatusTroca): string {
  switch (s) {
    case "Concluída":  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "Reprovada":  return "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300";
    case "Pendente Analista": return "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300";
    case "Pendente SST": return "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300";
    case "Pendente RH":  return "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300";
    default:           return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  }
}

/** O que o status quer dizer, em português de gente. */
export function explicaStatus(s: StatusTroca): string {
  switch (s) {
    case "Pendente Analista":    return "Aguardando o analista validar a troca.";
    case "Pendente Operacional": return "Validada pelo analista. Aguardando o Operacional aprovar.";
    case "Pendente Escritório":  return "Validada pelo analista. Aguardando a aprovação do administrativo.";
    case "Pendente SST":         return "Aprovada. O SST vai avaliar se precisa de ASO.";
    case "Pendente RH":          return "Liberada pelo SST. O RH vai fazer a alteração na Senior.";
    case "Concluída":            return "Alteração feita na Senior. Troca concluída.";
    case "Reprovada":            return "Não aprovada — veja o motivo no detalhe.";
  }
}

export const fmtData = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
  return isNaN(+d) ? "—" : d.toLocaleDateString("pt-BR");
};

export const fmtDataHora = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

/**
 * O que o SST resolveu, em uma linha — vale para a trilha e para a lista.
 * Dispensar é informação, não ausência de informação: quem lê depois
 * precisa saber que ninguém esqueceu de marcar, foi decidido não marcar.
 */
export function resumoSST(s: Pick<SolicitacaoTroca, "sst_em" | "sst_aso_data" | "sst_aso_dispensado">): string {
  if (!s.sst_em) return "—";
  if (s.sst_aso_dispensado) return "ASO dispensado — a função não exige exame novo";
  return s.sst_aso_data ? `ASO em ${fmtData(s.sst_aso_data)}` : "Liberada pelo SST";
}
