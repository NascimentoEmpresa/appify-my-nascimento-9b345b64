import { describe, it, expect } from "vitest";
import {
  PARAM_ORIGEM_REEMBOLSO, urlDespesaDoReembolso,
} from "@/lib/reembolso/vinculoMalote";
import type { Reembolso } from "@/hooks/useReembolso";

// A querystring é o CONTRATO entre a Central de Serviços e o Malote: uma
// chave renomeada de um lado abre o formulário em branco do outro, sem erro
// nenhum na tela — o pior tipo de defeito, porque parece que a pessoa é que
// esqueceu de preencher. Estes testes travam os nomes das chaves e o formato
// dos valores que o formulário do Malote sabe ler.

const base: Reembolso = {
  id: "11111111-2222-3333-4444-555555555555",
  numero: "REEMB-202609-0026",
  solicitante_id: "u1",
  solicitante_nome: "GUSTAVO GARCIA RONSANI",
  setor: "Juridico",
  competencia: "2026-09",
  pix: "51982875562",
  distancia_km: 80,
  data_viagem: "2026-09-01",
  saida: "06:30",
  chegada: "11:30",
  observacoes: null,
  total_centavos: 1400,
  status: "aprovado",
  decidido_por_nome: "Natália Taborda",
  decidido_em: "2026-09-02T18:01:25Z",
  motivo_reprovacao: null,
  malote_despesa_id: null,
  enviado_malote_em: null,
  created_at: "2026-09-02T14:08:18Z",
};

const params = (r: Reembolso, s?: Parameters<typeof urlDespesaDoReembolso>[1]) =>
  new URLSearchParams(urlDespesaDoReembolso(r, s).split("?")[1]);

describe("urlDespesaDoReembolso", () => {
  it("aponta para o formulário do Malote, não para uma tela clonada", () => {
    // Clonar o formulário faria as regras de rateio, parcelamento e aprovação
    // existirem em dois lugares — é o que o próprio CriarDespesa.tsx avisa.
    expect(urlDespesaDoReembolso(base)).toMatch(/^\/app\/malote\/criar-despesa\?/);
  });

  it("manda o valor em REAIS, que é o que o formulário lê", () => {
    // O reembolso guarda centavos; o Malote, reais. Errar aqui multiplica a
    // despesa por 100 e ninguém percebe até o pagamento.
    expect(params(base).get("valor")).toBe("14");
  });

  it("manda a competência no formato do Malote", () => {
    expect(params(base).get("competencia")).toBe("2026-09");
  });

  it("leva o PIX para Informações de pagamento, onde o financeiro procura", () => {
    expect(params(base).get("info")).toBe("PIX: 51982875562");
  });

  it("o nome da despesa identifica de quem é o reembolso", () => {
    expect(params(base).get("nome"))
      .toBe("Reembolso REEMB-202609-0026 — GUSTAVO GARCIA RONSANI (Juridico)");
  });

  it("carrega o id do reembolso para o Malote carimbar a volta", () => {
    // Sem isto a despesa nasce e o reembolso fica "Aprovado" para sempre.
    expect(params(base).get(PARAM_ORIGEM_REEMBOLSO)).toBe(base.id);
  });
});

describe("classificação — o campo que travou o fluxo", () => {
  it("sem sugestão configurada, NÃO vai na URL", () => {
    // `rubrica=` vazio abriria o formulário com uma classificação "escolhida"
    // que não é nenhuma. Melhor não mandar e deixar a pessoa escolher.
    expect(params(base).has("rubrica")).toBe(false);
  });

  it("com sugestão, vai pelo NOME — é assim que o Malote a procura", () => {
    expect(params(base, { rubrica: "DIÁRIA" }).get("rubrica")).toBe("DIÁRIA");
  });

  it("sugestão vazia é o mesmo que não ter", () => {
    expect(params(base, { rubrica: "" }).has("rubrica")).toBe(false);
    expect(params(base, { rubrica: null }).has("rubrica")).toBe(false);
  });
});

describe("forma de pagamento", () => {
  it("PIX é o padrão — reembolso se paga por PIX", () => {
    expect(params(base).get("forma")).toBe("PIX");
  });

  it("a configuração ganha do padrão quando existe", () => {
    expect(params(base, { formaPagamento: "TED" }).get("forma")).toBe("TED");
  });
});

describe("campos que podem vir vazios", () => {
  it("não estoura com solicitante, número ou setor nulos", () => {
    const vazio = { ...base, numero: null, solicitante_nome: null, setor: null };
    const p = params(vazio);
    expect(p.get("nome")).toBe("Reembolso — colaborador (—)");
    expect(p.get(PARAM_ORIGEM_REEMBOLSO)).toBe(base.id);
  });
});
