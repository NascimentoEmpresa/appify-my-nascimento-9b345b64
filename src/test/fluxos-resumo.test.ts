import { describe, it, expect } from "vitest";
import {
  CODIGOS_DE_FLUXO, fluxoPorCodigo, sequenciaDe, todosOsFluxos,
} from "@/lib/fluxos/resumo";
import { STATUS_TODOS as STATUS_DEMISSAO } from "@/lib/demissao/solicitacao";
import { statusDeAcao, type Etapa } from "@/lib/trocaFuncao/solicitacao";

// O "Resumo de Funções" (02/09/2026) é o texto que explica cada sistema para
// quem usa. Ele mora longe da regra, então o risco dele é ESPECÍFICO: envelhecer
// calado. Um resumo errado é pior que resumo nenhum — a pessoa segue o texto e
// vai procurar o card na fila errada.
//
// Por isso estes testes não conferem redação: conferem que o texto e a regra
// falam dos MESMOS status. No dia em que alguém mudar uma etapa e esquecer o
// resumo, é aqui que estoura.

describe("catálogo de fluxos", () => {
  it("todo código listado devolve um fluxo", () => {
    for (const c of CODIGOS_DE_FLUXO) {
      expect(fluxoPorCodigo(c)).not.toBeNull();
    }
  });

  it("código desconhecido devolve null, e não estoura", () => {
    // A tela usa isso para simplesmente não desenhar o botão. Um throw aqui
    // derrubaria a página inteira por causa de um botão de ajuda.
    expect(fluxoPorCodigo("nao_existe")).toBeNull();
  });

  it("todo fluxo tem nome, para que serve e pelo menos dois passos", () => {
    for (const f of todosOsFluxos()) {
      expect(f.nome.length).toBeGreaterThan(0);
      expect(f.paraQue.length).toBeGreaterThan(0);
      // Um passo só não é fluxo — é uma tela.
      expect(f.passos.length).toBeGreaterThanOrEqual(2);
      for (const p of f.passos) {
        expect(p.quem.length).toBeGreaterThan(0);
        expect(p.faz.length).toBeGreaterThan(0);
      }
    }
  });

  it("a sequência sai na ordem dos passos", () => {
    const f = fluxoPorCodigo("demissao")!;
    // Ordem trocada em 08/09/2026: o RH libera e o SST fecha agendando o ASO.
    // Em 14/09/2026 a etapa 1 voltou do analista para o Operacional.
    expect(sequenciaDe(f)).toBe("Encarregado → Operacional → RH → SST");
  });
});

describe("o resumo não pode divergir da regra", () => {
  it("os status citados na demissão existem no fluxo da demissão", () => {
    const citados = fluxoPorCodigo("demissao")!.passos
      .map(p => p.status).filter(Boolean) as string[];
    expect(citados).toEqual(["Pendente Operacional", "Pendente RH", "Pendente SST"]);
    for (const s of citados) expect(STATUS_DEMISSAO).toContain(s);
  });

  it("os status citados na mudança de função são status de ação de alguma etapa", () => {
    const etapas: Etapa[] = ["analista", "aprovacao", "sst", "rh"];
    const daRegra = new Set(etapas.flatMap(e => statusDeAcao(e)));
    const citados = fluxoPorCodigo("troca_funcao")!.passos
      .map(p => p.status).filter(Boolean) as string[];
    expect(citados.length).toBeGreaterThan(0);
    for (const s of citados) expect(daRegra).toContain(s);
  });

  it("os fluxos que ficaram com o analista dizem isso no texto", () => {
    // No recrutamento o status tem o mesmo nome, mas ele não vem de uma lib —
    // está no Recrutamento.tsx. A demissão saiu daqui em 14/09/2026 e a troca
    // de função em 16/09/2026 (Licitações só acompanha).
    for (const codigo of ["vaga"]) {
      const f = fluxoPorCodigo(codigo)!;
      const temAnalista = f.passos.some(p => p.quem === "Analista");
      expect(temAnalista, `${codigo} deveria ter a etapa do analista`).toBe(true);
    }
  });

  it("onde o analista aparece, ele é o primeiro a decidir", () => {
    // O pedido foi explícito: "PRIMEIRO o analista aprova". O passo 1 é sempre
    // o encarregado abrindo, então o analista tem que ser o passo 2.
    for (const codigo of ["vaga"]) {
      const f = fluxoPorCodigo(codigo)!;
      expect(f.passos[1].quem, codigo).toBe("Analista");
    }
  });

  it("na troca de função quem decide primeiro é o Operacional ou a Diretoria — Licitações só acompanha (16/09/2026)", () => {
    const f = fluxoPorCodigo("troca_funcao")!;
    expect(f.passos[1].quem).toBe("Operacional");
    expect(f.passos.some(p => p.quem === "Diretoria")).toBe(true);
    expect(f.passos.some(p => p.quem === "Analista")).toBe(false);
  });

  it("na demissão quem decide primeiro é o Operacional, e o analista só acompanha", () => {
    // 14/09/2026: "agora o OPERACIONAL aprova e os analistas só veem".
    const f = fluxoPorCodigo("demissao")!;
    expect(f.passos[1].quem).toBe("Operacional");
    expect(f.passos.some(p => p.quem === "Analista")).toBe(false);
  });
});
