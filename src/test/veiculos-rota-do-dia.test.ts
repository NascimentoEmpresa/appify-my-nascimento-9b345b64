import { describe, expect, it } from "vitest";
import { alertasKm, contarEstados, estadoDoDia, faltandoPrestacao, viagensDoDia, type ViagemDoDia } from "@/lib/veiculos/rotaDoDia";
import type { ChecklistVeiculo } from "@/lib/checklistVeiculo";

let seq = 0;
const v = (p: Partial<ViagemDoDia>): ViagemDoDia => ({
  id: `v${++seq}`, numero: seq, patrimonio_id: "carro1", veiculo_nome: "GOL", data_inicio: "2026-11-10", data_fim: "2026-11-10",
  turno: "dia_todo", status: "confirmado", solicitante_nome: "JOAO", ...p,
});
const ck = (agendamento_id: string, tipo: "saida" | "chegada", completo = true): ChecklistVeiculo => ({
  agendamento_id, tipo, foto_lateral_direita: "a", foto_lateral_esquerda: "b", foto_dianteira: "c", foto_traseira: "d",
  fotos_interior: ["1", "2", "3", "4"], foto_km: "k", completo, realizado_em: "2026-11-10T11:05:00Z",
});
// 10/11/2026 às 10:00 em Brasília (13:00 UTC); 07:00 = 10:00 UTC.
const DEZ = new Date("2026-11-10T13:00:00Z"), SETE = new Date("2026-11-10T10:00:00Z");

describe("prestação da viagem", () => {
  const completa = { avaria: false, avaria_descricao: null };
  it("completa com KM, abastecimento respondido (nota se Sim) e avaria respondida — vídeo e água/óleo não entram mais", () => {
    expect(faltandoPrestacao({ km_inicial: 1, km_final: 2, sem_abastecimento: false, houve_abastecimento: true }, completa, true)).toEqual([]);
    expect(faltandoPrestacao({ km_inicial: 1, km_final: 2, sem_abastecimento: false, houve_abastecimento: false }, completa, false)).toEqual([]);
    // "não abasteci" do checklist de chegada ainda vale como Não.
    expect(faltandoPrestacao({ km_inicial: 1, km_final: 2, sem_abastecimento: true, houve_abastecimento: null }, completa, false)).toEqual([]);
  });
  it("lista tudo o que falta", () => {
    expect(faltandoPrestacao({ km_inicial: null, km_final: null, sem_abastecimento: false, houve_abastecimento: null }, null, false)).toEqual([
      "KM de saída", "KM de retorno", "Responder se houve abastecimento", "Informar se há avaria",
    ]);
  });
  it("Sim sem nota exige a foto da nota; nota anexada basta mesmo sem resposta", () => {
    expect(faltandoPrestacao({ km_inicial: 1, km_final: 2, sem_abastecimento: false, houve_abastecimento: true }, completa, false)).toEqual(["Foto da nota do combustível"]);
    expect(faltandoPrestacao({ km_inicial: 1, km_final: 2, sem_abastecimento: false, houve_abastecimento: null }, completa, true)).toEqual([]);
  });
  it("avaria 'sim' exige descrição", () => {
    expect(faltandoPrestacao({ km_inicial: 1, km_final: 2, sem_abastecimento: true }, { avaria: true, avaria_descricao: " " }, false)).toEqual(["Descrição da avaria"]);
  });
});

describe("agendamentos do dia", () => {
  it("em rota = saiu (checklist de saída) e não voltou; com o horário e se o checklist está completo", () => {
    const a = v({});
    const l = estadoDoDia(a, ck(a.id, "saida", false), null, "2026-11-10", DEZ);
    expect(l.estado).toBe("em_rota");
    expect(l.saidaCompleta).toBe(false);
    expect(l.saiuEm).toBe("2026-11-10T11:05:00Z");
  });
  it("KM de saída sem checklist também conta como em rota", () => {
    expect(estadoDoDia(v({ km_inicial: 500 }), null, null, "2026-11-10", DEZ).estado).toBe("em_rota");
  });
  it("não saiu: passou a hora do turno sem saída; antes disso, aguardando", () => {
    expect(estadoDoDia(v({}), null, null, "2026-11-10", DEZ).estado).toBe("saida_atrasada");
    expect(estadoDoDia(v({}), null, null, "2026-11-10", SETE).estado).toBe("aguardando");
    expect(estadoDoDia(v({ turno: "tarde" }), null, null, "2026-11-10", DEZ).estado).toBe("aguardando");
  });
  it("retornou e não utilizado", () => {
    const a = v({});
    expect(estadoDoDia(a, ck(a.id, "saida"), ck(a.id, "chegada"), "2026-11-10", DEZ).estado).toBe("retornou");
    expect(estadoDoDia(v({ nao_utilizado_em: "x" }), null, null, "2026-11-10", DEZ).estado).toBe("nao_utilizado");
  });
  it("só as de hoje, sem canceladas; em rota primeiro; contagem", () => {
    const rota = v({ veiculo_nome: "B" });
    const lista = [v({ veiculo_nome: "A" }), rota, v({ status: "cancelado" }), v({ data_inicio: "2026-11-09", data_fim: "2026-11-09" }),
      v({ data_inicio: "2026-11-09", data_fim: "2026-11-11", km_inicial: 10, km_inicial_em: "2026-11-09T12:00:00Z" })];
    const ls = viagensDoDia(lista, [ck(rota.id, "saida")], "2026-11-10", DEZ);
    expect(ls).toHaveLength(3);
    expect(ls[0].estado).toBe("em_rota");
    expect(contarEstados(ls)).toEqual({ em_rota: 2, saida_atrasada: 1, aguardando: 0, retornou: 0, nao_utilizado: 0 });
  });
});

describe("KM sem registro", () => {
  it("aponta quem saiu com KM diferente do último registrado", () => {
    const lista = [
      v({ km_inicial: 1100, km_anterior: 1090, data_inicio: "2026-11-09" }),
      v({ km_inicial: 1200, km_anterior: 1200 }),
      v({ km_inicial: 1000, km_anterior: 1050 }),
      v({ km_inicial: 900, km_anterior: null }),
    ];
    const al = alertasKm(lista);
    expect(al.map((x) => [x.diferenca, x.tipo])).toEqual([[-50, "menor"], [10, "sem_registro"]]);
    expect(alertasKm(lista, null, 20).map((x) => x.diferenca)).toEqual([-50]);
    expect(alertasKm(lista, "2026-11-10").map((x) => x.diferenca)).toEqual([-50]);
  });
});
