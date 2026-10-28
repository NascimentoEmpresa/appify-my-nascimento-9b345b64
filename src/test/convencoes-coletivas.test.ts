import { describe, expect, it } from "vitest";
import {
  BENEFICIOS, DEF_POR_CHAVE, beneficioPreenchido, identificacaoCct, montarQuadro, normalizarBeneficios,
  pendenciasConvencao, situacaoConvencao, textoBeneficio,
  type MapaBeneficios, type ReferenciaConvencao,
} from "@/lib/licitacoes/convencoes";

/** Todos os benefícios preenchidos, como num cadastro completo. */
const completos = (): MapaBeneficios => ({
  va: { valor: 23.5, periodo: "dia" },
  vl: { valor: 12, periodo: "dia" },
  vt: { valor: 5, periodo: "dia" },
  insalubridade: { percentual: 20 },
  periculosidade: { nao_contem: true },
  assiduidade: { valor: 120, periodo: "mes" },
  cesta_basica: { valor: 150, periodo: "mes" },
  plano_saude: { nao_contem: true },
  auxilio_creche: { valor: 200 },
  adicional_lider: { modo: "valor", valor: 300, periodo: "mes" },
});

const cadastro = (b: MapaBeneficios = completos()) => ({
  empresa_id: "e", contrato_id: "c", categoria_profissional: "Limpeza e Conservação", sindicato: "Sindilimp RS",
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
    expect(beneficioPreenchido(DEF_POR_CHAVE.va, { nao_contem: true })).toBe(true);
  });
  it("percentual só aceita as opções do chamado", () => {
    expect(beneficioPreenchido(DEF_POR_CHAVE.insalubridade, { percentual: 40 })).toBe(true);
    expect(beneficioPreenchido(DEF_POR_CHAVE.insalubridade, { percentual: 10 })).toBe(false);
    expect(beneficioPreenchido(DEF_POR_CHAVE.periculosidade, { percentual: 30 })).toBe(true);
  });
  it("Plano de Saúde e Auxílio Creche são só por mês", () => {
    expect(textoBeneficio(DEF_POR_CHAVE.plano_saude, { valor: 250 })).toBe("R$ 250,00 / mês");
    expect(textoBeneficio(DEF_POR_CHAVE.auxilio_creche, { valor: 25.52, periodo: "dia" })).toBe("R$ 25,52 / mês");
  });
  it("a periodicidade sai como foi cadastrada", () => {
    expect(textoBeneficio(DEF_POR_CHAVE.va, { valor: 23.5, periodo: "dia" })).toBe("R$ 23,50 / dia");
    expect(textoBeneficio(DEF_POR_CHAVE.va, { valor: 461.82, periodo: "mes" })).toBe("R$ 461,82 / mês");
  });
  it("Adicional de Líder: valor ou porcentagem (10/20/30)", () => {
    const d = DEF_POR_CHAVE.adicional_lider;
    expect(textoBeneficio(d, { modo: "porcentagem", percentual: 20, periodo: "mes" })).toBe("20% / mês");
    expect(beneficioPreenchido(d, { modo: "porcentagem", percentual: 15, periodo: "mes" })).toBe(false);
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
  it("decreto sem anexo é pendência", () => {
    expect(pendenciasConvencao({ ...cadastro(), decreto_numero: "12.345/2024" })).toContain("Decreto municipal informado sem o anexo");
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
    expect(q.itens.find((i) => i.def.chave === "va")?.texto).toBe("R$ 23,50 / dia");
    expect(q.itens.find((i) => i.def.chave === "plano_saude")?.naoContem).toBe(true);
  });
  it("regra por benefício: o VT sai do decreto, sem somar", () => {
    const decreto = ref("b", { vt: { valor: 9.1, periodo: "mes" } });
    const q = montarQuadro({ status: "vinculado", principal_id: "a", regras: { vt: "b" }, referencias: [ref("a", completos()), decreto] });
    expect(q.itens.find((i) => i.def.chave === "vt")?.texto).toBe("R$ 9,10 / mês");
    expect(q.usadas.map((u) => u.id)).toEqual(["a", "b"]);
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
