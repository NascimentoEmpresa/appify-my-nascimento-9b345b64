import { describe, it, expect } from "vitest";
import {
  localEhEscritorio, normalizarLocal, statusInicial, proximoStatus, pertenceAFila,
  statusVisiveis, statusDeAcao, explicaStatus,
  type StatusTroca,
} from "@/lib/trocaFuncao/solicitacao";

describe("localEhEscritorio", () => {
  it("reconhece o escritório nas grafias que existem no cadastro", () => {
    // "ESCRITÓRI0" está com ZERO no lugar do O na EMPREGADOS (espelho do
    // Senior, 18 pessoas). Tem que cair no escritório mesmo assim.
    expect(localEhEscritorio("ADMINISTRATIVO")).toBe(true);
    expect(localEhEscritorio("ESCRITÓRI0")).toBe(true);
    expect(localEhEscritorio("ESCRITÓRIO")).toBe(true);
    expect(localEhEscritorio("escritorio")).toBe(true);
    expect(localEhEscritorio("  Administrativo  ")).toBe(true);
  });

  it("trata contrato como contrato", () => {
    for (const local of [
      "UFRGS - CAMPUS VALE 5D TRI", "SAMU", "PREFEITURA DE VERANOPOLIS",
      "PORTARIA FURG", "VIGIA E ZELADORIA TRIUNFO", "ESCOLA INFANTIL CANAA",
    ]) {
      expect(localEhEscritorio(local)).toBe(false);
    }
  });

  it("sem local, trata como contrato", () => {
    // 27 pessoas ativas estão sem local. O Operacional é a fila com gente
    // olhando todo dia, então errar para esse lado é o menor prejuízo.
    expect(localEhEscritorio(null)).toBe(false);
    expect(localEhEscritorio("")).toBe(false);
    expect(localEhEscritorio("   ")).toBe(false);
  });

  it("não confunde contrato que só COMEÇA parecido", () => {
    // "ADMINISTRATIVO HOSPITAL X" seria escritório; "ADMINISTRATIVOX" não.
    expect(localEhEscritorio("ADMINISTRATIVO HOSPITAL X")).toBe(true);
    expect(localEhEscritorio("ADMINISTRATIVOX")).toBe(false);
  });

  it("normaliza acento, caixa e o zero", () => {
    expect(normalizarLocal(" Escritóri0 ")).toBe("ESCRITORIO");
  });
});

describe("statusInicial", () => {
  it("contrato nasce no Operacional e escritório na dupla do administrativo", () => {
    expect(statusInicial(false)).toBe("Pendente Operacional");
    expect(statusInicial(true)).toBe("Pendente Escritório");
  });
});

describe("proximoStatus", () => {
  it("aprovar em qualquer das duas filas manda para o SST", () => {
    expect(proximoStatus("Pendente Operacional", "aprovar")).toBe("Pendente SST");
    expect(proximoStatus("Pendente Escritório", "aprovar")).toBe("Pendente SST");
  });

  it("percorre SST → RH → Concluída", () => {
    expect(proximoStatus("Pendente SST", "aso")).toBe("Pendente RH");
    expect(proximoStatus("Pendente RH", "concluir")).toBe("Concluída");
  });

  it("reprovar só vale enquanto está em aprovação", () => {
    expect(proximoStatus("Pendente Operacional", "reprovar")).toBe("Reprovada");
    expect(proximoStatus("Pendente Escritório", "reprovar")).toBe("Reprovada");
    // Depois de aprovada não se reprova: o caminho é cancelar, não voltar.
    expect(proximoStatus("Pendente SST", "reprovar")).toBeNull();
    expect(proximoStatus("Pendente RH", "reprovar")).toBeNull();
  });

  it("recusa ação fora de hora", () => {
    expect(proximoStatus("Pendente Operacional", "aso")).toBeNull();
    expect(proximoStatus("Pendente Operacional", "concluir")).toBeNull();
    expect(proximoStatus("Pendente SST", "concluir")).toBeNull();
    expect(proximoStatus("Concluída", "aprovar")).toBeNull();
    expect(proximoStatus("Reprovada", "aprovar")).toBeNull();
  });

  it("não deixa concluir pulando o ASO", () => {
    // O pedido é explícito: aprovado vai para o SST e SÓ DEPOIS para o RH.
    expect(proximoStatus("Pendente SST", "concluir")).toBeNull();
  });
});

describe("pertenceAFila", () => {
  const sol = (status: StatusTroca, e_escritorio: boolean) => ({ status, e_escritorio });

  it("separa as duas filas de aprovação", () => {
    expect(pertenceAFila(sol("Pendente Operacional", false), "operacional")).toBe(true);
    expect(pertenceAFila(sol("Pendente Escritório", true), "escritorio")).toBe(true);
    // Uma não enxerga a fila da outra.
    expect(pertenceAFila(sol("Pendente Escritório", true), "operacional")).toBe(false);
    expect(pertenceAFila(sol("Pendente Operacional", false), "escritorio")).toBe(false);
  });

  it("depois de aprovada, cada aprovador acompanha só a origem dele", () => {
    // Os status seguintes são comuns às duas: sem o recorte por origem, o
    // Operacional passaria a ver as do escritório e vice-versa.
    expect(pertenceAFila(sol("Pendente SST", false), "operacional")).toBe(true);
    expect(pertenceAFila(sol("Pendente SST", true), "operacional")).toBe(false);
    expect(pertenceAFila(sol("Concluída", true), "escritorio")).toBe(true);
  });

  it("SST e RH tratam as duas origens", () => {
    expect(pertenceAFila(sol("Pendente SST", true), "sst")).toBe(true);
    expect(pertenceAFila(sol("Pendente SST", false), "sst")).toBe(true);
    expect(pertenceAFila(sol("Pendente RH", true), "rh")).toBe(true);
  });

  it("SST e RH não enxergam o que está em aprovação nem o reprovado", () => {
    expect(pertenceAFila(sol("Pendente Operacional", false), "sst")).toBe(false);
    expect(pertenceAFila(sol("Reprovada", false), "sst")).toBe(false);
    expect(pertenceAFila(sol("Reprovada", false), "rh")).toBe(false);
    expect(pertenceAFila(sol("Pendente SST", false), "rh")).toBe(false);
  });
});

describe("statusVisiveis / statusDeAcao", () => {
  it("cada etapa age em exatamente um status, e ele está entre os visíveis", () => {
    for (const etapa of ["operacional", "escritorio", "sst", "rh"] as const) {
      expect(statusVisiveis(etapa)).toContain(statusDeAcao(etapa));
    }
  });
});

describe("explicaStatus", () => {
  it("explica todos os status, sem sobrar nenhum sem texto", () => {
    const todos: StatusTroca[] = [
      "Pendente Operacional", "Pendente Escritório", "Pendente SST",
      "Pendente RH", "Concluída", "Reprovada",
    ];
    for (const s of todos) expect(explicaStatus(s).length).toBeGreaterThan(10);
  });
});
