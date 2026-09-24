// Dashboard de Agendamento de Veículos (24/09/2026): as regras que o painel
// e o relatório exportado compartilham — situação no tempo, período que
// "encosta", dias da reserva, km e custo. Ver src/lib/veiculos/dashboardVeiculos.ts.
import { describe, expect, it } from "vitest";
import {
  diasDaReserva, filtrar, indicadores, intervaloDo, porContrato, porMes, porVeiculo, situacaoDe,
  type AbastecimentoDash, type AgendamentoDash,
} from "@/lib/veiculos/dashboardVeiculos";

const HOJE = "2026-09-24";
let n = 0;
function ag(p: Partial<AgendamentoDash>): AgendamentoDash {
  n++;
  return {
    id: `a${n}`, numero: n, patrimonio_id: "carro1", veiculo_nome: "HILUX", veiculo_identificador: "JAA-5D04",
    data_inicio: "2026-09-10", data_fim: "2026-09-10", turno: "dia_todo", destino: null, motivo: null, observacoes: null,
    status: "confirmado", motivo_cancelamento: null, solicitante_id: "u1", solicitante_nome: "Ana", created_at: "2026-09-01T10:00:00Z",
    km_inicial: null, km_inicial_em: null, km_final: null, km_final_em: null, contratos: [], ...p,
  };
}

describe("situação no tempo", () => {
  it("cancelado ganha de qualquer data", () => {
    expect(situacaoDe(ag({ status: "cancelado", data_inicio: "2026-10-01", data_fim: "2026-10-01" }), HOJE)).toBe("Cancelado");
  });
  it("futuro = Agendado, passado = Realizado, hoje dentro = Em andamento", () => {
    expect(situacaoDe(ag({ data_inicio: "2026-09-25", data_fim: "2026-09-25" }), HOJE)).toBe("Agendado");
    expect(situacaoDe(ag({ data_inicio: "2026-09-20", data_fim: "2026-09-23" }), HOJE)).toBe("Realizado");
    expect(situacaoDe(ag({ data_inicio: "2026-09-23", data_fim: "2026-09-26" }), HOJE)).toBe("Em andamento");
    expect(situacaoDe(ag({ data_inicio: HOJE, data_fim: HOJE }), HOJE)).toBe("Em andamento");
  });
});

describe("período", () => {
  it("'este mês' e 'mês passado' viram datas certas (inclusive fevereiro)", () => {
    expect(intervaloDo("mes", HOJE)).toEqual(["2026-09-01", "2026-09-30"]);
    expect(intervaloDo("mes_passado", "2026-03-10")).toEqual(["2026-02-01", "2026-02-28"]);
  });
  it("reserva que atravessa o fim do mês aparece nos dois meses", () => {
    const a = ag({ data_inicio: "2026-08-30", data_fim: "2026-09-02" });
    expect(filtrar([a], { periodo: "mes" }, HOJE)).toHaveLength(1);
    expect(filtrar([a], { periodo: "mes_passado" }, HOJE)).toHaveLength(1);
  });
  it("filtra por veículo e por situação", () => {
    const l = [ag({ patrimonio_id: "x" }), ag({ patrimonio_id: "y", status: "cancelado" })];
    expect(filtrar(l, { periodo: "tudo", veiculo: "x" }, HOJE)).toHaveLength(1);
    expect(filtrar(l, { periodo: "tudo", situacao: "Cancelado" }, HOJE).map((a) => a.patrimonio_id)).toEqual(["y"]);
  });
});

describe("indicadores", () => {
  it("dias contam início e fim; cancelada não conta dia, veículo nem contrato", () => {
    expect(diasDaReserva({ data_inicio: "2026-09-10", data_fim: "2026-09-12" })).toBe(3);
    const l = [
      ag({ data_inicio: "2026-09-10", data_fim: "2026-09-12", contratos: [{ contrato_codigo: 1, contrato_nome: "UFRGS", administrativo: false }] }),
      ag({ status: "cancelado", patrimonio_id: "outro", contratos: [{ contrato_codigo: 2, contrato_nome: "SMS", administrativo: false }] }),
    ];
    const i = indicadores(l, [], HOJE);
    expect(i.total).toBe(2);
    expect(i.diasReservados).toBe(3);
    expect(i.veiculosUsados).toBe(1);
    expect(i.contratosAtendidos).toBe(1);
    expect(i.taxaCancelamento).toBe(0.5);
  });
  it("km rodado e custo por km só com os dois lados preenchidos", () => {
    const a = ag({ km_inicial: 1000, km_final: 1250 });
    const b = ag({ km_inicial: 500, km_final: null });
    const notas: AbastecimentoDash[] = [{ id: "n1", agendamento_id: a.id, data: "2026-09-10", valor: 250, litros: 40, km: null,
      descricao: null, nome_arquivo: null, criado_por_nome: null, created_at: "2026-09-10T10:00:00Z", contratos: [] }];
    const i = indicadores([a, b], notas, HOJE);
    expect(i.kmRodados).toBe(250);
    expect(i.viagensComKm).toBe(1);
    expect(i.valorAbastecido).toBe(250);
    expect(i.custoPorKm).toBe(1);
    expect(porVeiculo([a, b], notas)[0]).toMatchObject({ reservas: 2, km: 250, valor: 250 });
  });
});

describe("agrupamentos", () => {
  it("por mês empilha as situações e ordena no tempo", () => {
    const l = [ag({ data_inicio: "2026-09-05", data_fim: "2026-09-05" }), ag({ data_inicio: "2026-08-05", data_fim: "2026-08-05", status: "cancelado" })];
    const m = porMes(l, HOJE);
    expect(m.map((x) => x.mes)).toEqual(["2026-08", "2026-09"]);
    expect(m[0].Cancelado).toBe(1);
    expect(m[1].Realizado).toBe(1);
  });
  it("por mês preenche com zero os meses sem agendamento no meio", () => {
    const l = [ag({ data_inicio: "2026-06-05", data_fim: "2026-06-05" }), ag({ data_inicio: "2026-09-05", data_fim: "2026-09-05" })];
    const m = porMes(l, HOJE);
    expect(m.map((x) => x.mes)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(m[1].total).toBe(0);
  });
  it("top de contratos junta o resto em 'Outros'", () => {
    const l = ["A", "A", "B", "C", "D"].map((nome) => ag({ contratos: [{ contrato_codigo: null, contrato_nome: nome, administrativo: false }] }));
    expect(porContrato(l, 2)).toEqual([{ nome: "A", qtd: 2 }, { nome: "B", qtd: 1 }, { nome: "Outros (2)", qtd: 2 }]);
  });
});
