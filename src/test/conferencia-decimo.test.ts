import { describe, it, expect } from "vitest";
import {
  ETAPA_RH, MENU, MENU_DA_ACAO, MODULO_DA_ACAO, STATUS_TODOS,
  acharCabecalho, codigoDaCelula, competenciaPadrao, contaAvanco, corDoStatus, etapaDoStatus,
  explicaStatus, lerPlanilhaDecimo, normalizaCabecalho, numeroDaCelula, ordemDoStatus,
  podeAgir, prazoDaParcela, proximoStatus,
  type Acao, type StatusDecimo,
} from "@/lib/conferenciaDecimo/conferencia";

// Conferência de 13º: clone do ponto SEM Operacional e SEM encarregados. As
// mesmas regras moram na RPC decimo_agir (mig 20261112220000) — estes testes
// descrevem as duas.

const com = (...menus: string[]) => (m: string) => menus.includes(m);
const tudo = () => true;
const ninguem = () => false;
const TODAS: Acao[] = ["andamento", "confirmar", "reabrir", "informar_valor", "liberar", "marcar_pago", "devolver_rh", "problema"];

describe("fluxo — só RH e Financeiro", () => {
  it("caminho feliz: Pendente RH → conferido → liberado → pago", () => {
    expect(proximoStatus("Pendente RH", "andamento")).toBe("Em Conferência RH");
    expect(proximoStatus("Em Conferência RH", "confirmar")).toBe("Conferido RH");
    expect(proximoStatus("Conferido RH", "liberar")).toBe("Liberado Financeiro");
    expect(proximoStatus("Liberado Financeiro", "marcar_pago")).toBe("Pago");
  });

  it("não existe nada de Operacional nem encarregado", () => {
    for (const s of STATUS_TODOS) expect(s).not.toMatch(/Operacional|Encarregad/);
    expect(Object.values(MENU)).not.toContain("ponto_aprovar_contrato");
    expect(new Set(Object.values(MODULO_DA_ACAO))).toEqual(new Set(["rh", "financeiro"]));
  });

  it("não libera sem confirmar a conferência", () => {
    expect(proximoStatus("Pendente RH", "liberar")).toBeNull();
    expect(proximoStatus("Em Conferência RH", "liberar")).toBeNull();
    expect(proximoStatus("Devolvido RH", "liberar")).toBeNull();
  });

  it("não paga o que não foi liberado", () => {
    for (const s of ETAPA_RH) expect(proximoStatus(s, "marcar_pago")).toBeNull();
  });

  it("pago é o fim da linha", () => {
    for (const a of TODAS) expect(proximoStatus("Pago", a)).toBeNull();
  });

  it("informar valor não mexe no status e só vale com o RH", () => {
    for (const s of ETAPA_RH) expect(proximoStatus(s, "informar_valor")).toBe(s);
    expect(proximoStatus("Liberado Financeiro", "informar_valor")).toBeNull();
    expect(proximoStatus("Problema", "informar_valor")).toBeNull();
  });

  it("devolvido volta a ser trabalho do RH; problema continua com o Financeiro", () => {
    expect(proximoStatus("Liberado Financeiro", "devolver_rh")).toBe("Devolvido RH");
    expect(proximoStatus("Devolvido RH", "confirmar")).toBe("Conferido RH");
    expect(proximoStatus("Liberado Financeiro", "problema")).toBe("Problema");
    expect(proximoStatus("Problema", "marcar_pago")).toBe("Pago");
    expect(proximoStatus("Problema", "devolver_rh")).toBe("Devolvido RH");
    expect(etapaDoStatus("Problema")).toBe("financeiro");
    expect(etapaDoStatus("Devolvido RH")).toBe("rh");
  });

  it("reabrir desfaz o conferido, antes de liberar", () => {
    expect(proximoStatus("Conferido RH", "reabrir")).toBe("Em Conferência RH");
    expect(proximoStatus("Liberado Financeiro", "reabrir")).toBeNull();
  });
});

describe("podeAgir — chave + módulo + status", () => {
  it("sem chave nenhuma, nada passa", () => {
    for (const s of STATUS_TODOS) for (const a of TODAS) {
      expect(podeAgir(s, a, ninguem, "rh")).toBe(false);
      expect(podeAgir(s, a, ninguem, "financeiro")).toBe(false);
    }
  });

  it("cada ação tem a sua chave", () => {
    expect(podeAgir("Pendente RH", "confirmar", com(MENU.valor), "rh")).toBe(false);
    expect(podeAgir("Pendente RH", "confirmar", com(MENU.confirmar), "rh")).toBe(true);
    expect(podeAgir("Conferido RH", "liberar", com(MENU.confirmar), "rh")).toBe(false);
    expect(podeAgir("Conferido RH", "liberar", com(MENU.valor), "rh")).toBe(true);
    expect(podeAgir("Liberado Financeiro", "marcar_pago", com(MENU.pagar), "financeiro")).toBe(true);
  });

  it("quem tem todas as chaves vê em cada tela só o passo daquele setor", () => {
    expect(podeAgir("Liberado Financeiro", "marcar_pago", tudo, "rh")).toBe(false);
    expect(podeAgir("Pendente RH", "confirmar", tudo, "financeiro")).toBe(false);
    expect(podeAgir("Liberado Financeiro", "devolver_rh", tudo, "financeiro")).toBe(true);
  });

  it("devolver é poder de quem paga", () => {
    expect(MENU_DA_ACAO.devolver_rh).toBe(MENU.pagar);
    expect(MENU_DA_ACAO.problema).toBe(MENU.pagar);
  });
});

describe("avanço, aparência e ordem", () => {
  it("o RH conta o que já saiu dele; o Financeiro, o que foi pago", () => {
    const s: StatusDecimo[] = ["Pendente RH", "Conferido RH", "Liberado Financeiro", "Problema", "Pago"];
    expect(contaAvanco(s)).toEqual({ rh: 3, financeiro: 1, total: 5 });
  });

  it("todo status tem cor e explicação próprias", () => {
    for (const s of STATUS_TODOS) {
      expect(corDoStatus(s)).not.toBe("bg-blue-100 text-blue-700 border-blue-200");
      expect(explicaStatus(s)).not.toBe("");
      expect(ordemDoStatus(s)).toBeLessThan(99);
    }
    expect(ordemDoStatus("Problema")).toBeLessThan(ordemDoStatus("Pendente RH"));
    expect(ordemDoStatus("Pago")).toBeGreaterThan(ordemDoStatus("Liberado Financeiro"));
  });
});

describe("competência e prazo legal", () => {
  it("até novembro é a 1ª parcela; dezembro, a 2ª; janeiro fecha o ano anterior", () => {
    expect(competenciaPadrao(new Date(2026, 10, 12))).toEqual({ ano: 2026, parcela: 1 });
    expect(competenciaPadrao(new Date(2026, 11, 5))).toEqual({ ano: 2026, parcela: 2 });
    expect(competenciaPadrao(new Date(2027, 0, 10))).toEqual({ ano: 2026, parcela: 2 });
  });

  it("1ª até 30/11 e 2ª até 20/12, antecipando fim de semana", () => {
    // 30/11/2026 é segunda; 20/12/2026 é domingo → sexta 18/12.
    expect(prazoDaParcela(2026, 1).toDateString()).toBe(new Date(2026, 10, 30).toDateString());
    expect(prazoDaParcela(2026, 2).toDateString()).toBe(new Date(2026, 11, 18).toDateString());
    // 30/11/2025 é domingo → sexta 28/11.
    expect(prazoDaParcela(2025, 1).toDateString()).toBe(new Date(2025, 10, 28).toDateString());
    expect(prazoDaParcela(2026, 1).getHours()).toBe(17);
  });
});

describe("planilha da Senior", () => {
  const contratos = [
    { empresa: 1, filial: 10, nome: "PREFEITURA A" },
    { empresa: 1, filial: 20, nome: "HOSPITAL B" },
    { empresa: 2, filial: 20, nome: "ESCOLA C" },
  ];

  it("lê número em formato BR, do Excel e com R$", () => {
    expect(numeroDaCelula(1234.5)).toBe(1234.5);
    expect(numeroDaCelula("1.234,56")).toBe(1234.56);
    expect(numeroDaCelula("R$ 1.234,56")).toBe(1234.56);
    expect(numeroDaCelula("1234.56")).toBe(1234.56);
    expect(numeroDaCelula("1.234")).toBe(1234);
    expect(numeroDaCelula("(10,00)")).toBe(-10);
    expect(numeroDaCelula("")).toBeNull();
    expect(numeroDaCelula("abc")).toBeNull();
  });

  it("lê o código da filial mesmo com o nome colado", () => {
    expect(codigoDaCelula(10)).toBe(10);
    expect(codigoDaCelula("10 - PREFEITURA A")).toBe(10);
    expect(codigoDaCelula("PREFEITURA")).toBeNull();
    expect(codigoDaCelula(10.5)).toBeNull();
  });

  it("normaliza cabeçalho com acento e º", () => {
    expect(normalizaCabecalho("Valor Líquido 13º")).toBe("valor liquido 13o");
  });

  it("acha o cabeçalho depois do título e prefere o líquido", () => {
    const l = [
      ["Relatório de 13º Salário"], [],
      ["Empresa", "Filial", "Colaborador", "Valor Bruto", "Valor Líquido"],
    ];
    const c = acharCabecalho(l)!;
    expect(c.linhaCabecalho).toBe(2);
    expect(c.colEmpresa).toBe(0);
    expect(c.colFilial).toBe(1);
    expect(c.candidatasValor[0]).toBe(4);
    expect(c.candidatasValor).toContain(3);
  });

  it("sem coluna de filial não é a tabela", () => {
    expect(acharCabecalho([["Nome", "Valor"]])).toBeNull();
  });

  it("soma por contrato a planilha por colaborador e conta as pessoas", () => {
    const l = [
      ["Empresa", "Filial", "Nome", "Valor"],
      [1, 10, "ANA", "1.000,00"],
      [1, 10, "BIA", 500.255],
      [1, 20, "CAIO", 800],
      [2, 20, "DUDA", 700],
      [9, 99, "EDU", 50],
      [1, 10, "ZERO", 0],
      [null, null, "Total", 3000],
    ];
    const c = acharCabecalho(l)!;
    const r = lerPlanilhaDecimo(l, c, 3, contratos);
    expect(r.porContrato).toEqual([
      { empresa: 2, filial: 20, nome: "ESCOLA C", valor: 700, qtd: 1 },
      { empresa: 1, filial: 20, nome: "HOSPITAL B", valor: 800, qtd: 1 },
      { empresa: 1, filial: 10, nome: "PREFEITURA A", valor: 1500.26, qtd: 2 },
    ]);
    expect(r.semContrato).toEqual([{ empresa: 9, filial: 99, valor: 50 }]);
    expect(r.total).toBe(3000.26);
    expect(r.linhasIgnoradas).toBe(2);
  });

  it("planilha já resumida sem qtd não inventa quantidade", () => {
    const l = [["Filial", "Total 13º"], [10, 1500]];
    const r = lerPlanilhaDecimo(l, acharCabecalho(l)!, 1, contratos);
    expect(r.porContrato).toEqual([{ empresa: 1, filial: 10, nome: "PREFEITURA A", valor: 1500, qtd: null }]);
  });

  it("usa a coluna de quantidade quando existe", () => {
    const l = [["Filial", "Qtd Colaboradores", "Valor"], [10, 12, 1500]];
    const r = lerPlanilhaDecimo(l, acharCabecalho(l)!, 2, contratos);
    expect(r.porContrato[0].qtd).toBe(12);
  });

  it("filial sem empresa que existe em duas empresas fica de fora", () => {
    const l = [["Filial", "Valor"], [20, 100], [10, 200]];
    const r = lerPlanilhaDecimo(l, acharCabecalho(l)!, 1, contratos);
    expect(r.ambiguas).toEqual([{ filial: 20, valor: 100 }]);
    expect(r.porContrato.map(c => c.filial)).toEqual([10]);
  });
});
