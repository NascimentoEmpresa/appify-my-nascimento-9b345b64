import { describe, expect, it } from "vitest";
import { diasEntre, indicadores, ordemDaFila, situacaoPrazo, valorEvitado, valorVigente, type Notificacao } from "@/pages/juridico/notificacoes/regras";

const HOJE = "2026-09-21";
const n = (over: Partial<Notificacao>): Notificacao => ({
  id: 1, protocolo: "NOT-2026-00001", tipo: "Multa", data_recebimento: "2026-09-10", assunto: "x", etapa: "Recebida", ...over,
});

describe("prazo de defesa", () => {
  it("conta dias corridos sem erro de fuso", () => {
    expect(diasEntre("2026-09-21", "2026-09-26")).toBe(5);
    expect(diasEntre("2026-12-31", "2027-01-01")).toBe(1);
  });
  it("régua: vencido, hoje, urgente (≤3), atenção (≤7), ok", () => {
    expect(situacaoPrazo(n({ prazo_defesa: "2026-09-19" }), HOJE)).toMatchObject({ nivel: "vencido", dias: -2 });
    expect(situacaoPrazo(n({ prazo_defesa: "2026-09-21" }), HOJE).nivel).toBe("hoje");
    expect(situacaoPrazo(n({ prazo_defesa: "2026-09-24" }), HOJE).nivel).toBe("urgente");
    expect(situacaoPrazo(n({ prazo_defesa: "2026-09-28" }), HOJE).nivel).toBe("atencao");
    expect(situacaoPrazo(n({ prazo_defesa: "2026-10-30" }), HOJE).nivel).toBe("ok");
  });
  it("depois de protocolar a defesa (ou encerrar), prazo vencido não alarma", () => {
    expect(situacaoPrazo(n({ prazo_defesa: "2026-09-01", etapa: "Defesa protocolada" }), HOJE).nivel).toBe("ok");
    expect(situacaoPrazo(n({ prazo_defesa: "2026-09-01", etapa: "Encerrada" }), HOJE).nivel).toBe("encerrada");
  });
});

describe("valores", () => {
  it("vigente = final quando lançado; revertida sem final = zero; senão o original", () => {
    expect(valorVigente({ valor_original: 1000, valor_final: 300 })).toBe(300);
    expect(valorVigente({ valor_original: 1000, resultado: "Revertida" })).toBe(0);
    expect(valorVigente({ valor_original: 1000, resultado: "Mantida" })).toBe(1000);
    expect(valorVigente({ valor_original: 1000, valor_final: 0 })).toBe(0);
  });
  it("evitado nunca fica negativo", () => {
    expect(valorEvitado({ valor_original: 1000, valor_final: 300 })).toBe(700);
    expect(valorEvitado({ valor_original: 100, valor_final: 150 })).toBe(0);
  });
});

describe("indicadores", () => {
  const lista = [
    n({ id: 1, prazo_defesa: "2026-09-19", valor_original: 1000 }),                                            // vencida
    n({ id: 2, prazo_defesa: "2026-09-23", valor_original: 500, responsavel_nome: "Ana" }),                    // vencendo
    n({ id: 3, etapa: "Encerrada", resultado: "Revertida", valor_original: 2000, contrato: "C1" }),           // êxito
    n({ id: 4, etapa: "Encerrada", resultado: "Mantida", valor_original: 300, valor_descontado: 300, contrato: "C1" }),
    n({ id: 5, etapa: "Encerrada", resultado: "Sem defesa", valor_original: 100, medida_preventiva: "treinar" }),
  ];
  const i = indicadores(lista, HOJE);
  it("conta prazos, abertas e sem responsável", () => {
    expect(i).toMatchObject({ total: 5, abertas: 2, encerradas: 3, vencidas: 1, vencendo7: 1, semResponsavel: 1 });
  });
  it("valores e taxa de êxito ('Sem defesa' não entra na conta de êxito)", () => {
    expect(i.valorAplicado).toBe(3900);
    expect(i.valorEvitado).toBe(2000);
    expect(i.valorDescontado).toBe(300);
    expect(i.taxaExito).toBe(50);
    expect(i.medidasPendentes).toBe(1);
    expect(i.porContrato[0]).toMatchObject({ nome: "C1", qtd: 2, valor: 2300 });
  });
  it("fila: vencida primeiro, encerrada por último", () => {
    const f = [...lista].sort((a, b) => ordemDaFila(a, b, HOJE)).map(x => x.id);
    expect(f[0]).toBe(1);
    expect(f[1]).toBe(2);
    expect(f.slice(2).sort()).toEqual([3, 4, 5]);
  });
});
