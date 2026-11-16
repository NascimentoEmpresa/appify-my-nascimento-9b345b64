import { describe, it, expect } from "vitest";
import {
  atinge, listaImpactados, opcoesModulosImpactados, opcoesSetoresImpactados, rotuloModuloImpactado, semColunasImpactados,
} from "@/pages/chamados/impactados";

describe("Chamados — setores e módulos impactados", () => {
  it("módulos vêm do MODULOS_ERP sem o 'Outro'", () => {
    expect(opcoesModulosImpactados.some((m) => m.value === "outro")).toBe(false);
    expect(opcoesModulosImpactados.find((m) => m.value === "rh")?.label).toBe("Recursos Humanos");
  });
  it("setores sem o PADRAO do Plano de Ações nem vazios", () => {
    expect(opcoesSetoresImpactados(["PADRAO", "", "RH", "Jurídico"]).map((o) => o.value)).toEqual(["RH", "Jurídico"]);
  });
  it("rótulo e lista legível", () => {
    expect(rotuloModuloImpactado("sst")).toBe("SST");
    expect(rotuloModuloImpactado("modulo_antigo")).toBe("modulo_antigo");
    expect(listaImpactados(["rh", "sst"], rotuloModuloImpactado)).toBe("Recursos Humanos, SST");
    expect(listaImpactados(null)).toBe("—");
    expect(listaImpactados([])).toBe("—");
  });
  it("filtro do Monitoramento", () => {
    expect(atinge(["RH", "SST"], "SST", "__todos__")).toBe(true);
    expect(atinge(["RH"], "SST", "__todos__")).toBe(false);
    expect(atinge(null, "SST", "__todos__")).toBe(false);
    expect(atinge(null, "__todos__", "__todos__")).toBe(true);
  });
  it("reconhece o erro de coluna ainda inexistente", () => {
    expect(semColunasImpactados("Could not find the 'setores_impactados' column of 'CHAMADO_SISTEMA' in the schema cache")).toBe(true);
    expect(semColunasImpactados("permission denied")).toBe(false);
  });
});
