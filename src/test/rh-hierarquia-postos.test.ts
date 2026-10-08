import { describe, expect, it } from "vitest";
import {
  caminho, descendentes, filtrarArvore, lideres, montarHierarquia, partesDoPosto, podeMover, responsaveisPorContrato, resumo, tituloDeLideranca,
  type PainelHierarquiaBruto,
} from "@/lib/rh/hierarquiaPostos";

// Recorte real da Senior: Supervisor UFFS → Analista de Contrato → Encarregado 1030 → postos.
const bruto: PainelHierarquiaBruto = {
  postos: [
    ["PO-00250", "05-1093-0022-0007-6-SUPERVISOR OPERACIONAL-44h-UFFS", "SUPERVISOR OPERACIONAL-44h-UFFS", 5, 1093, "0007", 1, null, 1, true, "senior"],
    ["PO-00240", "05-1093-0022-0219-6-ANALISTA DE CONTRATO-44H-UFFS", "ANALISTA DE CONTRATO-44H-UFFS", 5, 1093, "0219", 1, "PO-00250", 1, true, "senior"],
    ["PO-00029", "01-1030-0055-0118-48-ENCARREGADO-44H", "ENCARREGADO-44H", 1, 1030, "0118", 1, "PO-00240", 1, true, "senior"],
    ["PO-00021", "01-1030-0055-0122-48-AUX DE LIMPEZA-44H", "AUX DE LIMPEZA-44H", 1, 1030, "0122", 2, "PO-00029", 2, true, "senior"],
    ["PO-00020", "01-1030-0055-0138-43-MOTORISTA-44H", "MOTORISTA-44H", 1, 1030, "0138", 3, "PO-00029", 1, true, "senior"],
    ["PO-00146", "01-1052-0048-0118-02-ENCARREGADO ADM-44H", "ENCARREGADO ADM-44H", 1, 1052, "0118", 1, "PO-00240", 2, true, "senior"],
    ["PO-00040", "01-1075-0055-0138-0060-MOTORISTA-44H", "MOTORISTA-44H", 1, 1075, "0138", 1, null, 0, false, null],
  ],
  ocupantes: [
    [1, "SUPERVISOR UM", 10, "SUPERVISOR", "Trabalhando", "PO-00250", true, 5, 1093, null],
    [2, "ENCARREGADA DOIS", 20, "ENCARREGADO", "Trabalhando", "PO-00029", true, 1, 1030, null],
    [3, "ANA LIMPEZA", 30, "AUX LIMPEZA", "Trabalhando", "PO-00021", false, 1, 1030, null],
    [4, "BIA LIMPEZA", 31, "AUX LIMPEZA", "Férias", "PO-00021", false, 1, 1030, null],
    [5, "CARLA LIMPEZA", 32, "AUX LIMPEZA", "Trabalhando", "PO-00021", false, 1, 1030, null],
    [6, "ADEMIR GOTTEMS", 8049, "MOTORISTA", "Trabalhando", "PO-00040", false, 1, 1075, null],
    [7, "SEM POSTO", 99, "AUX", "Trabalhando", null, false, 1, 1030, null],
  ],
  contratos: [[5, 1093, "SEDE", true], [1, 1030, "UFFS ERECHIM", true], [1, 1052, "IFRS", true], [1, 1075, "SEMA", true]],
  historico: [], pode_alterar: false,
};
const h = montarHierarquia(bruto);

describe("hierarquia de postos", () => {
  it("separa a descrição da Senior", () => {
    expect(partesDoPosto("01-1099-0071-0061-06-RECEPCIONISTA-A 30H 5X2")).toEqual({
      empresa: 1, filial: 1099, local: "0071", cargo: "0061", sindicato: "06", titulo: "RECEPCIONISTA-A 30H 5X2",
    });
    expect(tituloDeLideranca("SUPER. RECEPCIONISTA")).toBe(false);
    expect(tituloDeLideranca("ENCARREGADO-44H")).toBe(true);
  });

  it("monta a árvore com ordem, níveis e totais do ramo", () => {
    expect(h.raizes.map((r) => r.codigo)).toEqual(["PO-00250"]);
    const enc = h.porCodigo.get("PO-00029")!;
    expect(enc.nivel).toBe(2);
    expect(enc.filhos.map((f) => f.codigo)).toEqual(["PO-00020", "PO-00021"]);   // pela ordem da Senior
    expect(enc.ramo).toMatchObject({ postos: 3, colaboradores: 4, vagas: 6, contratos: ["UFFS ERECHIM"] });
    expect(h.raizes[0].ramo).toMatchObject({ postos: 6, colaboradores: 5, contratos: ["IFRS", "SEDE", "UFFS ERECHIM"] });
  });

  it("fora da hierarquia e sem posto", () => {
    expect(h.fora.map((n) => n.codigo)).toEqual(["PO-00040"]);
    expect(h.fora[0].ocupantes[0].nome).toBe("ADEMIR GOTTEMS");
    expect(h.semPosto.map((o) => o.nome)).toEqual(["SEM POSTO"]);
  });

  it("caminho até a raiz e descendentes", () => {
    expect(caminho(h, "PO-00021").map((n) => n.codigo)).toEqual(["PO-00250", "PO-00240", "PO-00029", "PO-00021"]);
    expect(descendentes(h.porCodigo.get("PO-00240")!).map((n) => n.codigo).sort()).toEqual(["PO-00020", "PO-00021", "PO-00029", "PO-00146"]);
  });

  it("líderes e responsáveis por contrato", () => {
    const ls = lideres(h);
    expect(ls.map((l) => l.posto.codigo)).toEqual(["PO-00250", "PO-00240", "PO-00029"]);
    expect(ls[2]).toMatchObject({ postosAbaixo: 2, colaboradoresAbaixo: 3 });
    expect(ls[1].ocupantes).toHaveLength(0);
    const r = responsaveisPorContrato(h);
    const uffs = r.find((x) => x.contrato === "UFFS ERECHIM")!;
    expect(uffs.lideres.map((l) => l.codigo)).toEqual(["PO-00240", "PO-00029"]);
    expect(uffs.colaboradores).toBe(4);
  });

  it("resumo", () => {
    expect(resumo(h)).toMatchObject({
      postos: 7, naArvore: 6, fora: 1, lideres: 3, niveis: 4, ativos: 7, ativosNaArvore: 5, ativosFora: 1, semPosto: 1,
      postosAcimaDasVagas: 1, lideresSemOcupante: 1, contratos: 3,
    });
  });

  it("busca mostra o caminho até o achado", () => {
    const f = filtrarArvore(h, "carla")!;
    expect([...f.achados]).toEqual(["PO-00021"]);
    expect([...f.visiveis].sort()).toEqual(["PO-00021", "PO-00029", "PO-00240", "PO-00250"]);
    expect(filtrarArvore(h, "  ")).toBeNull();
  });

  it("não deixa mover um posto para baixo dele mesmo", () => {
    expect(podeMover(h, "PO-00240", "PO-00029")).toBe(false);
    expect(podeMover(h, "PO-00029", "PO-00029")).toBe(false);
    expect(podeMover(h, "PO-00146", "PO-00029")).toBe(true);
    expect(podeMover(h, "PO-00146", null)).toBe(true);
  });
});
