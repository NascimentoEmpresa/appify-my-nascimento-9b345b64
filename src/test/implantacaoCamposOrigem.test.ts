import { describe, it, expect } from "vitest";
import {
  CAMPOS_ORIGEM,
  ROW_INDEX_NO_TOPO,
  formatarData,
  formatarInteiro,
  formatarMoeda,
  semDado,
  valorFormatado,
  type OrigemContrato,
} from "@/lib/implantacao/camposOrigem";

/**
 * Campos do checklist que vêm prontos da Capa de Edital, Grade de Licitações
 * e Planilha de Custo.
 *
 * O vínculo é o `row_index` de `checklist_items`. Se a planilha do checklist for
 * reimportada e os índices andarem, o painel do topo passaria a gravar a
 * resposta no item errado calado — por isso o teste de integridade no fim,
 * contra o texto real dos itens lido do banco em 30/09/2026.
 */
const ITENS_NO_BANCO: Record<number, string> = {
  3: "Locais de cada posto de trabalho (Endereço)",
  4: "Escala de horário de postos",
  25: "Prazo envio treinamentos",
  27: "EPIs especificados",
  28: "Insalubridade/periculosidade",
  31: "Data de início do contrato",
  48: "Data da homologação",
  49: "Data de abertura",
  50: "Data captação",
  51: "EDITAL",
  52: "Horário",
  53: "Cidade",
  54: "Objeto",
  55: "Empresa",
  56: "Responsável",
  57: "Posição",
  58: "UF",
  59: "Status",
  60: "Fase",
  61: "Valor global",
  62: "Nº pessoas (Quantidade de postos)",
};

const ORIGEM_COMPLETA: OrigemContrato = {
  locais_postos: "PORTO ALEGRE: Rua Exemplo, 100",
  escalas_postos: "SERVENTE 44H 5X2",
  prazo_envio_treinamentos: "2026-02-15",
  epis_especificados: "Luva nitrílica e óculos de proteção",
  insalubridade_periculosidade: "SERVENTE: Insalubridade R$ 320,00",
  data_inicio: "2026-01-31",
  data_homologacao: "2026-01-20",
  abertura: "2026-01-28 08H30",
  data_captacao: "2026-01-10",
  edital: "PE 19/2024",
  horario: "08H30",
  cidade: "BENTO GONÇALVES",
  objeto: "SERVIÇOS DE LIMPEZA (NOSSO)",
  empresa: "NASCIMENTO SERVICOS DE LIMPEZA LTDA",
  responsavel: "Lucas de Jesus Silva",
  posicao: "1º",
  uf: "RS",
  status: "Ganhamos",
  fase: "Finalizada",
  valor_global: "3989986.56",
  qtd_postos: 72,
};

describe("semDado", () => {
  it("trata null, undefined e string vazia como sem dado", () => {
    expect(semDado(null)).toBe(true);
    expect(semDado(undefined)).toBe(true);
    expect(semDado("")).toBe(true);
    expect(semDado("   ")).toBe(true);
  });

  it("trata 0 como sem dado — capa não preenchida, não contrato com zero postos", () => {
    expect(semDado(0)).toBe(true);
    expect(semDado(72)).toBe(false);
  });

  it("aceita texto com conteúdo", () => {
    expect(semDado("RS")).toBe(false);
  });
});

describe("formatarMoeda", () => {
  it("formata o TEXT do banco como real", () => {
    // O Intl usa um espaço não separável entre R$ e o número.
    expect(formatarMoeda("3989986.56")).toBe("R$\u00a03.989.986,56");
    expect(formatarMoeda("1265688.12")).toBe("R$\u00a01.265.688,12");
  });

  it("devolve vazio quando não há valor", () => {
    expect(formatarMoeda(null)).toBe("");
    expect(formatarMoeda("")).toBe("");
  });

  it("devolve o texto original em vez de R$ NaN quando a coluna tem lixo", () => {
    // valor_estimado é TEXT, então pode conter qualquer coisa
    expect(formatarMoeda("a combinar")).toBe("a combinar");
  });
});

describe("formatarData", () => {
  it("converte date puro para dd/mm/aaaa", () => {
    expect(formatarData("2026-01-31")).toBe("31/01/2026");
  });

  it("descarta a hora de máquina do timestamptz", () => {
    expect(formatarData("2026-07-06T00:00:00+00:00")).toBe("06/07/2026");
  });

  it("preserva a hora escrita à mão em `abertura`, que é TEXT livre", () => {
    expect(formatarData("2026-01-28 08H30")).toBe("28/01/2026 08H30");
    expect(formatarData("2026-01-14 09h")).toBe("14/01/2026 09h");
  });

  it("não inventa data quando o texto não é ISO", () => {
    expect(formatarData("a definir")).toBe("a definir");
    expect(formatarData("31/01/2026")).toBe("31/01/2026");
  });

  it("devolve vazio quando não há data", () => {
    expect(formatarData(null)).toBe("");
  });
});

describe("formatarInteiro", () => {
  it("formata a quantidade de postos", () => {
    expect(formatarInteiro(72)).toBe("72");
  });

  it("devolve vazio para 0 e null", () => {
    expect(formatarInteiro(0)).toBe("");
    expect(formatarInteiro(null)).toBe("");
  });
});

describe("valorFormatado", () => {
  it("resolve os 21 campos de um contrato com todas as origens completas", () => {
    const valores = CAMPOS_ORIGEM.map((c) => valorFormatado(c, ORIGEM_COMPLETA));
    expect(valores.every((v) => v !== "")).toBe(true);
  });

  it("devolve vazio nos campos que a origem não tem", () => {
    // contrato "PORTO ALEGRE — Interprete de Libras": uf e data_inicio nulos
    const parcial: OrigemContrato = { ...ORIGEM_COMPLETA, uf: null, data_inicio: null };
    const uf = CAMPOS_ORIGEM.find((c) => c.chave === "uf")!;
    const inicio = CAMPOS_ORIGEM.find((c) => c.chave === "data_inicio")!;
    expect(valorFormatado(uf, parcial)).toBe("");
    expect(valorFormatado(inicio, parcial)).toBe("");
    // e os demais continuam resolvendo
    expect(valorFormatado(CAMPOS_ORIGEM.find((c) => c.chave === "edital")!, parcial)).toBe("PE 19/2024");
  });

  it("devolve vazio quando o RPC não trouxe linha (sem capa vinculada)", () => {
    expect(CAMPOS_ORIGEM.every((c) => valorFormatado(c, null) === "")).toBe(true);
  });
});

describe("integridade do mapa de campos", () => {
  it("cobre os 11 campos anteriores e os 10 da nova planilha", () => {
    expect(CAMPOS_ORIGEM).toHaveLength(21);
    expect(ROW_INDEX_NO_TOPO.size).toBe(21);
  });

  it("cada row_index aponta pro item que o banco tem nesse índice", () => {
    for (const campo of CAMPOS_ORIGEM) {
      expect(ITENS_NO_BANCO[campo.rowIndex]).toBe(campo.rotulo);
    }
  });

  it("não repete row_index nem coluna da origem", () => {
    expect(new Set(CAMPOS_ORIGEM.map((c) => c.rowIndex)).size).toBe(CAMPOS_ORIGEM.length);
    expect(new Set(CAMPOS_ORIGEM.map((c) => c.chave)).size).toBe(CAMPOS_ORIGEM.length);
  });

  it("distribui os campos pelas três fontes corretas", () => {
    const daGrade = CAMPOS_ORIGEM.filter((c) => c.fonte === "grade").map((c) => c.chave);
    expect(daGrade.sort()).toEqual(["cidade", "data_captacao", "edital", "fase", "horario", "posicao"]);
    expect(CAMPOS_ORIGEM.filter((c) => c.fonte === "capa")).toHaveLength(12);
    expect(CAMPOS_ORIGEM.filter((c) => c.fonte === "planilha").map((c) => c.chave).sort())
      .toEqual(["escalas_postos", "insalubridade_periculosidade", "locais_postos"]);
  });
});
