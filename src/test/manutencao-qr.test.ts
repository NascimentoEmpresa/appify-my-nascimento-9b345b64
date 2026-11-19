import { describe, expect, it } from "vitest";
import { acaoPublicaManutencao, manutencaoEmAberto, urlPublicaManutencao } from "@/lib/suprimentos/manutencaoQr";

describe("fluxo público de manutenção por QR", () => {
  it("expõe somente a ação compatível com a etapa", () => {
    expect(acaoPublicaManutencao("aguardando_orcamento")).toBe("orcamento");
    expect(acaoPublicaManutencao("manutencao_reprovada")).toBe("orcamento");
    expect(acaoPublicaManutencao("manutencao_autorizada")).toBe("iniciar");
    expect(acaoPublicaManutencao("em_execucao")).toBe("concluir");
    expect(acaoPublicaManutencao("pronta_retirada")).toBeNull();
  });

  it("considera encerrada a única etapa terminal da manutenção", () => {
    expect(manutencaoEmAberto("pronta_retirada")).toBe(true);
    expect(manutencaoEmAberto("encerrada")).toBe(false);
  });

  it("monta o link sem credencial do ERP", () => {
    expect(urlPublicaManutencao("abc", "https://erp.exemplo.com"))
      .toBe("https://erp.exemplo.com/manutencao/equipamento/abc");
  });
});
