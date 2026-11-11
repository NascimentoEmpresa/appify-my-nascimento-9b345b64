import { describe, expect, it } from "vitest";
import { linhasExcelDemissoes } from "@/lib/demissao/exportarDemissoes";
import type { SolicitacaoDemissao } from "@/lib/demissao/solicitacao";

// Solicitações de Demissão › Exportar Excel (11/11/2026). Dados fictícios.

const s = (id: number, extra: Partial<SolicitacaoDemissao> = {}) => ({
  id, colaborador_nome: `PESSOA ${id}`, colaborador_cpf: "000.000.000-00", contrato: "CONTRATO X", status: "Pendente SST",
  data_aviso: "2026-11-10", colaborador_admissao: "15/03/2024", criado_em: "2026-11-09T12:00:00Z", ...extra,
}) as unknown as SolicitacaoDemissao;

describe("exportar Excel das demissões", () => {
  it("uma linha por solicitação, data como data", () => {
    const [l] = linhasExcelDemissoes([s(1)]);
    expect(l["Nº"]).toBe(1);
    expect(l["Colaborador"]).toBe("PESSOA 1");
    expect((l["Data do aviso"] as Date).getDate()).toBe(10);
    expect((l["Admissão"] as Date).getFullYear()).toBe(2024);
    expect(l["Aberta em"]).toBeInstanceOf(Date);
  });

  it("a coluna Rescisão só no RH, e cancelada fica sem rescisão", () => {
    expect("Rescisão" in linhasExcelDemissoes([s(1)])[0]).toBe(false);
    const [a, b, c] = linhasExcelDemissoes([s(1), s(2), s(3, { status: "Cancelada" })], new Map([[1, "Rescisão por fazer"]]));
    expect(a["Rescisão"]).toBe("Rescisão por fazer");
    expect(b["Rescisão"]).toBe("Ainda não liberada");
    expect(c["Rescisão"]).toBeNull();
  });
});
