import { describe, it, expect } from "vitest";
import {
  CAMPOS_PATRIMONIO, PATRIM_RESET, soCamposDoForm,
} from "@/pages/juridico/patrimonio/carteira";

/**
 * A linha como o SELECT * devolve: o formulário recebe ela INTEIRA
 * (abrirEditarPat faz `{ ...PATRIM_RESET, ...p }`), então o estado carrega
 * colunas que a tela nunca edita.
 */
const linhaDoBanco = {
  id: 42,
  created_at: "2026-06-22T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
  codigo: "17",
  tipo: "Imóvel",
  descricao: "Casa na Rua das Flores",
  localizacao: "Rua das Flores, 120",
  cidade: "Triunfo",
  status: "Ativo",
  valor_contrato: "250000",
  // Rollup das parcelas — recalculado a partir de JUR_PATRIMONIO_OBRIGACOES.
  valor_falta: 80000,
  valor_total: 250000,
  parcelas_pagas: 12,
  parcelas_falta: 24,
  proxima_parcela: "2026-09-10",
  reforcos_pagos: 5000,
  aba_origem: "ATIVO IMOBILIZADO",
  geo_status: "ok",
};

describe("payload de salvar patrimônio", () => {
  it("não devolve o id — a coluna é IDENTITY e o UPDATE seria recusado", () => {
    // O erro real que a tela mostrava:
    // 'column "id" can only be updated to DEFAULT'
    expect(soCamposDoForm(linhaDoBanco)).not.toHaveProperty("id");
  });

  it("não devolve carimbos que o banco controla", () => {
    const p = soCamposDoForm(linhaDoBanco);
    expect(p).not.toHaveProperty("created_at");
    expect(p).not.toHaveProperty("updated_at");
  });

  it("não devolve os rollups das parcelas com valor velho da tela", () => {
    const p = soCamposDoForm(linhaDoBanco);
    for (const col of ["valor_falta", "valor_total", "parcelas_pagas",
                       "parcelas_falta", "proxima_parcela", "reforcos_pagos"]) {
      expect(p).not.toHaveProperty(col);
    }
  });

  it("leva todos os campos que a tela edita, e só eles", () => {
    expect(Object.keys(soCamposDoForm(linhaDoBanco)).sort()).toEqual([...CAMPOS_PATRIMONIO].sort());
  });

  it("preserva o valor digitado, não só a chave", () => {
    const p = soCamposDoForm({ ...linhaDoBanco, cidade: "Canoas", descricao: "Casa reformada" });
    expect(p.cidade).toBe("Canoas");
    expect(p.descricao).toBe("Casa reformada");
    expect(p.codigo).toBe("17");
  });

  it("campo apagado na tela vira string vazia, não some do payload", () => {
    // Some do payload = a coluna fica com o valor antigo no banco. Apagar a
    // placa tem que apagar a placa.
    const p = soCamposDoForm({ ...linhaDoBanco, placa: "" });
    expect(p).toHaveProperty("placa");
    expect(p.placa).toBe("");
  });

  it("cadastro novo (formulário vazio) não inventa id", () => {
    const p = soCamposDoForm({ ...PATRIM_RESET, descricao: "Terreno novo" });
    expect(p).not.toHaveProperty("id");
    expect(p.descricao).toBe("Terreno novo");
    expect(p.tipo).toBe("Imóvel");
  });

  it("o modelo do formulário não tem id nem colunas de rollup", () => {
    for (const col of ["id", "created_at", "valor_falta", "parcelas_pagas"]) {
      expect(PATRIM_RESET).not.toHaveProperty(col);
    }
  });
});
