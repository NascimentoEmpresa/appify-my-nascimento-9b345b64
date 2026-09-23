import { describe, expect, it } from "vitest";
import { contratosCotados, nomeContrato } from "@/components/cotacoes/comum";
import type { CotacaoLicitacao } from "@/hooks/useCotacoesLicitacao";

/**
 * SIS-2026-0487 — o índice "Contratos cotados" da tela de Compras.
 *
 * O que se testa aqui é o agrupamento, não o desenho: é ele que decide se
 * duas cotações do mesmo contrato aparecem como um item só no dropdown (que é
 * o ponto do chamado) ou como duas entradas que parecem iguais.
 */
function cotacao(over: Partial<CotacaoLicitacao> & { id: string; created_at: string }): CotacaoLicitacao {
  return {
    empresa_id: "emp-1", tipo: "Cotação", contrato: null, comentario: "…",
    remetente_id: null, remetente_nome: "Camila Campos Kuhn", status: "respondido",
    visualizado_por_id: null, visualizado_por_nome: null, visualizado_em: null,
    resposta_comentario: null, respondente_id: null, respondente_nome: null, data_resposta: null,
    resposta_visualizada_por_id: null, resposta_visualizada_por_nome: null, resposta_visualizada_em: null,
    editado_por_id: null, editado_por_nome: null, editado_em: null,
    updated_at: over.created_at, anexosSolicitacao: [], anexosResposta: [],
    ...over,
  };
}

describe("nomeContrato", () => {
  it("apara o espaço e trata vazio como ausência", () => {
    expect(nomeContrato({ contrato: "  CT 2024/0012  " })).toBe("CT 2024/0012");
    expect(nomeContrato({ contrato: "   " })).toBeNull();
    expect(nomeContrato({ contrato: null })).toBeNull();
  });
});

describe("contratosCotados", () => {
  it("agrupa as cotações do mesmo contrato e aponta a mais recente primeiro", () => {
    const lista = contratosCotados([
      cotacao({ id: "a", created_at: "2026-05-18T17:04:00.000Z", contrato: "CT 2024/0012" }),
      cotacao({ id: "b", created_at: "2026-09-22T09:06:00.000Z", contrato: "CT 2024/0012" }),
    ]);

    expect(lista).toHaveLength(1);
    expect(lista[0].nome).toBe("CT 2024/0012");
    expect(lista[0].maisRecente).toBe("2026-09-22T09:06:00.000Z");
    // A primeira ocorrência é o destino do scroll — tem de ser a mais nova.
    expect(lista[0].ocorrencias.map((o) => o.id)).toEqual(["b", "a"]);
    // E é ela que diz qual ano/mês do acordeão abrir.
    expect(lista[0].ocorrencias[0]).toMatchObject({ year: 2026, month: 8 });
    expect(lista[0].ocorrencias[1]).toMatchObject({ year: 2026, month: 4 });
  });

  it("junta grafias que só diferem por caixa ou espaço, exibindo a mais recente", () => {
    const lista = contratosCotados([
      cotacao({ id: "a", created_at: "2026-05-18T17:04:00.000Z", contrato: "ct 01" }),
      cotacao({ id: "b", created_at: "2026-08-02T10:00:00.000Z", contrato: "  CT 01  " }),
    ]);

    expect(lista).toHaveLength(1);
    expect(lista[0].nome).toBe("CT 01");
    expect(lista[0].ocorrencias).toHaveLength(2);
  });

  it("deixa de fora o histórico sem contrato — o dropdown é índice de contrato", () => {
    const lista = contratosCotados([
      cotacao({ id: "a", created_at: "2026-05-18T17:04:00.000Z", contrato: null }),
      cotacao({ id: "b", created_at: "2026-05-19T17:04:00.000Z", contrato: "   " }),
      cotacao({ id: "c", created_at: "2026-05-20T17:04:00.000Z", contrato: "CT 99" }),
    ]);

    expect(lista.map((c) => c.nome)).toEqual(["CT 99"]);
  });

  it("ordena por nome em pt-BR, com número na ordem humana e acento ignorado", () => {
    const lista = contratosCotados([
      cotacao({ id: "a", created_at: "2026-01-01T00:00:00.000Z", contrato: "CT 10" }),
      cotacao({ id: "b", created_at: "2026-01-02T00:00:00.000Z", contrato: "CT 2" }),
      cotacao({ id: "c", created_at: "2026-01-03T00:00:00.000Z", contrato: "Água Limpa" }),
    ]);

    // "CT 2" antes de "CT 10" (numeric), e "Água" ordenado como "Agua".
    expect(lista.map((c) => c.nome)).toEqual(["Água Limpa", "CT 2", "CT 10"]);
  });
});
