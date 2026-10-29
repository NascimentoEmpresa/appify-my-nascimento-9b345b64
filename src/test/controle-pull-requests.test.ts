import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILTRO_CONTROLE_PR_PADRAO, csvControlePr, filtroVazio, linhasAlteradas, parametrosRpc, totalPaginas,
  type FiltroControlePr, type PrControle,
} from "@/lib/sistemas/controlePullRequests";

// SIS-2026-0786 — Controle de Pull Requests. Filtro e paginação rodam no
// banco (mig 20261029005000, provada num PostgreSQL 18 descartável); aqui
// fica o que a tela monta e o laço do Exportar CSV.

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { rpc: (...a: any[]) => rpc(...a) },
}));

const pr = (x: Partial<PrControle>): PrControle => ({
  numero: 1, titulo: "x", url: null, autor_login: null, autor_avatar: null, desenvolvedor: "Fulano",
  chamado: null, chamado_id: null, chamado_assunto: null,
  commits: 1, adicoes: 10, remocoes: 2, arquivos: 1, mergeado_em: "2026-10-29T15:00:00Z", ...x,
});
const f = (x: Partial<FiltroControlePr>): FiltroControlePr => ({ ...FILTRO_CONTROLE_PR_PADRAO, ...x });

describe("parametrosRpc", () => {
  it("filtro padrão não filtra nada: tudo null e chamado 'todas'", () => {
    expect(parametrosRpc(FILTRO_CONTROLE_PR_PADRAO, 1)).toEqual({
      _busca: null, _desenvolvedor: null, _de: null, _ate: null, _chamado: "todas", _pagina: 1, _por_pagina: 20,
    });
  });

  it("as duas datas vão como o intervalo do merge, a busca vai sem espaço nas pontas", () => {
    expect(parametrosRpc(f({ busca: "  #1081 ", de: "2026-10-08", ate: "2026-10-29", chamado: "sem", desenvolvedor: "Ana" }), 3, 500))
      .toMatchObject({ _busca: "#1081", _de: "2026-10-08", _ate: "2026-10-29", _chamado: "sem", _desenvolvedor: "Ana", _pagina: 3, _por_pagina: 500 });
  });

  it("página inválida vira 1", () => {
    expect(parametrosRpc(FILTRO_CONTROLE_PR_PADRAO, 0)._pagina).toBe(1);
    expect(parametrosRpc(FILTRO_CONTROLE_PR_PADRAO, Number.NaN)._pagina).toBe(1);
  });
});

describe("apoio", () => {
  it("totalPaginas nunca é zero", () => {
    expect(totalPaginas(0, 20)).toBe(1);
    expect(totalPaginas(20, 20)).toBe(1);
    expect(totalPaginas(1083, 20)).toBe(55);
  });

  it("filtroVazio reconhece só o padrão", () => {
    expect(filtroVazio(FILTRO_CONTROLE_PR_PADRAO)).toBe(true);
    expect(filtroVazio(f({ busca: "   " }))).toBe(true);
    expect(filtroVazio(f({ ate: "2026-10-29" }))).toBe(false);
    expect(filtroVazio(f({ chamado: "com" }))).toBe(false);
  });

  it("linhas alteradas soma adições e remoções, tratando nulo como zero", () => {
    expect(linhasAlteradas(pr({ adicoes: 142, remocoes: 38 }))).toBe(180);
    expect(linhasAlteradas(pr({ adicoes: null, remocoes: 5 }))).toBe(5);
  });
});

describe("csvControlePr", () => {
  it("BOM, ponto e vírgula, aspas escapadas, 'Sem chamado' e hora de Brasília", () => {
    const csv = csvControlePr([pr({ numero: 7, titulo: 'Ajuste "urgente"', desenvolvedor: "Ana", mergeado_em: "2026-10-29T20:05:06Z" })]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [cab, linha] = csv.slice(1).split("\r\n");
    expect(cab.split(";")[0]).toBe('"Desenvolvedor"');
    expect(linha).toBe('"Ana";"#7";"Sem chamado";"Ajuste ""urgente""";"1";"10";"2";"1";"29/10/2026, 17:05"');
  });
});

describe("buscarTudoParaCsv", () => {
  // Dublê da RPC: `total` PRs, devolvendo a última página quando se pede além do fim.
  const banco = (total: number) => (_nome: string, p: { _pagina: number; _por_pagina: number }) => {
    const paginas = Math.max(1, Math.ceil(total / p._por_pagina));
    const pagina = Math.min(p._pagina, paginas);
    const ini = (pagina - 1) * p._por_pagina;
    const prs = Array.from({ length: Math.max(0, Math.min(p._por_pagina, total - ini)) }, (_, i) => pr({ numero: total - ini - i }));
    return Promise.resolve({ data: { total, pagina, por_pagina: p._por_pagina, desenvolvedores: [], prs }, error: null });
  };

  // Com chaves: função devolvida pelo beforeEach o Vitest roda como limpeza.
  beforeEach(() => { rpc.mockReset(); });

  it("junta todas as páginas de 500, sem repetir e sem chamada a mais", async () => {
    rpc.mockImplementation(banco(1083));
    const { buscarTudoParaCsv } = await import("@/hooks/useControlePullRequests");
    const prs = await buscarTudoParaCsv(f({ chamado: "com" }));
    expect(prs).toHaveLength(1083);
    expect(new Set(prs.map((p) => p.numero)).size).toBe(1083);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[0][1]).toMatchObject({ _chamado: "com", _pagina: 1, _por_pagina: 500 });
  });

  it("total múltiplo de 500: a página além do fim não duplica a última", async () => {
    rpc.mockImplementation(banco(1000));
    const { buscarTudoParaCsv } = await import("@/hooks/useControlePullRequests");
    const prs = await buscarTudoParaCsv(FILTRO_CONTROLE_PR_PADRAO);
    expect(prs).toHaveLength(1000);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("nenhuma PR: uma chamada e lista vazia", async () => {
    rpc.mockImplementation(banco(0));
    const { buscarTudoParaCsv } = await import("@/hooks/useControlePullRequests");
    expect(await buscarTudoParaCsv(FILTRO_CONTROLE_PR_PADRAO)).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("erro do banco sobe para a tela mostrar", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("Sem acesso ao Controle de Pull Requests.") });
    const { buscarTudoParaCsv } = await import("@/hooks/useControlePullRequests");
    await expect(buscarTudoParaCsv(FILTRO_CONTROLE_PR_PADRAO)).rejects.toThrow("Sem acesso");
  });
});
