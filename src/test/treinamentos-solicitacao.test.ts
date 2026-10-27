import { describe, expect, it } from "vitest";
import {
  FORM_VAZIO, acoesEncarregado, acoesPermitidas, comData, datasPrevistas, errosEtapa, formDaSolicitacao, ordenarFila, paraEnvio,
  primeiraEtapaComErro, progressoChecklist, rotuloStatus, secoesFicha, textoOficio, ETAPAS, ULTIMA_ETAPA,
  type FormTreinamento, type SolicitacaoTreinamento,
} from "@/lib/treinamentos/solicitacaoTreinamento";

const completo: FormTreinamento = {
  ...FORM_VAZIO,
  contrato: "1__1050", contrato_nome: "UFRGS - LIMPEZA GERAL",
  treinamento: "NR-35", motivo: "Trabalho em altura nas fachadas", objetivo: "Usar o cinto corretamente", assuntos: "Ancoragem, EPI, resgate",
  qtd_participantes: "25", equipe: "Limpeza de vidros", turnos: "manhã e tarde",
  modalidade: "presencial", local_treinamento: "Campus Centro — Av. Paulo Gama, 110", datas_previstas: ["2026-11-10", "2026-11-12"],
  urgencia: "programavel",
  tem_sala: true, voltagem: "220", tem_projetor: false, precisa_projetor: true, tem_internet: true, tem_som: false,
  tem_espaco_cafe: true, observacoes: "", confirmado: true,
};

describe("etapas do formulário (mesmas regras do banco)", () => {
  it("são 4: a Estrutura entrou na Necessidade", () => {
    expect(ETAPAS.map((e) => e.titulo)).toEqual(["Identificação", "Necessidade", "Participantes", "Confirmação"]);
    expect(ULTIMA_ETAPA).toBe(4);
  });
  it("formulário completo passa em todas", () => {
    for (const n of [1, 2, 3, 4]) expect(errosEtapa(completo, n)).toEqual([]);
  });
  it("etapa 1 exige contrato; 2 treinamento, motivo e assuntos; 3 quantidade", () => {
    expect(errosEtapa({ ...completo, contrato_nome: "" }, 1)).toEqual(["Escolha o contrato / unidade."]);
    expect(errosEtapa({ ...completo, treinamento: "", motivo: " ", assuntos: "" }, 2)).toHaveLength(3);
    expect(errosEtapa({ ...completo, objetivo: "" }, 2)).toEqual([]);   // opcional
    expect(errosEtapa({ ...completo, qtd_participantes: "0" }, 3)).toEqual(["Informe a quantidade de colaboradores."]);
    expect(errosEtapa({ ...completo, qtd_participantes: "2,5" }, 3)).toEqual(["Informe a quantidade de colaboradores."]);
  });
  it("etapa 2: checklist completo no presencial; online dispensa local e checklist", () => {
    expect(errosEtapa({ ...completo, tem_som: null }, 2)).toEqual(["Responda todas as perguntas do checklist do local."]);
    expect(errosEtapa({ ...completo, voltagem: "" }, 2)).toEqual(["Informe a voltagem das tomadas."]);
    const online = { ...completo, modalidade: "online" as const, local_treinamento: "", tem_sala: null, voltagem: "" as const, tem_som: null };
    expect(errosEtapa(online, 2)).toEqual([]);
  });
  it("etapa 2: ao menos uma data e urgência prioritária justificada", () => {
    expect(errosEtapa({ ...completo, datas_previstas: [] }, 2)).toEqual(["Informe ao menos uma data prevista."]);
    expect(errosEtapa({ ...completo, urgencia: "prioritario" }, 2)).toEqual(["Prioritário: justifique a urgência nas observações."]);
    expect(errosEtapa({ ...completo, urgencia: "prioritario", observacoes: "Fiscalização marcada" }, 2)).toEqual([]);
  });
  it("comData: sem repetir, em ordem, só data válida", () => {
    expect(comData(["2026-11-12"], "2026-11-10")).toEqual(["2026-11-10", "2026-11-12"]);
    expect(comData(["2026-11-12"], "2026-11-12")).toEqual(["2026-11-12"]);
    expect(comData([], "")).toEqual([]);
  });
  it("confirmação exige as anteriores e o aceite", () => {
    expect(errosEtapa({ ...completo, confirmado: false }, 4)).toEqual(["Confirme a veracidade das informações para enviar."]);
    expect(errosEtapa({ ...completo, treinamento: "" }, 4)[0]).toBe("Preencha os campos obrigatórios das etapas anteriores.");
    expect(primeiraEtapaComErro({ ...completo, qtd_participantes: "" })).toBe(3);
    expect(primeiraEtapaComErro(completo)).toBeNull();
  });
  it("progresso do checklist (7 respostas, sem transporte)", () => {
    expect(progressoChecklist(FORM_VAZIO)).toEqual({ respondidas: 0, total: 7 });
    expect(progressoChecklist(completo)).toEqual({ respondidas: 7, total: 7 });
  });
});

describe("envio e volta para o formulário", () => {
  it("manda o contrato separado, as datas e zera o checklist no online", () => {
    const p = paraEnvio(completo);
    expect(p).toMatchObject({ contrato_empresa: 1, contrato_filial: 1050, qtd_participantes: 25, tem_sala: true, voltagem: "220", confirmado: true,
      datas_previstas: ["2026-11-10", "2026-11-12"] });
    expect(p).not.toHaveProperty("horario_inicio");
    expect(p).not.toHaveProperty("recursos");
    expect(paraEnvio({ ...completo, modalidade: "online" })).toMatchObject({ tem_sala: null, voltagem: null, local_treinamento: "" });
  });
  it("solicitação devolvida volta ao formulário sem a confirmação; antiga (híbrida, data única) também", () => {
    const s = { ...paraEnvio(completo), id: 1, protocolo: "TRN-2026-0001", status: "pendente", contrato_nome: "UFRGS - LIMPEZA GERAL",
      objetivo: null, equipe: null, turnos: null, observacoes: null } as unknown as SolicitacaoTreinamento;
    const f = formDaSolicitacao(s);
    expect(f.contrato).toBe("1__1050");
    expect(f.datas_previstas).toEqual(["2026-11-10", "2026-11-12"]);
    expect(f.confirmado).toBe(false);
    expect(f.objetivo).toBe("");
    const antiga = formDaSolicitacao({ ...s, modalidade: "hibrida" as never, datas_previstas: [], data_preferencial: "2026-11-05" });
    expect(antiga.modalidade).toBe("presencial");
    expect(antiga.datas_previstas).toEqual(["2026-11-05"]);
    expect(datasPrevistas({ datas_previstas: null, data_preferencial: null })).toEqual([]);
  });
});

describe("leitura para Treinamentos", () => {
  const s = { ...completo, qtd_participantes: 25, voltagem: "220" as const, solicitante_nome: "IDALECIO", protocolo: "TRN-2026-0001",
    objetivo: completo.objetivo, equipe: completo.equipe, turnos: completo.turnos, observacoes: null };
  it("ficha sem seção Estrutura; checklist só no presencial", () => {
    const titulos = secoesFicha(s).map((x) => x.titulo);
    expect(titulos).toContain("Checklist do local");
    expect(titulos).not.toContain("Estrutura");
    expect(secoesFicha({ ...s, modalidade: "online" }).map((x) => x.titulo)).not.toContain("Checklist do local");
  });
  it("texto do ofício: protocolo, datas e respostas legíveis; sem horário, recursos e transporte", () => {
    const t = textoOficio(s);
    expect(t.startsWith("SOLICITAÇÃO DE TREINAMENTO — TRN-2026-0001")).toBe(true);
    expect(t).toContain("Datas previstas: 10/11/2026, 12/11/2026");
    expect(t).toContain("Modalidade: Presencial");
    expect(t).toContain("Voltagem das tomadas: 220V");
    expect(t).toContain("Solicitar projetor a Treinamentos: Sim");
    expect(t).not.toContain("Horário");
    expect(t).not.toContain("Recursos");
    expect(t).not.toContain("Transporte");
    expect(textoOficio({ ...s, datas_previstas: ["2026-11-10"] })).toContain("Data prevista: 10/11/2026");
  });
  it("fluxo: aceitar/reprovar → informar data → encarregado aprova ou pede outra", () => {
    expect(rotuloStatus({ status: "pendente", devolucao_motivo: "Falta endereço" })).toBe("Ajuste solicitado");
    expect(rotuloStatus({ status: "aprovada", devolucao_motivo: null, data_recusa_motivo: "Dia de folga" })).toBe("Nova data solicitada");
    expect(rotuloStatus({ status: "concluida", devolucao_motivo: null })).toBe("Realizada");
    expect(acoesPermitidas({ status: "pendente" })).toEqual(["aprovar", "devolver", "reprovar", "cancelar"]);
    expect(acoesPermitidas({ status: "aprovada" })).toContain("informar_data");
    expect(acoesPermitidas({ status: "data_informada" })).not.toContain("concluir");
    expect(acoesPermitidas({ status: "reprovada" })).toEqual([]);
    expect(acoesEncarregado({ status: "data_informada" })).toEqual(["aprovar_data", "pedir_outra_data"]);
    expect(acoesEncarregado({ status: "aprovada" })).toEqual([]);
    expect(acoesEncarregado({ status: "pendente" })).toEqual(["cancelar"]);
  });
  it("fila", () => {
    const f = ordenarFila([
      { id: 1, status: "pendente", urgencia: "programavel", data_preferencial: "2026-11-01", created_at: "a" },
      { id: 2, status: "concluida", urgencia: "programavel", data_preferencial: "2026-10-01", created_at: "b" },
      { id: 3, status: "pendente", urgencia: "prioritario", data_preferencial: "2026-12-01", created_at: "c" },
      { id: 4, status: "data_informada", urgencia: "programavel", data_preferencial: "2026-10-30", created_at: "d" },
    ] as never[]);
    expect(f.map((x: { id: number }) => x.id)).toEqual([3, 1, 4, 2]);
  });
});
