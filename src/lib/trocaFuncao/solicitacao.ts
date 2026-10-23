// =====================================================================
// TROCA DE FUNÇÃO — o fluxo, longe do React
//
// Encarregado abre → quem aprova decide → SST → RH altera na Senior.
//
//   contrato simples ──→ Pendente Operacional ─┐
//                                              ├→ Pendente SST → Pendente RH → Concluída
//   administrativa ────→ Pendente Escritório ──┘
//          ↘ Reprovada (em qualquer uma das duas filas de decisão)
//
// ADMINISTRATIVA (16/09/2026) = solicitação do ESCRITÓRIO **ou** com SETOR
// informado. Vai pra Diretoria › Mudança de Função, e lá só enxerga (e
// decide) quem tem o setor dela marcado em Administração › Acesso por
// Usuário (SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR). O Operacional fica com
// a troca de contrato SEM setor — e só passa a ver alguma com setor se o
// admin marcar o setor pra ele. Pedido do Pablo: "na Licitação ninguém pode
// ver as do administrativo e quando tiver setor; vai pra Diretoria; no
// Operacional só a de contrato, a menos que eu libere no acesso".
//
// A ETAPA DO ANALISTA (02/09/2026 → 16/09/2026) validava tudo antes da
// aprovação. Saiu: Licitações › Analistas Validações › Mudança de Função
// virou ACOMPANHAMENTO das trocas de contrato simples, sem botão. As
// solicitações nascem direto na fila de quem decide. "Pendente Analista"
// fica no tipo só pelo histórico (nada nasce mais assim).
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

/** Administrativa = do escritório OU com setor informado. É o que vai pra Diretoria. */
export const ehAdministrativa = (s: Pick<SolicitacaoTroca, "e_escritorio" | "setor">): boolean =>
  !!s.e_escritorio || !!String(s.setor ?? "").trim();

export const origemDa = (s: Pick<SolicitacaoTroca, "e_escritorio" | "setor">): Origem =>
  ehAdministrativa(s) ? "escritorio" : "contrato";

/** Mesma régua do banco (cs_reembolso_norm_setor): sem acento, caixa alta, sem espaços nas pontas. */
export const normSetorTroca = (s: string | null | undefined): string =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();

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
  /** Ver `TipoTroca`. Nulo nos pedidos antigos = 'funcao'. */
  tipo?: TipoTroca | null;
  horario_atual?: string | null;
  horario_novo?: string | null;
  local: string | null;
  /** Texto antigo do cadastro (Organograma / Descrição do Local). Os pedidos novos usam os `posto_*` abaixo. */
  posto: string | null;
  /**
   * Posto de trabalho da Senior (PO-xxxxx, RH_POSTO_TRABALHO). O ATUAL o
   * banco lê do cadastro no insert (stf_valida_troca); o NOVO é o escolhido
   * na lista — nulo = o posto não muda. Nome e contrato são retrato do dia.
   */
  posto_atual_codigo?: string | null;
  posto_atual_nome?: string | null;
  posto_atual_contrato?: string | null;
  posto_novo_codigo?: string | null;
  posto_novo_nome?: string | null;
  posto_novo_contrato?: string | null;
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

// ---------------------------------------------------------------------
// OS TRÊS TIPOS DE MOVIMENTAÇÃO (23/10/2026)
//
// Pedido: registrar também a troca de POSTO DE TRABALHO, junto com a de
// função e a de horário, e a troca só de posto não pode obrigar cargo novo
// nem horário novo.
//
//   funcao  → cargo novo + horário novo (pode ser o mesmo); posto novo
//             opcional — troca de função que também muda de posto.
//   horario → só horário; cargo e posto ficam.
//   posto   → só posto; cargo fica; horário novo opcional (vazio = mesmo).
//
// O banco repete tudo isto num gatilho (stf_valida_troca, mig
// 20261023000410) — a tela só avisa antes.
// ---------------------------------------------------------------------

export type TipoTroca = "funcao" | "horario" | "posto";

export const ROTULO_TIPO: Record<TipoTroca, string> = {
  funcao: "Alteração de função",
  horario: "Só horário",
  posto: "Só posto",
};

/** Um posto de trabalho para escolher (RPC stf_postos_trabalho). */
export interface PostoTrabalho {
  codigo: string;
  nome: string;
  contrato: string | null;
  /** "Descrição do Local" mais comum entre quem está no posto hoje. */
  unidade: string | null;
  ocupantes: number;
}

/** "UFRGS RECEPÇÃO · PALÁCIO · PO-00002 — RECEPCIONISTA-B 40H" — o que o encarregado reconhece. */
export function rotuloPosto(p: Pick<PostoTrabalho, "codigo" | "nome" | "contrato" | "unidade">): string {
  return [p.contrato, p.unidade, `${p.codigo} — ${p.nome}`].filter(Boolean).join(" · ");
}

const igualSemCaixa = (a?: string | null, b?: string | null) =>
  String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase();

export interface RascunhoTroca {
  tipo: TipoTroca;
  cargoAtual: string;
  cargoNovo: string;
  horarioAtual: string;
  horarioNovo: string;
  postoAtualCodigo: string;
  /** Código do posto escolhido; vazio = não muda. */
  postoNovoCodigo: string;
}

/** O que impede o envio da PARTE DA TROCA (cargo/horário/posto), ou null. Espelho de stf_valida_troca. */
export function validarTroca(r: RascunhoTroca): string | null {
  const cargoNovo = r.cargoNovo.trim();
  const horarioNovo = r.horarioNovo.trim();
  const posto = r.postoNovoCodigo.trim();
  if (r.tipo === "funcao") {
    if (!cargoNovo) return "Informe para qual cargo a pessoa vai.";
    if (igualSemCaixa(cargoNovo, r.cargoAtual)) return "O cargo novo é igual ao atual — se é só o horário ou o posto que muda, escolha \"Só horário\" ou \"Só posto\".";
    if (!horarioNovo) return "Informe a carga horária/escala que a pessoa vai fazer no cargo novo.";
  }
  if (r.tipo === "horario") {
    if (!horarioNovo) return "Informe o horário novo que a pessoa vai fazer.";
    if (igualSemCaixa(horarioNovo, r.horarioAtual)) return "O horário novo é igual ao atual — não há o que trocar.";
    if (posto) return "Troca só de horário não muda o posto — escolha \"Só posto\" ou \"Alteração de função\".";
  }
  if (r.tipo === "posto" && !posto) return "Escolha o posto novo.";
  if (posto && posto === r.postoAtualCodigo.trim()) return "O posto novo é o mesmo em que a pessoa já está.";
  return null;
}

export interface MudancaTroca {
  rotulo: "Cargo" | "Posto" | "Horário";
  atual: string;
  novo: string;
}

/**
 * O que MUDA no pedido, na ordem Cargo → Posto → Horário. É o que o fluxo,
 * o detalhe, o histórico e o RH mostram — o que não muda não aparece (o
 * horário "mantido" da troca de função, o cargo da troca só de posto).
 * Mesma régua de stf_resumo_troca no banco.
 */
export function mudancasDaTroca(s: Pick<SolicitacaoTroca,
  "tipo" | "cargo_atual" | "cargo_novo" | "horario_atual" | "horario_novo"
  | "posto_atual_codigo" | "posto_atual_nome" | "posto_novo_codigo" | "posto_novo_nome">): MudancaTroca[] {
  const out: MudancaTroca[] = [];
  const tipo = s.tipo ?? "funcao";
  if (tipo === "funcao") out.push({ rotulo: "Cargo", atual: s.cargo_atual || "—", novo: s.cargo_novo || "—" });
  if (s.posto_novo_codigo) {
    out.push({
      rotulo: "Posto",
      atual: s.posto_atual_nome || s.posto_atual_codigo || "—",
      novo: s.posto_novo_nome || s.posto_novo_codigo,
    });
  }
  const horarioNovo = String(s.horario_novo ?? "").trim();
  if (horarioNovo && !igualSemCaixa(horarioNovo, s.horario_atual)) {
    out.push({ rotulo: "Horário", atual: String(s.horario_atual ?? "").trim() || "—", novo: horarioNovo });
  }
  return out;
}

export interface LinhaQuadroTroca extends MudancaTroca {
  muda: boolean;
  /** Contrato do posto, embaixo do nome. */
  atualExtra?: string | null;
  novoExtra?: string | null;
}

/**
 * O quadro do detalhe: Cargo, Posto e Horário SEMPRE, na mesma ordem. O que
 * não muda sai como "Mantém …" — quem conclui no RH precisa ver que o posto
 * não muda, não ficar na dúvida se faltou informar.
 */
export function quadroDaTroca(s: Parameters<typeof mudancasDaTroca>[0]
  & Pick<SolicitacaoTroca, "posto" | "posto_atual_contrato" | "posto_novo_contrato">): LinhaQuadroTroca[] {
  const muda = new Map(mudancasDaTroca(s).map(m => [m.rotulo, m]));
  const cargoAtual = s.cargo_atual || "—";
  const postoAtual = s.posto_atual_nome || s.posto_atual_codigo || s.posto || "—";
  const horarioAtual = String(s.horario_atual ?? "").trim() || "—";
  const linha = (rotulo: MudancaTroca["rotulo"], atual: string, extra?: Partial<LinhaQuadroTroca>): LinhaQuadroTroca => {
    const m = muda.get(rotulo);
    return m ? { ...m, muda: true, ...extra } : { rotulo, atual, novo: "Mantém", muda: false, atualExtra: extra?.atualExtra };
  };
  return [
    linha("Cargo", cargoAtual),
    linha("Posto", postoAtual, { atualExtra: s.posto_atual_contrato, novoExtra: s.posto_novo_contrato }),
    linha("Horário", horarioAtual),
  ];
}

/** "Cargo: A → B · Posto: X → Y · Horário: H → H2" — uma linha, para listas e títulos. */
export function resumoDaTroca(s: Parameters<typeof mudancasDaTroca>[0]): string {
  const m = mudancasDaTroca(s);
  if (m.length === 0) return `${s.cargo_atual || "—"} → ${s.cargo_novo || "—"}`;
  return m.map(x => `${x.rotulo}: ${x.atual} → ${x.novo}`).join(" · ");
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
export function statusInicial(eEscritorio: boolean, setor?: string | null): StatusTroca {
  // Desde 16/09/2026 nasce direto na fila de quem decide (o analista saiu).
  return ehAdministrativa({ e_escritorio: eEscritorio, setor }) ? "Pendente Escritório" : "Pendente Operacional";
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
  // Licitações só acompanha (16/09/2026): nenhum botão.
  analista:  [],
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
/**
 * Os setores marcados pra pessoa em Acesso por Usuário são um FILTRO
 * (16/09/2026, segunda leitura do Pablo: "podendo filtrar por setor"):
 *   • nenhum setor marcado → vê/decide todas as administrativas da tela;
 *   • setores marcados     → só as daqueles setores (e as sem setor).
 * O banco aplica a mesma régua em aprova_setor() (mig 128).
 */
export function passaNoFiltroDeSetor(
  s: Pick<SolicitacaoTroca, "setor">,
  setores: ReadonlySet<string> | null = null,
): boolean {
  const setor = normSetorTroca(s.setor);
  if (!setor || !setores || setores.size === 0) return true;
  return setores.has(setor);
}

/**
 * O recorte de quem está olhando (16/09/2026):
 *   • SST e RH tratam tudo.
 *   • Licitações (analista) só acompanha a troca de CONTRATO SIMPLES — nada
 *     do administrativo nem com setor aparece lá.
 *   • Aprovação: a TELA diz a origem (Operacional → contrato simples;
 *     Diretoria → administrativa = escritório ou com setor), e os setores
 *     marcados filtram as administrativas.
 */
export function visivelNoRecorte(
  s: Pick<SolicitacaoTroca, "e_escritorio" | "setor">,
  etapa: Etapa,
  origens: Origem[],
  setores: ReadonlySet<string> | null = null,
): boolean {
  if (etapa === "sst" || etapa === "rh") return true;
  if (etapa === "analista") return !ehAdministrativa(s);
  if (!origens.includes(origemDa(s))) return false;
  return !ehAdministrativa(s) || passaNoFiltroDeSetor(s, setores);
}

export function pertenceAFila(
  s: Pick<SolicitacaoTroca, "status" | "e_escritorio" | "setor">,
  etapa: Etapa,
  origens: Origem[],
  setores: ReadonlySet<string> | null = null,
): boolean {
  if (!STATUS_VISIVEIS[etapa].includes(s.status)) return false;
  return visivelNoRecorte(s, etapa, origens, setores);
}

/**
 * Esta pessoa pode DECIDIR esta linha agora?
 *
 * Ver não é decidir: na tela de aprovação alguém pode acompanhar o que já
 * saiu da mão dele, e no SST/RH a origem não separa ninguém.
 */
export function podeAgirEm(
  s: Pick<SolicitacaoTroca, "status" | "e_escritorio" | "setor">,
  etapa: Etapa,
  origens: Origem[],
  setores: ReadonlySet<string> | null = null,
): boolean {
  if (!STATUS_DE_ACAO[etapa].includes(s.status)) return false;
  return visivelNoRecorte(s, etapa, origens, setores);
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
    case "Pendente Analista":    return "Aguardando validação (etapa antiga — não nasce mais assim).";
    case "Pendente Operacional": return "Aguardando o Operacional aprovar.";
    case "Pendente Escritório":  return "Aguardando a aprovação da Diretoria (administrativo / setor).";
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
