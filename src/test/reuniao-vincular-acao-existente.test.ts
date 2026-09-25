import { describe, expect, it } from "vitest";
import {
  acaoPodeSerVinculada,
  tituloAcaoVinculavel,
} from "@/pages/central-servicos/reunioes/acaoExistente";

describe("seleção de ação existente em reunião", () => {
  it.each(["a_definir", "nao_iniciada", "em_andamento", "aguardando_validacao", "atrasada"])(
    "permite vincular a ação com status %s",
    (status_normalizado) => {
      expect(acaoPodeSerVinculada({ status_normalizado })).toBe(true);
    },
  );

  it.each(["concluida_pendente_evidencia", "concluida_validada", "cancelada"])(
    "não permite vincular a ação terminal com status %s",
    (status_normalizado) => {
      expect(acaoPodeSerVinculada({ status_normalizado })).toBe(false);
    },
  );

  it("usa a descrição da ação quando o título não foi preenchido", () => {
    expect(tituloAcaoVinculavel({ titulo: " ", acao: " Revisar orçamento " })).toBe("Revisar orçamento");
    expect(tituloAcaoVinculavel({ titulo: null, acao: null })).toBe("Ação sem título");
  });
});
