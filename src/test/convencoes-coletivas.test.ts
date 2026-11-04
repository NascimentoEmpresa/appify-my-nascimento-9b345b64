import { describe, expect, it } from "vitest";
import {
  BENEFICIOS, DEF_POR_CHAVE, beneficioPreenchido, identificacaoCct, montarQuadro, normalizarBeneficios,
  BENEFICIOS_CCT, pendenciasConvencao, pendenciasDecreto, situacaoConvencao, textoBeneficio,
  type MapaBeneficios, type ReferenciaConvencao,
} from "@/lib/licitacoes/convencoes";

/** Todos os benefícios preenchidos, como num cadastro completo. */
const completos = (): MapaBeneficios => ({
  va: { valor: 23.5, periodo: "dia", desconto: { modo: "porcentagem", percentual: 20 } },
  vl: { valor: 12, periodo: "dia" },
  vt: { valor: 5, periodo: "dia" },
  insalubridade: { percentual: 20, base: "minimo_regional" },
  periculosidade: { nao_contem: true },
  assiduidade: { valor: 120, periodo: "mes" },
  cesta_basica: { valor: 150, periodo: "mes" },
  plano_saude: { nao_contem: true },
  auxilio_creche: { valor: 200 },
  adicional_lider: { modo: "valor", valor: 300, periodo: "mes" },
});

const cadastro = (b: MapaBeneficios = completos()) => ({
  empresa_id: "e", categoria_profissional: "Limpeza e Conservação", sindicato: "Sindilimp RS",
  vigencia_inicio: "2026-01-01", vigencia_fim: "2027-12-31", cct_arquivo_path: "c/cct.pdf", beneficios: b,
});

describe("benefícios", () => {
  it("segue a ordem do chamado, com o Vale-Lanche logo abaixo do VA", () => {
    expect(BENEFICIOS.map((b) => b.chave).slice(0, 2)).toEqual(["va", "vl"]);
    expect(BENEFICIOS).toHaveLength(10);
  });
  it("vazio NÃO é 'Não contém'", () => {
    expect(beneficioPreenchido(DEF_POR_CHAVE.va, undefined)).toBe(false);
    expect(beneficioPreenchido(DEF_POR_CHAVE.va, {})).toBe(false);
    expect(beneficioPreenchido(DEF_POR_CHAVE.va, { valor: 10 })).toBe(false); // sem periodicidade
    expect(beneficioPreenchido(DEF_POR_CHAVE.va, { valor: 10, periodo: "dia" })).toBe(false); // sem o desconto
    expect(beneficioPreenchido(DEF_POR_CHAVE.va, { nao_contem: true })).toBe(true);
  });
  it("percentual é digitado e exige a base de cálculo", () => {
    const ins = DEF_POR_CHAVE.insalubridade;
    expect(beneficioPreenchido(ins, { percentual: 10, base: "salario_base" })).toBe(true);
    expect(beneficioPreenchido(ins, { percentual: 40 })).toBe(false); // sem base
    expect(beneficioPreenchido(ins, { percentual: 120, base: "salario_base" })).toBe(false);
    expect(textoBeneficio(DEF_POR_CHAVE.periculosidade, { percentual: 30, base: "salario_base" })).toBe("30% sobre o salário base");
    expect(textoBeneficio(ins, { percentual: 12.5, base: "minimo_nacional" })).toBe("12,5% sobre o salário mínimo nacional");
  });
  it("aviso diz quando falta só a base", () => {
    const b = completos();
    b.insalubridade = { percentual: 40 };
    expect(pendenciasConvencao(cadastro(b))).toEqual(["Insalubridade: escolha a base de cálculo"]);
  });
  it("VA: desconto do colaborador em valor, porcentagem ou 'Não contém'", () => {
    const va = DEF_POR_CHAVE.va;
    expect(textoBeneficio(va, { valor: 23.5, periodo: "dia", desconto: { modo: "porcentagem", percentual: 20 } }))
      .toBe("R$ 23,50 / dia · desconto do colaborador: 20%");
    expect(textoBeneficio(va, { valor: 400, periodo: "mes", desconto: { modo: "valor", valor: 1 } }))
      .toBe("R$ 400,00 / mês · desconto do colaborador: R$ 1,00");
    expect(textoBeneficio(va, { valor: 400, periodo: "mes", desconto: { nao_contem: true } }))
      .toBe("R$ 400,00 / mês · desconto do colaborador: não contém");
    expect(beneficioPreenchido(va, { nao_contem: true })).toBe(true); // sem VA não há desconto
    const b = completos();
    b.va = { valor: 23.5, periodo: "dia" };
    expect(pendenciasConvencao(cadastro(b))).toEqual(['Vale-Alimentação (VA): informe o desconto do colaborador ou marque "Não contém"']);
  });
  it("a CCT não cadastra VT (vem do decreto)", () => {
    expect(BENEFICIOS_CCT.map((b) => b.chave)).not.toContain("vt");
    const b = completos();
    delete b.vt;
    expect(pendenciasConvencao(cadastro(b))).toEqual([]);
  });
  it("Plano de Saúde e Auxílio Creche são só por mês", () => {
    expect(textoBeneficio(DEF_POR_CHAVE.plano_saude, { valor: 250 })).toBe("R$ 250,00 / mês");
    expect(textoBeneficio(DEF_POR_CHAVE.auxilio_creche, { valor: 25.52, periodo: "dia" })).toBe("R$ 25,52 / mês");
  });
  it("a periodicidade sai como foi cadastrada", () => {
    expect(textoBeneficio(DEF_POR_CHAVE.vl, { valor: 23.5, periodo: "dia" })).toBe("R$ 23,50 / dia");
    expect(textoBeneficio(DEF_POR_CHAVE.vl, { valor: 461.82, periodo: "mes" })).toBe("R$ 461,82 / mês");
  });
  it("Adicional de Líder: valor (sem base) ou porcentagem digitada sobre a base", () => {
    const d = DEF_POR_CHAVE.adicional_lider;
    expect(textoBeneficio(d, { modo: "porcentagem", percentual: 15, base: "salario_base", periodo: "mes" })).toBe("15% sobre o salário base / mês");
    expect(beneficioPreenchido(d, { modo: "porcentagem", percentual: 15, periodo: "mes" })).toBe(false); // sem base
    expect(textoBeneficio(d, { modo: "valor", valor: 300, periodo: "mes" })).toBe("R$ 300,00 / mês");
    expect(normalizarBeneficios({ adicional_lider: { modo: "valor", valor: 300, periodo: "mes", base: "salario_base" } }).adicional_lider?.base).toBeUndefined();
    expect(beneficioPreenchido(d, { modo: "valor", periodo: "mes" })).toBe(false);
    expect(textoBeneficio(d, { nao_contem: true })).toBe("Não contém");
  });
  it("normalizar: 'Não contém' limpa o resto e a periodicidade fixa entra sozinha", () => {
    const n = normalizarBeneficios({ va: { nao_contem: true, valor: 9, periodo: "dia" }, plano_saude: { valor: 250 } });
    expect(n.va).toEqual({ nao_contem: true });
    expect(n.plano_saude).toEqual({ nao_contem: false, valor: 250, periodo: "mes" });
  });
});

describe("cadastro", () => {
  it("completo sem pendência", () => {
    expect(pendenciasConvencao(cadastro())).toEqual([]);
    expect(situacaoConvencao(cadastro())).toBe("completo");
  });
  it("benefício em branco e CCT sem anexo deixam pendente", () => {
    const b = completos();
    delete b.cesta_basica;
    const p = pendenciasConvencao({ ...cadastro(b), cct_arquivo_path: null });
    expect(p).toContain("Convenção coletiva não anexada");
    expect(p.some((x) => x.startsWith("Cesta Básica"))).toBe(true);
  });
  it("contrato e decreto não são mais cobrados na CCT", () => {
    expect(pendenciasConvencao({ ...cadastro(), contrato_id: null, decreto_numero: "12.345/2024" })).toEqual([]);
  });
  it("identificação da CCT pela vigência", () => {
    expect(identificacaoCct({ vigencia_inicio: "2026-01-01", vigencia_fim: "2027-12-31" })).toBe("CCT 2026/2027");
    expect(identificacaoCct({ identificacao: "CCT SEAC 2026", vigencia_inicio: "2026-01-01" })).toBe("CCT SEAC 2026");
  });
});

const ref = (id: string, b: MapaBeneficios, versao = 1): ReferenciaConvencao => ({
  id, versao, beneficios: b, vigencia_inicio: "2026-01-01", vigencia_fim: "2026-12-31",
});

describe("quadro da vaga", () => {
  it("posto sem vínculo é pendência — nunca 'Não contém'", () => {
    const q = montarQuadro({ status: "sem_vinculo", posto: "SUP. 5D POA" });
    expect(q.itens).toHaveLength(0);
    expect(q.pendencias[0]).toContain("SUP. 5D POA");
  });
  it("tudo da principal", () => {
    const q = montarQuadro({ status: "vinculado", principal_id: "a", referencias: [ref("a", completos())] });
    expect(q.status).toBe("ok");
    expect(q.itens.find((i) => i.def.chave === "va")?.texto).toBe("R$ 23,50 / dia · desconto do colaborador: 20%");
    expect(q.itens.find((i) => i.def.chave === "insalubridade")?.texto).toBe("20% sobre o salário mínimo regional");
    expect(q.itens.find((i) => i.def.chave === "plano_saude")?.naoContem).toBe(true);
  });
  it("regra por benefício: o VT sai do decreto, sem somar", () => {
    const decreto = ref("b", { vt: { valor: 9.1, periodo: "mes" } });
    const q = montarQuadro({ status: "vinculado", principal_id: "a", regras: { vt: "b" }, referencias: [ref("a", completos()), decreto] });
    expect(q.itens.find((i) => i.def.chave === "vt")?.texto).toBe("R$ 9,10 / mês");
    expect(q.usadas.map((u) => u.id)).toEqual(["a", "b"]);
  });
  it("CCT sem VT e posto sem decreto: a pendência pede o decreto", () => {
    const b = completos();
    delete b.vt;
    const q = montarQuadro({ status: "vinculado", principal_id: "a", referencias: [ref("a", b)] });
    expect(q.pendencias).toEqual(["Vale-Transporte (VT): o posto não tem decreto municipal para o VT — vincule na Planilha de Custo."]);
  });
  it("benefício em branco na convenção vira pendência", () => {
    const b = completos();
    delete b.vl;
    const q = montarQuadro({ status: "vinculado", principal_id: "a", referencias: [ref("a", b)] });
    expect(q.status).toBe("pendente");
    expect(q.itens.find((i) => i.def.chave === "vl")?.texto).toBeNull();
  });
  it("avisa quando a convenção já tem versão mais nova que a da vaga", () => {
    const q = montarQuadro({ status: "vinculado", principal_id: "a", referencias: [ref("a", completos(), 2)], versoes_atuais: { a: 3 } });
    expect(q.desatualizada).toBe(true);
  });
});

describe("decreto municipal em cadastro próprio", () => {
  const decreto = (b: MapaBeneficios = { vt: { valor: 4.8, periodo: "dia" } }) => ({
    tipo: "decreto" as const, decreto_numero: "Decreto 12.345/2024", municipio: "Bento Gonçalves",
    decreto_arquivo_path: "decretos/decreto.pdf", beneficios: b,
  });

  it("sem contrato, sem CCT e só com o VT fica completo", () => {
    expect(pendenciasConvencao(decreto())).toEqual([]);
    expect(situacaoConvencao(decreto())).toBe("completo");
  });

  it("VT vazio é pendência; \"Não contém\" vale", () => {
    expect(pendenciasDecreto(decreto({}))).toEqual(['Vale-Transporte (VT): preencha o valor ou marque "Não contém"']);
    expect(pendenciasDecreto(decreto({ vt: { nao_contem: true } }))).toEqual([]);
  });

  it("cobra número, município e anexo", () => {
    expect(pendenciasDecreto({ tipo: "decreto", beneficios: { vt: { nao_contem: true } } }))
      .toEqual(["Número do decreto não informado", "Município não informado", "Decreto não anexado"]);
  });

  it("a CCT continua com as regras dela", () => {
    expect(pendenciasConvencao({ ...cadastro(), tipo: "cct" })).toEqual([]);
  });
});
