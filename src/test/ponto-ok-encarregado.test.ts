import { describe, it, expect } from "vitest";
import { aprovarEsperaOk, rotuloOkEncarregado, temOkEncarregado } from "@/lib/conferenciaPonto/conferencia";
import {
  buscarOcupantes, contratosDoPosto, contratosSemResponsavel, montarHierarquia, responsaveisPorContrato,
  type PainelHierarquiaBruto,
} from "@/lib/rh/hierarquiaPostos";

// Mig 20261008000005 (08/10/2026): o OK do encarregado antes de enviar ao
// RH, e o responsável de cada contrato vindo da Hierarquia de Postos.

describe("OK do encarregado na Conferência de Ponto", () => {
  const semOk = { ok_encarregado_por: null, ok_encarregado_em: null, ok_encarregado_pelo_operacional: false };
  const doEncarregado = { ok_encarregado_por: "IDALECIO CARDOSO COSTA", ok_encarregado_em: "2026-10-08T12:00:00Z", ok_encarregado_pelo_operacional: false };
  const doOperacional = { ok_encarregado_por: "Pablo Flores Santarem", ok_encarregado_em: "2026-10-08T12:00:00Z", ok_encarregado_pelo_operacional: true };

  it("enviar ao RH espera o OK; as outras ações não", () => {
    expect(aprovarEsperaOk(semOk, "aprovar")).toBe(true);
    expect(aprovarEsperaOk(doEncarregado, "aprovar")).toBe(false);
    expect(aprovarEsperaOk(doOperacional, "aprovar")).toBe(false);
    expect(aprovarEsperaOk(semOk, "andamento_op")).toBe(false);
    expect(aprovarEsperaOk(semOk, "confirmar")).toBe(false);
  });

  it("linha sem as colunas (banco sem a migration) conta como sem OK", () => {
    expect(temOkEncarregado({})).toBe(false);
  });

  it("o selo diz de quem é o OK", () => {
    expect(rotuloOkEncarregado(semOk)).toBeNull();
    expect(rotuloOkEncarregado(doEncarregado)).toBe("OK do IDALECIO CARDOSO COSTA");
    expect(rotuloOkEncarregado(doOperacional)).toBe("OK pelo Operacional (Pablo Flores Santarem)");
  });
});

// Recorte real: Supervisor UFFS → Analista (vago) → Encarregado Chapecó → postos.
const bruto: PainelHierarquiaBruto = {
  postos: [
    ["PO-00250", "05-1093-0022-0007-6-SUPERVISOR OPERACIONAL-44h-UFFS", "SUPERVISOR OPERACIONAL-44h-UFFS", 5, 1093, "0007", 1, null, 1, true, "senior"],
    ["PO-00240", "05-1093-0022-0219-6-ANALISTA DE CONTRATO-44H-UFFS", "ANALISTA DE CONTRATO-44H-UFFS", 5, 1093, "0219", 1, "PO-00250", 1, true, "senior"],
    ["PO-00029", "01-1030-0055-0118-48-ENCARREGADO-44H", "ENCARREGADO-44H", 1, 1030, "0118", 1, "PO-00240", 1, true, "senior"],
    ["PO-00021", "01-1030-0055-0122-48-AUX DE LIMPEZA-44H", "AUX DE LIMPEZA-44H", 1, 1030, "0122", 2, "PO-00029", 2, true, "senior"],
  ],
  ocupantes: [
    [1, "ISMAEL KUHL LOPES", 10, "SUPERVISOR", "Trabalhando", "PO-00250", true, 5, 1093, null, false, "PO-00250"],
    [2, "IDALECIO CARDOSO COSTA", 20, "ENCARREGADO", "Trabalhando", "PO-00029", true, 1, 1030, null, false, "PO-00029"],
    [3, "ANA LIMPEZA", 30, "AUX LIMPEZA", "Trabalhando", "PO-00021", false, 1, 1030, null, false, "PO-00021"],
    // Trocada no ERP: a Senior ainda a põe no posto de limpeza.
    [4, "BIANCA ÁVILA", 31, "AUX LIMPEZA", "Trabalhando", null, false, 1, 1030, null, true, "PO-00021"],
  ],
  contratos: [[5, 1093, "ADM E ESTAGIARIOS - NH", true], [1, 1030, "UFFS CHAPECO - 041/2021", true], [1, 1099, "SEM NINGUEM", true], [9, 9, "ENCERRADO", false]],
  // Como o banco devolve: só o Idalécio responde por Chapecó.
  responsaveis: [[1, 1030, "PO-00029", 2], [5, 1093, "PO-00250", 1]],
  historico: [], pode_alterar: true,
};
const h = montarHierarquia(bruto);

describe("Hierarquia de Postos — responsável pelo ponto e ajustes do ERP", () => {
  it("o responsável de cada contrato é o que o banco calculou", () => {
    const uffs = responsaveisPorContrato(h).find((c) => c.chave === "1-1030")!;
    expect(uffs.contrato).toBe("UFFS CHAPECO - 041/2021");
    expect(uffs.responsaveis.map((r) => r.ocupante.nome)).toEqual(["IDALECIO CARDOSO COSTA"]);
    expect(contratosDoPosto(h, "PO-00029")).toEqual([{ chave: "1-1030", nome: "UFFS CHAPECO - 041/2021" }]);
    expect(contratosDoPosto(h, "PO-00240")).toEqual([]);
  });

  it("contrato ativo sem ninguém aparece; encerrado não", () => {
    expect(contratosSemResponsavel(h).map((c) => c.nome)).toEqual(["SEM NINGUEM"]);
  });

  it("ocupante ajustado: posto efetivo do ERP, Senior guardada à parte", () => {
    const b = h.ocupantes.find((o) => o.id === 4)!;
    expect(b).toMatchObject({ ajustado: true, posto: null, postoSenior: "PO-00021" });
    expect(h.porCodigo.get("PO-00021")!.ocupantes.map((o) => o.id)).toEqual([3]);
    expect(h.semPosto.map((o) => o.id)).toEqual([4]);
  });

  it("painel antigo (sem as colunas novas) continua montando", () => {
    const antigo = montarHierarquia({ ...bruto, responsaveis: undefined, ocupantes: [[3, "ANA", 30, null, "Trabalhando", "PO-00021", false, 1, 1030, null]] });
    expect(antigo.ocupantes[0]).toMatchObject({ ajustado: false, postoSenior: "PO-00021" });
    expect(antigo.responsaveis.size).toBe(0);
  });

  it("busca de colaborador: sem acento, a partir de 2 letras, com limite", () => {
    expect(buscarOcupantes(h, "a")).toEqual([]);
    expect(buscarOcupantes(h, "avila").map((o) => o.id)).toEqual([4]);
    expect(buscarOcupantes(h, "20").map((o) => o.nome)).toEqual(["IDALECIO CARDOSO COSTA"]);
    expect(buscarOcupantes(h, "limpeza", 1)).toHaveLength(1);
  });
});
