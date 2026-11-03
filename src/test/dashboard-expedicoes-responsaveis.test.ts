import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261030000400_sis_2026_0753_expedicoes_responsaveis.sql",
  "utf8",
);
const migrationHistorica = readFileSync(
  "supabase/migrations/20261029000600_sis_2026_0753_historico_e_ia_operacional.sql",
  "utf8",
);
const frontend = readFileSync(
  "src/pages/suprimentos/DashboardComprasEstoque.tsx",
  "utf8",
);

describe("dashboard de Suprimentos — expedições e responsáveis", () => {
  it("conta a produção logística pela data efetiva do despacho", () => {
    expect(migration).toContain("pedidos_despachados AS");
    expect(migration).toContain("p.data_despachado AT TIME ZONE 'America/Sao_Paulo'");
    expect(migration).toContain("BETWEEN p_inicio AND p_fim");
    expect(migration).toContain("envio_tipo = 'CORREIO'");
    expect(migration).toContain("p.envio_tipo = 'SUPERVISOR'");
  });

  it("identifica o responsável sem confundir operador e supervisor", () => {
    expect(migration).toContain("p.retirado_por_nome");
    expect(migration).toContain("ph.alterado_por_nome");
    expect(migration).toContain("ph.status_novo = 'DESPACHADO'");
    expect(migration).toContain("'entregas_por_responsavel'");
  });

  it("expõe confirmação, rastreio e registros históricos sem modalidade", () => {
    expect(migration).toContain("public.sup_pedido_comprovacao");
    expect(migration).toContain("'confirmadas'");
    expect(migration).toContain("'sem_modalidade'");
    expect(migration).toContain("envio_rastreio AS rastreio");
  });

  it("explica o escopo mensal e apresenta a apuração auditável", () => {
    expect(migrationHistorica).toContain("date_trunc(''month'', p.data_solicitacao::timestamp)");
    expect(frontend).toContain("Pedidos de Materiais pela data real da solicitação");
    expect(frontend).toContain("Despachos por Responsável");
    expect(frontend).toContain("Expedições do Período");
    expect(frontend).toContain("Entregas comprovadas");
  });
});
