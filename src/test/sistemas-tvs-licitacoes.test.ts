import { describe, expect, it } from "vitest";
import {
  MAPA_UF, chaveCidade, diasAteAbertura, estatisticasLicitacao, nomeDeCidade, paraItensLicitacao, reaisAbreviado, reaisCurto, urgenciaAbertura, valorDaGrade,
  type LinhaLicitacaoTv,
} from "@/lib/tv/licitacaoTv";
import { RELATORIOS_TV, nomeRelatorioTv, relatorioTemFiltros } from "@/lib/tv/tv";
import { corDoRelatorioTv, paginasDoRelatorio } from "@/lib/tv/relatorioTv";
import type { Dashboard } from "@/pages/treinamentos/plataforma/tipos";

// TV — Licitações e Treinamentos (08/10/2026, mig 20261008000007).
// As contas de Licitações têm que bater com as do Painel Executivo
// (usePainelLicitacao) — o número da TV é o da tela.

const HOJE = new Date(2026, 9, 8, 10); // 08/10/2026

const linha = (p: Partial<{
  id: string; edital: string; fase: string; resp: string | null; cidade: string | null; uf: string | null; data: string | null;
  pessoas: number | null; valor: string | null; posicao: number | null; criado: string; alterado: string | null; empresa: string | null;
}>): LinhaLicitacaoTv => [
  p.id ?? Math.random().toString(36).slice(2), p.edital ?? "PE 1/2026", p.fase ?? "Em Andamento", p.resp ?? null, p.cidade ?? null, p.uf ?? null,
  p.data ?? null, "Limpeza", p.pessoas ?? null, p.valor ?? null, p.posicao ?? null, p.criado ?? "2026-10-01T12:00:00Z", p.alterado ?? null, p.empresa ?? "HAGG",
];

describe("TV de Licitações — as contas do Painel Executivo", () => {
  it("lê o valor da grade em texto BR (com e sem R$, com e sem vírgula)", () => {
    expect(valorDaGrade("R$ 1.750.267,32")).toBeCloseTo(1750267.32);
    expect(valorDaGrade("1750267.32")).toBeCloseTo(1750267.32);
    expect(valorDaGrade("")).toBe(0);
    expect(valorDaGrade(null)).toBe(0);
    expect(valorDaGrade("a combinar")).toBe(0);
  });

  it("pipeline sem Não Participado/Suspenso/Revogado; vitória = Finalizada em 1º lugar", () => {
    const s = estatisticasLicitacao(paraItensLicitacao([
      linha({ fase: "Em Andamento", valor: "R$ 1.000.000,00" }),
      linha({ fase: "Finalizada", posicao: 1, valor: "R$ 2.000.000,00", pessoas: 40 }),
      linha({ fase: "Finalizada", posicao: 3, valor: "R$ 500.000,00" }),
      linha({ fase: "Finalizada", posicao: null, valor: "R$ 100.000,00" }),
      linha({ fase: "Não Participado", valor: "R$ 9.000.000,00" }),
      linha({ fase: "Suspenso", valor: "R$ 9.000.000,00" }),
      linha({ fase: "Revogado", valor: "R$ 9.000.000,00" }),
    ]), HOJE);
    expect(s.total).toBe(7);
    expect(s.ativas).toBe(1);
    expect(s.finalizadas).toBe(3);
    expect(s.ganhas).toBe(1);
    expect(s.perdidas).toBe(2); // sem posição conta como perdida, como no Painel
    expect(s.taxaVitoria).toBeCloseTo(100 / 3);
    expect(s.valorPipeline).toBe(3_600_000);
    expect(s.valorGanho).toBe(2_000_000);
    expect(s.pessoasGanhas).toBe(40);
    expect(s.naoParticipados).toBe(1);
    // Funil: Finalizada se divide em ganho/perdido; não participados ficam fora.
    expect(Object.fromEntries(s.porFase.map((f) => [f.nome, f.n]))).toEqual({ "Em Andamento": 1, "Finalizada (Ganho)": 1, "Finalizada (Perdido)": 2 });
    expect(s.porFase.find((f) => f.nome === "Finalizada (Ganho)")?.cor).toBe("#22c55e");
  });

  it("responsável: junta caixa/acento diferentes e ordena por valor (máx. 8)", () => {
    const s = estatisticasLicitacao(paraItensLicitacao([
      linha({ resp: "Amália Maia", valor: "100,00" }),
      linha({ resp: "AMALIA MAIA ", valor: "50,00", fase: "Finalizada", posicao: 1 }),
      linha({ resp: "Bruno", valor: "1.000,00" }),
      linha({ resp: null, valor: "10,00" }),
      ...Array.from({ length: 9 }, (_, k) => linha({ resp: `Outro ${k}`, valor: "1,00" })),
    ]), HOJE);
    expect(s.porResponsavel).toHaveLength(8);
    expect(s.porResponsavel[0].nome).toBe("BRUNO");
    const amalia = s.porResponsavel.find((r) => r.nome.startsWith("AM"));
    expect(amalia).toMatchObject({ qtd: 2, valor: 150, vitorias: 1, perdidas: 0, taxa: 100 });
  });

  it("evolução: 6 meses pela data de cadastro, terminando no mês atual", () => {
    const s = estatisticasLicitacao(paraItensLicitacao([
      linha({ criado: "2026-10-02T12:00:00Z", valor: "1.000,00" }),
      linha({ criado: "2026-10-05T12:00:00Z", valor: "500,00" }),
      linha({ criado: "2026-05-15T12:00:00Z" }),
      linha({ criado: "2026-04-15T12:00:00Z" }), // 7º mês para trás: fora
    ]), HOJE);
    expect(s.evolucao.map((m) => m.rotulo)).toEqual(["Mai", "Jun", "Jul", "Ago", "Set", "Out"]);
    expect(s.evolucao[5]).toEqual({ rotulo: "Out", processos: 2, valor: 1500 });
    expect(s.evolucao[0].processos).toBe(1);
  });

  it("aberturas: só fases ativas, de hoje em diante; o cartão conta só até 7 dias", () => {
    const s = estatisticasLicitacao(paraItensLicitacao([
      linha({ id: "a", fase: "À Iniciar", data: "2026-10-08" }),
      linha({ id: "b", fase: "Iniciado", data: "2026-10-15" }),
      linha({ id: "c", fase: "Em Andamento", data: "2026-10-20" }),
      linha({ id: "d", fase: "Em Andamento", data: "2026-10-07" }), // já passou
      linha({ id: "e", fase: "Finalizada", posicao: 1, data: "2026-10-09" }), // não é ativa
    ]), HOJE);
    expect(s.proximasAberturas.map((a) => [a.item.id, a.dias])).toEqual([["a", 0], ["b", 7], ["c", 12]]);
    expect(s.aberturas7d).toBe(2);
    expect(diasAteAbertura("2026-10-11", HOJE)).toBe(3);
    expect(urgenciaAbertura(3)).toBe("critica");
    expect(urgenciaAbertura(7)).toBe("proxima");
    expect(urgenciaAbertura(8)).toBe("normal");
    expect(urgenciaAbertura(null)).toBeNull();
  });

  it("onde estamos: conta por UF e por cidade (cidade com caixa diferente é a mesma)", () => {
    const s = estatisticasLicitacao(paraItensLicitacao([
      linha({ cidade: "Porto Alegre", uf: "rs" }),
      linha({ cidade: "PORTO ALEGRE", uf: "RS" }),
      linha({ cidade: "Curitiba", uf: "PR" }),
      linha({ cidade: null, uf: null }),
    ]), HOJE);
    expect(s.porUF.get("RS")).toBe(2);
    expect(s.porUF.get("PR")).toBe(1);
    expect(s.topCidades[0]).toMatchObject({ cidade: "Porto Alegre", uf: "RS", n: 2 });
  });

  it("UF que falta: a da mesma cidade em outro processo; senão, a do IBGE; senão, sem estado", () => {
    const municipios = [
      { nome: "Glorinha", uf: "RS" },
      { nome: "Palmeira", uf: "PR" }, { nome: "Palmeira", uf: "SC" },
      { nome: "Bonito", uf: "MS" }, { nome: "Bonito", uf: "PA" },
      { nome: "Porto Alegre", uf: "RS" },
    ];
    const s = estatisticasLicitacao(paraItensLicitacao([
      linha({ cidade: "Porto Alegre", uf: "RS" }),
      linha({ cidade: "PORTO ALEGRE", uf: null }), // a grade já sabe: RS
      linha({ cidade: "GLORINHA", uf: null }), // só no IBGE, uma UF só
      linha({ cidade: "Curitiba", uf: "PR" }),
      linha({ cidade: "Palmeira", uf: "SC" }),
      linha({ cidade: "Chapecó", uf: "SC" }),
      linha({ cidade: "PALMEIRA", uf: null }), // a grade já sabe: SC
      linha({ cidade: "BONITO", uf: null }), // duas UFs no IBGE, nenhuma com processo: sem estado
      linha({ cidade: "FUNEAS CURITIBA", uf: null }), // não é município: sem estado
    ]), HOJE, municipios);
    expect(s.porUF.get("RS")).toBe(3);
    expect(s.porUF.get("SC")).toBe(3);
    expect(s.porUF.get("PR")).toBe(1);
    expect(s.semUF).toBe(2);
    // Mesma cidade com grafias diferentes vira uma só, com o nome oficial.
    expect(s.topCidades[0]).toMatchObject({ cidade: "Porto Alegre", uf: "RS", n: 2 });
    expect(s.topCidades.find((c) => c.uf === "RS" && c.n === 1)?.cidade).toBe("Glorinha");
  });

  it("nome de cidade: caixa alta vira nome próprio; acento e partículas", () => {
    expect(nomeDeCidade("SÃO JOSÉ DO NORTE")).toBe("São José do Norte");
    expect(nomeDeCidade("  Florianópolis ")).toBe("Florianópolis");
    expect(chaveCidade("São José do Norte")).toBe(chaveCidade("SAO JOSE DO NORTE"));
    // Sem a lista do IBGE, a grafia "melhor" (com acento) ganha.
    const s = estatisticasLicitacao(paraItensLicitacao([
      linha({ cidade: "FLORIANOPOLIS", uf: "SC" }), linha({ cidade: "FLORIANÓPOLIS", uf: "SC" }),
    ]), HOJE);
    expect(s.topCidades[0]).toMatchObject({ cidade: "Florianópolis", n: 2 });
  });

  it("últimos resultados: os finalizados mais recentes, ganho ou perdido", () => {
    const s = estatisticasLicitacao(paraItensLicitacao([
      linha({ id: "velho", fase: "Finalizada", posicao: 1, alterado: "2026-09-01T00:00:00Z" }),
      linha({ id: "novo", fase: "Finalizada", posicao: 2, alterado: "2026-10-07T00:00:00Z" }),
    ]), HOJE);
    expect(s.ultimosResultados.map((r) => [r.item.id, r.ganhou])).toEqual([["novo", false], ["velho", true]]);
  });

  it("R$ curto trunca (não arredonda), como o Painel", () => {
    expect(reaisCurto(39_990_944_339)).toEqual({ valor: "R$ 39,9", unidade: "bilhões" });
    expect(reaisCurto(12_349_000)).toEqual({ valor: "R$ 12,3", unidade: "milhões" });
    expect(reaisCurto(850_900)).toEqual({ valor: "R$ 850", unidade: "mil" });
    expect(reaisAbreviado(12_349_000)).toBe("R$ 12,3 mi");
    expect(reaisAbreviado(1_200_000_000)).toBe("R$ 1,2 bi");
    expect(reaisAbreviado(0)).toBeNull();
  });

  it("o mapa em quadradinhos tem as 27 UFs, sem duas no mesmo lugar", () => {
    expect(new Set(MAPA_UF.map((m) => m.uf)).size).toBe(27);
    expect(new Set(MAPA_UF.map((m) => `${m.col},${m.lin}`)).size).toBe(27);
  });
});

describe("TV — Licitações e Treinamentos no catálogo", () => {
  it("estão no catálogo, sem período nem contrato", () => {
    const slugs = RELATORIOS_TV.map((r) => r.slug);
    expect(slugs).toContain("licitacoes");
    expect(slugs).toContain("treinamentos");
    expect(relatorioTemFiltros("licitacoes")).toBe(false);
    expect(relatorioTemFiltros("treinamentos")).toBe(false);
    expect(relatorioTemFiltros("demissoes")).toBe(true);
    expect(nomeRelatorioTv("treinamentos", "12m")).toBe("Treinamentos — Dashboard");
    expect(nomeRelatorioTv("demissoes", "mes")).toBe("Demissões · Este mês");
    expect(corDoRelatorioTv("treinamentos")).toBe("#f26522");
  });

  it("páginas de Licitações: mapa só com UF; sem processo, só o resumo", () => {
    expect(paginasDoRelatorio({ tipo: "licitacoes", contrato: null, itens: [] }).map((p) => p.chave)).toEqual(["lic-resumo"]);
    expect(paginasDoRelatorio({ tipo: "licitacoes", contrato: null, itens: [linha({ uf: null })] }).map((p) => p.chave))
      .toEqual(["lic-resumo", "lic-responsaveis", "lic-aberturas"]);
    expect(paginasDoRelatorio({ tipo: "licitacoes", contrato: null, itens: [linha({ uf: "RS" })] })).toHaveLength(4);
  });

  it("páginas de Treinamentos: cursos e contratos só se houver", () => {
    const vazio = { por_curso: [], por_contrato: [] } as unknown as Dashboard;
    expect(paginasDoRelatorio({ tipo: "treinamentos", contrato: null, painel: vazio })).toHaveLength(2);
    const comCurso = { por_curso: [{ id: "x" }], por_contrato: [] } as unknown as Dashboard;
    expect(paginasDoRelatorio({ tipo: "treinamentos", contrato: null, painel: comCurso })).toHaveLength(3);
  });
});
