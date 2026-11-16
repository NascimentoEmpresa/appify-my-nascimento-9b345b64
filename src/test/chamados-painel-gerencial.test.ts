import { describe, it, expect } from "vitest";
import {
  grupoGerencial, atrasadoGerencial, dataReferencia, filtrarChamados, ordenarParaAba, SEM_RESPONSAVEL,
  diasEntre, mediana, kpisGerencial, rendimentoPorResponsavel, contarPor, agruparOutros, rotuloDias,
  tiposAcaoPermitidos, validarPedidoAcao, respostaObrigatoria, detalheAcao, rotuloStatusAcao, tamanhoFilas,
  type ChamadoGerencial,
} from "@/lib/chamados/painelGerencial";
import { descreverAviso } from "@/lib/chamados/avisoChat";

// Espelho das regras da mig 20261116230000 (SIS-2026-0923). As RPCs mandam;
// estes testes garantem que a tela não oferece o que o banco recusa e que os
// indicadores contam do jeito documentado em painelGerencial.ts.

const AGORA = new Date("2026-11-16T12:00:00-03:00");

const ch = (over: Partial<ChamadoGerencial> = {}): ChamadoGerencial => ({
  id: "c1", numero: "SIS-2026-0001", assunto: "Ajuste no relatório", descricao: null,
  prioridade: "media", status: "em_andamento", setor: "Financeiro",
  solicitante_id: "s1", solicitante_nome: "Ana", responsavel_id: "d1", responsavel_nome: "Pablo",
  posicao_dev: 1, modulo_sistema: null, modulo_sistema_outro: null,
  created_at: "2026-11-01T10:00:00-03:00", concluido_em: null, cancelado_em: null,
  conclusao_confirmada_em: null, concluido_sem_retorno: false, gestao_finalizada_em: null,
  desenvolvimento_iniciado_em: null, prazo_conclusao_em: null, prazo_solicitante: null,
  concluido_no_prazo: null, horas_gastas: null, etapa_validacao: null,
  avaliacao_nota: null, avaliacao_comentario: null, acoes_pendentes: 0,
  ...over,
});

describe("em que aba o chamado cai", () => {
  it("ativo (aberto, na fila, aguardando retorno) é Em andamento", () => {
    for (const status of ["aberto", "em_andamento", "aguardando_retorno"]) {
      expect(grupoGerencial(ch({ status }))).toBe("andamento");
    }
  });
  it("concluído sem confirmação do solicitante aguarda validação", () => {
    expect(grupoGerencial(ch({ status: "concluido" }))).toBe("validacao");
  });
  it("concluído e confirmado, mas com a Presidência validando, ainda aguarda validação", () => {
    expect(grupoGerencial(ch({ status: "concluido", conclusao_confirmada_em: "2026-11-10T10:00:00Z", etapa_validacao: "validacao_presidencia" })))
      .toBe("validacao");
  });
  it("confirmado (ou concluído sem retorno do solicitante) é Concluído", () => {
    expect(grupoGerencial(ch({ status: "concluido", conclusao_confirmada_em: "2026-11-10T10:00:00Z" }))).toBe("concluido");
    expect(grupoGerencial(ch({ status: "concluido", concluido_sem_retorno: true }))).toBe("concluido");
    expect(grupoGerencial(ch({ status: "concluido", conclusao_confirmada_em: "x", etapa_validacao: "treinamento" }))).toBe("concluido");
  });
  it("cancelado e reprovado ficam à parte", () => {
    expect(grupoGerencial(ch({ status: "cancelado" }))).toBe("encerrado");
    expect(grupoGerencial(ch({ status: "reprovado" }))).toBe("encerrado");
  });
});

describe("atrasado", () => {
  it("só a previsão do dev vencida com o chamado ativo", () => {
    expect(atrasadoGerencial(ch({ prazo_conclusao_em: "2026-11-14T18:00:00-03:00" }), AGORA)).toBe(true);
    expect(atrasadoGerencial(ch({ prazo_conclusao_em: "2026-11-16T18:00:00-03:00" }), AGORA)).toBe(false); // vence hoje: ainda no prazo
    expect(atrasadoGerencial(ch({ status: "concluido", prazo_conclusao_em: "2026-11-01T18:00:00-03:00" }), AGORA)).toBe(false);
  });
  it("prazo esperado do solicitante não conta", () => {
    expect(atrasadoGerencial(ch({ prazo_solicitante: "2026-11-02" }), AGORA)).toBe(false);
  });
});

describe("filtros", () => {
  const lista = [
    ch({ id: "a", setor: "SST", responsavel_id: "d1", prioridade: "alta", assunto: "EPIs", created_at: "2026-11-05T10:00:00-03:00" }),
    ch({ id: "b", setor: "Financeiro", responsavel_id: "d2", responsavel_nome: "João", numero: "SIS-2026-0815" }),
    ch({ id: "c", setor: null, responsavel_id: null, responsavel_nome: null, status: "aberto", posicao_dev: null }),
    ch({ id: "d", status: "concluido", created_at: "2026-09-01T10:00:00-03:00", concluido_em: "2026-11-10T10:00:00-03:00" }),
  ];
  it("setor, responsável (inclusive sem responsável), prioridade e busca", () => {
    expect(filtrarChamados(lista, { setor: "SST" }).map((c) => c.id)).toEqual(["a"]);
    expect(filtrarChamados(lista, { responsavelId: "d2" }).map((c) => c.id)).toEqual(["b"]);
    expect(filtrarChamados(lista, { responsavelId: SEM_RESPONSAVEL }).map((c) => c.id)).toEqual(["c"]);
    expect(filtrarChamados(lista, { prioridade: "alta" }).map((c) => c.id)).toEqual(["a"]);
    expect(filtrarChamados(lista, { busca: "0815" }).map((c) => c.id)).toEqual(["b"]);
    expect(filtrarChamados(lista, { busca: "joão" }).map((c) => c.id)).toEqual(["b"]);
  });
  it("período olha a conclusão para o entregue e a abertura para o ativo", () => {
    expect(dataReferencia(lista[3])).toBe("2026-11-10T10:00:00-03:00");
    const r = filtrarChamados(lista, { de: "2026-11-04", ate: "2026-11-30" }).map((c) => c.id);
    expect(r).toEqual(["a", "d"]);
  });
  it("Em andamento ordena por responsável e posição na fila", () => {
    const ord = ordenarParaAba([
      ch({ id: "p2", responsavel_nome: "Pablo", posicao_dev: 2 }),
      ch({ id: "e1", responsavel_nome: "Eduardo", posicao_dev: 1 }),
      ch({ id: "p1", responsavel_nome: "Pablo", posicao_dev: 1 }),
      ch({ id: "sem", responsavel_nome: null, posicao_dev: null }),
    ], "andamento").map((c) => c.id);
    expect(ord).toEqual(["e1", "p1", "p2", "sem"]);
  });
});

describe("contas básicas", () => {
  it("diasEntre e mediana", () => {
    expect(diasEntre("2026-11-01T00:00:00Z", "2026-11-03T12:00:00Z")).toBe(2.5);
    expect(diasEntre(null, "2026-11-03T12:00:00Z")).toBeNull();
    expect(diasEntre("2026-11-03T00:00:00Z", "2026-11-01T00:00:00Z")).toBeNull();
    expect(mediana([])).toBeNull();
    expect(mediana([5, 1, 3])).toBe(3);
    expect(mediana([4, 1, 3, 2])).toBe(2.5);
  });
  it("rótulo de dias", () => {
    expect(rotuloDias(null)).toBe("—");
    expect(rotuloDias(0.25)).toBe("6 h");
    expect(rotuloDias(1)).toBe("1 dia");
    expect(rotuloDias(3.46)).toBe("3,5 dias");
  });
  it("contarPor e agruparOutros (sem 9ª cor)", () => {
    const c = contarPor([{ s: "SST" }, { s: "SST" }, { s: "RH" }, { s: null }], (x) => x.s);
    expect(c).toEqual([{ nome: "SST", total: 2 }, { nome: "Não informado", total: 1 }, { nome: "RH", total: 1 }]);
    const muitos = Array.from({ length: 10 }, (_, i) => ({ nome: `S${i}`, total: 10 - i }));
    const g = agruparOutros(muitos, 8);
    expect(g).toHaveLength(8);
    expect(g[7]).toEqual({ nome: "Outros", total: 3 + 2 + 1 });
  });
});

describe("KPIs e rendimento por responsável", () => {
  const lista = [
    // Pablo: 2 concluídos (1 no prazo, 1 com atraso), 1 em andamento atrasado
    ch({ id: "1", status: "concluido", conclusao_confirmada_em: "x", created_at: "2026-11-01T00:00:00Z",
      desenvolvimento_iniciado_em: "2026-11-03T00:00:00Z", concluido_em: "2026-11-04T00:00:00Z", concluido_no_prazo: true, avaliacao_nota: 5 }),
    ch({ id: "2", status: "concluido", created_at: "2026-11-01T00:00:00Z",
      desenvolvimento_iniciado_em: "2026-11-02T00:00:00Z", concluido_em: "2026-11-05T00:00:00Z", concluido_no_prazo: false, avaliacao_nota: 4 }),
    ch({ id: "3", prazo_conclusao_em: "2026-11-10T18:00:00-03:00" }),
    // João: 2 concluídos, mais rápido no desenvolvimento
    ch({ id: "4", responsavel_id: "d2", responsavel_nome: "João", status: "concluido", conclusao_confirmada_em: "x",
      created_at: "2026-11-01T00:00:00Z", desenvolvimento_iniciado_em: "2026-11-09T00:00:00Z", concluido_em: "2026-11-10T00:00:00Z" }),
    ch({ id: "5", responsavel_id: "d2", responsavel_nome: "João", status: "concluido", conclusao_confirmada_em: "x",
      created_at: "2026-11-01T00:00:00Z", desenvolvimento_iniciado_em: "2026-11-09T12:00:00Z", concluido_em: "2026-11-10T00:00:00Z" }),
    ch({ id: "6", responsavel_id: null, responsavel_nome: null, status: "cancelado" }),
  ];

  it("KPIs", () => {
    expect(kpisGerencial(lista, 2, AGORA)).toEqual({
      andamento: 1, validacao: 1, concluidos: 3, encerrados: 1, atrasados: 1, acoesPendentes: 2,
    });
  });

  it("concluídos, tempos, avaliação e % no prazo por responsável", () => {
    const r = rendimentoPorResponsavel(lista, AGORA);
    expect(r.map((x) => x.nome)).toEqual(["João", "Pablo"]); // empate em 2: João entrega mais rápido
    const pablo = r.find((x) => x.responsavelId === "d1")!;
    expect(pablo.concluidos).toBe(2);
    expect(pablo.emAndamento).toBe(1);
    expect(pablo.atrasados).toBe(1);
    expect(pablo.tempoTotalMedianoDias).toBe(3.5);   // 3 e 4 dias
    expect(pablo.tempoDevMedianoDias).toBe(2);       // 1 e 3 dias
    expect(pablo.avaliacaoMedia).toBe(4.5);
    expect(pablo.avaliacoes).toBe(2);
    expect(pablo.pctNoPrazo).toBe(50);
    const joao = r.find((x) => x.responsavelId === "d2")!;
    expect(joao.tempoDevMedianoDias).toBe(0.75);
    expect(joao.pctNoPrazo).toBeNull();
    expect(joao.avaliacaoMedia).toBeNull();
  });

  it("chamado sem responsável não entra no ranking", () => {
    expect(rendimentoPorResponsavel([ch({ responsavel_id: null })], AGORA)).toEqual([]);
  });

  it("tamanho da fila conta só os ativos de cada responsável", () => {
    expect(tamanhoFilas(lista)).toEqual({ d1: 1 });
  });
});

describe("solicitar ação (espelho de chamado_gestao_acao_solicitar)", () => {
  it("ações por estado do chamado", () => {
    expect(tiposAcaoPermitidos(ch())).toEqual(["ordem_fila", "prioridade", "cancelamento", "informacoes"]);
    expect(tiposAcaoPermitidos(ch({ status: "aberto", responsavel_id: null, posicao_dev: null })))
      .toEqual(["prioridade", "cancelamento", "informacoes"]);
    expect(tiposAcaoPermitidos(ch({ status: "concluido" }))).toEqual(["revisao", "informacoes"]);
    expect(tiposAcaoPermitidos(ch({ status: "cancelado" }))).toEqual(["informacoes"]);
  });

  it("justificativa com pelo menos 10 caracteres", () => {
    expect(validarPedidoAcao(ch(), { tipo: "informacoes", justificativa: "  curta   " }, 3)).toMatch(/10 caracteres/);
    expect(validarPedidoAcao(ch(), { tipo: "informacoes", justificativa: "Qual a previsão?" }, 3)).toBeNull();
  });

  it("prioridade nova e diferente da atual", () => {
    const j = "Impacta o fechamento do mês";
    expect(validarPedidoAcao(ch(), { tipo: "prioridade", justificativa: j }, 3)).toMatch(/Escolha/);
    expect(validarPedidoAcao(ch(), { tipo: "prioridade", prioridade: "media", justificativa: j }, 3)).toMatch(/já está/);
    expect(validarPedidoAcao(ch(), { tipo: "prioridade", prioridade: "alta", justificativa: j }, 3)).toBeNull();
  });

  it("posição dentro da fila e diferente da atual", () => {
    const j = "Precisa sair antes da auditoria";
    expect(validarPedidoAcao(ch({ posicao_dev: 2 }), { tipo: "ordem_fila", posicao: 0, justificativa: j }, 3)).toMatch(/entre 1 e 3/);
    expect(validarPedidoAcao(ch({ posicao_dev: 2 }), { tipo: "ordem_fila", posicao: 4, justificativa: j }, 3)).toMatch(/entre 1 e 3/);
    expect(validarPedidoAcao(ch({ posicao_dev: 2 }), { tipo: "ordem_fila", posicao: 2, justificativa: j }, 3)).toMatch(/diferente/);
    expect(validarPedidoAcao(ch({ posicao_dev: 2 }), { tipo: "ordem_fila", posicao: 1, justificativa: j }, 3)).toBeNull();
  });

  it("não oferece o que não se aplica", () => {
    expect(validarPedidoAcao(ch({ status: "concluido" }), { tipo: "cancelamento", justificativa: "Não precisa mais disso" }, 0))
      .toMatch(/não se aplica/);
    expect(validarPedidoAcao(ch(), { tipo: "revisao", justificativa: "A entrega ficou incompleta" }, 1)).toMatch(/não se aplica/);
  });

  it("resposta de Sistemas: obrigatória para recusar e para responder informações", () => {
    expect(respostaObrigatoria("prioridade", true)).toBe(false);
    expect(respostaObrigatoria("prioridade", false)).toBe(true);
    expect(respostaObrigatoria("informacoes", true)).toBe(true);
  });

  it("textos do detalhamento e da situação", () => {
    expect(detalheAcao({ tipo: "prioridade", valor_atual: "media", valor_solicitado: "alta" })).toBe("Média → Alta");
    expect(detalheAcao({ tipo: "ordem_fila", valor_atual: "3", valor_solicitado: "1" })).toBe("Posição 3º → 1º");
    expect(rotuloStatusAcao({ tipo: "informacoes", status: "aceita" })).toBe("Respondida");
    expect(rotuloStatusAcao({ tipo: "cancelamento", status: "aceita" })).toBe("Aceita");
    expect(rotuloStatusAcao({ tipo: "cancelamento", status: "cancelada" })).toBe("Retirada");
  });
});

describe("avisos do chat (lib/chamados/avisoChat, extraída do ChatChamado)", () => {
  const ev = (texto: string, tipo = "evento") =>
    ({ id: "e", chamado_id: "c", autor_id: "u1", tipo, texto, meta: null, created_at: "2026-11-16T10:00:00Z" });
  const nomeDe = (uid: string | null) => (uid === "u1" ? "Iury" : "—");

  it("continua traduzindo os avisos de antes", () => {
    expect(descreverAviso(ev("Prioridade alterada para Alta"), nomeDe)?.texto).toBe("Iury mudou a prioridade para Alta");
    expect(descreverAviso(ev("Chamado cancelado: a pedido da gestão — não precisa mais"), nomeDe)?.texto)
      .toBe("Iury cancelou o chamado — a pedido da gestão — não precisa mais");
    expect(descreverAviso(ev("oi", "comentario"), nomeDe)).toBeNull();
  });

  it("traduz os efeitos dos pedidos da gestão", () => {
    expect(descreverAviso(ev("Posição na fila do responsável alterada para 1º"), nomeDe)?.texto)
      .toBe("Iury mudou a posição do chamado na fila para 1º");
    expect(descreverAviso(ev("Entrega devolvida para revisão a pedido da gestão: faltou o filtro"), nomeDe)?.texto)
      .toBe("Iury devolveu a entrega para revisão a pedido da gestão — faltou o filtro");
  });

  it("a revisão da gestão não usa o texto que o Monitoramento conta como reabertura", () => {
    expect("Entrega devolvida para revisão a pedido da gestão: x".startsWith("Chamado reaberto")).toBe(false);
  });
});
