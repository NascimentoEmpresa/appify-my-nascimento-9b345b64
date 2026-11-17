import { describe, expect, it } from "vitest";
import { FILTROS_INCIDENTE, filtrarIncidentes, type Incidente } from "@/lib/sst/incidentes";

const base: Incidente = {
  id: 1, empregado_id: 10, nome: "Ana Silva", contrato_id: "c1", contrato_nome: "Contrato A",
  encarregado: "João Lima", data_incidente: "2026-11-02", dias_afastamento: null,
  numero_relatorio: "R-1", status: "elaboracao", observacoes: null,
  arquivo_nome: null, arquivo_path: null, created_at: "2026-11-02T10:00:00Z",
};
const lista: Incidente[] = [base, { ...base, id: 2, nome: "Bárbara Souza", contrato_id: "c2",
  encarregado: "Maria Santos", data_incidente: "2026-11-10", dias_afastamento: 3, status: "finalizado" }];

describe("filtros do controle de incidentes", () => {
  const ids = (f: Partial<typeof FILTROS_INCIDENTE>) => filtrarIncidentes(lista, { ...FILTROS_INCIDENTE, ...f }).map((i) => i.id);
  it("filtra período inclusivo, contrato e colaborador sem acento", () => {
    expect(ids({ de: "2026-11-10", ate: "2026-11-10" })).toEqual([2]);
    expect(ids({ contrato: "c1", colaborador: "ana" })).toEqual([1]);
    expect(ids({ colaborador: "barbara" })).toEqual([2]);
  });
  it("filtra encarregado, afastamento e status", () => {
    expect(ids({ encarregado: "joao", afastamento: "nao" })).toEqual([1]);
    expect(ids({ afastamento: "sim", status: "finalizado" })).toEqual([2]);
    expect(ids({ afastamento: "sim", status: "recebido" })).toEqual([]);
  });
});
