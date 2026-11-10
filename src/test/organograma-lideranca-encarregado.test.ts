import { describe, expect, it } from "vitest";
import { montarEstrutura } from "@/lib/organograma/estruturaSetores";
import {
  casaLideranca, ehEncarregado, liderDe, liderancaDoContrato, liderancas, linhasCsvLideranca,
} from "@/lib/organograma/liderancaContrato";
import type { NoPessoa } from "@/lib/organograma/pessoas";

// SIS-2026-0770 (reaberto): a quem cada colaborador do contrato se reporta,
// mesmo com 2 ou 3 encarregados no mesmo contrato. Dados de exemplo.
let seq = 0;
function p(id: string, parent: string | null, setor: string | null, funcao: string, extra: Partial<NoPessoa> = {}): NoPessoa {
  return {
    id, parent_id: parent, ordem: seq++, nome: `PESSOA ${id.toUpperCase()}`, setor, par_grupo: null, do_grupo: false, contrato: "1093 - ADM",
    superior_pendente: false, empresa: 5, filial: 1093, contratos_extras: [], user_id: null, empregado_id: null, funcao_manual: funcao,
    email: null, avatar_url: null, cargo: null, ativo: true, cor: null, superior_origem: "manual", posto_codigo: null, posto_nome: null, ...extra,
  };
}
const campo = (id: string, parent: string | null, funcao = "Vigia", filial = 10, extra: Partial<NoPessoa> = {}) =>
  p(id, parent, null, funcao, { empresa: 2, filial, contrato: `${filial} - HOSPITAL ${filial}`, ...extra });

const dados = [
  p("pres", null, "PRESIDÊNCIA", "PRESIDENTE"),
  p("dop", "pres", "OPERACIONAL", "Gerente Operacional"),
  p("sup", "dop", "OPERACIONAL", "Supervisora Operacional"),
  // Contrato 10 com TRÊS encarregados.
  campo("enc1", "sup", "Encarregada de Limpeza"),
  campo("enc2", "sup", "ENCARREGADO"),
  campo("lid", "enc1", "Servente", 10, { funcao_manual: "Líder de turma" }), // líder abaixo da encarregada
  campo("a", "enc1", "Servente"),
  campo("b", "lid", "Servente"), // responde ao líder, que responde à enc1
  campo("c", "enc2", "Vigia"),
  campo("d", "sup", "Vigia"), // responde direto à supervisora: sem encarregado
  campo("e", null, "Vigia"), // pendente: sem superior
  // Contrato 20 sem encarregado nenhum: ninguém "falta".
  campo("f", "sup", "Porteiro", 20),
  campo("g", "sup", "Porteiro", 20),
];
const e = montarEstrutura(dados);
const c10 = e.contratos.find((c) => c.filial === 10)!;
const c20 = e.contratos.find((c) => c.filial === 20)!;

describe("quem é encarregado", () => {
  it("pela função escrita no organograma ou pelo cargo; acento e caixa não importam", () => {
    expect(ehEncarregado({ funcao_manual: "Encarregada de Limpeza", cargo: null })).toBe(true);
    expect(ehEncarregado({ funcao_manual: null, cargo: "LÍDER DE EQUIPE" })).toBe(true);
    expect(ehEncarregado({ funcao_manual: null, cargo: "CHEFE DE TURMA" })).toBe(true);
    expect(ehEncarregado({ funcao_manual: null, cargo: "VIGIA" })).toBe(false);
    expect(ehEncarregado({ funcao_manual: null, cargo: "LIDERANCA COMUNITARIA" })).toBe(false);
    // a função escrita vale sobre o cargo
    expect(ehEncarregado({ funcao_manual: "Servente", cargo: "ENCARREGADO" })).toBe(false);
  });
});

describe("turma de cada encarregado no contrato", () => {
  const lid = liderancaDoContrato(c10);
  const turma = (id: string) => lid.encarregados.find((t) => t.encarregado.id === id)!;

  it("três encarregados no mesmo contrato, cada um com a sua turma", () => {
    expect(lid.encarregados.map((t) => t.encarregado.id).sort()).toEqual(["enc1", "enc2", "lid"]);
    expect(turma("enc1").equipe.map((x) => x.id)).toEqual(["a"]);
    expect(turma("lid").equipe.map((x) => x.id)).toEqual(["b"]); // o mais próximo vale
    expect(turma("lid").acima?.id).toBe("enc1");
    expect(turma("enc2").equipe.map((x) => x.id)).toEqual(["c"]);
  });

  it("quem responde direto ao supervisor ou está pendente fica sem encarregado", () => {
    expect(lid.semEncarregado.map((x) => x.id)).toEqual(["d", "e"]);
  });

  it("contrato sem encarregado não acusa ninguém", () => {
    const l20 = liderancaDoContrato(c20);
    expect(l20.encarregados).toEqual([]);
    expect(l20.semEncarregado).toEqual([]);
  });

  it("quem já tem gente do contrato abaixo conta como encarregado, mesmo com cargo de vigia", () => {
    const x = montarEstrutura([...dados, campo("h", "c", "Vigia")]);
    const l = liderancaDoContrato(x.contratos.find((c) => c.filial === 10)!);
    expect(l.encarregados.find((t) => t.encarregado.id === "c")?.equipe.map((y) => y.id)).toEqual(["h"]);
  });

  it("um ciclo sujo no cadastro não trava", () => {
    const x = montarEstrutura([campo("p1", "p2", "Encarregado", 30), campo("p2", "p1", "Vigia", 30)]);
    expect(() => liderancaDoContrato(x.contratos[0])).not.toThrow();
  });
});

describe("liderança por colaborador (pesquisa de clima)", () => {
  const linhas = liderancas(dados, e);
  const de = (id: string) => linhas.find((l) => l.pessoa.id === id)!;

  it("busca pelo colaborador mostra o encarregado, o chefe direto e o supervisor do contrato", () => {
    expect(liderDe(de("b"))?.id).toBe("lid");
    expect(de("b").liderImediato?.id).toBe("lid");
    expect(de("b").supervisor?.id).toBe("sup");
    expect(de("b").cadeia.map((x) => x.id)).toEqual(["lid", "enc1", "sup", "dop", "pres"]);
    expect(de("c").encarregado?.id).toBe("enc2");
    expect(de("d").semEncarregado).toBe(true);
    expect(de("enc1").ehEncarregado).toBe(true);
  });

  it("escritório: o líder é o chefe direto; lotação é o setor", () => {
    expect(de("sup").campo).toBe(false);
    expect(liderDe(de("sup"))?.id).toBe("dop");
  });

  it("acha pelo nome do colaborador, do encarregado ou do contrato", () => {
    expect(linhas.filter((l) => casaLideranca(l, "pessoa enc2")).map((l) => l.pessoa.id).sort()).toEqual(["c", "enc2"]);
    expect(linhas.filter((l) => casaLideranca(l, "hospital 20")).map((l) => l.pessoa.id).sort()).toEqual(["f", "g"]);
  });

  it("planilha: uma linha por colaborador, com cabeçalho", () => {
    const csv = linhasCsvLideranca(linhas);
    expect(csv[0][3]).toBe("Encarregado");
    expect(csv).toHaveLength(dados.length + 1);
    expect(csv.find((l) => l[0] === "PESSOA B")?.slice(3, 6)).toEqual(["PESSOA LID", "PESSOA LID", "PESSOA SUP"]);
    expect(csv.find((l) => l[0] === "PESSOA D")?.[3]).toBe("SEM ENCARREGADO");
  });
});
