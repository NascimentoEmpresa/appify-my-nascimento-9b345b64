import { describe, expect, it } from "vitest";
import { situacaoCa } from "@/lib/sst/ca";
import { caAtendeLaudo } from "@/lib/sst/laudo";

const MS_DIA = 86_400_000;

function dataCivil(deslocamentoDias = 0) {
  const agora = new Date();
  const base = Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate());
  return new Date(base + deslocamentoDias * MS_DIA).toISOString().slice(0, 10);
}

function somarMeses(data: string, meses: number) {
  const [ano, mes, dia] = data.split("-").map(Number);
  const primeiro = new Date(Date.UTC(ano, mes - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(
    primeiro.getUTCFullYear(), primeiro.getUTCMonth() + 1, 0,
  )).getUTCDate();
  return new Date(Date.UTC(
    primeiro.getUTCFullYear(), primeiro.getUTCMonth(), Math.min(dia, ultimoDia),
  )).toISOString().slice(0, 10);
}

describe("situação do CA", () => {
  // O caso real são centenas de máscaras sem acompanhamento de CA. A mesma
  // classificação precisa valer nos KPIs, tabelas e consultas do banco.
  it("classifica ausência de validade como sem CA", () => {
    expect(situacaoCa(null, 60)).toBe("sem_ca");
  });

  it("classifica validade de ontem como vencida", () => {
    expect(situacaoCa(dataCivil(-1), 60)).toBe("vencido");
  });

  it("mantém o CA válido durante o próprio dia da validade", () => {
    expect(situacaoCa(dataCivil(), 60)).toBe("valido");
  });

  it("classifica validade dentro da antecedência como vencendo", () => {
    expect(situacaoCa(dataCivil(20), 60)).toBe("vencendo");
  });

  it("classifica validade além da antecedência como válida", () => {
    expect(situacaoCa(dataCivil(61), 60)).toBe("valido");
  });

  it("inclui o limite exato na faixa de vencimento", () => {
    expect(situacaoCa(dataCivil(60), 60)).toBe("vencendo");
  });
});

describe("aceite do CA pelo laudo do SST", () => {
  // A entrada precisa impedir que uma remessa já chegue com menos validade do
  // que o SST determinou para aquele EPI.
  const hoje = dataCivil();

  it("sem laudo aceita qualquer coisa, inclusive CA nulo", () => {
    expect(caAtendeLaudo(null, null, hoje)).toBe(true);
  });

  it("com laudo recusa CA nulo", () => {
    expect(caAtendeLaudo(null, 6, hoje)).toBe(false);
  });

  it("recusa CA que vence antes do mínimo", () => {
    const minimo = somarMeses(hoje, 6);
    const antes = new Date(Date.parse(`${minimo}T00:00:00Z`) - MS_DIA).toISOString().slice(0, 10);
    expect(caAtendeLaudo(antes, 6, hoje)).toBe(false);
  });

  it("aceita CA exatamente no mínimo", () => {
    expect(caAtendeLaudo(somarMeses(hoje, 6), 6, hoje)).toBe(true);
  });

  it("aceita CA muito além do mínimo", () => {
    expect(caAtendeLaudo(somarMeses(hoje, 18), 6, hoje)).toBe(true);
  });
});
