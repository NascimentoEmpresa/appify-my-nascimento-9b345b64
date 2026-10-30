import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261030000200_sis_2026_0753_separa_cotacoes_por_origem.sql",
  "utf8",
);
const frontend = readFileSync(
  "src/pages/suprimentos/DashboardComprasEstoque.tsx",
  "utf8",
);

describe("dashboard de Suprimentos — cotações separadas por origem", () => {
  it("expõe uma série exclusiva para os envios do Malote", () => {
    expect(migration).toContain("'cotacoes_malote_por_comprador'");
    expect(migration).toContain("btrim(cotacao_enviada_por_nome)");
    expect(migration).toContain("FROM cotacoes_malote");
  });

  it("expõe outra série exclusiva para as respostas de Licitações", () => {
    expect(migration).toContain("'cotacoes_licitacao_por_comprador'");
    expect(migration).toContain("btrim(respondente_nome)");
    expect(migration).toContain("FROM cotacoes_licitacao");
  });

  it("junta variações de maiúsculas e espaços do mesmo nome", () => {
    expect(migration).toContain("regexp_replace(lower(btrim(cotacao_enviada_por_nome))");
    expect(migration).toContain("regexp_replace(lower(btrim(respondente_nome))");
    expect(migration).toContain("initcap(n.nome_normalizado)");
  });

  it("renderiza dois gráficos com origem e significado explícitos", () => {
    expect(frontend).toContain("Envios de Cotação do Malote por Pessoa");
    expect(frontend).toContain("Cotações de Licitações por Pessoa");
    expect(frontend).toContain("as três propostas internas continuam sendo um único processo");
    expect(frontend).not.toContain('titulo="Cotações por Comprador"');
  });
});
