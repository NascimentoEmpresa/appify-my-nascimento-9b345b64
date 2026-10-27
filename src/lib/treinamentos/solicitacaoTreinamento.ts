// =====================================================================
// Treinamentos — SOLICITAÇÃO DE TREINAMENTO (migs 20261026000910 e 20261027000120)
// O formulário de 4 etapas do encarregado e o que Treinamentos faz com ele.
// 27/10 (Pablo): a Estrutura entrou na Necessidade; só presencial/online;
// sem horário, recursos e transporte; várias datas previstas; Treinamentos
// aceita ou reprova e informa a data, e o encarregado aprova a data (ou pede
// outra, com motivo).
// As regras de cada etapa são as mesmas de trn_sol_validar no banco.
// Testes: src/test/treinamentos-solicitacao.test.ts.
// =====================================================================

export type StatusSolTreinamento = "pendente" | "aprovada" | "data_informada" | "agendada" | "concluida" | "reprovada" | "cancelada";
export type Modalidade = "presencial" | "online";
export type Urgencia = "programavel" | "prioritario";
export type Voltagem = "110" | "220" | "ambas";

export interface FormTreinamento {
  contrato: string;                 // "empresa__filial"
  contrato_nome: string;
  treinamento: string; motivo: string; objetivo: string; assuntos: string;
  qtd_participantes: string; equipe: string; turnos: string;
  modalidade: Modalidade; local_treinamento: string; datas_previstas: string[]; urgencia: Urgencia;
  tem_sala: boolean | null; voltagem: Voltagem | ""; tem_projetor: boolean | null; precisa_projetor: boolean | null;
  tem_internet: boolean | null; tem_som: boolean | null; tem_espaco_cafe: boolean | null;
  observacoes: string;
  confirmado: boolean;
}

export const FORM_VAZIO: FormTreinamento = {
  contrato: "", contrato_nome: "", treinamento: "", motivo: "", objetivo: "", assuntos: "",
  qtd_participantes: "", equipe: "", turnos: "",
  modalidade: "presencial", local_treinamento: "", datas_previstas: [], urgencia: "programavel",
  tem_sala: null, voltagem: "", tem_projetor: null, precisa_projetor: null, tem_internet: null, tem_som: null,
  tem_espaco_cafe: null, observacoes: "", confirmado: false,
};

export interface SolicitacaoTreinamento {
  id: number; protocolo: string; status: StatusSolTreinamento;
  solicitante_id: string; solicitante_nome: string | null; solicitante_email: string | null;
  contrato_empresa: number | null; contrato_filial: number | null; contrato_nome: string;
  treinamento: string; motivo: string; objetivo: string | null; assuntos: string;
  qtd_participantes: number; equipe: string | null; turnos: string | null;
  modalidade: Modalidade; local_treinamento: string | null; data_preferencial: string | null; datas_previstas: string[] | null;
  horario_inicio: string | null; horario_fim: string | null; urgencia: Urgencia; recursos: string[];
  tem_sala: boolean | null; voltagem: Voltagem | null; tem_projetor: boolean | null; precisa_projetor: boolean | null;
  tem_internet: boolean | null; tem_som: boolean | null; tem_espaco_cafe: boolean | null; precisa_transporte: boolean | null;
  observacoes: string | null; declaracao: string | null; confirmado_em: string | null;
  decidido_por: string | null; decidido_em: string | null; motivo_reprovacao: string | null; devolucao_motivo: string | null;
  data_confirmada: string | null; horario_confirmado: string | null; instrutor: string | null; obs_treinamentos: string | null;
  data_recusa_motivo: string | null; data_aprovada_em: string | null;
  concluida_em: string | null; cancelada_em: string | null; cancelada_por: string | null; cancelamento_motivo: string | null;
  created_at: string; updated_at: string;
}

export interface EventoSolTreinamento {
  id: number; solicitacao_id: number; acao: string; de_status: string | null; para_status: string | null;
  texto: string | null; autor_nome: string | null; created_at: string;
}

export const ETAPAS = [
  { n: 1, titulo: "Identificação", subtitulo: "Identificação da solicitação" },
  { n: 2, titulo: "Necessidade", subtitulo: "Necessidade do treinamento, modalidade e datas" },
  { n: 3, titulo: "Participantes", subtitulo: "Público e participantes" },
  { n: 4, titulo: "Confirmação", subtitulo: "Revisão e confirmação" },
] as const;
export const ULTIMA_ETAPA = ETAPAS.length;
export const MAX_DATAS = 10;

export const MODALIDADES: { v: Modalidade; r: string }[] = [
  { v: "presencial", r: "Presencial" }, { v: "online", r: "Online" },
];
/** Gravada antes de 27/10 — só para ler o que já existe. */
const ROTULO_MODALIDADE_ANTIGA: Record<string, string> = { hibrida: "Híbrida" };
export const rotuloModalidade = (m: string | null | undefined) =>
  MODALIDADES.find((x) => x.v === m)?.r ?? ROTULO_MODALIDADE_ANTIGA[String(m)] ?? (m || "—");
export const VOLTAGENS: { v: Voltagem; r: string }[] = [{ v: "110", r: "110/127V" }, { v: "220", r: "220V" }, { v: "ambas", r: "Ambas" }];

/** As perguntas Sim/Não do checklist do local, na ordem do modelo (transporte saiu em 27/10). */
export const CHECKLIST: { secao: string; campo: keyof FormTreinamento; pergunta: string }[] = [
  { secao: "1. Estrutura do local", campo: "tem_sala", pergunta: "O local possui sala disponível para realizar o treinamento?" },
  { secao: "2. Equipamentos e infraestrutura", campo: "tem_projetor", pergunta: "O local possui projetor disponível?" },
  { secao: "2. Equipamentos e infraestrutura", campo: "precisa_projetor", pergunta: "Será necessário solicitar projetor ao setor de Treinamentos?" },
  { secao: "2. Equipamentos e infraestrutura", campo: "tem_internet", pergunta: "O local possui acesso à internet?" },
  { secao: "2. Equipamentos e infraestrutura", campo: "tem_som", pergunta: "O local possui caixa de som e microfone?" },
  { secao: "3. Espaço para café", campo: "tem_espaco_cafe", pergunta: "Existe espaço adequado para organizar e servir café?" },
];

export const DECLARACAO =
  "Declaro que todas as informações fornecidas foram verificadas e confirmadas, correspondendo às condições reais do local e às " +
  "necessidades do treinamento. Estou ciente de que serão utilizadas para elaboração do ofício e organização das atividades.";

export const precisaLocal = (f: Pick<FormTreinamento, "modalidade">) => f.modalidade === "presencial";

/** Erros de UMA etapa (1–3); a última junta todas e exige a confirmação. */
export function errosEtapa(f: FormTreinamento, etapa: number): string[] {
  const e: string[] = [];
  if (etapa === 1) {
    if (!f.contrato_nome.trim()) e.push("Escolha o contrato / unidade.");
  } else if (etapa === 2) {
    if (!f.treinamento.trim()) e.push("Informe qual treinamento está solicitando.");
    if (!f.motivo.trim()) e.push("Informe por que o treinamento é necessário.");
    if (!f.assuntos.trim()) e.push("Informe os assuntos que precisam ser abordados.");
    if (precisaLocal(f)) {
      if (!f.local_treinamento.trim()) e.push("Informe o local e o endereço completo do treinamento.");
      if (f.tem_sala === null) e.push("Responda se o local tem sala disponível.");
      if (!f.voltagem) e.push("Informe a voltagem das tomadas.");
      if (CHECKLIST.some((c) => c.campo !== "tem_sala" && f[c.campo] === null)) e.push("Responda todas as perguntas do checklist do local.");
    }
    if (f.datas_previstas.length === 0) e.push("Informe ao menos uma data prevista.");
    else if (f.datas_previstas.length > MAX_DATAS) e.push(`Informe no máximo ${MAX_DATAS} datas previstas.`);
    if (f.urgencia === "prioritario" && !f.observacoes.trim()) e.push("Prioritário: justifique a urgência nas observações.");
  } else if (etapa === 3) {
    const q = Number(f.qtd_participantes);
    if (!f.qtd_participantes.trim() || !Number.isInteger(q) || q < 1) e.push("Informe a quantidade de colaboradores.");
    else if (q > 5000) e.push("Quantidade de colaboradores fora do limite.");
  } else if (etapa === ULTIMA_ETAPA) {
    const antes = ETAPAS.slice(0, -1).flatMap((x) => errosEtapa(f, x.n));
    if (antes.length) return ["Preencha os campos obrigatórios das etapas anteriores.", ...antes];
    if (!f.confirmado) e.push("Confirme a veracidade das informações para enviar.");
  }
  return e;
}

/** Primeira etapa com pendência (para "voltar ao que falta"); null = tudo certo até a confirmação. */
export function primeiraEtapaComErro(f: FormTreinamento): number | null {
  for (const x of ETAPAS.slice(0, -1)) if (errosEtapa(f, x.n).length) return x.n;
  return null;
}

/** Inclui uma data prevista (sem repetir, em ordem). */
export function comData(datas: string[], d: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || datas.includes(d)) return datas;
  return [...datas, d].sort();
}

/** Respondidas do checklist (sala, voltagem e as 5 Sim/Não). */
export function progressoChecklist(f: FormTreinamento): { respondidas: number; total: number } {
  const total = CHECKLIST.length + 1;
  const respondidas = CHECKLIST.filter((c) => f[c.campo] !== null).length + (f.voltagem ? 1 : 0);
  return { respondidas, total };
}

/** O que vai para o banco (trn_sol_criar / trn_sol_reenviar). */
export function paraEnvio(f: FormTreinamento): Record<string, unknown> {
  const [emp, fil] = f.contrato.split("__");
  const local = precisaLocal(f);
  return {
    contrato_empresa: emp ? Number(emp) : null, contrato_filial: fil ? Number(fil) : null, contrato_nome: f.contrato_nome.trim(),
    treinamento: f.treinamento.trim(), motivo: f.motivo.trim(), objetivo: f.objetivo.trim(), assuntos: f.assuntos.trim(),
    qtd_participantes: Number(f.qtd_participantes), equipe: f.equipe.trim(), turnos: f.turnos.trim(),
    modalidade: f.modalidade, local_treinamento: local ? f.local_treinamento.trim() : "", datas_previstas: [...f.datas_previstas].sort(),
    urgencia: f.urgencia,
    tem_sala: local ? f.tem_sala : null, voltagem: local ? f.voltagem || null : null,
    tem_projetor: local ? f.tem_projetor : null, precisa_projetor: local ? f.precisa_projetor : null,
    tem_internet: local ? f.tem_internet : null, tem_som: local ? f.tem_som : null,
    tem_espaco_cafe: local ? f.tem_espaco_cafe : null,
    observacoes: f.observacoes.trim(), confirmado: f.confirmado,
  };
}

/** As datas previstas; as gravadas antes de 27/10 só têm a data_preferencial. */
export function datasPrevistas(s: { datas_previstas?: string[] | null; data_preferencial?: string | null }): string[] {
  const d = (s.datas_previstas ?? []).filter(Boolean).map((x) => x.slice(0, 10));
  return d.length ? [...d].sort() : s.data_preferencial ? [s.data_preferencial.slice(0, 10)] : [];
}

/** Uma solicitação devolvida volta para o formulário (o encarregado corrige). */
export function formDaSolicitacao(s: SolicitacaoTreinamento): FormTreinamento {
  return {
    contrato: s.contrato_empresa != null && s.contrato_filial != null ? `${s.contrato_empresa}__${s.contrato_filial}` : "",
    contrato_nome: s.contrato_nome, treinamento: s.treinamento, motivo: s.motivo, objetivo: s.objetivo ?? "", assuntos: s.assuntos,
    qtd_participantes: String(s.qtd_participantes), equipe: s.equipe ?? "", turnos: s.turnos ?? "",
    // Híbrida (antes de 27/10) volta como presencial: tem local e checklist.
    modalidade: s.modalidade === "online" ? "online" : "presencial", local_treinamento: s.local_treinamento ?? "",
    datas_previstas: datasPrevistas(s), urgencia: s.urgencia,
    tem_sala: s.tem_sala, voltagem: s.voltagem ?? "", tem_projetor: s.tem_projetor, precisa_projetor: s.precisa_projetor,
    tem_internet: s.tem_internet, tem_som: s.tem_som, tem_espaco_cafe: s.tem_espaco_cafe,
    observacoes: s.observacoes ?? "", confirmado: false,
  };
}

// ── Leitura (resumo, ofício, status) ────────────────────────────────────────

export const STATUS_SOL_TREINAMENTO: Record<StatusSolTreinamento, { rotulo: string; cor: string }> = {
  pendente:       { rotulo: "Aguardando validação",      cor: "bg-amber-100 text-amber-800 border-amber-200" },
  aprovada:       { rotulo: "Aceita — aguardando data",  cor: "bg-sky-100 text-sky-800 border-sky-200" },
  data_informada: { rotulo: "Data aguardando aprovação", cor: "bg-violet-100 text-violet-800 border-violet-200" },
  agendada:       { rotulo: "Agendada",                  cor: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  concluida:      { rotulo: "Realizada",                 cor: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  reprovada:      { rotulo: "Reprovada",                 cor: "bg-red-100 text-red-700 border-red-200" },
  cancelada:      { rotulo: "Cancelada",                 cor: "bg-slate-100 text-slate-600 border-slate-200" },
};

/** Pendente devolvida aparece como "Ajuste solicitado"; aceita depois de o
 *  encarregado pedir outra data, como "Nova data solicitada". */
export function rotuloStatus(s: Pick<SolicitacaoTreinamento, "status" | "devolucao_motivo"> & { data_recusa_motivo?: string | null }): string {
  if (s.status === "pendente" && s.devolucao_motivo) return "Ajuste solicitado";
  if (s.status === "aprovada" && s.data_recusa_motivo) return "Nova data solicitada";
  return STATUS_SOL_TREINAMENTO[s.status]?.rotulo ?? s.status;
}

export const ROTULO_EVENTO: Record<string, string> = {
  enviada: "Enviada", reenviada: "Corrigida e reenviada", aprovada: "Aceita", agendada: "Agendada",
  data_informada: "Data informada", data_aprovada: "Data aprovada pelo encarregado", data_recusada: "Encarregado pediu outra data",
  concluida: "Realizada", reprovada: "Reprovada", devolvida: "Devolvida para ajuste", cancelada: "Cancelada",
};

const simNao = (b: boolean | null | undefined) => (b == null ? "Não informado" : b ? "Sim" : "Não");
export const fmtDataIso = (s: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "A definir";
};
const rotuloDe = <T extends string>(lista: { v: T; r: string }[], v: T | string | null | undefined) => lista.find((x) => x.v === v)?.r ?? (v || "—");

type Leitura = Pick<SolicitacaoTreinamento, "contrato_nome" | "treinamento" | "motivo" | "objetivo" | "assuntos" | "qtd_participantes"
  | "equipe" | "turnos" | "modalidade" | "local_treinamento" | "urgencia"
  | "tem_sala" | "voltagem" | "tem_projetor" | "precisa_projetor" | "tem_internet" | "tem_som" | "tem_espaco_cafe"
  | "observacoes"> & { datas_previstas?: string[] | null; data_preferencial?: string | null;
    solicitante_nome?: string | null; protocolo?: string | null };

/** As seções da ficha (resumo da confirmação e detalhe de Treinamentos). */
export function secoesFicha(s: Leitura): { titulo: string; itens: [string, string][] }[] {
  const local = s.modalidade !== "online";
  const datas = datasPrevistas(s);
  return [
    { titulo: "Identificação", itens: [["Solicitante", s.solicitante_nome || "—"], ["Contrato / Unidade", s.contrato_nome || "—"]] },
    { titulo: "Necessidade", itens: [
      ["Treinamento", s.treinamento || "—"], ["Por que é necessário", s.motivo || "—"],
      ["O que devem aprender", s.objetivo || "—"], ["Assuntos a abordar", s.assuntos || "—"],
      ["Modalidade", rotuloModalidade(s.modalidade)],
      ["Local e endereço", local ? s.local_treinamento || "—" : "Online"],
      [datas.length > 1 ? "Datas previstas" : "Data prevista", datas.length ? datas.map(fmtDataIso).join(", ") : "A definir"],
      ["Prazo / urgência", s.urgencia === "prioritario" ? "Prioritário" : "Programável"]] },
    { titulo: "Participantes", itens: [
      ["Quantidade de colaboradores", s.qtd_participantes ? String(s.qtd_participantes) : "—"],
      ["Equipe", s.equipe || "—"], ["Turnos", s.turnos || "—"]] },
    ...(local ? [{ titulo: "Checklist do local", itens: [
      ["Sala disponível", simNao(s.tem_sala)], ["Voltagem das tomadas", rotuloDe(VOLTAGENS, s.voltagem)],
      ["Projetor no local", simNao(s.tem_projetor)], ["Solicitar projetor a Treinamentos", simNao(s.precisa_projetor)],
      ["Internet", simNao(s.tem_internet)], ["Caixa de som e microfone", simNao(s.tem_som)],
      ["Espaço para café", simNao(s.tem_espaco_cafe)],
    ] as [string, string][] }] : []),
    { titulo: "Observações", itens: [["Observações adicionais", s.observacoes || "—"]] },
  ];
}

/** "Copiar informações para o ofício": a ficha em texto, uma linha por campo. */
export function textoOficio(s: Leitura): string {
  const linhas = [`SOLICITAÇÃO DE TREINAMENTO${s.protocolo ? ` — ${s.protocolo}` : ""}`, ""];
  for (const sec of secoesFicha(s)) {
    linhas.push(sec.titulo.toUpperCase());
    for (const [r, v] of sec.itens) linhas.push(`${r}: ${v}`);
    linhas.push("");
  }
  return linhas.join("\n").trim();
}

export type AcaoTreinamentos = "aprovar" | "reprovar" | "devolver" | "informar_data" | "concluir" | "cancelar";

/** Ações de Treinamentos conforme o status. Informar/remarcar a data sempre
 *  volta para o encarregado aprovar (data_informada). */
export function acoesPermitidas(s: Pick<SolicitacaoTreinamento, "status">): AcaoTreinamentos[] {
  switch (s.status) {
    case "pendente": return ["aprovar", "devolver", "reprovar", "cancelar"];
    case "aprovada": return ["informar_data", "concluir", "cancelar"];
    case "data_informada": return ["informar_data", "cancelar"];
    case "agendada": return ["informar_data", "concluir", "cancelar"];
    default: return [];
  }
}

/** O que o encarregado (quem pediu) pode fazer. */
export function acoesEncarregado(s: Pick<SolicitacaoTreinamento, "status">): ("cancelar" | "aprovar_data" | "pedir_outra_data")[] {
  if (s.status === "pendente") return ["cancelar"];
  if (s.status === "data_informada") return ["aprovar_data", "pedir_outra_data"];
  return [];
}

/** Em andamento: aceita, com data informada ou agendada. */
export const emAndamento = (st: StatusSolTreinamento) => st === "aprovada" || st === "data_informada" || st === "agendada";

/** Ordem da fila de Treinamentos: prioritários pendentes primeiro, depois pela data prevista. */
export function ordenarFila<T extends Pick<SolicitacaoTreinamento, "status" | "urgencia" | "data_preferencial" | "created_at">>(lista: T[]): T[] {
  const peso = (s: T) => (s.status === "pendente" ? (s.urgencia === "prioritario" ? 0 : 1) : emAndamento(s.status) ? 2 : 3);
  return [...lista].sort((a, b) => peso(a) - peso(b)
    || String(a.data_preferencial ?? "9999").localeCompare(String(b.data_preferencial ?? "9999"))
    || b.created_at.localeCompare(a.created_at));
}
