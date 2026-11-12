import { describe, expect, it } from "vitest";
import {
  MOTIVO_SUBSTITUICAO, bloqueioSubstituicao, filtroEmpregadoDaVaga, quantitativoAcima, textoQuantitativo,
  FILTRO_EMPREGADO_VAGA, FILTRO_EMPREGADO_SUBSTITUICAO,
  type SituacaoSubstituido, type QuantitativoContrato,
} from "@/lib/recrutamento/vagaRegras";

// Chamado #0845 (Fernanda, 11/11/2026) — Ajuste na abertura de vagas,
// substituição de colaboradores. Duas validações SEPARADAS: a situação de
// quem sai (demissão, afastamento ou atestado liberam; trabalhando barra) e o
// quantitativo do contrato (acima do cotado exige Sim + justificativa).

const sit = (s: SituacaoSubstituido["situacao"], permite: boolean, texto = "x"): SituacaoSubstituido => ({ situacao: s, permite, texto });
const acima: QuantitativoContrato = { contrato_id: "c", ativos: 122, cotado: 120 };
const dentro: QuantitativoContrato = { contrato_id: "c", ativos: 118, cotado: 120 };

describe("situação de quem sai", () => {
  it("afastado, atestado e demissão liberam; dentro do cotado não pede nada", () => {
    for (const s of ["afastado", "atestado", "demissao"] as const) {
      expect(bloqueioSubstituicao({ situacao: sit(s, true), quantitativo: dentro, decisao: "", justificativa: "" })).toBeNull();
    }
  });

  it("trabalhando barra com a frase do chamado, mesmo com o contrato liberado", () => {
    const t = "Colaborador ativo com status trabalhando. Não é possível prosseguir com a substituição.";
    expect(bloqueioSubstituicao({ situacao: sit("trabalhando", false, t), quantitativo: acima, decisao: "sim", justificativa: "ok" })).toBe(t);
  });
});

describe("quantitativo do contrato", () => {
  it("acima só quando ativos > cotado, com os dois números", () => {
    expect(quantitativoAcima(acima)).toBe(true);
    expect(quantitativoAcima({ contrato_id: "c", ativos: 120, cotado: 120 })).toBe(false);
    expect(quantitativoAcima({ contrato_id: "c", ativos: 122, cotado: null })).toBe(false);
    expect(quantitativoAcima(null)).toBe(false);
  });

  it("acima do cotado: sem resposta, com Não, e com Sim sem justificativa barram", () => {
    const base = { situacao: sit("afastado", true), quantitativo: acima };
    expect(bloqueioSubstituicao({ ...base, decisao: "", justificativa: "" })).toMatch(/responda/);
    expect(bloqueioSubstituicao({ ...base, decisao: "nao", justificativa: "" })).toMatch(/não deseja prosseguir/);
    expect(bloqueioSubstituicao({ ...base, decisao: "sim", justificativa: "   " })).toMatch(/justificativa/);
    expect(bloqueioSubstituicao({ ...base, decisao: "sim", justificativa: "Posto extra no hospital — autorizou Fernanda" })).toBeNull();
  });

  it("o texto é o do chamado", () => {
    expect(textoQuantitativo(acima)).toBe("O contrato consta com 122 colaboradores ativos, enquanto o quantitativo cotado é de 120.");
  });
});

describe("busca de colaborador", () => {
  it("Substituição mostra o auxílio-doença (3); os outros motivos seguem como antes", () => {
    expect(filtroEmpregadoDaVaga(MOTIVO_SUBSTITUICAO)).toBe(FILTRO_EMPREGADO_SUBSTITUICAO);
    expect(FILTRO_EMPREGADO_SUBSTITUICAO).toContain("not.in.(7)");
    expect(filtroEmpregadoDaVaga("Aumento de Quadro")).toBe(FILTRO_EMPREGADO_VAGA);
  });
});
