import { describe, expect, it } from "vitest";
import {
  alertas, rotuloMes, serieAcidentes, serieAsos, tomContagem, tomPct, totalPendentesAso, variacao, type DadosSstPainelTv,
} from "@/lib/tv/sstPainelTv";
import { corDoRelatorioTv, paginasDoRelatorio } from "@/lib/tv/relatorioTv";
import { RELATORIOS_TV } from "@/lib/tv/tv";

// SIS-2026-0816 — TV do SST ('sst-painel'): tons, séries e o "onde agir".

const D: DadosSstPainelTv = {
  treinamentos: {
    nr: { total: 10, em_dia: 5, proximos: 1, vencidos: 2, pendentes: 2, contratos: 3, por_contrato: [] },
    online: { obrigatorios: 20, concluidos: 15, pendentes: 5, pessoas: 12, por_curso: [], por_contrato: [] },
    turmas: { realizadas_ano: 4, participantes_ano: 90, previstas_30d: 1, proxima: null, mensal: [] },
  },
  asos: {
    ano: { total: 50, por_tipo: { periodico: 30 } }, mes: 6, mes_anterior: 4,
    mensal: [{ mes: "2026-11", admissional: 1, periodico: 2, retorno: 0, troca_funcao: 1, demissional: 3 }],
    pendentes: { admissional: 2, demissional: 1, troca_funcao: 0, retorno: 0, periodico: 7 },
    periodicos: { realizados_ano: 30, vencidos: 5, proximos: 3, aguardando: 2, agendados: 1, em_dia: 100, afastados: 4, dias_aviso: 60 },
  },
  afastamentos: {
    ativos: 3, auxilio_doenca: 1, licenca_maternidade: 1, acidente_trabalho: 0, retornos_30d: 1, retorno_atrasado: 0,
    por_motivo: [], retornos_semanas: [],
    atestados: { mes: { qtd: 2, dias: 4 }, mes_anterior: { qtd: 1, dias: 5 }, ano: { qtd: 20, dias: 50 }, mensal: [] },
  },
  acidentes: {
    ano: { total: 3, tipicos: 2, trajeto: 1, nao_informado: 0, com_afastamento: 1, dias_afastamento: 4, com_cat: 1 },
    mes: 0, ano_anterior: 5, dias_sem_acidente: 12,
    mensal: [{ mes: "2026-01", tipicos: 1, trajeto: 1, nao_informado: 0, acumulado: 2 }],
  },
};

describe("TV do SST", () => {
  it("rótulo do mês", () => {
    expect(rotuloMes("2026-11")).toBe("nov/26");
    expect(rotuloMes("2027-01")).toBe("jan/27");
  });

  it("tons: zero é bom, % alto é bom", () => {
    expect(tomContagem(0)).toBe("bom");
    expect(tomContagem(3, 5)).toBe("atencao");
    expect(tomContagem(6, 5)).toBe("critico");
    expect(tomPct(null)).toBe("neutro");
    expect(tomPct(95)).toBe("bom");
    expect(tomPct(75)).toBe("atencao");
    expect(tomPct(40)).toBe("critico");
  });

  it("variação contra o período anterior", () => {
    expect(variacao(6, 4)).toBe(50);
    expect(variacao(3, 0)).toBeNull();
  });

  it("séries com o total da pilha e o acumulado", () => {
    expect(serieAsos(D.asos.mensal)[0]).toMatchObject({ rotulo: "nov/26", __total: 7 });
    expect(serieAcidentes(D.acidentes.mensal)[0]).toMatchObject({ __total: 2, acumulado: 2 });
  });

  it("pendências de ASO e onde agir (só o que tem número)", () => {
    expect(totalPendentesAso(D.asos.pendentes)).toBe(10);
    const a = alertas(D);
    expect(a.treinamentos.map((x) => x.valor)).toEqual([2, 2, 1, 5]);
    expect(a.afastamentos).toEqual([{ texto: "Retornos nos próximos 30 dias", valor: 1 }]);
    expect(a.acidentes).toEqual([{ texto: "Com afastamento no ano", valor: 1 }]);
  });

  it("relatório registrado no catálogo das TVs, com uma página e a cor do SST", () => {
    expect(RELATORIOS_TV.some((r) => r.slug === "sst-painel")).toBe(true);
    expect(corDoRelatorioTv("sst-painel")).toBe("#047857");
    expect(paginasDoRelatorio({ tipo: "sst-painel", contrato: null, ...D })).toHaveLength(1);
  });
});
