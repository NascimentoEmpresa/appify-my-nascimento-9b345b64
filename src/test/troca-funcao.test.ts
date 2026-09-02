import { describe, it, expect } from "vitest";
import {
  localEhEscritorio, normalizarLocal, statusInicial, statusAposAnalista, proximoStatus, pertenceAFila,
  podeAgirEm, origensVisiveis, origemDa, resumoSST,
  statusVisiveis, statusDeAcao, explicaStatus,
  type Origem, type StatusTroca,
} from "@/lib/trocaFuncao/solicitacao";

// CONTRATO e ESCRITÓRIO deixaram de ser duas telas (25/08/2026): viraram uma
// tela de aprovação só, recortada pela PERMISSÃO de quem abre. O que estes
// testes travam é que juntar as telas não juntou as filas — quem só aprova
// contrato continua sem enxergar o administrativo.
const CONTRATO: Origem[] = ["contrato"];
const ESCRITORIO: Origem[] = ["escritorio"];
const AMBAS: Origem[] = ["contrato", "escritorio"];

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
  it("toda troca nasce na mão do analista, venha de onde vier", () => {
    // A etapa do analista (02/09/2026) é a PRIMEIRA porta: a origem deixou de
    // decidir onde a solicitação nasce e passou a decidir só para onde ela vai
    // depois que o analista libera.
    expect(statusInicial(false)).toBe("Pendente Analista");
    expect(statusInicial(true)).toBe("Pendente Analista");
  });
});

describe("statusAposAnalista", () => {
  it("a origem escolhe a fila seguinte, não a inicial", () => {
    expect(statusAposAnalista(false)).toBe("Pendente Operacional");
    expect(statusAposAnalista(true)).toBe("Pendente Escritório");
  });
});

describe("proximoStatus", () => {
  it("o analista libera para a fila da ORIGEM, não direto para o SST", () => {
    // O pedido é explícito: primeiro o analista, DEPOIS o operacional.
    expect(proximoStatus("Pendente Analista", "aprovar", false)).toBe("Pendente Operacional");
    expect(proximoStatus("Pendente Analista", "aprovar", true)).toBe("Pendente Escritório");
  });

  it("o analista também reprova — é uma porta de decisão, não de leitura", () => {
    expect(proximoStatus("Pendente Analista", "reprovar")).toBe("Reprovada");
  });

  it("aprovar em qualquer das duas filas manda para o SST", () => {
    expect(proximoStatus("Pendente Operacional", "aprovar")).toBe("Pendente SST");
    expect(proximoStatus("Pendente Escritório", "aprovar")).toBe("Pendente SST");
  });

  it("percorre SST → RH → Concluída", () => {
    expect(proximoStatus("Pendente SST", "aso")).toBe("Pendente RH");
    expect(proximoStatus("Pendente RH", "concluir")).toBe("Concluída");
  });

  it("dispensar o ASO chega no mesmo lugar que marcar", () => {
    // Nem toda função nova exige exame. Para o RH os dois querem dizer "o SST
    // já olhou, pode alterar na Senior" — muda só o que fica registrado.
    expect(proximoStatus("Pendente SST", "dispensar_aso")).toBe("Pendente RH");
    expect(proximoStatus("Pendente Analista", "dispensar_aso")).toBeNull();
    expect(proximoStatus("Pendente Operacional", "dispensar_aso")).toBeNull();
    expect(proximoStatus("Pendente RH", "dispensar_aso")).toBeNull();
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

describe("origensVisiveis", () => {
  it("traduz os dois menus antigos em quais origens a pessoa enxerga", () => {
    expect(origensVisiveis(true, false)).toEqual(["contrato"]);
    expect(origensVisiveis(false, true)).toEqual(["escritorio"]);
    expect(origensVisiveis(true, true)).toEqual(["contrato", "escritorio"]);
  });

  it("sem nenhum dos dois menus, não sobra nada para ver", () => {
    // Juntar as telas não podia abrir acesso: sem permissão, lista vazia.
    expect(origensVisiveis(false, false)).toEqual([]);
  });
});

describe("origemDa", () => {
  it("é o flag do pedido, e nada mais", () => {
    expect(origemDa({ e_escritorio: true })).toBe("escritorio");
    expect(origemDa({ e_escritorio: false })).toBe("contrato");
  });
});

describe("pertenceAFila", () => {
  const sol = (status: StatusTroca, e_escritorio: boolean) => ({ status, e_escritorio });

  it("uma tela só, mas cada permissão vê a sua fila", () => {
    expect(pertenceAFila(sol("Pendente Operacional", false), "aprovacao", CONTRATO)).toBe(true);
    expect(pertenceAFila(sol("Pendente Escritório", true), "aprovacao", ESCRITORIO)).toBe(true);
    // Juntar as telas não pode dar a fila de um para o outro.
    expect(pertenceAFila(sol("Pendente Escritório", true), "aprovacao", CONTRATO)).toBe(false);
    expect(pertenceAFila(sol("Pendente Operacional", false), "aprovacao", ESCRITORIO)).toBe(false);
  });

  it("quem tem as duas permissões vê as duas origens", () => {
    expect(pertenceAFila(sol("Pendente Operacional", false), "aprovacao", AMBAS)).toBe(true);
    expect(pertenceAFila(sol("Pendente Escritório", true), "aprovacao", AMBAS)).toBe(true);
  });

  it("depois de aprovada, cada aprovador acompanha só a origem dele", () => {
    // Os status seguintes são comuns às duas: sem o recorte por origem, quem
    // aprova contrato passaria a ver as do escritório e vice-versa.
    expect(pertenceAFila(sol("Pendente SST", false), "aprovacao", CONTRATO)).toBe(true);
    expect(pertenceAFila(sol("Pendente SST", true), "aprovacao", CONTRATO)).toBe(false);
    expect(pertenceAFila(sol("Concluída", true), "aprovacao", ESCRITORIO)).toBe(true);
  });

  it("SST e RH tratam as duas origens", () => {
    expect(pertenceAFila(sol("Pendente SST", true), "sst", AMBAS)).toBe(true);
    expect(pertenceAFila(sol("Pendente SST", false), "sst", AMBAS)).toBe(true);
    expect(pertenceAFila(sol("Pendente RH", true), "rh", AMBAS)).toBe(true);
  });

  it("SST e RH não enxergam o que está em aprovação nem o reprovado", () => {
    expect(pertenceAFila(sol("Pendente Operacional", false), "sst", AMBAS)).toBe(false);
    expect(pertenceAFila(sol("Reprovada", false), "sst", AMBAS)).toBe(false);
    expect(pertenceAFila(sol("Reprovada", false), "rh", AMBAS)).toBe(false);
    expect(pertenceAFila(sol("Pendente SST", false), "rh", AMBAS)).toBe(false);
  });
});

describe("podeAgirEm", () => {
  const sol = (status: StatusTroca, e_escritorio: boolean) => ({ status, e_escritorio });

  it("ver não é decidir: acompanha o que já saiu da mão dele, sem poder mexer", () => {
    expect(pertenceAFila(sol("Pendente SST", false), "aprovacao", CONTRATO)).toBe(true);
    expect(podeAgirEm(sol("Pendente SST", false), "aprovacao", CONTRATO)).toBe(false);
  });

  it("só age no que é da sua origem", () => {
    expect(podeAgirEm(sol("Pendente Operacional", false), "aprovacao", CONTRATO)).toBe(true);
    expect(podeAgirEm(sol("Pendente Escritório", true), "aprovacao", CONTRATO)).toBe(false);
    expect(podeAgirEm(sol("Pendente Escritório", true), "aprovacao", ESCRITORIO)).toBe(true);
  });

  it("SST e RH agem no status deles, nas duas origens", () => {
    expect(podeAgirEm(sol("Pendente SST", true), "sst", AMBAS)).toBe(true);
    expect(podeAgirEm(sol("Pendente RH", false), "rh", AMBAS)).toBe(true);
    expect(podeAgirEm(sol("Concluída", false), "rh", AMBAS)).toBe(false);
  });
});

describe("statusVisiveis / statusDeAcao", () => {
  it("todo status de ação da etapa está entre os que ela enxerga", () => {
    for (const etapa of ["analista", "aprovacao", "sst", "rh"] as const) {
      for (const s of statusDeAcao(etapa)) {
        expect(statusVisiveis(etapa)).toContain(s);
      }
    }
  });

  it("a aprovação age nas duas filas de origem", () => {
    expect(statusDeAcao("aprovacao")).toEqual(["Pendente Operacional", "Pendente Escritório"]);
  });

  it("o analista age só na fila dele", () => {
    expect(statusDeAcao("analista")).toEqual(["Pendente Analista"]);
  });

  it("o Operacional VÊ a fila do analista, mas não decide nada nela", () => {
    // É o mesmo desenho da Gestão Recrutamento: quem perdeu a decisão manteve
    // o acompanhamento, para não ficar cego sobre o que vem pela frente.
    expect(statusVisiveis("aprovacao")).toContain("Pendente Analista");
    expect(statusDeAcao("aprovacao")).not.toContain("Pendente Analista");
  });
});

describe("resumoSST", () => {
  it("antes do SST, não inventa", () => {
    expect(resumoSST({ sst_em: null, sst_aso_data: null, sst_aso_dispensado: false })).toBe("—");
  });

  it("dispensado é informação, não ausência dela", () => {
    // Sem isto, quem lê depois não sabe se ninguém marcou ou se foi decidido
    // não marcar.
    expect(resumoSST({ sst_em: "2026-08-25T12:00:00Z", sst_aso_data: null, sst_aso_dispensado: true }))
      .toMatch(/dispensado/i);
  });

  it("marcado mostra a data", () => {
    expect(resumoSST({ sst_em: "2026-08-25T12:00:00Z", sst_aso_data: "2026-09-03", sst_aso_dispensado: false }))
      .toBe("ASO em 03/09/2026");
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
