import { describe, expect, it } from "vitest";
import {
  filtrarChamadosParaVincular, formularioBaseadoEm, lerBaseado, MOTIVOS_REABERTURA, proximaParte,
  rotaNovoChamado, rotuloParte, tituloDaParte, type ChamadoBase,
} from "@/lib/chamados/vinculos";

const UUID = "0a1b2c3d-0000-4000-8000-000000000001";

const base: ChamadoBase = {
  id: UUID, numero: "SIS-2026-0900", assunto: "Relatório de comissões", categorias: ["relatorio"], tipo_solicitacao: "melhoria",
  prioridade: "media", descricao: "Falta a coluna", observacoes_solicitante: null, impacto_trabalho: "medio", urgencia: "semana",
  prazo_solicitante: "2026-11-01", modulo_sistema: "outro", modulo_sistema_outro: "Power BI", ambiente: "producao", afeta_usuarios: 12,
};

describe("Reabrir — motivos", () => {
  it("as duas opções, na ordem pedida", () => {
    expect(MOTIVOS_REABERTURA.map((m) => m.rotulo)).toEqual([
      "Não atendeu o solicitado",
      "Precisa de modificações no que foi solicitado",
    ]);
  });
});

describe("Reabrir chamado baseado nesse", () => {
  it("rota do formulário novo conforme a tela de onde veio", () => {
    expect(rotaNovoChamado("/app/central-servicos/chamados/x/acompanhar", UUID)).toBe(`/app/central-servicos/chamados/novo?baseado=${UUID}`);
    expect(rotaNovoChamado("/app/encarregados/chamados/x/acompanhar", UUID)).toBe(`/app/encarregados/chamados/novo?baseado=${UUID}`);
    expect(rotaNovoChamado("/app/sistemas/chamados/x/acompanhar")).toBe("/app/central-servicos/chamados/novo");
  });

  it("só aceita UUID no ?baseado=", () => {
    expect(lerBaseado(`?baseado=${UUID.toUpperCase()}`)).toBe(UUID);
    expect(lerBaseado("?baseado=1;drop")).toBeNull();
    expect(lerBaseado("")).toBeNull();
  });

  it("copia o chamado anterior; prazo vencido não vem", () => {
    const f = formularioBaseadoEm(base, 2, "2026-11-12");
    expect(f).toMatchObject({
      assunto: "Relatório de comissões (Parte 2)", categorias: ["relatorio"], tipo: "melhoria", prioridade: "media",
      descricao: "Falta a coluna", modulo: "outro", moduloOutro: "Power BI", afetaUsuarios: "12", prazoSolicitante: "",
    });
    expect(formularioBaseadoEm({ ...base, prazo_solicitante: "2026-12-01" }, 2, "2026-11-12").prazoSolicitante).toBe("2026-12-01");
  });

  it("título da parte: não repete o sufixo e cabe em 120", () => {
    expect(tituloDaParte("Relatório (Parte 2)", 3)).toBe("Relatório (Parte 3)");
    const longo = tituloDaParte("x".repeat(130), 2);
    expect(longo.length).toBeLessThanOrEqual(120);
    expect(longo.endsWith(" (Parte 2)")).toBe(true);
  });
});

describe("Série de chamados", () => {
  it("rótulo e próxima parte", () => {
    expect(rotuloParte(null)).toBe("Parte 1");
    expect(rotuloParte(3)).toBe("Parte 3");
    expect(proximaParte([])).toBe(2);
    expect(proximaParte([{ parte: 1 }, { parte: 2 }, { parte: 3 }])).toBe(4);
  });

  it("busca do seletor por número ou título, sem acento", () => {
    const l = [{ numero: "SIS-2026-0900", assunto: "Relatório de comissões" }, { numero: "SIS-2026-0901", assunto: "Ponto" }];
    expect(filtrarChamadosParaVincular(l, "#0901").map((c) => c.assunto)).toEqual(["Ponto"]);
    expect(filtrarChamadosParaVincular(l, "relatorio").map((c) => c.numero)).toEqual(["SIS-2026-0900"]);
    expect(filtrarChamadosParaVincular(l, "  ")).toHaveLength(2);
  });
});
