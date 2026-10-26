import { describe, expect, it } from "vitest";
import {
  ORDEM_STATUS_VAGA, alternarOpcao, opcaoMarcada, opcoesStatusVaga, passaNoAtalho, passaNoStatusDaLista,
  passaNosStatusMarcados, rotuloBotaoStatus,
} from "@/lib/recrutamento/filtroStatusVaga";
import { passaNoFiltro } from "@/lib/recrutamento/responsavelVaga";

// Gestão Recrutamento — filtro de status com várias marcações e contagem (23/10/2026).

const vagas = [
  { status: "Pendente Analista" },
  { status: "Pendente Recrutamento" },
  { status: "Pendente Recrutamento" },
  { status: "Entrevista e Avaliação" },
  { status: "Vaga aberta - Seleção de Currículos" },
  { status: "Contratado" },
  { status: "Reprovada" },
  { status: "Reprovada" },
  { status: "Reprovada" },
  { status: "Status antigo" },
  { status: null },
];

describe("opções do filtro, com a quantidade", () => {
  it("conta por status, na ordem do fluxo, legado no fim, sem o vazio", () => {
    const op = opcoesStatusVaga(vagas);
    expect(op.map((o) => [o.rotulo, o.n])).toEqual([
      ["Pendente Operacional", 1],
      ["Pendente Recrutamento", 2],
      ["Vaga aberta - Seleção de Currículos", 1],
      ["Entrevista e Avaliação", 1],
      ["Contratado", 1],
      ["Reprovada", 3],
      ["Status antigo", 1],
    ]);
  });

  it("Pendente Analista aparece como Pendente Operacional e junta as duas grafias", () => {
    const op = opcoesStatusVaga([{ status: "Pendente Analista" }, { status: "Pendente Operacional" }]);
    expect(op).toHaveLength(1);
    expect(op[0].rotulo).toBe("Pendente Operacional");
    expect(op[0].n).toBe(2);
    expect(op[0].status.sort()).toEqual(["Pendente Analista", "Pendente Operacional"]);
  });

  it("status marcado que sumiu do recorte continua na lista, com 0", () => {
    const op = opcoesStatusVaga([{ status: "Reprovada" }], ["Contratado"]);
    expect(op.find((o) => o.rotulo === "Contratado")?.n).toBe(0);
  });

  it("'Concluído - ...' vai junto de Concluído na ordem", () => {
    const op = opcoesStatusVaga([{ status: "Reprovada" }, { status: "Concluído - 2 vagas" }, { status: "Contratado" }]);
    expect(op.map((o) => o.rotulo)).toEqual(["Contratado", "Concluído - 2 vagas", "Reprovada"]);
  });

  it("a lista de status vem do fluxo (botão Status), não inventada", () => {
    expect(ORDEM_STATUS_VAGA).toContain("Aguardando SST e Compras");
    expect(ORDEM_STATUS_VAGA).toContain("Compras Confirmou - Aguardando Documentação");
    expect(ORDEM_STATUS_VAGA.slice(-3)).toEqual(["Concluído", "Reprovada", "Cancelada"]);
  });
});

describe("marcar e desmarcar", () => {
  const pendOp = { status: ["Pendente Analista", "Pendente Operacional"] };
  it("marca a opção inteira e desmarca a opção inteira", () => {
    const m = alternarOpcao([], pendOp);
    expect(m).toEqual(["Pendente Analista", "Pendente Operacional"]);
    expect(opcaoMarcada(m, pendOp)).toBe(true);
    expect(alternarOpcao(m, pendOp)).toEqual([]);
  });
  it("nada marcado = todos passam; marcado = só os marcados", () => {
    expect(passaNosStatusMarcados("Reprovada", [])).toBe(true);
    expect(passaNosStatusMarcados("Reprovada", ["Contratado", "Entrevista e Avaliação"])).toBe(false);
    expect(passaNosStatusMarcados("Contratado", ["Contratado", "Entrevista e Avaliação"])).toBe(true);
  });
  it("texto do botão", () => {
    const op = opcoesStatusVaga(vagas);
    expect(rotuloBotaoStatus([], op)).toBe("Status");
    expect(rotuloBotaoStatus(["Reprovada"], op)).toBe("Status: Reprovada");
    expect(rotuloBotaoStatus(["Reprovada", "Contratado"], op)).toBe("Status (2)");
  });
});

describe("atalhos", () => {
  it("mesma regra da consulta", () => {
    expect(passaNoAtalho("Reprovada", "")).toBe(true);
    expect(passaNoAtalho("Entrevista e Avaliação", "em_processo")).toBe(true);
    expect(passaNoAtalho("Reprovada", "em_processo")).toBe(false);
    expect(passaNoAtalho("Pendente Recrutamento", "em_processo")).toBe(false);
    expect(passaNoAtalho("Contratado", "concluido")).toBe(true);
    expect(passaNoAtalho("Concluído - parcial", "concluido")).toBe(true);
    expect(passaNoAtalho("Aguardando SST e Compras", "pend_selecao", ["Aguardando SST e Compras"])).toBe(true);
    expect(passaNoAtalho("Reprovada", "Reprovada")).toBe(true);
    expect(passaNoAtalho("Contratado", "Reprovada")).toBe(false);
  });
});

describe("o responsável nunca alarga o recorte de status (bug de 23/10/2026)", () => {
  // TAINARA cuida de 4 vagas: 1 em entrevista, 1 contratada, 2 reprovadas.
  const tai = "u-tainara";
  const dela = [
    { status: "Entrevista e Avaliação", resp: tai },
    { status: "Contratado", resp: tai },
    { status: "Reprovada", resp: tai },
    { status: "Reprovada", resp: tai },
    { status: "Entrevista e Avaliação", resp: "u-outra" },
  ];
  const lista = (atalho: string, marcados: string[]) =>
    dela.filter((v) => passaNoStatusDaLista(v.status, { atalho, marcados }, passaNoFiltro(v, v.resp, tai, "u-eu")));

  it("Em Processo + responsável: só as em andamento dela", () => {
    expect(lista("em_processo", []).map((v) => v.status)).toEqual(["Entrevista e Avaliação"]);
  });
  it("Todas + status marcados (sem Reprovada/Contratado) + responsável: some o que não foi marcado", () => {
    expect(lista("", ["Entrevista e Avaliação", "Pendente Recrutamento"])).toHaveLength(1);
  });
  it("Reprovados + responsável: nada — vaga encerrada não está com ninguém (23/10/2026)", () => {
    expect(lista("Reprovada", [])).toHaveLength(0);
  });
  it("23/10/2026: encerradas ficam fora da lista sem marcação; marcadas, aparecem", () => {
    const todas = ["Entrevista e Avaliação", "Contratado", "Concluído", "Concluído - parcial", "Reprovada", "Cancelada", "Pendente Recrutamento"];
    const sem = todas.filter((s) => passaNoStatusDaLista(s, { atalho: "", marcados: [], semEncerradas: true }));
    expect(sem).toEqual(["Entrevista e Avaliação", "Pendente Recrutamento"]);
    expect(todas.filter((s) => passaNoStatusDaLista(s, { atalho: "", marcados: ["Reprovada"], semEncerradas: true }))).toEqual(["Reprovada"]);
    // Cards do topo: sem `semEncerradas`, nada marcado = tudo.
    expect(todas.filter((s) => passaNosStatusMarcados(s, []))).toHaveLength(todas.length);
  });
  it("filtrou a Tainara: só o que ainda está em processo, nem com Reprovada marcada", () => {
    expect(lista("", [])).toHaveLength(1);
    expect(lista("", ["Reprovada"])).toHaveLength(0);
  });
  it("contagem do filtro respeita o responsável (conta só o que passou nos outros filtros)", () => {
    const op = opcoesStatusVaga(dela.filter((v) => passaNoFiltro(v, v.resp, tai, "u-eu")));
    expect(op.map((o) => [o.rotulo, o.n])).toEqual([["Entrevista e Avaliação", 1]]);
  });
});
