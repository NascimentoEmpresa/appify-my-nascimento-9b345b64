import { describe, expect, it } from "vitest";
import { podeGerenciarReuniao } from "@/pages/central-servicos/reunioes/permissao";

const reuniao = {
  criado_por: "criador",
  responsavel_preenchimento_user_id: "responsavel",
  organizador_user_id: "organizador",
};

describe("SIS-2026-0470 — acesso admin à Agenda de Reunião", () => {
  it.each(["criador", "responsavel", "organizador"])(
    "mantém o gerenciamento pelos vínculos existentes (%s)",
    (userId) => {
      expect(podeGerenciarReuniao(userId, reuniao, false)).toBe(true);
    },
  );

  it("não libera uma reunião alheia sem a flag administrativa", () => {
    expect(podeGerenciarReuniao("outra-pessoa", reuniao, false)).toBe(false);
  });

  it("libera qualquer reunião quando a flag administrativa está ativa", () => {
    expect(podeGerenciarReuniao("outra-pessoa", reuniao, true)).toBe(true);
  });

  it("não depende de um usuário carregado para reconhecer a flag administrativa", () => {
    expect(podeGerenciarReuniao(undefined, reuniao, true)).toBe(true);
  });
});
