import { describe, expect, it } from "vitest";
import {
  chaveCidade, chavesSemCoordenada, consultaDaCidade, dataCurta, foiEntregue,
  montarParadas, rotuloCidade, type EventoCorreio,
} from "@/lib/suprimentos/trajetoCorreio";

/**
 * Os eventos abaixo são os do objeto REAL OY768985965BR (Triunfo/RS →
 * Penha/SC, entregue em 31/08/2026), na ordem cronológica em que a Edge
 * Function os entrega — os Correios devolvem do mais novo para o mais velho e
 * a inversão acontece lá.
 */
const eventos: EventoCorreio[] = [
  { descricao: "Objeto postado após o horário limite da unidade", data: "2026-08-24T16:06:00", cidade: "Triunfo", uf: "RS", destinoCidade: "Porto Alegre", destinoUf: "RS" },
  { descricao: "Objeto em transferência - por favor aguarde", data: "2026-08-25T11:32:00", cidade: "Triunfo", uf: "RS", destinoCidade: "Porto Alegre", destinoUf: "RS" },
  { descricao: "Objeto em transferência - por favor aguarde", data: "2026-08-26T21:51:00", cidade: "Porto Alegre", uf: "RS", destinoCidade: "Sao Jose", destinoUf: "SC" },
  { descricao: "Objeto em transferência - por favor aguarde", data: "2026-08-27T22:32:00", cidade: "Sao Jose", uf: "SC", destinoCidade: "Penha", destinoUf: "SC" },
  { descricao: "Objeto saiu para entrega ao destinatário", data: "2026-08-31T09:58:00", cidade: "Penha", uf: "SC" },
  { descricao: "Objeto entregue ao destinatário", data: "2026-08-31T10:47:00", cidade: "Penha", uf: "SC" },
];

describe("paradas do trajeto", () => {
  const paradas = montarParadas(eventos);

  it("reproduz a rota do objeto real, sem repetir cidade em sequência", () => {
    expect(paradas.map((p) => p.chave)).toEqual([
      "TRIUNFO-RS", "PORTO ALEGRE-RS", "SAO JOSE-SC", "PENHA-SC",
    ]);
  });

  /** Seis eventos, quatro pinos: os três de Penha e os dois de Triunfo agrupam. */
  it("agrupa os eventos da mesma cidade numa parada só", () => {
    expect(paradas[0].eventos).toHaveLength(2);
    expect(paradas[3].eventos).toHaveLength(2);
    expect(paradas.reduce((n, p) => n + p.eventos.length, 0)).toBe(eventos.length);
  });

  it("objeto entregue não promete parada seguinte", () => {
    expect(paradas.some((p) => p.previsto)).toBe(false);
    expect(foiEntregue(eventos)).toBe(true);
  });
});

describe("objeto ainda em trânsito", () => {
  /** Para na transferência: o destino é o que quem abre o mapa quer ver. */
  const emTransito = eventos.slice(0, 3);
  const paradas = montarParadas(emTransito);

  it("acrescenta o destino da última transferência como parada prevista", () => {
    const ultima = paradas[paradas.length - 1];
    expect(ultima.chave).toBe("SAO JOSE-SC");
    expect(ultima.previsto).toBe(true);
    expect(ultima.eventos).toHaveLength(0);
  });

  it("não duplica o destino quando o objeto já chegou nele", () => {
    const chegou = [...emTransito, {
      descricao: "Objeto recebido na unidade", data: "2026-08-27T22:32:00",
      cidade: "Sao Jose", uf: "SC",
    }];
    const p = montarParadas(chegou);
    expect(p.filter((x) => x.chave === "SAO JOSE-SC")).toHaveLength(1);
    expect(p[p.length - 1].previsto).toBe(false);
  });

  it("não foi entregue", () => {
    expect(foiEntregue(emTransito)).toBe(false);
  });
});

describe("cidade que reaparece", () => {
  /** Objeto devolvido volta à origem — e isso não pode sumir do mapa. */
  it("volta a virar parada quando o objeto já tinha saído dela", () => {
    const idaEVolta: EventoCorreio[] = [
      { descricao: "Postado", data: "2026-08-24T16:06:00", cidade: "Triunfo", uf: "RS" },
      { descricao: "Em transferência", data: "2026-08-25T11:32:00", cidade: "Porto Alegre", uf: "RS" },
      { descricao: "Devolvido ao remetente", data: "2026-08-28T09:00:00", cidade: "Triunfo", uf: "RS" },
    ];
    expect(montarParadas(idaEVolta).map((p) => p.chave))
      .toEqual(["TRIUNFO-RS", "PORTO ALEGRE-RS", "TRIUNFO-RS"]);
  });
});

describe("evento sem unidade", () => {
  it("não vira pino, e não derruba o resto do trajeto", () => {
    const comBuraco: EventoCorreio[] = [
      { descricao: "Objeto postado", data: "2026-08-24T16:06:00", cidade: "Triunfo", uf: "RS" },
      { descricao: "Objeto em trânsito", data: "2026-08-25T11:32:00", cidade: null, uf: null },
      { descricao: "Objeto entregue ao destinatário", data: "2026-08-31T10:47:00", cidade: "Penha", uf: "SC" },
    ];
    expect(montarParadas(comBuraco).map((p) => p.chave)).toEqual(["TRIUNFO-RS", "PENHA-SC"]);
  });

  it("lista vazia não estoura", () => {
    expect(montarParadas([])).toEqual([]);
  });
});

describe("chave da cidade", () => {
  /** A chave é o que liga a parada à coordenada guardada: acento não pode separá-las. */
  it("ignora acento e caixa", () => {
    expect(chaveCidade("São José", "sc")).toBe("SAO JOSE-SC");
    expect(chaveCidade("Sao Jose", "SC")).toBe("SAO JOSE-SC");
  });

  it("sem UF não há chave — 'Penha' sozinho existe em mais de um estado", () => {
    expect(chaveCidade("Penha", null)).toBe("");
    expect(chaveCidade(null, "SC")).toBe("");
  });
});

describe("o que falta buscar no mapa", () => {
  const paradas = montarParadas(eventos);

  it("pede só as cidades que ainda não têm coordenada", () => {
    const conhecidas = { "TRIUNFO-RS": [0, 0], "PENHA-SC": [0, 0] };
    expect(chavesSemCoordenada(paradas, conhecidas)).toEqual(["PORTO ALEGRE-RS", "SAO JOSE-SC"]);
  });

  it("não pede duas vezes a mesma cidade", () => {
    const idaEVolta = montarParadas([
      { descricao: "a", data: null, cidade: "Triunfo", uf: "RS" },
      { descricao: "b", data: null, cidade: "Porto Alegre", uf: "RS" },
      { descricao: "c", data: null, cidade: "Triunfo", uf: "RS" },
    ]);
    expect(chavesSemCoordenada(idaEVolta, {})).toEqual(["TRIUNFO-RS", "PORTO ALEGRE-RS"]);
  });

  it("a consulta leva a UF, senão o pino cai noutro estado", () => {
    expect(consultaDaCidade({ cidade: "Penha", uf: "SC" })).toBe("Penha, SC, Brasil");
  });
});

describe("apresentação", () => {
  it("escreve a cidade como o site dos Correios", () => {
    expect(rotuloCidade({ cidade: "Sao Jose", uf: "SC" })).toBe("Sao Jose - SC");
  });

  it("formata a data no padrão brasileiro", () => {
    expect(dataCurta("2026-08-31T10:47:00")).toBe("31/08/2026 10:47");
  });

  it("data ausente ou inválida não imprime 'Invalid Date'", () => {
    expect(dataCurta(null)).toBe("");
    expect(dataCurta("nada disso")).toBe("");
  });
});
