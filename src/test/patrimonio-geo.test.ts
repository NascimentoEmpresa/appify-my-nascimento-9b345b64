import { describe, it, expect, vi } from "vitest";
import {
  limparEndereco, logradouro, consultaGeo, variantesDeConsulta, cidadeParaBusca,
  assinaturaEndereco, temCoordenada, precisaLocalizar, coordenadaValida,
  buscarCoordenada, localizarPatrimonio,
} from "@/pages/juridico/patrimonio/geo";

// Endereços REAIS do cadastro (JUR_PATRIMONIOS) — é neles que a limpeza tem
// que funcionar, não em exemplos inventados.
describe("limpar o endereço", () => {
  it("tira anotação entre parênteses", () => {
    expect(limparEndereco("RUA ALLAN KARDEC - CASA AZUL (o valor faltante será pago ao final)"))
      .toBe("RUA ALLAN KARDEC - CASA AZUL");
  });

  it("tira marcador de unidade, que não muda a coordenada do prédio", () => {
    expect(limparEndereco("TURIM - RUA JOSE MILTON LOPES, 557 - AP 01102 150 E BOX"))
      .toContain("RUA JOSE MILTON LOPES, 557");
  });

  it("não deixa separador órfão quando tira um pedaço do meio", () => {
    // "TRAVESSA X, 876, BOX 24 - ZONA" viraria "TRAVESSA X, 876, - ZONA".
    const s = limparEndereco("TRAVESSA LARGO V, 876, BOX 24 - ZONA NOVA, CAPÃO DA CANOA - ENZO");
    expect(s).not.toMatch(/,\s*,/);
    expect(s).not.toMatch(/,\s*-/);
  });

  it('"Nº 0" é ausência de número, não número zero', () => {
    expect(limparEndereco("CHACARÁ TF 10, Nº 0, PASSO FUNDO TRIUNFO")).not.toMatch(/N[ºo°]\s*0/);
  });

  it("texto sem letra nenhuma não é endereço", () => {
    expect(limparEndereco("- , -")).toBe("");
    expect(limparEndereco("")).toBe("");
    expect(limparEndereco(null)).toBe("");
  });
});

describe("achar o logradouro no meio do texto", () => {
  it("descarta o nome do empreendimento na frente da rua", () => {
    expect(logradouro("TURIM - RUA JOSE MILTON LOPES, 557")).toBe("RUA JOSE MILTON LOPES, 557");
    expect(logradouro("ATLANTIDA GREEN SQUARE - AV CENTRAL, 1891")).toBe("AV CENTRAL, 1891");
  });

  it("descarta o apelido depois da rua", () => {
    expect(logradouro("RUA ALLAN KARDEC - CASA AZUL")).toBe("RUA ALLAN KARDEC");
  });

  it("devolve vazio quando não há logradouro reconhecível", () => {
    expect(logradouro("COTAS - GAV")).toBe("");
    expect(logradouro("MURANO")).toBe("");
  });
});

describe("cidade como o mapa escreve", () => {
  it("corrige as grafias que o OpenStreetMap não reconhece", () => {
    // Medido contra o serviço: "Xangrilá" devolve vazio, "Xangri-lá" acha.
    expect(cidadeParaBusca("Xangrilá")).toBe("Xangri-lá");
    expect(cidadeParaBusca("XANGRILA")).toBe("Xangri-lá");
    expect(cidadeParaBusca("Triunfo")).toBe("Triunfo");
    expect(cidadeParaBusca("")).toBe("");
  });
});

describe("variantes da consulta", () => {
  it("vai da mais específica para a mais genérica, sem repetir", () => {
    const v = variantesDeConsulta({ id: 1, cidade: "Capão da Canoa", localizacao: "TURIM - RUA JOSE MILTON LOPES, 557 - AP 01102" });
    expect(v[0]).toContain("TURIM");
    expect(v[1]).toBe("RUA JOSE MILTON LOPES, 557, Capão da Canoa, RS, Brasil");
    expect(v[2]).toBe("RUA JOSE MILTON LOPES, Capão da Canoa, RS, Brasil");
    expect(new Set(v).size).toBe(v.length);
  });

  it("sem endereço não gera consulta — o imóvel fica no pino da cidade", () => {
    // Buscar só a cidade devolveria o centro dela: um pino "exato" que não é
    // o imóvel. Melhor assumir que não se sabe.
    expect(variantesDeConsulta({ id: 1, cidade: "TRIUNFO", localizacao: "" })).toEqual([]);
    expect(consultaGeo({ id: 1, cidade: "TRIUNFO", localizacao: "" })).toBe("");
  });

  it("endereço sem RUA/AV afrouxa pelo número", () => {
    const v = variantesDeConsulta({ id: 1, cidade: "Triunfo", localizacao: "ADÃO TAVARES DA SILVA, 393" });
    expect(v.some(x => x.startsWith("ADÃO TAVARES DA SILVA, 393"))).toBe(true);
    expect(v.some(x => x.startsWith("ADÃO TAVARES DA SILVA,"))).toBe(true);
  });
});

describe("quando procurar de novo", () => {
  const base = { id: 1, cidade: "Triunfo", localizacao: "RUA JOÃO PESSOA, 172" };

  it("já tem coordenada do endereço atual: não procura", () => {
    expect(precisaLocalizar({ ...base, latitude: -29.9, longitude: -51.7, geo_endereco: assinaturaEndereco(base) })).toBe(false);
  });

  it("endereço mudou no cadastro: procura de novo", () => {
    expect(precisaLocalizar({ ...base, latitude: -29.9, longitude: -51.7, geo_endereco: "OUTRA RUA|Triunfo" })).toBe(true);
  });

  it("não repete busca impossível com o mesmo endereço", () => {
    // Sem isto, toda abertura de tela tentaria "COTAS - GAV" outra vez.
    const p = { id: 1, cidade: "", localizacao: "COTAS - GAV" };
    expect(precisaLocalizar({ ...p, geo_status: "nao_encontrado", geo_endereco: assinaturaEndereco(p) })).toBe(false);
    expect(precisaLocalizar({ ...p, geo_status: "nao_encontrado", geo_endereco: "outro|" })).toBe(true);
  });

  it("coordenada manual nunca é sobrescrita", () => {
    expect(precisaLocalizar({ ...base, geo_status: "manual", latitude: -29.9, longitude: -51.7, geo_endereco: "qualquer" })).toBe(false);
  });

  it("sabe quem já tem coordenada", () => {
    expect(temCoordenada({ id: 1, latitude: -29.9, longitude: -51.7 })).toBe(true);
    expect(temCoordenada({ id: 1, latitude: -29.9, longitude: null })).toBe(false);
    expect(temCoordenada({ id: 1 })).toBe(false);
  });
});

describe("coordenada digitada à mão", () => {
  it("aceita o Brasil e recusa o resto", () => {
    expect(coordenadaValida(-29.9447, -51.7186)).toBe(true);
    expect(coordenadaValida(29.9447, -51.7186)).toBe(false);   // sinal trocado
    expect(coordenadaValida(-29.9447, 51.7186)).toBe(false);
    expect(coordenadaValida("", "")).toBe(false);
    expect(coordenadaValida("abc", -51)).toBe(false);
  });
});

describe("busca no serviço", () => {
  const resposta = (linhas: any[]) => ({ ok: true, json: async () => linhas } as any);

  it("devolve a primeira coordenada válida", async () => {
    const fetchFake = vi.fn().mockResolvedValue(resposta([{ lat: "-29.94", lon: "-51.71", display_name: "Rua X" }]));
    const r = await buscarCoordenada("Rua X, Triunfo, RS, Brasil", fetchFake as any);
    expect(r).toEqual({ lat: -29.94, lng: -51.71, rotulo: "Rua X" });
    expect(String(fetchFake.mock.calls[0][0])).toContain("countrycodes=br");
  });

  it("resultado fora do Brasil é descartado", async () => {
    // "RUA PERU" sem trava acharia o país Peru.
    const fetchFake = vi.fn().mockResolvedValue(resposta([{ lat: "-9.19", lon: "-75.01", display_name: "Peru" }]));
    expect(await buscarCoordenada("RUA PERU", fetchFake as any)).toBeNull();
  });

  it("lista vazia é 'não encontrado', não erro", async () => {
    expect(await buscarCoordenada("nada", vi.fn().mockResolvedValue(resposta([])) as any)).toBeNull();
  });

  it("serviço fora do ar vira erro para a tela mostrar", async () => {
    const fetchFake = vi.fn().mockResolvedValue({ ok: false, status: 503 } as any);
    await expect(buscarCoordenada("x", fetchFake as any)).rejects.toThrow(/503/);
  });

  it("consulta vazia nem chama o serviço", async () => {
    const fetchFake = vi.fn();
    expect(await buscarCoordenada("   ", fetchFake as any)).toBeNull();
    expect(fetchFake).not.toHaveBeenCalled();
  });
});

describe("localizar tentando as variantes", () => {
  const semPausa = async () => {};

  it("para na primeira variante que acha", async () => {
    const fetchFake = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as any)                                     // completa falha
      .mockResolvedValueOnce({ ok: true, json: async () => [{ lat: "-29.7", lon: "-50.0", display_name: "Rua José Milton Lopes" }] } as any);
    const r = await localizarPatrimonio(
      { id: 1, cidade: "Capão da Canoa", localizacao: "TURIM - RUA JOSE MILTON LOPES, 557" },
      { fetchFn: fetchFake as any, aguardar: semPausa });
    expect(r.achado?.rotulo).toBe("Rua José Milton Lopes");
    expect(r.tentativas).toBe(2);
    expect(fetchFake).toHaveBeenCalledTimes(2);   // não tentou a terceira
  });

  it("esgotou as variantes: não achou", async () => {
    const fetchFake = vi.fn().mockResolvedValue({ ok: true, json: async () => [] } as any);
    const r = await localizarPatrimonio(
      { id: 1, cidade: "", localizacao: "COTAS - GAV" },
      { fetchFn: fetchFake as any, aguardar: semPausa });
    expect(r.achado).toBeNull();
  });
});
