import { describe, expect, it } from "vitest";
import {
  parteDevConcluida, ROTULO_AGUARDANDO_GESTOR, ROTULO_PARTE_DEV_CONCLUIDA, situacaoDesenvolvimento, statusPainel, STATUS_PAINEL,
} from "@/lib/chamados/prazoDesenvolvimento";
import { aguardandoGestorConcluir, botaoConcluir } from "@/pages/chamados/validacaoPresidencia";

// 17/11/2026, Pablo (SIS-2026-0919 depois do merge da PR #1312): com a parte
// do dev entregue (desenvolvimento_entregue_em), o botão verde "Concluir
// chamado" vira "Parte do desenvolvedor concluída" em cinza para o dev, e os
// selos dizem "Aguardando Gestor de Sistemas" em vez de "Em andamento".

const emDesenvolvimento = {
  status: "em_andamento",
  responsavel_id: "dev",
  desenvolvimento_iniciado_em: "2026-11-16T21:44:00Z",
  desenvolvimento_entregue_em: null as string | null,
};
const depoisDoMerge = { ...emDesenvolvimento, desenvolvimento_entregue_em: "2026-11-17T17:16:00Z" };

describe("parte do desenvolvedor concluída", () => {
  it("é o mesmo sinal da espera pelo gestor", () => {
    expect(parteDevConcluida(depoisDoMerge)).toBe(true);
    expect(aguardandoGestorConcluir(depoisDoMerge)).toBe(true);
    expect(parteDevConcluida(emDesenvolvimento)).toBe(false);
  });
  it("vale também em aguardando retorno", () => {
    expect(parteDevConcluida({ ...depoisDoMerge, status: "aguardando_retorno" })).toBe(true);
  });
  it("encerrado não fica aguardando o gestor", () => {
    for (const status of ["concluido", "cancelado", "reprovado"]) {
      expect(parteDevConcluida({ ...depoisDoMerge, status })).toBe(false);
    }
  });
  it("coluna não lida não acusa entrega", () => {
    expect(parteDevConcluida({ status: "em_andamento" })).toBe(false);
  });
});

describe("selo do andamento", () => {
  it("entregue troca 'Em desenvolvimento' por 'Parte do desenvolvedor concluída'", () => {
    expect(situacaoDesenvolvimento(emDesenvolvimento)).toBe("em_desenvolvimento");
    expect(situacaoDesenvolvimento(depoisDoMerge)).toBe("parte_dev_concluida");
    expect(ROTULO_PARTE_DEV_CONCLUIDA).toBe("Parte do desenvolvedor concluída");
  });
  it("entregue sem ter clicado em Iniciar também conta como entregue", () => {
    expect(situacaoDesenvolvimento({ ...depoisDoMerge, desenvolvimento_iniciado_em: null })).toBe("parte_dev_concluida");
  });
});

describe("Painel do Desenvolvedor", () => {
  it("mostra 'Aguardando Gestor de Sistemas'", () => {
    expect(statusPainel(depoisDoMerge)).toBe("aguardando_gestor");
    expect(STATUS_PAINEL.aguardando_gestor.label).toBe(ROTULO_AGUARDANDO_GESTOR);
    expect(statusPainel(emDesenvolvimento)).toBe("em_desenvolvimento");
  });
  it("concluído pelo gestor volta a ser 'concluido'", () => {
    expect(statusPainel({ ...depoisDoMerge, status: "concluido" })).toBe("concluido");
  });
});

describe("botão Concluir chamado", () => {
  it("antes da entrega: verde para o dev", () => {
    expect(botaoConcluir(emDesenvolvimento, false, "dev")).toBe("concluir");
  });
  it("depois do merge (ou do clique do dev): cinza para o dev, sem clique nenhum", () => {
    expect(botaoConcluir(depoisDoMerge, false, "dev")).toBe("parte_dev_concluida");
  });
  it("outro membro do time que não é gestor também vê cinza", () => {
    expect(botaoConcluir(depoisDoMerge, false, "coordenador")).toBe("parte_dev_concluida");
  });
  it("o Gestor de Sistemas também vê o cinza (o verde Concluir tarefa vem em cima)", () => {
    // 18/11/2026: o gestor também vê o cinza — e o verde "Concluir tarefa"
    // em cima (podeConcluirTarefa, em chamado-fila-gestor-sistemas.test.ts).
    expect(botaoConcluir(depoisDoMerge, true, "iury")).toBe("parte_dev_concluida");
    expect(botaoConcluir(depoisDoMerge, true, "dev")).toBe("parte_dev_concluida");
  });
});
