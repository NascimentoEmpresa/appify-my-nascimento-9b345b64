// =====================================================================
// Treinamentos — SOLICITAÇÃO DE TREINAMENTO (mig 20261026000910)
// O formulário de 5 etapas do encarregado e o que Treinamentos faz com ele.
// As regras de cada etapa são as mesmas de trn_sol_validar no banco.
// Testes: src/test/treinamentos-solicitacao.test.ts.
// =====================================================================

export type StatusSolTreinamento = "pendente" | "aprovada" | "agendada" | "concluida" | "reprovada" | "cancelada";
export type Modalidade = "presencial" | "online" | "hibrida";
export type Urgencia = "programavel" | "prioritario";
export type Voltagem = "110" | "220" | "ambas";

export interface FormTreinamento {
  contrato: string;                 // "empresa__filial"
  contrato_nome: string;
  treinamento: string; motivo: string; objetivo: string; assuntos: string;
  qtd_participantes: string; equipe: string; turnos: string;
  modalidade: Modalidade; local_treinamento: string; data_preferencial: string;
  horario_inicio: string; horario_fim: string; urgencia: Urgencia; recursos: string[];
  tem_sala: boolean | null; voltagem: Voltagem | ""; tem_projetor: boolean | null; precisa_projetor: boolean | null;
  tem_internet: boolean | null; tem_som: boolean | null; tem_espaco_cafe: boolean | null; precisa_transporte: boolean | null;
  observacoes: string;
  confirmado: boolean;
}

export const FORM_VAZIO: FormTreinamento = {
  contrato: "", contrato_nome: "", treinamento: "", motivo: "", objetivo: "", assuntos: "",
  qtd_participantes: "", equipe: "", turnos: "",
  modalidade: "presencial", local_treinamento: "", data_preferencial: "", horario_inicio: "08:00", horario_fim: "12:00",
  urgencia: "programavel", recursos: [],
  tem_sala: null, voltagem: "", tem_projetor: null, precisa_projetor: null, tem_internet: null, tem_som: null,
  tem_espaco_cafe: null, precisa_transporte: null, observacoes: "", confirmado: false,
};

export interface SolicitacaoTreinamento {
  id: number; protocolo: string; status: StatusSolTreinamento;
  solicitante_id: string; solicitante_nome: string | null; solicitante_email: string | null;
  contrato_empresa: number | null; contrato_filial: number | null; contrato_nome: string;
  treinamento: string; motivo: string; objetivo: string | null; assuntos: string;
  qtd_participantes: number; equipe: string | null; turnos: string | null;
  modalidade: Modalidade; local_treinamento: string | null; data_preferencial: string | null;
  horario_inicio: string | null; horario_fim: string | null; urgencia: Urgencia; recursos: string[];
  tem_sala: boolean | null; voltagem: Voltagem | null; tem_projetor: boolean | null; precisa_projetor: boolean | null;
  tem_internet: boolean | null; tem_som: boolean | null; tem_espaco_cafe: boolean | null; precisa_transporte: boolean | null;
  observacoes: string | null; declaracao: string | null; confirmado_em: string | null;
  decidido_por: string | null; decidido_em: string | null; motivo_reprovacao: string | null; devolucao_motivo: string | null;
  data_confirmada: string | null; horario_confirmado: string | null; instrutor: string | null; obs_treinamentos: string | null;
  concluida_em: string | null; cancelada_em: string | null; cancelada_por: string | null; cancelamento_motivo: string | null;
  created_at: string; updated_at: string;
}

export interface EventoSolTreinamento {
  id: number; solicitacao_id: number; acao: string; de_status: string | null; para_status: string | null;
  texto: string | null; autor_nome: string | null; created_at: string;
}

export const ETAPAS = [
  { n: 1, titulo: "Identificação", subtitulo: "Identificação da solicitação" },
  { n: 2, titulo: "Necessidade", subtitulo: "Necessidade do treinamento" },
  { n: 3, titulo: "Participantes", subtitulo: "Público e participantes" },
  { n: 4, titulo: "Estrutura", subtitulo: "Estrutura, local e checklist" },
  { n: 5, titulo: "Confirmação", subtitulo: "Revisão e confirmação" },
] as const;

export const MODALIDADES: { v: Modalidade; r: string }[] = [
  { v: "presencial", r: "Presencial" }, { v: "online", r: "Online" }, { v: "hibrida", r: "Híbrida" },
];
export const RECURSOS: { v: string; r: string }[] = [
  { v: "sala", r: "Sala de treinamento" }, { v: "projetor_computador", r: "Projetor e computador" },
  { v: "materiais_impressos", r: "Materiais impressos" }, { v: "instrutor", r: "Instrutor especializado" },
  { v: "transporte", r: "Transporte dos participantes" },
];
export const VOLTAGENS: { v: Voltagem; r: string }[] = [{ v: "110", r: "110/127V" }, { v: "220", r: "220V" }, { v: "ambas", r: "Ambas" }];

/** As perguntas Sim/Não do checklist do local, na ordem do modelo. */
export const CHECKLIST: { secao: string; campo: keyof FormTreinamento; pergunta: string }[] = [
  { secao: "1. Estrutura do local", campo: "tem_sala", pergunta: "O local possui sala disponível para realizar o treinamento?" },
  { secao: "2. Equipamentos e infraestrutura", campo: "tem_projetor", pergunta: "O local possui projetor disponível?" },
  { secao: "2. Equipamentos e infraestrutura", campo: "precisa_projetor", pergunta: "Será necessário solicitar projetor ao setor de Treinamentos?" },
  { secao: "2. Equipamentos e infraestrutura", campo: "tem_internet", pergunta: "O local possui acesso à internet?" },
  { secao: "2. Equipamentos e infraestrutura", campo: "tem_som", pergunta: "O local possui caixa de som e microfone?" },
  { secao: "3. Espaço para café", campo: "tem_espaco_cafe", pergunta: "Existe espaço adequado para organizar e servir café?" },
  { secao: "4. Transporte e deslocamento", campo: "precisa_transporte", pergunta: "Será necessário transporte para os participantes?" },
];

export const DECLARACAO =
  "Declaro que todas as informações fornecidas foram verificadas e confirmadas, correspondendo às condições reais do local e às " +
  "necessidades do treinamento. Estou ciente de que serão utilizadas para elaboração do ofício e organização das atividades.";

export const precisaLocal = (f: Pick<FormTreinamento, "modalidade">) => f.modalidade !== "online";

/** Erros de UMA etapa (1–4); a 5 junta todas e exige a confirmação. */
export function errosEtapa(f: FormTreinamento, etapa: number): string[] {
  const e: string[] = [];
  if (etapa === 1) {
    if (!f.contrato_nome.trim()) e.push("Escolha o contrato / unidade.");
  } else if (etapa === 2) {
    if (!f.treinamento.trim()) e.push("Informe qual treinamento está solicitando.");
    if (!f.motivo.trim()) e.push("Informe por que o treinamento é necessário.");
    if (!f.assuntos.trim()) e.push("Informe os assuntos que precisam ser abordados.");
  } else if (etapa === 3) {
    const q = Number(f.qtd_participantes);
    if (!f.qtd_participantes.trim() || !Number.isInteger(q) || q < 1) e.push("Informe a quantidade de colaboradores.");
    else if (q > 5000) e.push("Quantidade de colaboradores fora do limite.");
  } else if (etapa === 4) {
    if (precisaLocal(f)) {
      if (!f.local_treinamento.trim()) e.push("Informe o local e o endereço completo do treinamento.");
      if (f.tem_sala === null) e.push("Responda se o local tem sala disponível.");
      if (!f.voltagem) e.push("Informe a voltagem das tomadas.");
      if (CHECKLIST.some((c) => c.campo !== "tem_sala" && f[c.campo] === null)) e.push("Responda todas as perguntas do checklist do local.");
    }
    if (!f.data_preferencial) e.push("Informe a data prevista.");
    if (!f.horario_inicio || !f.horario_fim) e.push("Informe o horário de início e de término.");
    else if (f.horario_fim <= f.horario_inicio) e.push("O horário de término tem que ser depois do início.");
    if (f.urgencia === "prioritario" && !f.observacoes.trim()) e.push("Prioritário: justifique a urgência nas observações.");
  } else if (etapa === 5) {
    const antes = [1, 2, 3, 4].flatMap((n) => errosEtapa(f, n));
    if (antes.length) return ["Preencha os campos obrigatórios das etapas anteriores.", ...antes];
    if (!f.confirmado) e.push("Confirme a veracidade das informações para enviar.");
  }
  return e;
}

/** Primeira etapa com pendência (para "voltar ao que falta"); null = tudo certo até a 4. */
export function primeiraEtapaComErro(f: FormTreinamento): number | null {
  for (const n of [1, 2, 3, 4]) if (errosEtapa(f, n).length) return n;
  return null;
}

/** Respondidas do checklist (o "0 de 8 respostas" do modelo: sala, voltagem e as 6 Sim/Não). */
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
    modalidade: f.modalidade, local_treinamento: f.local_treinamento.trim(), data_preferencial: f.data_preferencial,
    horario_inicio: f.horario_inicio, horario_fim: f.horario_fim, urgencia: f.urgencia, recursos: f.recursos,
    tem_sala: local ? f.tem_sala : null, voltagem: local ? f.voltagem || null : null,
    tem_projetor: local ? f.tem_projetor : null, precisa_projetor: local ? f.precisa_projetor : null,
    tem_internet: local ? f.tem_internet : null, tem_som: local ? f.tem_som : null,
    tem_espaco_cafe: local ? f.tem_espaco_cafe : null, precisa_transporte: local ? f.precisa_transporte : null,
    observacoes: f.observacoes.trim(), confirmado: f.confirmado,
  };
}

/** Uma solicitação devolvida volta para o formulário (o encarregado corrige). */
export function formDaSolicitacao(s: SolicitacaoTreinamento): FormTreinamento {
  return {
    contrato: s.contrato_empresa != null && s.contrato_filial != null ? `${s.contrato_empresa}__${s.contrato_filial}` : "",
    contrato_nome: s.contrato_nome, treinamento: s.treinamento, motivo: s.motivo, objetivo: s.objetivo ?? "", assuntos: s.assuntos,
    qtd_participantes: String(s.qtd_participantes), equipe: s.equipe ?? "", turnos: s.turnos ?? "",
    modalidade: s.modalidade, local_treinamento: s.local_treinamento ?? "", data_preferencial: s.data_preferencial ?? "",
    horario_inicio: (s.horario_inicio ?? "").slice(0, 5), horario_fim: (s.horario_fim ?? "").slice(0, 5),
    urgencia: s.urgencia, recursos: s.recursos ?? [],
    tem_sala: s.tem_sala, voltagem: s.voltagem ?? "", tem_projetor: s.tem_projetor, precisa_projetor: s.precisa_projetor,
    tem_internet: s.tem_internet, tem_som: s.tem_som, tem_espaco_cafe: s.tem_espaco_cafe, precisa_transporte: s.precisa_transporte,
    observacoes: s.observacoes ?? "", confirmado: false,
  };
}

// ── Leitura (resumo, ofício, status) ────────────────────────────────────────

export const STATUS_SOL_TREINAMENTO: Record<StatusSolTreinamento, { rotulo: string; cor: string }> = {
  pendente:  { rotulo: "Aguardando Treinamentos", cor: "bg-amber-100 text-amber-800 border-amber-200" },
  aprovada:  { rotulo: "Aprovada",               cor: "bg-sky-100 text-sky-800 border-sky-200" },
  agendada:  { rotulo: "Agendada",               cor: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  concluida: { rotulo: "Realizada",              cor: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  reprovada: { rotulo: "Reprovada",              cor: "bg-red-100 text-red-700 border-red-200" },
  cancelada: { rotulo: "Cancelada",              cor: "bg-slate-100 text-slate-600 border-slate-200" },
};

/** Pendente devolvida aparece como "Ajuste solicitado". */
export function rotuloStatus(s: Pick<SolicitacaoTreinamento, "status" | "devolucao_motivo">): string {
  if (s.status === "pendente" && s.devolucao_motivo) return "Ajuste solicitado";
  return STATUS_SOL_TREINAMENTO[s.status]?.rotulo ?? s.status;
}

export const ROTULO_EVENTO: Record<string, string> = {
  enviada: "Enviada", reenviada: "Corrigida e reenviada", aprovada: "Aprovada", agendada: "Agendada",
  concluida: "Realizada", reprovada: "Reprovada", devolvida: "Devolvida para ajuste", cancelada: "Cancelada",
};

const simNao = (b: boolean | null | undefined) => (b == null ? "Não informado" : b ? "Sim" : "Não");
const fmtData = (s: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "A definir";
};
const hora = (s: string | null | undefined) => (s ? s.slice(0, 5) : "—");
const rotuloDe = <T extends string>(lista: { v: T; r: string }[], v: T | string | null | undefined) => lista.find((x) => x.v === v)?.r ?? (v || "—");

type Leitura = Pick<SolicitacaoTreinamento, "contrato_nome" | "treinamento" | "motivo" | "objetivo" | "assuntos" | "qtd_participantes"
  | "equipe" | "turnos" | "modalidade" | "local_treinamento" | "data_preferencial" | "horario_inicio" | "horario_fim" | "urgencia"
  | "recursos" | "tem_sala" | "voltagem" | "tem_projetor" | "precisa_projetor" | "tem_internet" | "tem_som" | "tem_espaco_cafe"
  | "precisa_transporte" | "observacoes"> & { solicitante_nome?: string | null; protocolo?: string | null };

/** As seções da ficha (resumo da etapa 5 e detalhe de Treinamentos). */
export function secoesFicha(s: Leitura): { titulo: string; itens: [string, string][] }[] {
  const local = s.modalidade !== "online";
  return [
    { titulo: "Identificação", itens: [["Solicitante", s.solicitante_nome || "—"], ["Contrato / Unidade", s.contrato_nome || "—"]] },
    { titulo: "Necessidade", itens: [
      ["Treinamento", s.treinamento || "—"], ["Por que é necessário", s.motivo || "—"],
      ["O que devem aprender", s.objetivo || "—"], ["Assuntos a abordar", s.assuntos || "—"]] },
    { titulo: "Participantes", itens: [
      ["Quantidade de colaboradores", s.qtd_participantes ? String(s.qtd_participantes) : "—"],
      ["Equipe", s.equipe || "—"], ["Turnos", s.turnos || "—"]] },
    { titulo: "Estrutura", itens: [
      ["Modalidade", rotuloDe(MODALIDADES, s.modalidade)],
      ["Local e endereço", local ? s.local_treinamento || "—" : "Online"],
      ["Data prevista", fmtData(s.data_preferencial)],
      ["Horário", `${hora(s.horario_inicio)} às ${hora(s.horario_fim)}`],
      ["Prazo / urgência", s.urgencia === "prioritario" ? "Prioritário" : "Programável"],
      ["Recursos necessários", (s.recursos ?? []).map((r) => rotuloDe(RECURSOS, r)).join(", ") || "Nenhum"]] },
    ...(local ? [{ titulo: "Checklist do local", itens: [
      ["Sala disponível", simNao(s.tem_sala)], ["Voltagem das tomadas", rotuloDe(VOLTAGENS, s.voltagem)],
      ["Projetor no local", simNao(s.tem_projetor)], ["Solicitar projetor a Treinamentos", simNao(s.precisa_projetor)],
      ["Internet", simNao(s.tem_internet)], ["Caixa de som e microfone", simNao(s.tem_som)],
      ["Espaço para café", simNao(s.tem_espaco_cafe)], ["Transporte para os participantes", simNao(s.precisa_transporte)],
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

/** Ações de Treinamentos conforme o status. */
export function acoesPermitidas(s: Pick<SolicitacaoTreinamento, "status">): ("aprovar" | "reprovar" | "devolver" | "agendar" | "concluir" | "cancelar")[] {
  switch (s.status) {
    case "pendente": return ["aprovar", "devolver", "reprovar", "cancelar"];
    case "aprovada": return ["agendar", "concluir", "cancelar"];
    case "agendada": return ["agendar", "concluir", "cancelar"];
    default: return [];
  }
}

/** Ordem da fila de Treinamentos: prioritários pendentes primeiro, depois pela data prevista. */
export function ordenarFila<T extends Pick<SolicitacaoTreinamento, "status" | "urgencia" | "data_preferencial" | "created_at">>(lista: T[]): T[] {
  const peso = (s: T) => (s.status === "pendente" ? (s.urgencia === "prioritario" ? 0 : 1) : s.status === "aprovada" || s.status === "agendada" ? 2 : 3);
  return [...lista].sort((a, b) => peso(a) - peso(b)
    || String(a.data_preferencial ?? "9999").localeCompare(String(b.data_preferencial ?? "9999"))
    || b.created_at.localeCompare(a.created_at));
}
