import { describe, it, expect } from "vitest";
import {
  validarTroca, mudancasDaTroca, quadroDaTroca, resumoDaTroca, rotuloPosto,
  type RascunhoTroca,
} from "@/lib/trocaFuncao/solicitacao";

// Troca de POSTO DE TRABALHO (23/10/2026). Três tipos de movimentação —
// alteração de função, só horário, só posto — e a troca só de posto não
// pode obrigar cargo novo nem horário novo. O banco repete as regras em
// stf_valida_troca (mig 20261023000410); aqui trava o espelho da tela.

const base: RascunhoTroca = {
  tipo: "funcao", cargoAtual: "RECEPCIONISTA", cargoNovo: "", horarioAtual: "40H 5X2",
  horarioNovo: "", postoAtualCodigo: "PO-00001", postoNovoCodigo: "",
};

describe("validarTroca — só posto", () => {
  it("passa só com o posto novo: sem cargo novo e sem horário novo", () => {
    expect(validarTroca({ ...base, tipo: "posto", postoNovoCodigo: "PO-00002" })).toBeNull();
  });
  it("aceita horário novo junto, se mudar também", () => {
    expect(validarTroca({ ...base, tipo: "posto", postoNovoCodigo: "PO-00002", horarioNovo: "30H" })).toBeNull();
  });
  it("exige o posto novo", () => {
    expect(validarTroca({ ...base, tipo: "posto" })).toMatch(/posto novo/i);
  });
  it("não aceita o mesmo posto em que a pessoa já está", () => {
    expect(validarTroca({ ...base, tipo: "posto", postoNovoCodigo: "PO-00001" })).toMatch(/mesmo/i);
  });
});

describe("validarTroca — alteração de função", () => {
  it("exige cargo novo e horário, posto opcional", () => {
    expect(validarTroca({ ...base })).toMatch(/cargo/i);
    expect(validarTroca({ ...base, cargoNovo: "SUPERVISOR" })).toMatch(/carga horária/i);
    expect(validarTroca({ ...base, cargoNovo: "SUPERVISOR", horarioNovo: "40H 5X2" })).toBeNull();
    expect(validarTroca({ ...base, cargoNovo: "SUPERVISOR", horarioNovo: "40H 5X2", postoNovoCodigo: "PO-00002" })).toBeNull();
  });
  it("cargo igual ao atual manda escolher só horário ou só posto", () => {
    expect(validarTroca({ ...base, cargoNovo: " recepcionista ", horarioNovo: "30H" })).toMatch(/Só posto/);
  });
});

describe("validarTroca — só horário", () => {
  it("exige horário diferente e não aceita posto", () => {
    expect(validarTroca({ ...base, tipo: "horario" })).toMatch(/horário novo/i);
    expect(validarTroca({ ...base, tipo: "horario", horarioNovo: "40h 5x2" })).toMatch(/igual/i);
    expect(validarTroca({ ...base, tipo: "horario", horarioNovo: "30H" })).toBeNull();
    expect(validarTroca({ ...base, tipo: "horario", horarioNovo: "30H", postoNovoCodigo: "PO-00002" })).toMatch(/não muda o posto/);
  });
});

const pedido = {
  tipo: "funcao" as const, cargo_atual: "RECEPCIONISTA", cargo_novo: "SUPERVISOR",
  horario_atual: "30H", horario_novo: "40H",
  posto_atual_codigo: "PO-00001", posto_atual_nome: "RECEPCIONISTA-A 30H",
  posto_novo_codigo: "PO-00002", posto_novo_nome: "RECEPCIONISTA-B 40H",
};

describe("mudancasDaTroca / resumoDaTroca", () => {
  it("lista Cargo → Posto → Horário quando os três mudam", () => {
    expect(mudancasDaTroca(pedido).map(m => m.rotulo)).toEqual(["Cargo", "Posto", "Horário"]);
    expect(resumoDaTroca(pedido)).toBe(
      "Cargo: RECEPCIONISTA → SUPERVISOR · Posto: RECEPCIONISTA-A 30H → RECEPCIONISTA-B 40H · Horário: 30H → 40H");
  });
  it("só posto não mostra cargo (cargo_novo = atual) nem horário vazio", () => {
    const s = { ...pedido, tipo: "posto" as const, cargo_novo: "RECEPCIONISTA", horario_novo: null };
    expect(resumoDaTroca(s)).toBe("Posto: RECEPCIONISTA-A 30H → RECEPCIONISTA-B 40H");
  });
  it("horário mantido na troca de função não aparece como mudança", () => {
    const s = { ...pedido, horario_novo: "30h", posto_novo_codigo: null, posto_novo_nome: null };
    expect(resumoDaTroca(s)).toBe("Cargo: RECEPCIONISTA → SUPERVISOR");
  });
  it("pedido antigo (sem tipo nem posto) continua como cargo → cargo", () => {
    expect(resumoDaTroca({ cargo_atual: "A", cargo_novo: "B" } as never)).toBe("Cargo: A → B");
  });
});

describe("quadroDaTroca", () => {
  it("tem sempre Cargo, Posto e Horário — o que não muda sai como Mantém", () => {
    const q = quadroDaTroca({ ...pedido, tipo: "posto", cargo_novo: "RECEPCIONISTA", horario_novo: null,
      posto: null, posto_atual_contrato: "UFRGS", posto_novo_contrato: "UFRGS" });
    expect(q.map(l => [l.rotulo, l.muda, l.novo])).toEqual([
      ["Cargo", false, "Mantém"], ["Posto", true, "RECEPCIONISTA-B 40H"], ["Horário", false, "Mantém"],
    ]);
    expect(q[1].novoExtra).toBe("UFRGS");
  });
});

describe("rotuloPosto", () => {
  it("contrato · unidade · código — nome, pulando o que faltar", () => {
    expect(rotuloPosto({ codigo: "PO-1", nome: "VIGIA", contrato: "UFRGS", unidade: "CAMPUS" })).toBe("UFRGS · CAMPUS · PO-1 — VIGIA");
    expect(rotuloPosto({ codigo: "PO-1", nome: "VIGIA", contrato: null, unidade: null })).toBe("PO-1 — VIGIA");
  });
});
