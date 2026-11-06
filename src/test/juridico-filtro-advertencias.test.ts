import { describe, it, expect } from "vitest";
import {
  FILTROS_VAZIOS, filtrarAdvertencias, passaNosFiltros, mesDaData, mesDaLinha, rotuloMes,
  chipsDosFiltros, removerChip, semCampo, temFiltro, type FiltrosAdv, type LinhaAdvFiltro,
} from "@/lib/juridico/filtroAdvertencias";

const l = (x: Partial<LinhaAdvFiltro>): LinhaAdvFiltro => ({
  data_ocorrido: "2026-11-04", created_at: "2026-11-06T12:54:00", tipo_advertencia: "Escrita", grau: "Médio",
  contrato: "1049 - TJRS - 023/2025", solicitante_nome: "LIZIA", colaborador_cargo: "SERVENTE DE LIMPEZA", excecao: false, ...x,
});
const f = (x: Partial<FiltrosAdv>): FiltrosAdv => ({ ...FILTROS_VAZIOS, ...x });

describe("mês da advertência", () => {
  it("date, DD/MM/AAAA e timestamp", () => {
    expect(mesDaData("2026-07-28")).toBe("2026-07");
    expect(mesDaData("28/07/2026")).toBe("2026-07");
    expect(mesDaData("2026-11-05T14:38:00")).toBe("2026-11");
    expect(mesDaData("")).toBe("");
    expect(mesDaData(null)).toBe("");
  });
  it("base Ocorrido x Solicitada", () => {
    const a = l({ data_ocorrido: "2026-07-28", created_at: "2026-11-05T14:38:00" });
    expect(mesDaLinha(a, "ocorrido")).toBe("2026-07");
    expect(mesDaLinha(a, "solicitada")).toBe("2026-11");
  });
  it("rótulo", () => {
    expect(rotuloMes("2026-11")).toBe("nov/2026");
    expect(rotuloMes("2026-01")).toBe("jan/2026");
  });
});

describe("passaNosFiltros", () => {
  const exc = l({ data_ocorrido: "2026-07-28", created_at: "2026-11-05T14:38:00", excecao: true, solicitante_nome: "ROSANE", contrato: "1050 - UFRGS" });
  const verbal = l({ tipo_advertencia: "Verbal", grau: "Baixo" });
  const base = l({});
  const todas = [base, exc, verbal];

  it("vazio deixa tudo", () => {
    expect(filtrarAdvertencias(todas, FILTROS_VAZIOS)).toEqual(todas);
    expect(temFiltro(FILTROS_VAZIOS)).toBe(false);
  });
  it("mês respeita a base escolhida", () => {
    expect(filtrarAdvertencias(todas, f({ meses: ["2026-11"] }))).toEqual([base, verbal]);
    expect(filtrarAdvertencias(todas, f({ meses: ["2026-11"], baseMes: "solicitada" }))).toEqual(todas);
    expect(filtrarAdvertencias(todas, f({ meses: ["2026-07"] }))).toEqual([exc]);
  });
  it("tipo, grau, contrato, solicitante, função", () => {
    expect(filtrarAdvertencias(todas, f({ tipos: ["Verbal"] }))).toEqual([verbal]);
    expect(filtrarAdvertencias(todas, f({ graus: ["Médio"] }))).toEqual([base, exc]);
    expect(filtrarAdvertencias(todas, f({ contratos: ["1050 - UFRGS"] }))).toEqual([exc]);
    expect(filtrarAdvertencias(todas, f({ solicitantes: ["LIZIA"] }))).toEqual([base, verbal]);
    expect(filtrarAdvertencias(todas, f({ cargos: ["VIGILANTE"] }))).toEqual([]);
  });
  it("vários valores no mesmo campo = OU; campos diferentes = E", () => {
    expect(filtrarAdvertencias(todas, f({ tipos: ["Verbal", "Escrita"] }))).toEqual(todas);
    expect(filtrarAdvertencias(todas, f({ tipos: ["Escrita"], graus: ["Baixo"] }))).toEqual([]);
  });
  it("exceção sim/não", () => {
    expect(filtrarAdvertencias(todas, f({ excecao: "sim" }))).toEqual([exc]);
    expect(filtrarAdvertencias(todas, f({ excecao: "nao" }))).toEqual([base, verbal]);
    expect(passaNosFiltros(l({ excecao: null }), f({ excecao: "nao" }))).toBe(true);
  });
  it("valor com espaço sobrando ainda casa", () => {
    expect(passaNosFiltros(l({ contrato: " 1049 - TJRS - 023/2025 " }), f({ contratos: ["1049 - TJRS - 023/2025"] }))).toBe(true);
  });
});

describe("chips", () => {
  it("um chip por valor + exceção, e remove só o clicado", () => {
    const fx = f({ meses: ["2026-11"], tipos: ["Escrita", "Verbal"], excecao: "sim" });
    const chips = chipsDosFiltros(fx);
    expect(chips.map(c => c.rotulo)).toEqual([
      "Mês (ocorrido): nov/2026", "Tipo: Escrita", "Tipo: Verbal", "Só exceções fora do prazo",
    ]);
    const sem = removerChip(fx, chips[1]);
    expect(sem.tipos).toEqual(["Verbal"]);
    expect(removerChip(fx, chips[3]).excecao).toBe("todas");
  });
  it("chip do mês diz a base", () => {
    expect(chipsDosFiltros(f({ meses: ["2026-10"], baseMes: "solicitada" }))[0].rotulo).toBe("Mês (solicitada): out/2026");
  });
  it("semCampo limpa só aquele campo", () => {
    const fx = f({ tipos: ["Escrita"], graus: ["Médio"], excecao: "nao" });
    expect(semCampo(fx, "tipos")).toEqual({ ...fx, tipos: [] });
    expect(semCampo(fx, "excecao").excecao).toBe("todas");
  });
});
