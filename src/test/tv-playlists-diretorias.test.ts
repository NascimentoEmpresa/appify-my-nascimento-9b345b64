import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { painelGerencial } from "@/lib/tv/gerencial";

// Playlists TV Diretoria ADM e TV Diretor Operacional (mig 20261119110000):
// no modelo da Presidência, cada uma inclui só as playlists dos setores da
// sua diretoria. O teste lê a lista direto da migration — se alguém mexer
// nela, a separação por diretoria continua conferida aqui.

const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261119110000_tv_playlists_diretoria_adm_e_operacional.sql"), "utf8");
const incluidas = (nome: string): string[] => {
  const m = sql.match(new RegExp(`\\('${nome}',[\\s\\S]*?ARRAY\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`playlist ${nome} não achada na migration`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

describe("TVs — playlists por diretoria", () => {
  const adm = incluidas("TV Diretoria ADM");
  const ope = incluidas("TV Diretor Operacional");

  it("Diretoria ADM: RH + Recrutamento, SST, Financeiro e Jurídico, nessa ordem", () => {
    expect(adm).toEqual(["Recrutamento e Seleção", "TV SST", "Financeiro — Controle de Faturamento", "TV JURÍDICO"]);
  });

  it("Diretor Operacional: Operacional, Compras e Licitação, nessa ordem", () => {
    expect(ope).toEqual(["Operacional — Indicadores por Contrato", "Compras — Suprimentos", "TV LICITAÇÃO"]);
  });

  it("nenhum setor nas duas, e nada de visão de todos os setores ou playlist antiga sem TV", () => {
    expect(adm.filter((n) => ope.includes(n))).toEqual([]);
    for (const n of [...adm, ...ope]) {
      expect(["TV DIRETORIA", "Presidência — Todos os setores", "TV RH", "TV FINANCEIRO", "TV OPERACIONAL", "TV COMPRAS"]).not.toContain(n);
    }
  });

  it("os painéis gerenciais desses setores são mesmo da diretoria de cada playlist", () => {
    for (const s of ["ger-rh", "ger-recrutamento", "ger-sst", "ger-financeiro", "ger-juridico"]) {
      expect(painelGerencial(s)?.diretoria).toBe("Diretora Administrativa");
    }
    for (const s of ["ger-operacional", "ger-supply", "ger-licitacoes"]) {
      expect(painelGerencial(s)?.diretoria).toBe("Diretor Operacional");
    }
  });

  it("termina com NOTIFY e não cria FK de TV_ITEM para TV_PLAYLIST (PGRST201)", () => {
    expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
    expect(sql).not.toMatch(/^\s*[^-\s].*REFERENCES/m);
  });
});
