import { describe, expect, it } from "vitest";
import {
  contarPorStatus, diasSemMovimentacao, estaParado, exigeLaudo, FILTROS_CALCADO, filtrarCalcados,
  proximoStatus, statusSugeridoPeloPedido, type CalcadoOrtopedico,
} from "@/lib/sst/calcadosOrtopedicos";

// SIS-2026-0888. As regras de status espelham sst_calcado_status_do_pedido e
// sst_calcado_proximo_status (mig 20261118200000) — se um lado mudar, o
// outro precisa mudar junto.
const agora = new Date("2026-11-20T12:00:00Z");
const base: CalcadoOrtopedico = {
  id: 1, pedido_id: "p1", pedido_codigo: "PED-20261116-1774", pedido_status: "AGUARDANDO ENVIO",
  colaborador_nome: "Rosemary Goulart Martins", contrato_nome: "UFRGS - LIMPEZA GERAL - 047/2022",
  encarregado_nome: "Clóvis Ismar", item_nome: "BABUCHE ORTOPEDICO", tamanho: "38", quantidade: 1,
  data_solicitacao: "2026-11-16T13:58:48Z", status: "solicitado", observacoes: null,
  laudo_nome: null, laudo_path: null, updated_at: "2026-11-19T10:00:00Z",
};

describe("status sugerido pelo pedido do Compras", () => {
  it("traduz só os status que dizem algo ao SST", () => {
    expect(statusSugeridoPeloPedido("AGUARDANDO COMPRA")).toBe("em_compra");
    expect(statusSugeridoPeloPedido("RETIRADO PARA ENTREGA")).toBe("enviado");
    expect(statusSugeridoPeloPedido("DESPACHADO")).toBe("enviado");
    expect(statusSugeridoPeloPedido("CANCELADO")).toBe("cancelado");
    expect(statusSugeridoPeloPedido("AGUARDANDO ENVIO")).toBeNull();
    expect(statusSugeridoPeloPedido("EM SEPARACAO")).toBeNull();
    expect(statusSugeridoPeloPedido(null)).toBeNull();
  });
});

describe("avanço automático do status", () => {
  it("só anda para frente", () => {
    expect(proximoStatus("solicitado", "em_compra")).toBe("em_compra");
    expect(proximoStatus("em_analise", "em_compra")).toBe("em_compra");
    expect(proximoStatus("em_compra", "enviado")).toBe("enviado");
    expect(proximoStatus("enviado", "em_compra")).toBe("enviado");
    expect(proximoStatus("enviado", "entregue")).toBe("entregue");
    expect(proximoStatus("em_compra", null)).toBe("em_compra");
  });
  it("não passa por cima do SST depois de entregue, finalizado ou cancelado", () => {
    expect(proximoStatus("entregue", "cancelado")).toBe("entregue");
    expect(proximoStatus("finalizado", "enviado")).toBe("finalizado");
    expect(proximoStatus("finalizado", "cancelado")).toBe("finalizado");
    expect(proximoStatus("cancelado", "em_compra")).toBe("cancelado");
  });
  it("cancelamento do pedido cancela o que ainda está em andamento", () => {
    expect(proximoStatus("solicitado", "cancelado")).toBe("cancelado");
    expect(proximoStatus("enviado", "cancelado")).toBe("cancelado");
  });
  it("Finalizado é o único que exige laudo", () => {
    expect(exigeLaudo("finalizado")).toBe(true);
    expect(exigeLaudo("entregue")).toBe(false);
    expect(exigeLaudo("cancelado")).toBe(false);
  });
});

describe("última atualização", () => {
  it("conta dias inteiros desde a última mexida", () => {
    expect(diasSemMovimentacao("2026-11-20T08:00:00Z", agora)).toBe(0);
    expect(diasSemMovimentacao("2026-11-13T12:00:00Z", agora)).toBe(7);
    expect(diasSemMovimentacao("data ruim", agora)).toBe(0);
  });
  it("parado = em aberto, fora de Entregue, há 7 dias ou mais", () => {
    const velho = { updated_at: "2026-11-10T12:00:00Z" };
    expect(estaParado({ ...velho, status: "em_compra" }, agora)).toBe(true);
    expect(estaParado({ ...velho, status: "entregue" }, agora)).toBe(false);
    expect(estaParado({ ...velho, status: "finalizado" }, agora)).toBe(false);
    expect(estaParado({ updated_at: "2026-11-18T12:00:00Z", status: "em_compra" }, agora)).toBe(false);
  });
});

describe("filtros e contagem", () => {
  const lista: CalcadoOrtopedico[] = [
    base,
    { ...base, id: 2, colaborador_nome: "Édison Luis", contrato_nome: "TJRS - 023/2025", status: "em_compra",
      laudo_path: "controle/2/1_laudo.pdf", laudo_nome: "laudo.pdf", updated_at: "2026-11-12T12:00:00Z" },
    { ...base, id: 3, colaborador_nome: "Angelize Schaun", status: "finalizado", laudo_path: "x" },
  ];
  const ids = (f: Partial<typeof FILTROS_CALCADO>) =>
    filtrarCalcados(lista, { ...FILTROS_CALCADO, ...f }, agora).map((c) => c.id);
  it("o padrão mostra só os em aberto", () => {
    expect(ids({})).toEqual([1, 2]);
    expect(ids({ status: "todos" })).toEqual([1, 2, 3]);
    expect(ids({ status: "finalizado" })).toEqual([3]);
  });
  it("busca sem acento por colaborador, encarregado ou pedido", () => {
    expect(ids({ busca: "edison" })).toEqual([2]);
    expect(ids({ busca: "clovis" })).toEqual([1, 2]);
    expect(ids({ busca: "1774", status: "todos" })).toEqual([1, 2, 3]);
  });
  it("filtra contrato, laudo pendente e parados", () => {
    expect(ids({ contrato: "TJRS - 023/2025" })).toEqual([2]);
    expect(ids({ laudo: "sem" })).toEqual([1]);
    expect(ids({ laudo: "com", status: "todos" })).toEqual([2, 3]);
    expect(ids({ parados: true })).toEqual([2]);
  });
  it("conta por status", () => {
    const c = contarPorStatus(lista);
    expect(c.solicitado).toBe(1);
    expect(c.em_compra).toBe(1);
    expect(c.finalizado).toBe(1);
    expect(c.enviado).toBe(0);
  });
});
