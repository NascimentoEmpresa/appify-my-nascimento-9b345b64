// SIS-2026-0884 — o posto preenche a linha do Quadro de Postos do contrato.
import { describe, it, expect } from "vitest";
import {
  type LinhaQuadroForm, type RemuneracaoPosto, LINHA_VAZIA,
  preenchimentoDoPosto, aplicarPreenchimento, preencherQuadro, remuneracaoPorPosto,
  incluirEmOutros, erroDosOutros, outrosParaPayload, paraPayload, erroDaLinha, outrosEmTexto,
} from "@/lib/licitacoes/quadroPostos";
import { somaDiasCorridos, hojeIso } from "@/lib/recrutamento/vagaRegras";
import type { RespostaReferencia } from "@/lib/licitacoes/convencoes";

const linha = (p: Partial<LinhaQuadroForm> = {}): LinhaQuadroForm => ({
  ...LINHA_VAZIA,
  posto_nome: "ALMOXARIFE 5X2 8H - CACHOEIRINHA",
  funcao_nome: "ALMOXARIFE",
  cargo: "ALMOXARIFE",
  quantidade: "1",
  escala: "5X2",
  estado: "RS",
  cidade: "Cachoeirinha",
  local_exato: "DP - CACHOEIRINHA",
  data_inicio_prevista: somaDiasCorridos(hojeIso(), 10),
  ...p,
});

const planilha = (p: Partial<RemuneracaoPosto> = {}): RemuneracaoPosto => ({
  posto: "ALMOXARIFE 5X2 8H - CACHOEIRINHA",
  vigencia: "2026-01-01",
  salario: 1964.63,
  insalubridade: 0,
  periculosidade: 0,
  vt: 126.28,
  va: 461.82,
  ...p,
});

const cctDoPosto = (beneficios: Record<string, unknown>): RespostaReferencia => ({
  status: "vinculado",
  origem: "posto",
  principal_id: "c1",
  regras: {},
  referencias: [{ id: "c1", versao: 1, identificacao: "CCT 2026", beneficios: beneficios as never }],
});

describe("preenchimentoDoPosto", () => {
  it("salário vem do salário base da planilha", () => {
    expect(preenchimentoDoPosto(planilha()).valores.salario).toBe("1964,63");
  });

  it("periculosidade em R$ vira % sobre o salário base", () => {
    const p = preenchimentoDoPosto(planilha({ salario: 2000, periculosidade: 600 }));
    expect(p.valores.periculosidade_pct).toBe("30");
  });

  it("insalubridade só vira % quando dá um grau legal sobre o salário base", () => {
    expect(preenchimentoDoPosto(planilha({ salario: 2000, insalubridade: 400 })).valores.insalubridade_pct).toBe("20");
    const semBase = preenchimentoDoPosto(planilha({ salario: 1964.63, insalubridade: 607.2 }));
    expect(semBase.valores.insalubridade_pct).toBeUndefined();
    expect(semBase.avisos.join(" ")).toMatch(/Informe o %/);
  });

  it("sem valor na planilha o campo fica de fora (não inventa)", () => {
    const p = preenchimentoDoPosto(planilha({ salario: 0, vt: 0, va: 0 }));
    expect(p.valores).toEqual({});
  });

  it("benefícios: convenção do posto vence a planilha", () => {
    const ref = cctDoPosto({
      va: { valor: 27.15, periodo: "dia", desconto: { nao_contem: true } },
      insalubridade: { percentual: 40, base: "minimo_regional" },
    });
    const p = preenchimentoDoPosto(planilha({ referencia: ref, insalubridade: 100 }));
    expect(p.valores.beneficios).toMatch(/Vale-Alimentação \(VA\): R\$ 27,15 \/ dia/);
    expect(p.valores.insalubridade_pct).toBe("40");
  });

  it("benefícios: sem convenção, os da planilha", () => {
    expect(preenchimentoDoPosto(planilha()).valores.beneficios).toMatch(/^VT .*126,28.*VA .*461,82/);
  });

  it("com convenção no contrato, só o salário (o resto é da convenção)", () => {
    const p = preenchimentoDoPosto(planilha({ periculosidade: 589.39 }), { convencaoNoContrato: true });
    expect(Object.keys(p.valores)).toEqual(["salario"]);
  });

  it("adicionais da planilha ficam à parte, não no salário", () => {
    const p = preenchimentoDoPosto(planilha({ lideranca: 200, dsr: 50.5, adicional_noturno: 0 }));
    expect(p.adicionais).toEqual([
      { descricao: "Adicional de líder", valor: 200 },
      { descricao: "DSR", valor: 50.5 },
    ]);
  });
});

describe("aplicarPreenchimento", () => {
  const p = preenchimentoDoPosto(planilha());

  it("preenche o que está vazio e lembra o que pôs", () => {
    const n = aplicarPreenchimento(linha(), p)!;
    expect(n.salario).toBe("1964,63");
    expect(n.auto?.salario).toBe("1964,63");
  });

  it("nunca sobrescreve o que foi digitado à mão", () => {
    expect(aplicarPreenchimento(linha({ salario: "1928,12", beneficios: "VT: R$ 18,00 por dia" }), p)?.salario ?? "1928,12").toBe("1928,12");
  });

  it("atualiza o que ele mesmo pôs, se a fonte mudar", () => {
    const n = aplicarPreenchimento(linha(), p)!;
    const n2 = aplicarPreenchimento(n, preenchimentoDoPosto(planilha({ salario: 2100 })))!;
    expect(n2.salario).toBe("2100,00");
  });

  it("o botão (forcar) troca o digitado", () => {
    expect(aplicarPreenchimento(linha({ salario: "1928,12" }), p, true)!.salario).toBe("1964,63");
  });

  it("reaplicar não muda nada (sem laço na tela)", () => {
    const n = aplicarPreenchimento(linha(), p)!;
    expect(aplicarPreenchimento(n, p)).toBeNull();
  });
});

describe("preencherQuadro", () => {
  it("só toca linha em uso e com posto na planilha", () => {
    const mapa = remuneracaoPorPosto([planilha()]);
    const zerada = linha({ quantidade: "0" });
    const fora = linha({ posto_nome: "OUTRO POSTO" });
    const res = preencherQuadro([linha(), zerada, fora], mapa, false)!;
    expect(res[0].salario).toBe("1964,63");
    expect(res[1]).toBe(zerada);
    expect(res[2]).toBe(fora);
    expect(preencherQuadro(res, mapa, false)).toBeNull();
  });
});

describe("Outros", () => {
  it("valida item meio preenchido e ignora o em branco", () => {
    expect(erroDosOutros([{ descricao: "", valor: "" }])).toBeNull();
    expect(erroDosOutros([{ descricao: "Ajuda de custo", valor: "" }])).toMatch(/maior que zero/);
    expect(erroDosOutros([{ descricao: "", valor: "50" }])).toMatch(/sem descrição/);
    expect(erroDaLinha(linha({ salario: "1964,63", outros_proventos: [{ descricao: "X", valor: "0" }] }))).toMatch(/Outros/);
  });

  it("vai para o payload com número pt-BR lido certo", () => {
    expect(outrosParaPayload([{ descricao: " Ajuda de custo ", valor: "1.200,50" }, { descricao: "", valor: "" }]))
      .toEqual([{ descricao: "Ajuda de custo", valor: 1200.5 }]);
    const [l] = paraPayload([linha({ salario: "1964,63", outros_proventos: [{ descricao: "Bônus", valor: "100" }] })]);
    expect(l.outros_proventos).toEqual([{ descricao: "Bônus", valor: 100 }]);
    expect(l).not.toHaveProperty("auto");
  });

  it("a vaga mostra Outros em texto, ignorando lixo do jsonb", () => {
    expect(outrosEmTexto([{ descricao: "Ajuda de custo", valor: 150 }, { descricao: "", valor: 9 }, null]))
      .toMatch(/^Ajuda de custo R\$\s150,00\/mês$/);
    expect(outrosEmTexto(null)).toBe("");
  });

  it("incluir adicional da planilha não duplica", () => {
    const a = { descricao: "Adicional de líder", valor: 200 };
    const uma = incluirEmOutros([], a);
    expect(uma).toEqual([{ descricao: "Adicional de líder", valor: "200,00" }]);
    expect(incluirEmOutros(uma, a)).toBe(uma);
  });
});
