import { describe, expect, it } from "vitest";
import {
  acessoModuloPendente, CATEGORIAS_EXIGEM_ACESSO, exigeAcessoModulo, normalizarPessoasAcesso, pessoasDosIds,
} from "@/lib/chamados/acessoModulo";
import { CATEGORIAS } from "@/pages/chamados/types";
import { formularioBaseadoEm, type ChamadoBase } from "@/lib/chamados/vinculos";

// SIS-2026-0934 — "Quais pessoas devem ter acesso ao módulo?"
describe("acesso ao módulo na abertura do chamado", () => {
  it("as categorias que exigem a lista existem no formulário", () => {
    const valores = CATEGORIAS.map((c) => c.value as string);
    CATEGORIAS_EXIGEM_ACESSO.forEach((c) => expect(valores).toContain(c));
  });

  it("é obrigatório só com Novo módulo / tela ou Acesso / Permissão", () => {
    expect(exigeAcessoModulo(["novo_modulo"])).toBe(true);
    expect(exigeAcessoModulo(["correcao_erro", "acesso_permissao"])).toBe(true);
    expect(exigeAcessoModulo(["correcao_erro", "power_bi"])).toBe(false);
    expect(exigeAcessoModulo([])).toBe(false);
    expect(exigeAcessoModulo(null)).toBe(false);
  });

  it("pendente = obrigatório e sem ninguém", () => {
    expect(acessoModuloPendente(["novo_modulo"], [])).toBe(true);
    expect(acessoModuloPendente(["novo_modulo"], [{ id: " ", nome: "x" }])).toBe(true);
    expect(acessoModuloPendente(["novo_modulo"], [{ id: "u1", nome: "Ana" }])).toBe(false);
    expect(acessoModuloPendente(["outros"], [])).toBe(false);
  });

  it("normaliza: sem id vazio, sem repetidos, na ordem de escolha", () => {
    expect(normalizarPessoasAcesso([
      { id: "u2", nome: " Bia " }, { id: "u1", nome: "Ana" }, { id: "u2", nome: "Bia de novo" }, { id: "", nome: "?" }, null,
    ])).toEqual([{ id: "u2", nome: "Bia" }, { id: "u1", nome: "Ana" }]);
    expect(normalizarPessoasAcesso(null)).toEqual([]);
  });

  it("ids do seletor viram {id, nome} com o nome da lista de usuários", () => {
    const usuarios = [{ id: "u1", display_name: "Ana" }, { id: "u2", display_name: "Bia" }];
    expect(pessoasDosIds(["u2", "u1", "u3"], usuarios)).toEqual([
      { id: "u2", nome: "Bia" }, { id: "u1", nome: "Ana" }, { id: "u3", nome: "" },
    ]);
  });

  it("o \"baseado nesse\" leva as pessoas para a parte nova", () => {
    const base: ChamadoBase = {
      id: "c1", numero: "SIS-2026-0001", assunto: "Tela nova", categorias: ["novo_modulo"], tipo_solicitacao: "melhoria",
      prioridade: "media", descricao: "d", observacoes_solicitante: null, impacto_trabalho: "nao_impacta", urgencia: "ate_5d",
      modulo_sistema: "outro", modulo_sistema_outro: "X", ambiente: "producao", afeta_usuarios: null,
      acesso_modulo_usuarios: [{ id: "u1", nome: "Ana" }, { id: "u1", nome: "Ana" }],
    };
    expect(formularioBaseadoEm(base, 2, "2026-11-17").acessoUsuarios).toEqual([{ id: "u1", nome: "Ana" }]);
    expect(formularioBaseadoEm({ ...base, acesso_modulo_usuarios: undefined }, 2, "2026-11-17").acessoUsuarios).toEqual([]);
  });
});
