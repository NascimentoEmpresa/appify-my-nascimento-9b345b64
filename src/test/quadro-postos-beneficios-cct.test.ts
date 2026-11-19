// SIS-2026-0958 — benefícios da CCT nas vagas que a LICITAÇÃO abre (Quadro de
// Postos do contrato). Regra:
//   • posto com benefício na planilha (fora VT) → importa da CCT vinculada,
//     como está no cadastro (valor + unidade);
//   • sem benefício na planilha → não importa;
//   • sem CCT/vínculo → aviso;
//   • VT sempre vazio; o importado é editável (não sobrescreve o digitado).
import { describe, it, expect } from "vitest";
import {
  type LinhaQuadroForm, type RemuneracaoPosto, LINHA_VAZIA,
  beneficiosDaCct, beneficiosNaPlanilha, preenchimentoDoPosto, aplicarPreenchimento, preencherQuadro, remuneracaoPorPosto,
} from "@/lib/licitacoes/quadroPostos";
import type { RespostaReferencia } from "@/lib/licitacoes/convencoes";

const HOJE = "2026-11-19";

// CCT do SEEAC como o cadastro guarda — com VT vindo de um decreto (regra 'vt').
const cct = {
  id: "cct-seeac", versao: 2, identificacao: "CCT 2026/2027", sindicato: "SEEAC/SINDASSEIO RS",
  vigencia_inicio: "2026-01-01", vigencia_fim: "2026-12-31",
  beneficios: {
    va: { valor: 27.15, periodo: "dia" as const, desconto: { nao_contem: true } },
    vl: { nao_contem: true },
    insalubridade: { percentual: 40, base: "minimo_regional" as const },
    periculosidade: { nao_contem: true },
    assiduidade: { valor: 80, periodo: "mes" as const },
    cesta_basica: { valor: 150, periodo: "mes" as const },
    plano_saude: { nao_contem: true },
    auxilio_creche: { nao_contem: true },
    adicional_lider: { nao_contem: true },
  },
};
const decreto = { id: "dec-poa", versao: 1, decreto_numero: "21.000/2026", beneficios: { vt: { valor: 5.6, periodo: "dia" as const } } };

const ref = (p: Partial<RespostaReferencia> = {}): RespostaReferencia => ({
  status: "vinculado", origem: "posto", principal_id: "cct-seeac",
  regras: { vt: "dec-poa" }, referencias: [cct, decreto], ...p,
});

// "porteiro São Camilo": VA e assiduidade na planilha, VT também.
const porteiro = (p: Partial<RemuneracaoPosto> = {}): RemuneracaoPosto => ({
  posto: "PORTEIRO SAO CAMILO", vigencia: "2026-03-01", salario: 1964.63,
  insalubridade: 0, periculosidade: 0, vt: 245.4,
  beneficios_planilha: { "Aux. Alimentação": 597.3, "Assiduidade": 80 },
  sindicato: "SEEAC/SINDASSEIO RS",
  referencia: ref(),
  ...p,
});

const linha = (p: Partial<LinhaQuadroForm> = {}): LinhaQuadroForm => ({
  ...LINHA_VAZIA, posto_nome: "PORTEIRO SAO CAMILO", funcao_nome: "PORTEIRO", quantidade: "2", ...p,
});

describe("beneficiosDaCct — tem benefício na planilha → importa da CCT", () => {
  it("traz valor e unidade como estão no cadastro da CCT", () => {
    const b = beneficiosDaCct(porteiro(), HOJE);
    expect(b.texto).toContain("Vale-Alimentação (VA): R$ 27,15 / dia");
    expect(b.texto).toContain("Prêmio Assiduidade: R$ 80,00 / mês");
    expect(b.texto).toContain("Cesta Básica: R$ 150,00 / mês");
    expect(b.origem).toBe("Da CCT 2026/2027 (vinculada ao posto na Planilha de Custo)");
    expect(b.aviso).toBeNull();
  });

  it("'Não contém' não entra no texto", () => {
    expect(beneficiosDaCct(porteiro(), HOJE).texto).not.toMatch(/Vale Lanche|Plano de Saúde|Não contém/);
  });

  it("VT nunca entra — nem com decreto vinculado", () => {
    const b = beneficiosDaCct(porteiro(), HOJE);
    expect(b.texto).not.toMatch(/Vale-Transporte|VT|5,60/);
  });

  it("a origem diz de onde veio a CCT (contrato, posto, sindicato)", () => {
    expect(beneficiosDaCct(porteiro({ referencia: ref({ origem: "contrato" }) }), HOJE).origem).toMatch(/vinculada ao contrato/);
    expect(beneficiosDaCct(porteiro({ referencia: ref({ origem: "sindicato", regras: {} }) }), HOJE).origem).toMatch(/pelo sindicato do posto/);
  });

  it("CCT fora da vigência de hoje: importa, mas avisa", () => {
    const velha = { ...cct, identificacao: "CCT 2025", vigencia_inicio: "2025-01-01", vigencia_fim: "2025-12-31" };
    const b = beneficiosDaCct(porteiro({ referencia: ref({ referencias: [velha, decreto] }) }), HOJE);
    expect(b.texto).toContain("R$ 27,15 / dia");
    expect(b.aviso).toMatch(/não cobre a data de hoje/);
    const s = beneficiosDaCct(porteiro({ referencia: ref({ origem: "sindicato", fora_da_vigencia: true }) }), HOJE);
    expect(s.aviso).toMatch(/não cobre a data de hoje/);
  });

  it("CCT sem nenhum benefício preenchido (além do VT): aviso, campo vazio", () => {
    const so = { ...cct, beneficios: { va: { nao_contem: true } } };
    const b = beneficiosDaCct(porteiro({ referencia: ref({ referencias: [so, decreto] }) }), HOJE);
    expect(b.texto).toBeNull();
    expect(b.aviso).toMatch(/não tem benefício preenchido/);
  });
});

describe("beneficiosDaCct — sem benefício na planilha → não importa", () => {
  it("só VT na planilha não conta como benefício", () => {
    const r = porteiro({ beneficios_planilha: {}, vt: 245.4 });
    const b = beneficiosDaCct(r, HOJE);
    expect(b.texto).toBeNull();
    expect(b.aviso).toBeNull();
    expect(b.nota).toMatch(/não tem benefício/);
  });

  it("'Transporte' no mapa é ignorado mesmo assim", () => {
    expect(beneficiosNaPlanilha(porteiro({ beneficios_planilha: { Transporte: 200 } }))).toEqual({});
  });

  it("banco sem a migration: cai nos campos antigos (va/vr/lanche/cesta/assist.)", () => {
    const antigo = porteiro({ beneficios_planilha: undefined, va: 0, cesta_basica: 120 });
    expect(beneficiosNaPlanilha(antigo)).toEqual({ "Cesta Básica": 120 });
    expect(beneficiosNaPlanilha(porteiro({ beneficios_planilha: undefined, va: 0, vt: 300 }))).toEqual({});
  });
});

describe("beneficiosDaCct — sem CCT/vínculo → aviso", () => {
  it("sem vínculo: aviso claro com o sindicato procurado e o que a planilha tem", () => {
    const b = beneficiosDaCct(porteiro({ referencia: { status: "sem_vinculo", posto: "PORTEIRO SAO CAMILO" } }), HOJE);
    expect(b.texto).toBeNull();
    expect(b.aviso).toMatch(/não tem CCT vinculada/);
    expect(b.aviso).toMatch(/SEEAC\/SINDASSEIO RS/);
    expect(b.aviso).toMatch(/falta vincular o posto ou lançar a CCT/);
    expect(b.aviso).toMatch(/Aux\. Alimentação, Assiduidade/);
  });

  it("posto sem sindicato na planilha: o aviso diz isso", () => {
    const b = beneficiosDaCct(porteiro({ sindicato: null, referencia: { status: "sem_vinculo" } }), HOJE);
    expect(b.aviso).toMatch(/sem sindicato na planilha/);
  });

  it("posto achado só por aproximação (sem resposta do resolvedor): aviso, não 'sem CCT'", () => {
    const b = beneficiosDaCct(porteiro({ referencia: undefined }), HOJE);
    expect(b.aviso).toMatch(/não casou pelo nome/);
  });

  it("sem benefício na planilha nem CCT: nada de aviso (o usuário preenche à mão)", () => {
    const b = beneficiosDaCct(porteiro({ beneficios_planilha: {}, referencia: { status: "sem_vinculo" } }), HOJE);
    expect(b.aviso).toBeNull();
  });
});

describe("no quadro: editável e só nas linhas em uso", () => {
  it("o preenchimento automático põe os benefícios da CCT na linha", () => {
    const n = aplicarPreenchimento(linha(), preenchimentoDoPosto(porteiro(), { hoje: HOJE }))!;
    expect(n.beneficios).toContain("R$ 27,15 / dia");
  });

  it("o que foi digitado por cima não é trocado pelo automático", () => {
    const digitada = linha({ beneficios: "VA: R$ 30,00 por dia" });
    const n = aplicarPreenchimento(digitada, preenchimentoDoPosto(porteiro(), { hoje: HOJE }));
    expect(n?.beneficios ?? digitada.beneficios).toBe("VA: R$ 30,00 por dia");
  });

  it("com convenção no contrato os benefícios também vêm (e editáveis); percentuais não", () => {
    const p = preenchimentoDoPosto(porteiro({ referencia: ref({ origem: "contrato" }) }), { convencaoNoContrato: true, hoje: HOJE });
    expect(p.valores.beneficios).toContain("Prêmio Assiduidade");
    expect(p.valores.insalubridade_pct).toBeUndefined();
  });

  it("linha sem quantidade (catálogo à mostra) não é tocada", () => {
    expect(preencherQuadro([linha({ quantidade: "0" })], remuneracaoPorPosto([porteiro()]), false)).toBeNull();
  });
});
