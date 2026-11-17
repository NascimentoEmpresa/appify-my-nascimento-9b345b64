import { describe, expect, it } from "vitest";
import {
  acaoAoConcluir, aguardandoGestorConcluir, aguardandoGestorSistemas, CONFIRMA_CONCLUIR_PENDENTE_GESTOR, conclusaoAguardandoConfirmacao, resumoStatus,
} from "@/pages/chamados/validacaoPresidencia";
import { montarMensagemResumo } from "../../supabase/functions/_shared/chamado-resumo-pr";

// Revisão da PR #1310 (17/11/2026): o merge da PR NÃO conclui o chamado. Ele
// entrega o desenvolvimento ao Gestor de Sistemas (desenvolvimento_entregue_em,
// mig 20261117235500) e é o gestor quem conclui — o momento em que o
// solicitante vê "concluído". Antes a PR concluía sozinha (SIS-2026-0909).

// Como o chamado fica logo depois do merge: status inalterado, entrega marcada.
const depoisDoMerge = {
  status: "em_andamento",
  desenvolvimento_iniciado_em: "2026-11-15T10:00:00Z",
  desenvolvimento_entregue_em: "2026-11-17T18:00:00Z" as string | null,
  conclusao_confirmada_em: null as string | null,
  gestao_finalizada_em: null as string | null,
};

describe("merge da PR entrega ao Gestor de Sistemas", () => {
  it("fica aguardando o gestor concluir, sem estar concluído", () => {
    expect(aguardandoGestorConcluir(depoisDoMerge)).toBe(true);
    expect(resumoStatus(depoisDoMerge, null)).toBe("Pendente de conclusão do Gestor de Sistemas");
  });
  it("não cobra nada do solicitante nem pede a finalização", () => {
    expect(conclusaoAguardandoConfirmacao(depoisDoMerge)).toBe(false);
    expect(aguardandoGestorSistemas(depoisDoMerge)).toBe(false);
  });
  it("o gestor concluiu: sai da espera e vai para o solicitante confirmar", () => {
    // O gatilho zera a entrega na troca de status; aqui vale o status mesmo sem zerar.
    const c = { ...depoisDoMerge, status: "concluido" };
    expect(aguardandoGestorConcluir(c)).toBe(false);
    expect(conclusaoAguardandoConfirmacao(c)).toBe(true);
    expect(resumoStatus(c, null)).toBe("Aguardando confirmação do solicitante");
  });
  it("sem merge, segue o fluxo de sempre", () => {
    const c = { ...depoisDoMerge, desenvolvimento_entregue_em: null };
    expect(aguardandoGestorConcluir(c)).toBe(false);
    expect(resumoStatus(c, null)).toBe("Em desenvolvimento");
  });
  it("coluna não lida não acusa entrega", () => {
    expect(aguardandoGestorConcluir({ status: "em_andamento" })).toBe(false);
  });
  it("cancelado ou reprovado não espera o gestor", () => {
    expect(aguardandoGestorConcluir({ ...depoisDoMerge, status: "cancelado" })).toBe(false);
    expect(aguardandoGestorConcluir({ ...depoisDoMerge, status: "reprovado" })).toBe(false);
  });
});

describe("botão Concluir chamado (17/11/2026)", () => {
  const naoEntregue = { responsavel_id: "dev", desenvolvimento_entregue_em: null };
  const entregue = { responsavel_id: "dev", desenvolvimento_entregue_em: "2026-11-17T18:00:00Z" };
  it("o responsável conclui = entrega ao gestor (fica pendente)", () => {
    expect(acaoAoConcluir(naoEntregue, false, "dev")).toBe("entregar");
  });
  it("o responsável que também é Gestor de Sistemas entrega primeiro", () => {
    expect(acaoAoConcluir(naoEntregue, true, "dev")).toBe("entregar");
  });
  it("o Gestor de Sistemas conclui direto", () => {
    expect(acaoAoConcluir(naoEntregue, true, "iury")).toBe("concluir");
    expect(acaoAoConcluir(entregue, true, "iury")).toBe("concluir");
    expect(acaoAoConcluir(entregue, true, "dev")).toBe("concluir");
  });
  it("pendente do gestor: quem não é gestor conclui só confirmando", () => {
    expect(acaoAoConcluir(entregue, false, "dev")).toBe("concluir_confirmando");
    expect(CONFIRMA_CONCLUIR_PENDENTE_GESTOR).toContain("pendente de conclusão do Gestor de Sistemas");
  });
});

describe("resumo da I.A no chat, no merge", () => {
  it("avisa que o gestor ainda conclui antes de o solicitante confirmar", () => {
    const msg = montarMensagemResumo("Tela X ganhou o filtro Y.", []);
    expect(msg).toContain("Gestor de Sistemas vai conferir a entrega e concluir o chamado");
    expect(msg).toContain("Confirmar conclusão");
  });
});
