import { describe, expect, it } from "vitest";
import {
  filtrarNotasParaPrevia, montarEmail, planejarCobrancas, type ConfigCobranca, type NotaAberta,
} from "../../supabase/functions/_shared/cobranca-automatica";
import { datasDoConjunto, datasPorNota, setoresQueEuRegistro } from "@/pages/cobrancas/cobrancaNotas";

// SIS-2026-0878 — Cobranças: (1) data da cobrança por setor (Jurídico/Financeiro) e (2) prévia do e-mail só com as notas escolhidas e aptas ao setor.
const HOJE = "2026-10-20";
const AGORA = new Date("2026-10-20T15:00:00Z");
const emissaoHaDias = (dias: number) => new Date(Date.UTC(2026, 9, 20) - dias * 86_400_000).toISOString().slice(0, 10);
const nota = (dias: number, o: Partial<NotaAberta> = {}): NotaAberta => ({
  id: `n${dias}`, numero: String(1000 + dias), contratoId: "c1", dataEmissao: emissaoHaDias(dias), competencia: "2026-08-01", valor: 1000, ...o,
});
const CONFIG: ConfigCobranca = { intervalo_dias: { aviso: 0, verde: 7, amarela: 7, laranja: 7, vermelha: 7 }, aviso_dias_antes: 5 };

// Contrato "dos vigias": 1 nota na faixa laranja (atraso 31 a 60 = 61 a 90 dias de emissão) e várias na verde (atraso até 15).
const NOTAS = [nota(70), nota(40), nota(42), nota(44)];

describe("prévia só com as notas escolhidas", () => {
  it("sem nota escolhida e sem restrição, vale o contrato inteiro (comportamento antigo)", () => {
    expect(filtrarNotasParaPrevia(NOTAS, { restricaoDias: 0, hoje: HOJE })).toHaveLength(4);
    expect(filtrarNotasParaPrevia(NOTAS, { notaIds: [], restricaoDias: 0, hoje: HOJE })).toHaveLength(4);
    expect(filtrarNotasParaPrevia(NOTAS, { notaIds: null, restricaoDias: 0, hoje: HOJE })).toHaveLength(4);
  });

  it("com nota escolhida, só ela entra (o defeito: a prévia levava as 25 notas do contrato)", () => {
    const r = filtrarNotasParaPrevia(NOTAS, { notaIds: ["n70"], restricaoDias: 0, hoje: HOJE });
    expect(r.map((n) => n.id)).toEqual(["n70"]);
  });

  it("Jurídico (restrição 30): só nota com mais de 30 dias de atraso, mesmo que a verde esteja escolhida", () => {
    // n70: 70 − 30 = 40 dias de atraso (entra); n40: 10 dias (não entra)
    const r = filtrarNotasParaPrevia(NOTAS, { notaIds: ["n70", "n40"], restricaoDias: 30, hoje: HOJE });
    expect(r.map((n) => n.id)).toEqual(["n70"]);
    // sem escolher nenhuma, o Jurídico leva só as que ele pode cobrar
    expect(filtrarNotasParaPrevia(NOTAS, { restricaoDias: 30, hoje: HOJE }).map((n) => n.id)).toEqual(["n70"]);
  });

  it("Comercial (restrição 60): atraso acima de 60 dias", () => {
    expect(filtrarNotasParaPrevia([nota(95), nota(70)], { restricaoDias: 60, hoje: HOJE }).map((n) => n.id)).toEqual(["n95"]);
  });

  it("o e-mail lista só as notas que entraram e o modelo segue a faixa DELAS, não a do contrato todo", () => {
    const entrada = (notas: NotaAberta[]) => ({
      notas, contratos: new Map([["c1", { id: "c1", nome: "TRIUNFO VIGIAS - 33/2024", empresaCodigo: "SN" }]]),
      emailsPorContrato: new Map([["c1", ["adm@triunfo.rs.gov.br"]]]), contratosSoManual: new Set<string>(), enviosAnteriores: [], config: CONFIG, agora: AGORA,
    });
    const todas = planejarCobrancas(entrada(NOTAS))[0];
    expect(todas.notas).toHaveLength(4);
    expect(todas.faixa).toBe("laranja"); // n70 = 40 dias de atraso → laranja; a maior do conjunto (as outras são verdes)
    const so40 = planejarCobrancas(entrada(filtrarNotasParaPrevia(NOTAS, { notaIds: ["n40"], restricaoDias: 0, hoje: HOJE })))[0];
    expect(so40.notas.map((n) => n.id)).toEqual(["n40"]);
    expect(so40.faixa).toBe("verde");
    const email = montarEmail(so40, { assunto: "Cobrança - {{cliente}}", corpo: "{{lista_html}}" }, HOJE);
    expect(email.assunto).toContain("NFs: 1040");
    expect(email.corpo).toContain("Nota <b>1040</b>");
    expect(email.corpo).not.toContain("1070");
  });
});

describe("data da cobrança por setor (como no sistema antigo)", () => {
  const registros = [
    { nf_emissao_id: "a", setor: "juridico" as const, data_cobranca: "2026-10-19" },
    { nf_emissao_id: "a", setor: "juridico" as const, data_cobranca: "2026-10-10" },
    { nf_emissao_id: "b", setor: "financeiro" as const, data_cobranca: "2026-10-01" },
  ];
  // e-mail automático (Financeiro) que levou as notas a e c, enviado 23/10 às 02h UTC = 22/10 em São Paulo
  const envios = [{ criado_em: "2026-10-23T02:00:00Z", notas: [{ id: "a" }, { id: "c" }] }, { criado_em: "2026-10-05T15:00:00Z", notas: null }];

  it("Jurídico = o registro manual mais recente; Financeiro = o maior entre o registro e o e-mail automático", () => {
    const m = datasPorNota(registros, envios);
    expect(m.get("a")).toEqual({ juridico: "2026-10-19", financeiro: "2026-10-22" });
    expect(m.get("b")).toEqual({ juridico: null, financeiro: "2026-10-01" });
    expect(m.get("c")).toEqual({ juridico: null, financeiro: "2026-10-22" });
    expect(m.get("zzz")).toBeUndefined();
  });

  it("o dia do e-mail automático é o de São Paulo, não o UTC", () => {
    expect(datasPorNota([], [{ criado_em: "2026-10-23T01:30:00Z", notas: [{ id: "x" }] }]).get("x")?.financeiro).toBe("2026-10-22");
  });

  it("a linha do contrato mostra a cobrança mais recente de cada setor entre as notas", () => {
    const m = datasPorNota(registros, envios);
    expect(datasDoConjunto(["a", "b", "c"], m)).toEqual({ juridico: "2026-10-19", financeiro: "2026-10-22" });
    expect(datasDoConjunto(["b"], m)).toEqual({ juridico: null, financeiro: "2026-10-01" });
    expect(datasDoConjunto([], m)).toEqual({ juridico: null, financeiro: null });
  });
});

describe("quem registra a cobrança de cada setor", () => {
  it("Jurídico = aprovar ou alterar; Financeiro = alterar; só visualizar não registra", () => {
    expect(setoresQueEuRegistro({ alterar: true, aprovar: false })).toEqual(["juridico", "financeiro"]);
    expect(setoresQueEuRegistro({ alterar: false, aprovar: true })).toEqual(["juridico"]);
    expect(setoresQueEuRegistro({ alterar: false, aprovar: false })).toEqual([]);
  });
});
