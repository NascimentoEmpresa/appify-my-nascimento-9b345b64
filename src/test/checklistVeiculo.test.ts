import { describe, expect, it } from "vitest";
import {
  agendamentosComPendencia,
  avisoParaUsuario,
  camposFaltando,
  chegadaPrevistaPadrao,
  checklistCompleto,
  pendenciasDoAgendamento,
  situacaoChecklist,
  textoHistoricoPendencia,
  validarChegadaPrevista,
  type AgendamentoParaChecklist,
  type ChecklistVeiculo,
} from "@/lib/checklistVeiculo";

const ag = (x: Partial<AgendamentoParaChecklist> = {}): AgendamentoParaChecklist => ({
  id: "a1",
  numero: 13,
  veiculo_nome: "HILUX",
  veiculo_identificador: "JBZ-4D93",
  data_inicio: "2026-11-04",
  data_fim: "2026-11-04",
  turno: "dia_todo",
  status: "confirmado",
  solicitante_nome: "Fulano de Tal",
  checklist_exigido: true,
  chegada_prevista: "2026-11-04T17:00:00",
  ...x,
});

const completo = (tipo: "saida" | "chegada", x: Partial<ChecklistVeiculo> = {}): ChecklistVeiculo => ({
  agendamento_id: "a1",
  tipo,
  foto_lateral_direita: "p/1",
  foto_lateral_esquerda: "p/2",
  foto_dianteira: "p/3",
  foto_traseira: "p/4",
  fotos_interior: ["i1", "i2", "i3", "i4"],
  foto_km: "p/km",
  ...x,
});

const as = (h: string) => new Date(`2026-11-04T${h}:00`);

describe("checklist de veículo — completude", () => {
  it("sem nada, falta tudo", () => {
    expect(camposFaltando(null)).toEqual([
      "Foto lateral direita", "Foto lateral esquerda", "Foto dianteira", "Foto traseira",
      "4 fotos do interior", "Foto do KM",
    ]);
    expect(checklistCompleto(null)).toBe(false);
  });

  it("interior pela metade diz quantas faltam; defeito é opcional", () => {
    const c = completo("saida", { fotos_interior: ["i1", "i2", "i3"], fotos_defeito: null });
    expect(camposFaltando(c)).toEqual(["1 foto do interior"]);
    expect(checklistCompleto({ ...c, fotos_interior: ["a", "b", "c", "d"] })).toBe(true);
  });

  it("respeita a coluna gerada do banco quando ela vem", () => {
    expect(checklistCompleto({ ...completo("saida"), completo: false })).toBe(false);
  });
});

describe("checklist de veículo — o que está atrasado", () => {
  it("antes da saída não cobra nada", () => {
    expect(pendenciasDoAgendamento(ag(), [], as("07:59"))).toEqual({ saida: false, chegada: false });
  });

  it("começou a viagem: cobra a saída; passou a provável chegada: cobra a chegada", () => {
    expect(pendenciasDoAgendamento(ag(), [], as("08:00"))).toEqual({ saida: true, chegada: false });
    expect(pendenciasDoAgendamento(ag(), [], as("17:00"))).toEqual({ saida: true, chegada: true });
  });

  it("turno da tarde começa às 13h", () => {
    expect(pendenciasDoAgendamento(ag({ turno: "tarde" }), [], as("12:30")).saida).toBe(false);
    expect(pendenciasDoAgendamento(ag({ turno: "tarde" }), [], as("13:00")).saida).toBe(true);
  });

  it("sem provável chegada (antigo) usa o fim do turno do retorno", () => {
    const a = ag({ chegada_prevista: null, turno: "manha" });
    expect(pendenciasDoAgendamento(a, [], as("11:59")).chegada).toBe(false);
    expect(pendenciasDoAgendamento(a, [], as("12:00")).chegada).toBe(true);
  });

  it("checklist completo tira a pendência; incompleto não", () => {
    const meio = completo("chegada", { foto_km: null });
    expect(pendenciasDoAgendamento(ag(), [completo("saida"), meio], as("18:00"))).toEqual({ saida: false, chegada: true });
  });

  it("checklist de outro agendamento não conta", () => {
    expect(pendenciasDoAgendamento(ag(), [completo("saida", { agendamento_id: "outro" })], as("09:00")).saida).toBe(true);
  });

  it("cancelado ou anterior ao checklist não cobra", () => {
    expect(pendenciasDoAgendamento(ag({ status: "cancelado" }), [], as("23:00"))).toEqual({ saida: false, chegada: false });
    expect(pendenciasDoAgendamento(ag({ checklist_exigido: false }), [], as("23:00"))).toEqual({ saida: false, chegada: false });
  });

  it("'Não usei o carro no dia' não cobra checklist", () => {
    const a = ag({ nao_utilizado_em: "2026-11-05T10:00:00-03:00" });
    expect(pendenciasDoAgendamento(a, [], as("23:00"))).toEqual({ saida: false, chegada: false });
    expect(situacaoChecklist(a, "chegada", null, as("23:00"))).toBe("nao_exigido");
  });

  it("situação do chip", () => {
    expect(situacaoChecklist(ag(), "chegada", null, as("09:00"))).toBe("aguardando");
    expect(situacaoChecklist(ag(), "saida", null, as("09:00"))).toBe("pendente");
    expect(situacaoChecklist(ag(), "saida", completo("saida", { foto_km: null }), as("09:00"))).toBe("incompleto");
    expect(situacaoChecklist(ag(), "saida", completo("saida"), as("09:00"))).toBe("preenchido");
    expect(situacaoChecklist(ag({ checklist_exigido: false }), "saida", null, as("09:00"))).toBe("nao_exigido");
  });

  it("lista do mais antigo para o mais novo, só quem tem pendência", () => {
    const lista = agendamentosComPendencia(
      [ag({ id: "b", numero: 20, data_inicio: "2026-11-04" }), ag({ id: "a", numero: 10, data_inicio: "2026-11-03", data_fim: "2026-11-03", chegada_prevista: null }), ag({ id: "c", numero: 30, data_inicio: "2026-11-10", data_fim: "2026-11-10", chegada_prevista: null })],
      [],
      as("09:00"),
    );
    expect(lista.map((x) => x.agendamento.numero)).toEqual([10, 20]);
    expect(lista[0].pendencia).toEqual({ saida: true, chegada: true });
  });
});

describe("checklist de veículo — textos", () => {
  it("histórico explícito nas três variações", () => {
    expect(textoHistoricoPendencia("Fulano de Tal", ag(), { saida: true, chegada: true }))
      .toBe("FULANO DE TAL NÃO PREENCHEU A SAÍDA E A CHEGADA do agendamento nº 13 (HILUX JBZ-4D93 · 04/11/2026)");
    expect(textoHistoricoPendencia("Fulano", ag(), { saida: true, chegada: false })).toContain("NÃO PREENCHEU A SAÍDA do");
    expect(textoHistoricoPendencia("Fulano", ag(), { saida: false, chegada: true })).toContain("NÃO PREENCHEU A CHEGADA do");
    expect(textoHistoricoPendencia("Fulano", ag(), { saida: false, chegada: false })).toBeNull();
  });

  it("período de vários dias e sem placa", () => {
    expect(textoHistoricoPendencia(null, ag({ veiculo_identificador: null, data_fim: "2026-11-06" }), { saida: true, chegada: true }))
      .toBe("USUÁRIO SEM NOME NÃO PREENCHEU A SAÍDA E A CHEGADA do agendamento nº 13 (HILUX · 04/11/2026 a 06/11/2026)");
  });

  it("aviso para o usuário", () => {
    expect(avisoParaUsuario(ag(), { saida: false, chegada: true }))
      .toBe("VOCÊ PRECISA PREENCHER A CHEGADA do veículo HILUX (agendamento nº 13, 04/11/2026)");
  });
});

describe("provável chegada", () => {
  it("sugestão é o fim do turno do retorno", () => {
    expect(chegadaPrevistaPadrao("2026-11-05", "manha")).toBe("2026-11-05T12:00");
    expect(chegadaPrevistaPadrao("2026-11-05", "dia_todo")).toBe("2026-11-05T18:00");
  });

  it("obrigatória e não antes da saída", () => {
    const a = { data_inicio: "2026-11-04", turno: "tarde" as const };
    expect(validarChegadaPrevista("", a)).toMatch(/Informe/);
    expect(validarChegadaPrevista("2026-11-04T12:00", a)).toMatch(/antes da saída/);
    expect(validarChegadaPrevista("2026-11-04T13:00", a)).toBeNull();
  });
});
