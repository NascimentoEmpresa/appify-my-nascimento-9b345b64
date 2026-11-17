import { describe, expect, it } from "vitest";
import {
  aguardandoGestorSistemas, conclusaoAguardandoConfirmacao, podeConfirmarConclusao, podeFinalizarGestao,
  resumoStatus, seloConclusao,
} from "@/pages/chamados/validacaoPresidencia";

// 17/11/2026 (SIS-2026-0909, PR #1302): abrir a PR concluía o chamado e o
// card de Ações rápidas já dizia "Chamado concluído". Agora só o MERGE conclui,
// e só a etapa do dev (status 'concluido', Edge chamado-concluir-pr). O
// solicitante confirma e o Gestor de Sistemas finaliza, cada um no seu botão.

// Como o chamado fica logo depois do merge: status trocado, as duas colunas
// zeradas pelos gatilhos chamado_sistema_confirmacao / _finalizacao.
const depoisDoMerge = {
  status: "concluido",
  solicitante_id: "solicitante",
  desenvolvimento_iniciado_em: "2026-11-15T10:00:00Z",
  conclusao_confirmada_em: null as string | null,
  gestao_finalizada_em: null as string | null,
};

describe("conclusão pelo merge da PR = só a etapa do dev", () => {
  it("fica aguardando o solicitante, não o gestor", () => {
    expect(conclusaoAguardandoConfirmacao(depoisDoMerge)).toBe(true);
    expect(aguardandoGestorSistemas(depoisDoMerge)).toBe(false);
    expect(resumoStatus(depoisDoMerge, null)).toBe("Aguardando confirmação do solicitante");
  });
  it("o gestor não finaliza antes do solicitante confirmar", () => {
    expect(podeFinalizarGestao(depoisDoMerge, true)).toBe(false);
  });
  it("só o solicitante confirma", () => {
    expect(podeConfirmarConclusao(depoisDoMerge, null, "solicitante")).toBe(true);
    expect(podeConfirmarConclusao(depoisDoMerge, null, "dev")).toBe(false);
  });
  it("depois da confirmação, falta o Gestor de Sistemas", () => {
    const c = { ...depoisDoMerge, conclusao_confirmada_em: "2026-11-17T09:00:00Z" };
    expect(podeFinalizarGestao(c, true)).toBe(true);
    expect(resumoStatus(c, null)).toBe("Aguardando o Gestor de Sistemas");
  });
});

describe("selo do card Ações rápidas", () => {
  it("dev concluiu, faltam as confirmações: Desenvolvimento concluído", () => {
    expect(seloConclusao(depoisDoMerge)).toBe("Desenvolvimento concluído");
    const confirmado = { ...depoisDoMerge, conclusao_confirmada_em: "2026-11-17T09:00:00Z" };
    expect(seloConclusao(confirmado)).toBe("Desenvolvimento concluído");
  });
  it("Chamado concluído só depois do Gestor de Sistemas", () => {
    const finalizado = { ...depoisDoMerge, conclusao_confirmada_em: "2026-11-17T09:00:00Z", gestao_finalizada_em: "2026-11-17T10:00:00Z" };
    expect(seloConclusao(finalizado)).toBe("Chamado concluído");
  });
  it("coluna não lida não dá o chamado por concluído", () => {
    expect(seloConclusao({ status: "concluido" })).toBe("Desenvolvimento concluído");
  });
  it("fora de concluído não tem selo", () => {
    expect(seloConclusao({ status: "em_andamento" })).toBeNull();
  });
});
