import { describe, it, expect } from "vitest";
import { casaSetor, ehDeCampo, montarEstrutura, nomeSetor, papelDe, type SetorEstrutura } from "@/lib/organograma/estruturaSetores";
import type { NoPessoa } from "@/lib/organograma/pessoas";

// Dados de exemplo (sem pessoas reais).
let seq = 0;
function p(id: string, parent: string | null, setor: string | null, funcao: string, extra: Partial<NoPessoa> = {}): NoPessoa {
  return {
    id, parent_id: parent, ordem: seq++, nome: `PESSOA ${id.toUpperCase()}`, setor, par_grupo: null, do_grupo: false, contrato: "1093 - ADM E ESTAGIARIOS",
    superior_pendente: false, empresa: 5, filial: 1093, contratos_extras: [], user_id: null, empregado_id: null, funcao_manual: funcao,
    email: null, avatar_url: null, cargo: null, ativo: true, cor: null, superior_origem: "manual", posto_codigo: null, posto_nome: null, ...extra,
  };
}
const campo = (id: string, parent: string | null, filial: number, funcao = "Vigia", setor: string | null = null) =>
  p(id, parent, setor, funcao, { empresa: 2, filial, contrato: `${filial} - CONTRATO ${filial}` });

const ramo = (s: SetorEstrutura): unknown => (s.filhos.length ? { [s.nome]: s.filhos.map(ramo) } : s.nome);

describe("Organograma › Estrutura — topo e setores", () => {
  const dados = [
    p("dona", null, "PRESIDÊNCIA", "PROPRIETÁRIA"), p("dono", null, "Diretor Operacional", "PROPRIETÁRIO"),
    p("pres", "dona", "PRESIDÊNCIA", "PRESIDENTE"),
    p("ctrl", "pres", "CONTROLADORIA", "Gerente Controladoria"), p("ctl2", "ctrl", "CONTROLADORIA", "Analista"),
    p("dadm", "ctl2", "DIRETOR ADMINISTRATIVO", "Diretora Administrativa"),
    p("dop", "ctl2", "Diretor Operacional", "Diretor"), p("dop2", "dop", "DIRETOR OPERACIONAL", "Assistente"),
    p("rh", "dadm", "RH", "Gerente de RH"), p("jur", "rh", "JURIDICO", "Advogada"),
    p("comp", "dop", "COMPRAS", "Gerente"),
    p("x", "rh", "RH", "Desligado", { ativo: false }),
  ];
  const e = montarEstrutura(dados);

  it("proprietários são o Conselho; presidente, a Presidência; vice não", () => {
    expect(e.conselho.map((n) => n.id)).toEqual(["dona", "dono"]);
    expect(e.presidencia.map((n) => n.id)).toEqual(["pres"]);
    expect(papelDe({ funcao_manual: "Vice-Presidente", cargo: null })).toBeNull();
  });

  it("setores pela cadeia de comando, com nome normalizado e sem PRESIDÊNCIA", () => {
    expect(e.raiz.map(ramo)).toEqual([{
      Controladoria: [{ "Diretoria Administrativa": [{ RH: ["Jurídico"] }] }, { "Diretoria Operacional": ["Compras"] }],
    }]);
    expect(e.setores.find((s) => s.chave === "DIRETOR OPERACIONAL")!.membros.map((n) => n.id)).toEqual(["dop", "dop2"]);
    expect(e.raiz[0].ligadoA).toBe("pres");
    expect(nomeSetor("LICITACAO")).toBe("Licitação");
  });

  it("inativo fica de fora; busca acha o setor por alguém dentro", () => {
    const rh = e.setores.find((s) => s.chave === "RH")!;
    expect(rh.membros.map((n) => n.id)).toEqual(["rh"]);
    expect(casaSetor(e.raiz[0], "advog")).toBe(true);
  });

  it("sem título em ninguém, o topo da árvore vira a presidência", () => {
    const sem = montarEstrutura([p("t", null, null, "Diretor"), p("f", "t", "TI", "Analista")]);
    expect(sem.presidencia.map((n) => n.id)).toEqual(["t"]);
    expect(sem.setores.map((s) => s.chave)).toEqual(["TI"]);
  });

  it("ciclo entre setores não some com eles", () => {
    const ciclo = montarEstrutura([p("a", "b2", "A", "Gerente"), p("b", "a", "B", "Gerente"), p("b2", "b", "B", "Analista")]);
    expect(ciclo.setores).toHaveLength(2);
    expect(ciclo.raiz.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Organograma › Estrutura — campo dentro do contrato, contrato dentro do supervisor", () => {
  const base = [
    p("pres", null, "PRESIDÊNCIA", "PRESIDENTE"),
    p("ger", "pres", "OPERACIONAL", "Supervisor Operacional"),       // supervisor com equipe
    p("sup2", "ger", "OPERACIONAL", "Supervisor Operacional"),
    p("ana", "ger", "OPERACIONAL", "Analista Operacional I"),         // escritório: fica no setor
    p("aux", "ger", "OPERACIONAL", "Auxiliar de Limpeza", { empresa: 1, filial: 1053, contrato: "1053 - ADM HAGG" }), // limpeza do escritório: vai para o contrato
    // supervisora com cargo de campo na Senior e função escrita no organograma
    p("dai", "ger", "OPERACIONAL", "Supervisora Operacional", { cargo: "VIGIA", empresa: 2, filial: 1064, contrato: "1064 - TRIUNFO VIGIAS" }),
    campo("v1", "outro", 1064, "Vigia", "OPERACIONAL"),               // vigia com setor de escritório: mesmo assim vai ao contrato
    campo("enc", "sup2", 1074, "Encarregado"), campo("l1", "enc", 1074, "Servente"), campo("l2", "enc", 1074, "Servente"),
    campo("solto", null, 1090, "Servente"),                            // recém-contratado, sem superior ainda
    p("outro", "pres", "COMPRAS", "Comprador"),
  ];
  const e = montarEstrutura(base);
  const ct = (filial: number) => e.contratos.find((c) => c.filial === filial)!;

  it("quem é de campo não fica solto no setor", () => {
    const op = e.setores.find((s) => s.chave === "OPERACIONAL")!;
    expect(op.membros.map((n) => n.id).sort()).toEqual(["ana", "dai", "ger", "sup2"]);
    expect(ehDeCampo({ setor: "OPERACIONAL", funcao_manual: null, cargo: "VIGIA" })).toBe(true);
    expect(ehDeCampo({ setor: "OPERACIONAL", funcao_manual: "Supervisora Operacional", cargo: "VIGIA" })).toBe(false);
  });

  it("cada um no contrato da Senior — inclusive quem acabou de entrar sem superior", () => {
    expect(ct(1064).membros.map((n) => n.id)).toEqual(["v1"]);
    expect(ct(1053).membros.map((n) => n.id)).toEqual(["aux"]);
    expect(ct(1090).membros.map((n) => n.id)).toEqual(["solto"]);
    expect(ct(1074).cabecas.map((n) => n.id)).toEqual(["enc"]);
    expect(e.equipeNoContrato("enc", ct(1074).chave).map((n) => n.id)).toEqual(["l1", "l2"]);
  });

  it("supervisor pelo cadastro: o do próprio contrato, senão o mais próximo na cadeia", () => {
    expect([ct(1064).supervisor?.id, ct(1064).origem]).toEqual(["dai", "cadastro"]);
    expect(ct(1074).supervisor?.id).toBe("sup2");
    expect(ct(1053).supervisor?.id).toBe("ger");
    expect(ct(1090).supervisor).toBeNull();
    expect(e.semSupervisor.map((c) => c.filial)).toEqual([1090]);
  });

  it("supervisor definido na tela vence o do cadastro; a pessoa abre os contratos dela", () => {
    const def = montarEstrutura(base, new Map([[ct(1090).chave, "sup2"], [ct(1064).chave, "ger"]]));
    const c = (f: number) => def.contratos.find((x) => x.filial === f)!;
    expect([c(1090).supervisor?.id, c(1090).origem]).toEqual(["sup2", "definido"]);
    expect(c(1064).supervisor?.id).toBe("ger");
    expect(def.contratosDe("sup2").map((x) => x.filial)).toEqual([1074, 1090]);
    expect(def.semSupervisor).toEqual([]);
  });

  it("a equipe de escritório do supervisor não traz gente de campo", () => {
    expect(e.equipeEscritorio("ger").map((n) => n.id).sort()).toEqual(["ana", "dai", "sup2"]);
  });
});
