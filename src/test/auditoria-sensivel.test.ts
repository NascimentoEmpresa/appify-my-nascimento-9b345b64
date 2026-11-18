import { describe, expect, it } from "vitest";
import {
  descreverItemPermissao,
  eventosParaCsv,
  formatarDataHora,
  formatarValor,
  fraseEvento,
  linhasDetalhe,
  listarCamposAlterados,
  mudancaPermissao,
  periodoDoPreset,
  rotuloAcao,
  seloEvento,
  type EventoAuditoria,
} from "@/lib/auditoriaSensivel";

const PABLO = "11111111-1111-1111-1111-111111111111";
const HELENA = "22222222-2222-2222-2222-222222222222";

function ev(parcial: Partial<EventoAuditoria>): EventoAuditoria {
  return {
    id: "aud:1", ts: "2026-11-18T12:01:25Z", tipo: "permissao", evento: "x",
    ator_id: PABLO, ator_nome: "Pablo", alvo_id: HELENA, alvo_nome: "Helena",
    detalhes: {}, bruto: null, ...parcial,
  };
}

const ferias = { menu: "rh_ferias", menu_nome: "Férias", modulo_nome: "Recursos Humanos" };

describe("auditoria sensível — permissões", () => {
  it("classifica a mudança pelo antes/depois", () => {
    expect(mudancaPermissao({ antes: null, depois: true })).toBe("deu");
    expect(mudancaPermissao({ antes: false, depois: true })).toBe("deu");
    expect(mudancaPermissao({ antes: true, depois: null })).toBe("tirou");
    expect(mudancaPermissao({ antes: true, depois: false })).toBe("tirou");
    expect(mudancaPermissao({ antes: null, depois: false })).toBe("bloqueou");
    expect(mudancaPermissao({ antes: false, depois: null })).toBe("ajustou");
  });

  it("uma permissão só: diz qual, em qual tela e módulo, e para quem", () => {
    const e = ev({ evento: "permissoes_usuario", detalhes: { itens: [{ ...ferias, acao: "criar", antes: null, depois: true }] } });
    expect(fraseEvento(e)).toBe('Pablo deu a permissão "criar" em Férias (Recursos Humanos) para Helena');
    const t = ev({ evento: "permissoes_usuario", detalhes: { itens: [{ ...ferias, acao: "visualizar", antes: true, depois: null }] } });
    expect(fraseEvento(t)).toBe('Pablo tirou a permissão "ver" em Férias (Recursos Humanos) de Helena');
  });

  it("várias permissões: conta dadas e tiradas, e detalha item a item", () => {
    const e = ev({
      evento: "permissoes_usuario",
      detalhes: { itens: [
        { ...ferias, acao: "visualizar", antes: null, depois: true },
        { ...ferias, acao: "criar", antes: null, depois: true },
        { menu: "rh_ponto", acao: "alterar", antes: true, depois: null },
      ] },
    });
    expect(fraseEvento(e)).toBe("Pablo deu 2 permissões e tirou 1 permissão de Helena");
    expect(linhasDetalhe(e)).toEqual([
      "Deu Férias (Recursos Humanos) · ver",
      "Deu Férias (Recursos Humanos) · criar",
      "Tirou rh_ponto · alterar",
    ]);
  });

  it("descreve item sem nome de tela pelo código", () => {
    expect(descreverItemPermissao({ menu: "x_tela", acao: "enviar_malote", antes: null, depois: false }))
      .toBe("Bloqueou x_tela · enviar malote");
  });

  it("rótulo de ação desconhecida vira texto legível", () => {
    expect(rotuloAcao("visualizar")).toBe("ver");
    expect(rotuloAcao("acao_nova_qualquer")).toBe("acao nova qualquer");
  });

  it("perfil, papel e Novos Módulos", () => {
    expect(fraseEvento(ev({ evento: "perfil_concedido", detalhes: { perfil_nome: "Gestor RH" } })))
      .toBe('Pablo deu o perfil de acesso "Gestor RH" para Helena');
    expect(fraseEvento(ev({ evento: "papel_removido", detalhes: { papel: "admin" } })))
      .toBe('Pablo tirou o papel "admin" de Helena');
    expect(fraseEvento(ev({ evento: "modulo_liberado", alvo_id: null, alvo_nome: null,
      detalhes: { menu: "rh_ferias", menu_nome: "Férias", modulo_nome: "Recursos Humanos", adicionados: 3 } })))
      .toBe('Pablo liberou a tela nova "Férias (Recursos Humanos)" para 3 pessoas');
  });
});

describe("auditoria sensível — quem fez", () => {
  it("sem usuário é o Sistema", () => {
    const e = ev({ evento: "usuario_criado", tipo: "cadastro", ator_id: null, ator_nome: null, detalhes: { email: "h@x" } });
    expect(fraseEvento(e)).toBe("Sistema criou o login de Helena (h@x)");
    expect(eventosParaCsv([e])).toContain(";Sistema;");
  });

  it("alteração no próprio cadastro", () => {
    const e = ev({ evento: "cadastro_alterado", tipo: "cadastro", ator_id: HELENA, ator_nome: "Helena" });
    expect(fraseEvento(e)).toBe("Helena alterou o próprio cadastro");
  });

  it("logins e entradas", () => {
    expect(fraseEvento(ev({ evento: "conta_desativada", tipo: "login" }))).toBe("Pablo desativou a conta de Helena");
    expect(fraseEvento(ev({ evento: "login_vinculado", tipo: "login", detalhes: { empregado_nome: "HELENA SILVA", empregado_id: "10" } })))
      .toBe("Pablo vinculou o login de Helena ao empregado HELENA SILVA");
    const entrada = ev({ evento: "entrou", tipo: "login", ator_id: HELENA, ator_nome: "Helena", detalhes: { ip: "1.2.3.4", metodo: "email" } });
    expect(fraseEvento(entrada)).toBe("Helena entrou no sistema");
    expect(linhasDetalhe(entrada)).toEqual(["IP: 1.2.3.4", "Método: e-mail e senha"]);
    expect(seloEvento(entrada).texto).toBe("Entrada");
  });
});

describe("auditoria sensível — campos antes → depois", () => {
  it("traduz o nome do campo e o valor, e ordena por rótulo", () => {
    const campos = listarCamposAlterados({
      ativo: { antes: true, depois: false },
      cargo: { antes: null, depois: "ENCARREGADO ADMINISTRATIVO" },
    });
    expect(campos).toEqual([
      { campo: "cargo", rotulo: "Cargo", antes: "(vazio)", depois: "ENCARREGADO ADMINISTRATIVO" },
      { campo: "ativo", rotulo: "Conta ativa", antes: "Sim", depois: "Não" },
    ]);
    expect(linhasDetalhe(ev({ evento: "conta_desativada", detalhes: { campos: { ativo: { antes: true, depois: false } } } })))
      .toEqual(["Conta ativa: Sim → Não"]);
  });

  it("valores", () => {
    expect(formatarValor(null)).toBe("(vazio)");
    expect(formatarValor("x".repeat(200))).toHaveLength(118);
    expect(formatarValor("https://x/foto.png", "avatar_url")).toBe("foto definida");
    expect(formatarValor({ a: 1 })).toBe('{"a":1}');
  });

  it("sem mudança real não vira linha", () => {
    expect(listarCamposAlterados({ x: { antes: "", depois: null } })).toEqual([]);
    expect(listarCamposAlterados(null)).toEqual([]);
  });
});

describe("auditoria sensível — data e período em Brasília", () => {
  it("formata no fuso de Brasília", () => {
    expect(formatarDataHora("2026-11-18T12:01:25Z")).toBe("18/11/2026 09:01:25");
    expect(formatarDataHora("2026-11-18T02:00:00Z")).toBe("17/11/2026 23:00:00");
  });

  it("'hoje' começa à meia-noite de Brasília, mesmo de madrugada em UTC", () => {
    const { de, ate } = periodoDoPreset("hoje", new Date("2026-11-18T02:00:00Z")); // 17/11 23h em Brasília
    expect(de.toISOString()).toBe("2026-11-17T03:00:00.000Z");
    expect(ate.toISOString()).toBe("2026-11-18T03:00:00.000Z");
    const s = periodoDoPreset("7d", new Date("2026-11-18T15:00:00Z"));
    expect(s.de.toISOString()).toBe("2026-11-12T03:00:00.000Z");
  });
});

describe("auditoria sensível — CSV", () => {
  it("cabeçalho, BOM, ponto e vírgula e aspas", () => {
    const csv = eventosParaCsv([ev({ evento: "papel_concedido", detalhes: { papel: 'chefe; "geral"' } })]);
    expect(csv.startsWith("﻿Data e hora (Brasília);Tipo;Quem fez;Pessoa afetada;O que aconteceu;Detalhes")).toBe(true);
    expect(csv).toContain('"Pablo deu o papel ""chefe; ""geral"""" para Helena"');
  });
});
