import { describe, expect, it } from "vitest";
import {
  FORM_VAZIO, acoesPermitidas, errosEtapa, formDaSolicitacao, ordenarFila, paraEnvio, primeiraEtapaComErro, progressoChecklist,
  rotuloStatus, secoesFicha, textoOficio, type FormTreinamento, type SolicitacaoTreinamento,
} from "@/lib/treinamentos/solicitacaoTreinamento";

const completo: FormTreinamento = {
  ...FORM_VAZIO,
  contrato: "1__1050", contrato_nome: "UFRGS - LIMPEZA GERAL",
  treinamento: "NR-35", motivo: "Trabalho em altura nas fachadas", objetivo: "Usar o cinto corretamente", assuntos: "Ancoragem, EPI, resgate",
  qtd_participantes: "25", equipe: "Limpeza de vidros", turnos: "manhã e tarde",
  modalidade: "presencial", local_treinamento: "Campus Centro — Av. Paulo Gama, 110", data_preferencial: "2026-11-10",
  horario_inicio: "08:00", horario_fim: "12:00", urgencia: "programavel", recursos: ["sala", "instrutor"],
  tem_sala: true, voltagem: "220", tem_projetor: false, precisa_projetor: true, tem_internet: true, tem_som: false,
  tem_espaco_cafe: true, precisa_transporte: false, observacoes: "", confirmado: true,
};

describe("etapas do formulário (mesmas regras do banco)", () => {
  it("formulário completo passa em todas", () => {
    for (const n of [1, 2, 3, 4, 5]) expect(errosEtapa(completo, n)).toEqual([]);
  });
  it("etapa 1 exige contrato; 2 treinamento, motivo e assuntos; 3 quantidade", () => {
    expect(errosEtapa({ ...completo, contrato_nome: "" }, 1)).toEqual(["Escolha o contrato / unidade."]);
    expect(errosEtapa({ ...completo, treinamento: "", motivo: " ", assuntos: "" }, 2)).toHaveLength(3);
    expect(errosEtapa({ ...completo, objetivo: "" }, 2)).toEqual([]);   // opcional
    expect(errosEtapa({ ...completo, qtd_participantes: "0" }, 3)).toEqual(["Informe a quantidade de colaboradores."]);
    expect(errosEtapa({ ...completo, qtd_participantes: "2,5" }, 3)).toEqual(["Informe a quantidade de colaboradores."]);
  });
  it("etapa 4: checklist completo no presencial; online dispensa local e checklist", () => {
    expect(errosEtapa({ ...completo, tem_som: null }, 4)).toEqual(["Responda todas as perguntas do checklist do local."]);
    expect(errosEtapa({ ...completo, voltagem: "" }, 4)).toEqual(["Informe a voltagem das tomadas."]);
    const online = { ...completo, modalidade: "online" as const, local_treinamento: "", tem_sala: null, voltagem: "" as const, tem_som: null };
    expect(errosEtapa(online, 4)).toEqual([]);
  });
  it("etapa 4: horário e urgência prioritária justificada", () => {
    expect(errosEtapa({ ...completo, horario_fim: "07:00" }, 4)).toEqual(["O horário de término tem que ser depois do início."]);
    expect(errosEtapa({ ...completo, urgencia: "prioritario" }, 4)).toEqual(["Prioritário: justifique a urgência nas observações."]);
    expect(errosEtapa({ ...completo, urgencia: "prioritario", observacoes: "Fiscalização marcada" }, 4)).toEqual([]);
  });
  it("etapa 5 exige as anteriores e a confirmação", () => {
    expect(errosEtapa({ ...completo, confirmado: false }, 5)).toEqual(["Confirme a veracidade das informações para enviar."]);
    expect(errosEtapa({ ...completo, treinamento: "" }, 5)[0]).toBe("Preencha os campos obrigatórios das etapas anteriores.");
    expect(primeiraEtapaComErro({ ...completo, qtd_participantes: "" })).toBe(3);
    expect(primeiraEtapaComErro(completo)).toBeNull();
  });
  it("progresso do checklist (8 respostas)", () => {
    expect(progressoChecklist(FORM_VAZIO)).toEqual({ respondidas: 0, total: 8 });
    expect(progressoChecklist(completo)).toEqual({ respondidas: 8, total: 8 });
  });
});

describe("envio e volta para o formulário", () => {
  it("manda o contrato separado e zera o checklist no online", () => {
    const p = paraEnvio(completo);
    expect(p).toMatchObject({ contrato_empresa: 1, contrato_filial: 1050, qtd_participantes: 25, tem_sala: true, voltagem: "220", confirmado: true });
    expect(paraEnvio({ ...completo, modalidade: "online" })).toMatchObject({ tem_sala: null, voltagem: null, precisa_transporte: null });
  });
  it("solicitação devolvida volta ao formulário sem a confirmação", () => {
    const s = { ...paraEnvio(completo), id: 1, protocolo: "TRN-2026-0001", status: "pendente", contrato_nome: "UFRGS - LIMPEZA GERAL",
      horario_inicio: "08:00:00", horario_fim: "12:00:00", recursos: ["sala"], objetivo: null, equipe: null, turnos: null, observacoes: null } as unknown as SolicitacaoTreinamento;
    const f = formDaSolicitacao(s);
    expect(f.contrato).toBe("1__1050");
    expect(f.horario_inicio).toBe("08:00");
    expect(f.confirmado).toBe(false);
    expect(f.objetivo).toBe("");
  });
});

describe("leitura para Treinamentos", () => {
  const s = { ...completo, qtd_participantes: 25, voltagem: "220" as const, solicitante_nome: "IDALECIO", protocolo: "TRN-2026-0001",
    objetivo: completo.objetivo, equipe: completo.equipe, turnos: completo.turnos, observacoes: null };
  it("ficha com o checklist só no presencial", () => {
    expect(secoesFicha(s).map((x) => x.titulo)).toContain("Checklist do local");
    expect(secoesFicha({ ...s, modalidade: "online" }).map((x) => x.titulo)).not.toContain("Checklist do local");
  });
  it("texto do ofício: protocolo, rótulos e respostas legíveis", () => {
    const t = textoOficio(s);
    expect(t.startsWith("SOLICITAÇÃO DE TREINAMENTO — TRN-2026-0001")).toBe(true);
    expect(t).toContain("Data prevista: 10/11/2026");
    expect(t).toContain("Horário: 08:00 às 12:00");
    expect(t).toContain("Voltagem das tomadas: 220V");
    expect(t).toContain("Solicitar projetor a Treinamentos: Sim");
    expect(t).toContain("Recursos necessários: Sala de treinamento, Instrutor especializado");
  });
  it("status, ações e fila", () => {
    expect(rotuloStatus({ status: "pendente", devolucao_motivo: "Falta endereço" })).toBe("Ajuste solicitado");
    expect(rotuloStatus({ status: "concluida", devolucao_motivo: null })).toBe("Realizada");
    expect(acoesPermitidas({ status: "pendente" })).toEqual(["aprovar", "devolver", "reprovar", "cancelar"]);
    expect(acoesPermitidas({ status: "reprovada" })).toEqual([]);
    const f = ordenarFila([
      { id: 1, status: "pendente", urgencia: "programavel", data_preferencial: "2026-11-01", created_at: "a" },
      { id: 2, status: "concluida", urgencia: "programavel", data_preferencial: "2026-10-01", created_at: "b" },
      { id: 3, status: "pendente", urgencia: "prioritario", data_preferencial: "2026-12-01", created_at: "c" },
      { id: 4, status: "agendada", urgencia: "programavel", data_preferencial: "2026-10-30", created_at: "d" },
    ] as never[]);
    expect(f.map((x: { id: number }) => x.id)).toEqual([3, 1, 4, 2]);
  });
});
