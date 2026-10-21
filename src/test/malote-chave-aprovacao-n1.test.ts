import { describe, expect, it } from "vitest";
import { pedidoDeAprovacaoDaDespesa, podeCriarDespesaDaExcecao } from "@/pages/malote/excecao/regras";

// Malote (20/10/2026, DM-2026-2947): depois do horário 1.1 o Nível 1 só aprova com a senha de uma exceção de aprovação daquela despesa.
// A regra de verdade mora no banco (migration 20261021000020); aqui o que a tela usa para mostrar o pedido e esconder o "Criar despesa".
const AGORA = new Date("2026-10-20T18:00:00Z");
const expira = (horas: number) => new Date(AGORA.getTime() + horas * 3_600_000).toISOString();

const ped = (o: Record<string, unknown>) => ({
  id: "x", finalidade: "aprovacao" as const, despesa_alvo_id: "d1", status: "em_analise" as const, senha_expira_em: null as string | null,
  created_at: "2026-10-20T15:00:00Z", ...o,
});

describe("chave de aprovação do Nível 1", () => {
  it("a tela da despesa acha o pedido vivo: em análise, ou aprovado dentro das 24 h", () => {
    const lista = [
      ped({ id: "velho", status: "reprovada", created_at: "2026-10-19T10:00:00Z" }),
      ped({ id: "vivo", status: "aprovada", senha_expira_em: expira(10), created_at: "2026-10-20T14:00:00Z" }),
    ];
    expect(pedidoDeAprovacaoDaDespesa(lista, "d1", AGORA)?.id).toBe("vivo");
  });

  it("sem pedido vivo, mostra o mais recente (reprovada, expirada ou utilizada)", () => {
    const lista = [
      ped({ id: "a", status: "reprovada", created_at: "2026-10-19T10:00:00Z" }),
      ped({ id: "b", status: "aprovada", senha_expira_em: expira(-2), created_at: "2026-10-20T10:00:00Z" }), // venceu: "expirada"
    ];
    expect(pedidoDeAprovacaoDaDespesa(lista, "d1", AGORA)?.id).toBe("b");
  });

  it("só olha pedidos de aprovação DAQUELA despesa; exceção de criação e de outra despesa não contam", () => {
    const lista = [
      ped({ id: "criacao", finalidade: "criacao" }),
      ped({ id: "outra", despesa_alvo_id: "d2" }),
    ];
    expect(pedidoDeAprovacaoDaDespesa(lista, "d1", AGORA)).toBeNull();
  });

  it("a chave de aprovação nunca vira 'Criar despesa'; a exceção de criação (e a antiga, sem finalidade) continua podendo", () => {
    const ativa = { status: "aprovada" as const, senha_expira_em: expira(5) };
    expect(podeCriarDespesaDaExcecao({ ...ativa, finalidade: "aprovacao" }, AGORA)).toBe(false);
    expect(podeCriarDespesaDaExcecao({ ...ativa, finalidade: "criacao" }, AGORA)).toBe(true);
    expect(podeCriarDespesaDaExcecao(ativa, AGORA)).toBe(true);
  });
});
