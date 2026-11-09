import { describe, expect, it } from "vitest";
import {
  DEF_POR_CHAVE, anexosDoCadastro, beneficioPreenchido, espelhoAnexoPrincipal, lerPercentual, normalizarBeneficios,
  pendenciasConvencao, percentualTexto, planoAnexos, situacaoConvencao, textoBeneficio,
  type AnexoLista, type MapaBeneficios,
} from "@/lib/licitacoes/convencoes";

// Pedido da Licitação (09/11/2026, mig 20261109004500): CCT sem empresa,
// percentual do desconto do VA digitável, vários anexos por convenção.

const beneficiosCompletos = (): MapaBeneficios => ({
  va: { valor: 27.5, periodo: "dia", desconto: { modo: "porcentagem", percentual: 20 } },
  vl: { nao_contem: true },
  insalubridade: { percentual: 20, base: "minimo_regional" },
  periculosidade: { nao_contem: true },
  assiduidade: { nao_contem: true },
  cesta_basica: { nao_contem: true },
  plano_saude: { nao_contem: true },
  auxilio_creche: { nao_contem: true },
  adicional_lider: { nao_contem: true },
});

const cctSemEmpresa = {
  tipo: "cct" as const,
  categoria_profissional: "Limpeza e Conservação", sindicato: "SEEAC",
  vigencia_inicio: "2026-01-01", vigencia_fim: "2026-12-31", cct_arquivo_path: "convencoes/cct-1.pdf",
  beneficios: beneficiosCompletos(),
};

describe("CCT sem empresa", () => {
  it("empresa vazia não é pendência — a CCT vale para todas as empresas", () => {
    expect(pendenciasConvencao(cctSemEmpresa)).toEqual([]);
    expect(pendenciasConvencao({ ...cctSemEmpresa, empresa_id: null })).toEqual([]);
    expect(situacaoConvencao({ ...cctSemEmpresa, empresa_id: "" })).toBe("completo");
  });
  it("as outras obrigatoriedades continuam", () => {
    expect(pendenciasConvencao({ ...cctSemEmpresa, sindicato: "" })).toEqual(["Sindicato não informado"]);
    expect(pendenciasConvencao({ ...cctSemEmpresa, cct_arquivo_path: null })).toEqual(["Convenção coletiva não anexada"]);
  });
});

describe("percentual do desconto do colaborador (VA)", () => {
  it("aceita vírgula, ponto e o símbolo de %", () => {
    expect(lerPercentual("20")).toBe(20);
    expect(lerPercentual("7,5")).toBe(7.5);
    expect(lerPercentual("7.5")).toBe(7.5);
    expect(lerPercentual(" 6 % ")).toBe(6);
    expect(lerPercentual("7,")).toBe(7); // ainda digitando
  });
  it("vazio ou inválido vira null (nunca 0 escondido)", () => {
    expect(lerPercentual("")).toBeNull();
    expect(lerPercentual(null)).toBeNull();
    expect(lerPercentual("abc")).toBeNull();
    expect(lerPercentual("-5")).toBeNull();
  });
  it("o que a tela mostra ao reabrir é o que foi salvo", () => {
    expect(percentualTexto(7.5)).toBe("7,5");
    expect(percentualTexto(null)).toBe("");
    expect(lerPercentual(percentualTexto(12.25))).toBe(12.25);
  });
  it("o percentual é gravado e reaberto pela normalização", () => {
    const n = normalizarBeneficios({ va: { valor: 27.5, periodo: "dia", desconto: { modo: "porcentagem", percentual: lerPercentual("6,5") } } });
    expect(n.va?.desconto).toEqual({ nao_contem: false, modo: "porcentagem", percentual: 6.5 });
    expect(beneficioPreenchido(DEF_POR_CHAVE.va, n.va)).toBe(true);
    expect(textoBeneficio(DEF_POR_CHAVE.va, n.va)).toBe("R$ 27,50 / dia · desconto do colaborador: 6,5%");
  });
  it("sem percentual o VA fica pendente, com o aviso do desconto", () => {
    const b = beneficiosCompletos();
    b.va = { valor: 27.5, periodo: "dia", desconto: { modo: "porcentagem", percentual: null } };
    expect(pendenciasConvencao({ ...cctSemEmpresa, beneficios: b }))
      .toEqual(['Vale-Alimentação (VA): informe o desconto do colaborador ou marque "Não contém"']);
  });
});

describe("vários anexos", () => {
  const a1: AnexoLista = { id: "1", path: "convencoes/cct-1.pdf", nome: "CCT SEEAC 2026.pdf", tamanho: 100, descricao: "Limpeza — Capital" };
  const a2: AnexoLista = { id: "2", path: "convencoes/cct-2.pdf", nome: "CCT SEEAC interior.pdf", tamanho: 200, descricao: null };

  it("cadastro antigo (só cct_arquivo_path) vira um anexo sem id", () => {
    expect(anexosDoCadastro({ cct_arquivo_path: "x/cct.pdf", cct_arquivo_nome: "cct.pdf", cct_arquivo_tamanho: 5 }, []))
      .toEqual([{ id: null, path: "x/cct.pdf", nome: "cct.pdf", tamanho: 5, descricao: null }]);
    expect(anexosDoCadastro({ cct_arquivo_path: null }, null)).toEqual([]);
  });
  it("as linhas da tabela vêm na ordem em que entraram (a primeira é a principal)", () => {
    const l = anexosDoCadastro({ cct_arquivo_path: "ignorado" }, [
      { ...a2, criado_em: "2026-11-09T10:00:00Z" },
      { ...a1, criado_em: "2026-01-01T10:00:00Z" },
    ]);
    expect(l.map((a) => a.id)).toEqual(["1", "2"]);
  });
  it("anexo novo SOMA — não substitui nem apaga o anterior", () => {
    const novo: AnexoLista = { path: "convencoes/cct-3.pdf", nome: "Aditivo.pdf", tamanho: 50, descricao: "  Aditivo 2026 " };
    const p = planoAnexos([a1, a2], [a1, a2, novo]);
    expect(p.inserir).toEqual([{ path: "convencoes/cct-3.pdf", nome: "Aditivo.pdf", tamanho: 50, descricao: "Aditivo 2026" }]);
    expect(p.removerLinhas).toEqual([]);
    expect(p.removerArquivos).toEqual([]);
    expect(p.atualizar).toEqual([]);
  });
  it("remover um anexo tira a linha e o arquivo só dele", () => {
    const p = planoAnexos([a1, a2], [a2]);
    expect(p.removerLinhas).toEqual(["1"]);
    expect(p.removerArquivos).toEqual(["convencoes/cct-1.pdf"]);
    expect(p.inserir).toEqual([]);
  });
  it("trocar a descrição atualiza só a descrição", () => {
    const p = planoAnexos([a1, a2], [a1, { ...a2, descricao: "Interior" }]);
    expect(p.atualizar).toEqual([{ id: "2", descricao: "Interior" }]);
    expect(p.inserir).toEqual([]);
    // Espaço a mais não conta como mudança.
    expect(planoAnexos([a1], [{ ...a1, descricao: " Limpeza — Capital " }]).atualizar).toEqual([]);
  });
  it("anexo antigo sem linha vira linha ao salvar, sem reenviar o arquivo", () => {
    const antigo: AnexoLista = { id: null, path: "x/cct.pdf", nome: "cct.pdf", tamanho: 5, descricao: null };
    const p = planoAnexos([antigo], [{ ...antigo, descricao: "Capital" }]);
    expect(p.inserir).toEqual([{ path: "x/cct.pdf", nome: "cct.pdf", tamanho: 5, descricao: "Capital" }]);
    expect(p.removerArquivos).toEqual([]);
  });
  it("tirar o anexo antigo sem linha apaga só o arquivo", () => {
    const antigo: AnexoLista = { id: null, path: "x/cct.pdf", nome: "cct.pdf", tamanho: 5, descricao: null };
    const p = planoAnexos([antigo], []);
    expect(p.removerLinhas).toEqual([]);
    expect(p.removerArquivos).toEqual(["x/cct.pdf"]);
  });
  it("o espelho em cct_arquivo_* é o primeiro anexo (ou nada)", () => {
    expect(espelhoAnexoPrincipal([a1, a2])).toEqual({ cct_arquivo_path: a1.path, cct_arquivo_nome: a1.nome, cct_arquivo_tamanho: 100 });
    expect(espelhoAnexoPrincipal([])).toEqual({ cct_arquivo_path: null, cct_arquivo_nome: null, cct_arquivo_tamanho: null });
  });
});
