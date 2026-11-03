import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { derivarStatusVisivel, type StatusComprovacao } from "@/hooks/useSupPedidos";

const migration = readFileSync(
  "supabase/migrations/20261029004800_sis_2026_0753_ia_saldo_operacional_exato.sql",
  "utf8",
);

describe("dashboard de Suprimentos — status iguais a Pedidos de Materiais", () => {
  it("reconcilia o exemplo da tela sem contar parcial como despacho concluído", () => {
    const grupos = [
      { status: "DESPACHADO", comprovacao: "PENDENTE", itens: 10, atendidos: 10, quantidade: 587 },
      { status: "DESPACHADO", comprovacao: "ENVIADO", itens: 10, atendidos: 10, quantidade: 1917 },
      { status: "DESPACHADO", comprovacao: "PENDENTE", itens: 10, atendidos: 9, quantidade: 104 },
      { status: "AGUARDANDO COMPRA", comprovacao: null, itens: 10, atendidos: 0, quantidade: 445 },
      { status: "CANCELADO", comprovacao: null, itens: 10, atendidos: 0, quantidade: 40 },
    ];

    const classificados = grupos.map((grupo) => ({
      ...grupo,
      visivel: derivarStatusVisivel(
        grupo.status,
        grupo.comprovacao as StatusComprovacao,
        { itens: grupo.itens, itens_atendidos: grupo.atendidos },
      ),
    }));
    const despachadas = classificados
      .filter((grupo) => ["DESPACHADO_AGUARDANDO", "DESPACHADO_ENTREGUE"].includes(grupo.visivel))
      .reduce((total, grupo) => total + grupo.quantidade, 0);
    const pendentes = classificados
      .filter((grupo) => !["DESPACHADO_AGUARDANDO", "DESPACHADO_ENTREGUE", "CANCELADO"].includes(grupo.visivel))
      .reduce((total, grupo) => total + grupo.quantidade, 0);

    expect(despachadas).toBe(2504); // 587 aguardando confirmação + 1.917 entregues
    expect(pendentes).toBe(549); // 445 abertos + 104 parcialmente despachados
    expect(despachadas + pendentes + 40).toBe(3093);
  });

  it("deriva parcial, aguardando confirmação e entregue pelas fontes operacionais", () => {
    expect(migration).toContain("LEFT JOIN public.sup_pedido_situacao situacao");
    expect(migration).toContain("LEFT JOIN public.sup_pedido_comprovacao comprovacao");
    expect(migration).toContain("THEN 'PARCIALMENTE DESPACHADO'");
    expect(migration).toContain("THEN 'DESPACHADO_AGUARDANDO'");
    expect(migration).toContain("THEN 'DESPACHADO_ENTREGUE'");
  });

  it("não conta parcialmente despachado como despacho concluído", () => {
    expect(migration).toContain(
      "status_visivel IN ('DESPACHADO_AGUARDANDO', 'DESPACHADO_ENTREGUE')",
    );
    expect(migration).toContain(
      "status_visivel NOT IN ('DESPACHADO_AGUARDANDO', 'DESPACHADO_ENTREGUE', 'CANCELADO')",
    );
    expect(migration).toContain("FROM pedidos_classificados p");
  });

  it("interrompe a publicação se a definição instalada não tiver as âncoras esperadas", () => {
    expect(migration).toContain("Âncora dos cartões Pendentes/Despachadas");
    expect(migration).toContain("Âncora dos status por contrato");
    expect(migration).toContain("Âncora dos motivos de pendência");
    expect(migration).toContain("EXECUTE v_definicao");
  });
});
