import { describe, expect, it } from "vitest";
import {
  PAINEIS_GERENCIAIS, desvio, detalhesDaPagina, formatarValor, frase, indicadoresDaTv, lancamentoAtrasado, ordenarParaTv, paginasGerencial,
  placar, situacao, subindicadores, textoMeta, type IndicadorGerencial, type PainelGerencial,
} from "@/lib/tv/gerencial";
import { RELATORIOS_TV, relatorioTemFiltros } from "@/lib/tv/tv";
import { corDoRelatorioTv, paginasDoRelatorio } from "@/lib/tv/relatorioTv";

// TVs gerenciais por diretoria (mig 20261012000001, SIS-2026-0635): as regras
// da Parte IV do documento "Indicadores das TVs".

let seq = 0;
const ind = (p: Partial<IndicadorGerencial> & { valor?: number | null; impacto?: number | null; detalhe?: { nome: string; valor: number }[] }): IndicadorGerencial => ({
  codigo: p.codigo ?? `i${++seq}`, nome: p.nome ?? "Indicador", identificar: "", regra: null, fonte: p.fonte ?? "auto",
  unidade: p.unidade ?? "qtd", sentido: p.sentido ?? "menor", meta: p.meta === undefined ? 0 : p.meta, alerta: p.alerta === undefined ? 5 : p.alerta,
  periodicidade: p.periodicidade ?? "diaria", responsavel: p.responsavel ?? null, pai: p.pai ?? null, na_tv: p.na_tv ?? true, ordem: p.ordem ?? 1,
  parametro: null, parametro_rotulo: null, espelho_de: null,
  resultado: { valor: p.valor === undefined ? 0 : p.valor, impacto: p.impacto ?? null, detalhe: p.detalhe ?? [], afetado: null, causa: null, atualizado_em: p.resultado?.atualizado_em },
});

describe("as 13 TVs do documento", () => {
  it("estão todas no seletor de relatórios, sem período nem contrato", () => {
    expect(PAINEIS_GERENCIAIS).toHaveLength(13);
    const slugs = RELATORIOS_TV.map((r) => r.slug);
    for (const p of PAINEIS_GERENCIAIS) {
      expect(slugs).toContain(p.slug);
      expect(relatorioTemFiltros(p.slug)).toBe(false);
      expect(corDoRelatorioTv(p.slug)).toBe(p.cor);
    }
    expect(new Set(PAINEIS_GERENCIAIS.map((p) => p.diretoria))).toEqual(new Set(["Diretor Operacional", "Diretora Administrativa", "Áreas Transversais", "Presidência"]));
  });
});

describe("semáforo", () => {
  it("quanto menor, melhor: meta, atenção e vermelho", () => {
    expect(situacao(ind({ valor: 0 }))).toBe("verde");
    expect(situacao(ind({ valor: 3 }))).toBe("amarelo");
    expect(situacao(ind({ valor: 5 }))).toBe("amarelo");
    expect(situacao(ind({ valor: 6 }))).toBe("vermelho");
    expect(situacao(ind({ valor: 1, alerta: null }))).toBe("vermelho");
  });
  it("quanto maior, melhor (ex.: admissões previstas x concluídas)", () => {
    const base = { sentido: "maior" as const, meta: 100, alerta: 85 };
    expect(situacao(ind({ ...base, valor: 100 }))).toBe("verde");
    expect(situacao(ind({ ...base, valor: 90 }))).toBe("amarelo");
    expect(situacao(ind({ ...base, valor: 76 }))).toBe("vermelho");
  });
  it("sem meta = acompanhamento; sem valor = sem dado; o banco manda numérico como texto", () => {
    expect(situacao(ind({ meta: null, valor: 999 }))).toBe("neutro");
    expect(situacao(ind({ valor: null }))).toBe("sem_dado");
    expect(situacao({ meta: "0", alerta: "5", sentido: "menor", resultado: { valor: "138" } })).toBe("vermelho");
  });
});

describe("ordem da TV: fora da meta primeiro, pelo impacto absoluto", () => {
  it("vermelho antes de amarelo, sem dado e verde", () => {
    const verde = ind({ codigo: "verde", valor: 0, ordem: 1 });
    const amarelo = ind({ codigo: "amarelo", valor: 4, ordem: 2 });
    const vermelho = ind({ codigo: "vermelho", valor: 50, ordem: 3 });
    const semDado = ind({ codigo: "sem", valor: null, ordem: 4 });
    expect(ordenarParaTv([verde, semDado, amarelo, vermelho]).map((i) => i.codigo)).toEqual(["vermelho", "amarelo", "sem", "verde"]);
  });
  it("entre os vermelhos, o de maior R$ em jogo vem antes — não o maior percentual", () => {
    const pctAlto = ind({ codigo: "pct", unidade: "pct", valor: 40, meta: 3, alerta: 5 });
    const muitoDinheiro = ind({ codigo: "rs", unidade: "brl", valor: 80000, meta: 0, alerta: 5000, impacto: 80000 });
    expect(ordenarParaTv([pctAlto, muitoDinheiro]).map((i) => i.codigo)).toEqual(["rs", "pct"]);
  });
  it("sem impacto, pelo desvio da meta", () => {
    expect(desvio(ind({ valor: 12 }))).toBe(12);
    expect(desvio(ind({ sentido: "maior", meta: 100, valor: 70 }))).toBe(30);
    expect(desvio(ind({ meta: null, valor: 70 }))).toBe(0);
    const a = ind({ codigo: "a", valor: 7 }), b = ind({ codigo: "b", valor: 30 });
    expect(ordenarParaTv([a, b])[0].codigo).toBe("b");
  });
});

describe("formato do documento", () => {
  it("valores curtos para a TV", () => {
    expect(formatarValor(80000, "brl")).toBe("R$ 80 mil");
    expect(formatarValor(1_049_403, "brl")).toBe("R$ 1 mi");
    expect(formatarValor(3.24, "pct")).toBe("3,2%");
    expect(formatarValor(138, "qtd")).toBe("138");
    expect(formatarValor(null, "qtd")).toBe("—");
    expect(textoMeta({ meta: 0, sentido: "menor", unidade: "qtd" })).toBe("Meta ≤ 0");
    expect(textoMeta({ meta: 100, sentido: "maior", unidade: "pct" })).toBe("Meta ≥ 100%");
    expect(textoMeta({ meta: null, sentido: "menor", unidade: "qtd" })).toMatch(/Sem meta/);
  });
  it("a frase no formato adequado: resultado — afetado — maior causa — responsável", () => {
    const i = ind({ nome: "Glosas", unidade: "brl", valor: 80000, responsavel: "Operação" });
    i.resultado.afetado = "3 contratos"; i.resultado.causa = "posto descoberto";
    expect(frase(i)).toBe("Glosas: R$ 80 mil — 3 contratos — maior causa: posto descoberto — responsável: Operação");
  });
});

describe("páginas da TV e subindicadores", () => {
  const painel = (indicadores: IndicadorGerencial[]): PainelGerencial => ({ painel: { slug: "ger-rh", titulo: "RH", diretoria: "Diretora Administrativa", pergunta: "?" }, indicadores });

  it("subindicadores não ocupam a TV; abrem pelo consolidado", () => {
    const p = painel([ind({ codigo: "rh_obrigacoes" }), ind({ codigo: "rh_ob_folhas", pai: "rh_obrigacoes", na_tv: false }), ind({ codigo: "op_feedbacks", na_tv: false })]);
    expect(indicadoresDaTv(p).map((i) => i.codigo)).toEqual(["rh_obrigacoes"]);
    expect(subindicadores(p, "rh_obrigacoes").map((i) => i.codigo)).toEqual(["rh_ob_folhas"]);
    expect(subindicadores(p, null).map((i) => i.codigo)).toEqual(["op_feedbacks"]);
  });
  it("'Onde agir' só existe para os fora da meta com detalhamento, 2 por página", () => {
    const tudoBem = painel([ind({ valor: 0, detalhe: [{ nome: "X", valor: 1 }] })]);
    expect(paginasGerencial(tudoBem).map((p) => p.chave)).toEqual(["ger-resumo"]);

    const ruins = [1, 2, 3].map((k) => ind({ codigo: `r${k}`, valor: 10 * k, detalhe: [{ nome: "Contrato", valor: k }] }));
    const p = painel([...ruins, ind({ codigo: "semdet", valor: 99 })]);
    expect(paginasGerencial(p).map((x) => x.chave)).toEqual(["ger-resumo", "ger-detalhe-1", "ger-detalhe-2"]);
    expect(detalhesDaPagina(p, "ger-detalhe-1").map((i) => i.codigo)).toEqual(["r3", "r2"]);
    expect(detalhesDaPagina(p, "ger-detalhe-2").map((i) => i.codigo)).toEqual(["r1"]);
    expect(paginasDoRelatorio({ tipo: "gerencial", contrato: null, ...p })).toHaveLength(3);
  });
  it("placar por situação", () => {
    const pl = placar([ind({ valor: 0 }), ind({ valor: 9 }), ind({ valor: 9 }), ind({ valor: null })]);
    expect(pl).toMatchObject({ verde: 1, vermelho: 2, sem_dado: 1 });
  });
});

describe("lançamento em atraso (a mesma tolerância do ctl_nao_atualizados)", () => {
  const agora = new Date("2026-10-12T12:00:00");
  const manual = (periodicidade: "diaria" | "semanal" | "mensal", atualizado: string | null) =>
    ({ fonte: "manual" as const, periodicidade, resultado: { atualizado_em: atualizado } });
  it("nunca lançado, diário de 3 dias, semanal de 9, mensal de 36 = atraso", () => {
    expect(lancamentoAtrasado(manual("diaria", null), agora)).toBe(true);
    expect(lancamentoAtrasado(manual("diaria", "2026-10-09T12:00:00"), agora)).toBe(true);
    expect(lancamentoAtrasado(manual("diaria", "2026-10-11T12:00:00"), agora)).toBe(false);
    expect(lancamentoAtrasado(manual("semanal", "2026-10-03T12:00:00"), agora)).toBe(true);
    expect(lancamentoAtrasado(manual("mensal", "2026-09-20T12:00:00"), agora)).toBe(false);
    expect(lancamentoAtrasado({ fonte: "auto", periodicidade: "diaria", resultado: { atualizado_em: null } }, agora)).toBe(false);
  });
});
