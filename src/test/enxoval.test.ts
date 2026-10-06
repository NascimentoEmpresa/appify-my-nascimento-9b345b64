import { describe, expect, it } from "vitest";
import { decidirInclusaoEnxoval } from "@/lib/suprimentos/enxoval";

const vinculoAtivo = { id: "vinculo-1", ativo: true };
const vinculoInativo = { id: "vinculo-1", ativo: false };

describe("inclusão no enxoval", () => {
  it("insere quando ainda não existe vínculo", () => {
    expect(decidirInclusaoEnxoval(null, [])).toBe("inserir");
  });

  it("informa que já existe quando o vínculo está ativo", () => {
    expect(decidirInclusaoEnxoval(vinculoAtivo, [])).toBe("ja_existe");
  });

  it("desfaz a remoção que ainda está em rascunho", () => {
    expect(decidirInclusaoEnxoval(vinculoInativo, [{ tipo_acao: "excluir", status: "RASCUNHO" }]))
      .toBe("desfazer_rascunho");
  });

  it("desfaz a remoção já enviada para aprovação", () => {
    expect(decidirInclusaoEnxoval(vinculoInativo, [{ tipo_acao: "excluir", status: "PENDENTE" }]))
      .toBe("desfazer_pendente");
  });

  it("reativa vínculo inativo sem remoção em aberto", () => {
    expect(decidirInclusaoEnxoval(vinculoInativo, [])).toBe("reativar_orfao");
  });

  it("prioriza o rascunho quando há remoção em rascunho e pendente", () => {
    expect(decidirInclusaoEnxoval(vinculoInativo, [
      { tipo_acao: "excluir", status: "PENDENTE" },
      { tipo_acao: "excluir", status: "RASCUNHO" },
    ])).toBe("desfazer_rascunho");
  });

  it("ignora alterações que não representam remoção em aberto", () => {
    expect(decidirInclusaoEnxoval(vinculoInativo, [
      { tipo_acao: "criar", status: "PENDENTE" },
      { tipo_acao: "excluir", status: "APROVADO" },
      { tipo_acao: "excluir", status: "REPROVADO" },
    ])).toBe("reativar_orfao");
  });

  it("mantém a prioridade do vínculo ativo sobre qualquer rascunho", () => {
    expect(decidirInclusaoEnxoval(vinculoAtivo, [{ tipo_acao: "excluir", status: "RASCUNHO" }]))
      .toBe("ja_existe");
  });
});
