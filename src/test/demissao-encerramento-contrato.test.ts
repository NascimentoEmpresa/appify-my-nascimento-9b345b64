// SIS-2026-0854 — desligamento por encerramento do contrato com o cliente
// fica fora do turnover. A regra mora no banco (turnover_desconsidera, mig
// 20261114085400, provada em PGlite); aqui, a parte da tela: a pergunta é
// obrigatória, o que vai gravado, os textos e a nota do painel.
import { describe, expect, it } from "vitest";
import {
  encerramentoParaGravar, erroEncerramentoContrato, textoEncerramentoContrato, type SolicitacaoDemissao,
} from "@/lib/demissao/solicitacao";
import { linhasExcelDemissoes } from "@/lib/demissao/exportarDemissoes";
import { notaForaTurnover } from "@/lib/diretoria/turnover";

describe("pergunta do encerramento de contrato na Solicitar Demissão", () => {
  it("sem resposta não avança — esquecer não vira 'não'", () => {
    expect(erroEncerramentoContrato("")).toMatch(/encerramento do contrato/);
    expect(erroEncerramentoContrato(null)).not.toBeNull();
    expect(erroEncerramentoContrato("talvez")).not.toBeNull();
    expect(erroEncerramentoContrato("sim")).toBeNull();
    expect(erroEncerramentoContrato("nao")).toBeNull();
  });

  it("só o 'sim' grava true", () => {
    expect(encerramentoParaGravar("sim")).toBe(true);
    expect(encerramentoParaGravar("nao")).toBe(false);
    expect(encerramentoParaGravar("")).toBe(false);
  });

  it("texto cita o contrato e diz que sai do turnover", () => {
    expect(textoEncerramentoContrato(true, "1050 - UFRGS - LIMPEZA")).toBe("Sim — contrato 1050 - UFRGS - LIMPEZA encerrado (fora do turnover)");
    expect(textoEncerramentoContrato(true, "")).toContain("do colaborador");
    expect(textoEncerramentoContrato(false, "X")).toBe("Não");
    // Solicitações antigas não têm a coluna preenchida no tipo.
    expect(textoEncerramentoContrato(undefined)).toBe("Não");
  });
});

describe("Excel das demissões", () => {
  it("leva a coluna do encerramento", () => {
    const base = { id: 1, status: "Concluída", contrato: "X" } as SolicitacaoDemissao;
    const [sim, nao] = linhasExcelDemissoes([{ ...base, encerramento_contrato: true }, { ...base, id: 2 }]);
    expect(sim["Encerramento do contrato com o cliente"]).toBe("Sim");
    expect(nao["Encerramento do contrato com o cliente"]).toBe("Não");
  });
});

describe("nota do painel de Turnover", () => {
  it("só aparece quando algum desligamento ficou fora", () => {
    expect(notaForaTurnover(undefined)).toBeNull();
    expect(notaForaTurnover(0)).toBeNull();
    expect(notaForaTurnover(1)).toBe("1 desligamento por encerramento de contrato com o cliente ficou fora da conta.");
    expect(notaForaTurnover(1234)).toBe("1.234 desligamentos por encerramento de contrato com o cliente ficaram fora da conta.");
  });
});
