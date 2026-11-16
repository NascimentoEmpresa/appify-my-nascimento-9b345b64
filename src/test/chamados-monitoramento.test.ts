import { describe, expect, it } from "vitest";
import {
  analiseQualidade, avaliarChamado, calcularKpis, classificarTema, entraNoMonitoramento, leituraControladoria,
  rankingSolicitantes, resumoTemas, termosPresentes, type ChamadoMonitor, type LinhaMonitor,
} from "@/lib/chamados/monitoramento";

const AGORA = new Date("2026-10-22T12:00:00-03:00");

function chamado(p: Partial<ChamadoMonitor> = {}): ChamadoMonitor {
  return {
    id: "c1", numero: "SIS-2026-0001", assunto: "Ajuste", descricao: null, categorias: [],
    tipo_solicitacao: null, prioridade: "media", impacto_trabalho: null, urgencia: null,
    modulo_sistema: null, modulo_sistema_outro: null, afeta_usuarios: null, observacoes_solicitante: null,
    solicitante_id: "u1", solicitante_nome: "Fulano", setor: "Financeiro", status: "aberto",
    prazo_previsto: null, concluido_em: null, created_at: "2026-10-01T10:00:00-03:00",
    anexos_abertura: 0, anexos_total: 0, comentarios: 0, pedidos_info: 0, reaberturas: 0,
    aval_entrega: null, aval_dev_clareza: null, aval_dev_informacoes: null,
    validacao_aprovado: null, validacao_devolucoes: null,
    ...p,
  };
}

const linha = (p: Partial<ChamadoMonitor>): LinhaMonitor => {
  const c = chamado(p);
  return { c, a: avaliarChamado(c, AGORA) };
};

const BOM = `Hoje a conciliação do fluxo de caixa é feita manualmente numa planilha e demora 2 horas por dia.
Gostaria que o sistema importasse o extrato bancário e mostrasse as divergências.
- exemplo em anexo
- o resultado esperado é o saldo batendo com o banco no fechamento`;

describe("Monitoramento de Chamados — tema", () => {
  it("termo no assunto pesa mais que na descrição", () => {
    expect(classificarTema(chamado({ assunto: "Relatório de faturamento", descricao: "erro ao abrir" })).tema).toBe("relatorios");
  });

  it("categoria e tipo da abertura entram na conta", () => {
    expect(classificarTema(chamado({ assunto: "Tela X", categorias: ["correcao_erro"], tipo_solicitacao: "correcao" })).tema).toBe("correcoes");
    expect(classificarTema(chamado({ assunto: "Tela X", categorias: ["integracoes"] })).tema).toBe("integracoes");
  });

  it("acento e caixa não importam", () => {
    expect(classificarTema(chamado({ assunto: "CONCILIAÇÃO do Fluxo de Caixa" })).tema).toBe("fluxo_caixa");
  });

  it("sem termo nenhum = Outros, com motivo", () => {
    const r = classificarTema(chamado({ assunto: "Olá", descricao: "pode ver isso?" }));
    expect(r.tema).toBe("outros");
    expect(r.motivo).toMatch(/Nenhum termo/);
  });

  it("termo curto não casa dentro de outra palavra", () => {
    expect(termosPresentes(" ferro de passar ", ["erro"])).toEqual([]);
    expect(termosPresentes(" deu erros na tela ", ["erro"])).toEqual(["erro"]);
  });

  // SIS-2026-0904: o ajuste manual saiu. A RPC ainda manda `ajustes` (tabela
  // antiga), mas a avaliação fica só no automático.
  it("ajuste manual antigo vindo da RPC é ignorado", () => {
    const comAjuste = { ...chamado({ assunto: "Relatório", descricao: BOM }), ajustes: { tema: "visao_estrategica", indice: "9,5", efetividade: "10" } } as ChamadoMonitor;
    const a = avaliarChamado(comAjuste, AGORA);
    expect(a.tema).toBe(a.temaAuto.tema);
    expect(a).toEqual(avaliarChamado(chamado({ assunto: "Relatório", descricao: BOM }), AGORA));
  });
});

describe("Monitoramento de Chamados — índice 0–10", () => {
  it("pedido bem escrito pontua mais que pedido de uma linha", () => {
    const bom = avaliarChamado(chamado({ assunto: "Conciliação do fluxo de caixa", descricao: BOM, anexos_abertura: 2, impacto_trabalho: "atraso_significativo", afeta_usuarios: 5 }), AGORA);
    const ruim = avaliarChamado(chamado({ assunto: "arrumar", descricao: "ver" }), AGORA);
    expect(bom.indice).toBeGreaterThan(6);
    expect(ruim.indice).toBeLessThan(4);
    expect(bom.flags.objetivoClaro).toBe(true);
    expect(ruim.flags.baixaEspecificacao).toBe(true);
  });

  it("é reprodutível: mesma entrada, mesma nota", () => {
    const c = chamado({ assunto: "Painel", descricao: BOM });
    expect(avaliarChamado(c, AGORA)).toEqual(avaliarChamado(c, AGORA));
  });

  it("não concluído é preliminar e o critério de resultado fica de fora", () => {
    const a = avaliarChamado(chamado({ status: "em_andamento", descricao: BOM }), AGORA);
    expect(a.preliminar).toBe(true);
    expect(a.criterios.resultado.nota).toBeNull();
    expect(a.efetividade).toBeNull();
  });

  it("toda nota vem com motivo", () => {
    const a = avaliarChamado(chamado({ descricao: BOM }), AGORA);
    for (const n of Object.values(a.criterios)) expect(n.motivo.length).toBeGreaterThan(0);
  });

  it("nota do dev sobre a clareza puxa o critério", () => {
    const sem = avaliarChamado(chamado({ descricao: "ver tela" }), AGORA);
    const com = avaliarChamado(chamado({ descricao: "ver tela", aval_dev_clareza: 5 }), AGORA);
    expect(com.criterios.clareza_problema.nota!).toBeGreaterThan(sem.criterios.clareza_problema.nota!);
  });
});

describe("Monitoramento de Chamados — efetividade e prazo", () => {
  const concluido = { status: "concluido", concluido_em: "2026-10-11T10:00:00-03:00" } as const;

  it("concluído usa a avaliação do solicitante (5/5 = 100%)", () => {
    expect(avaliarChamado(chamado({ ...concluido, aval_entrega: 5 }), AGORA).efetividade).toBe(100);
    expect(avaliarChamado(chamado({ ...concluido, aval_entrega: 4 }), AGORA).efetividade).toBe(80);
  });

  it("sem avaliação parte de 80% e reabertura desconta", () => {
    expect(avaliarChamado(chamado({ ...concluido }), AGORA).efetividade).toBe(80);
    expect(avaliarChamado(chamado({ ...concluido, reaberturas: 1 }), AGORA).efetividade).toBe(65);
  });

  it("entregue depois do prazo previsto perde 10%", () => {
    expect(avaliarChamado(chamado({ ...concluido, aval_entrega: 5, prazo_previsto: "2026-10-05" }), AGORA).efetividade).toBe(90);
  });

  it("prazo em dias: da abertura à conclusão, ou até hoje se aberto", () => {
    expect(avaliarChamado(chamado({ ...concluido }), AGORA).prazoDias).toBe(10);
    expect(avaliarChamado(chamado({}), AGORA).prazoDias).toBe(21.1);
  });

  it("reprovado não tem efetividade", () => {
    expect(avaliarChamado(chamado({ status: "reprovado" }), AGORA).efetividade).toBeNull();
  });
});

describe("Monitoramento de Chamados — consolidação", () => {
  const linhas = [
    linha({ id: "a", solicitante_id: "u1", solicitante_nome: "Ana", setor: "Financeiro", status: "concluido", concluido_em: "2026-10-05T10:00:00-03:00", aval_entrega: 5, assunto: "Fluxo de caixa", descricao: BOM, anexos_abertura: 2 }),
    linha({ id: "b", solicitante_id: "u1", solicitante_nome: "Ana", setor: "Financeiro", status: "em_andamento", assunto: "Relatório de NFs", descricao: BOM }),
    linha({ id: "c", solicitante_id: "u2", solicitante_nome: "Bia", setor: "RH", status: "aberto", assunto: "x", descricao: "ver" }),
    linha({ id: "d", solicitante_id: "u3", solicitante_nome: "Caio", setor: "RH", status: "cancelado", assunto: "Relatório" }),
  ];

  // SIS-2026-0904: cancelado não entra no monitoramento — a tela tira na
  // entrada (entraNoMonitoramento) e as contas ignoram mesmo se chegar.
  it("cancelado fica fora do monitoramento", () => {
    expect(linhas.filter((l) => entraNoMonitoramento(l.c)).map((l) => l.c.id)).toEqual(["a", "b", "c"]);
    expect(entraNoMonitoramento({ status: "reprovado" })).toBe(true);
  });

  it("cancelado não pesa em total, solicitantes nem médias", () => {
    const k = calcularKpis(linhas);
    expect(k).toMatchObject({ total: 3, solicitantes: 2, concluidas: 1, emAndamento: 1, pendentes: 1 });
    expect(k).toEqual(calcularKpis(linhas.slice(0, 3)));
    expect(k.efetividadeMedia).toBe(100);
  });

  it("ranking não traz quem só cancelou e ordena pelo índice", () => {
    const r = rankingSolicitantes(linhas);
    expect(r.map((x) => x.nome)).toEqual(["Ana", "Bia"]);
    expect(r[0].total).toBe(2);
  });

  it("temas somam 100% (± arredondamento) e Outros vai por último", () => {
    const t = resumoTemas(linhas);
    expect(t.reduce((s, x) => s + x.qtd, 0)).toBe(3);
    expect(t[t.length - 1].tema).toBe("outros");
  });

  it("análise de qualidade e leitura em texto", () => {
    const q = analiseQualidade(linhas);
    expect(q.objetivoClaro).toBe(67);
    expect(leituraControladoria(linhas)).toMatch(/Financeiro/);
    expect(leituraControladoria([])).toMatch(/Sem solicitações/);
  });
});

describe("Monitoramento de Chamados — nota da I.A e ranking por volume (13/11/2026)", () => {
  const ia = (nota: number) => ({
    criterios: Object.fromEntries(["clareza_problema", "clareza_resultado", "descricao", "evidencias", "importancia",
      "aderencia", "reaproveitamento", "reducao_manual", "confiabilidade"].map((k) => [k, { nota, motivo: "ok" }])),
    resumo: "Pedido completo.", avaliado_em: "2026-11-13T10:00:00-03:00",
  });

  it("com a avaliação da I.A, os critérios de texto vêm dela e o índice chega a 9+", () => {
    const l = linha({ descricao: "ver", ia: ia(9.5) });
    expect(l.a.fonte).toBe("ia");
    expect(l.a.criterios.clareza_problema.nota).toBe(9.5);
    expect(l.a.indice).toBeGreaterThanOrEqual(9);
    expect(l.a.resumoIa).toBe("Pedido completo.");
  });

  it("I.A incompleta (faltou critério) cai na regra antiga", () => {
    const parcial = ia(9);
    delete (parcial.criterios as Record<string, unknown>).confiabilidade;
    expect(linha({ ia: parcial }).a.fonte).toBe("regra");
    expect(linha({ ia: null }).a.fonte).toBe("regra");
  });

  it("quem tem 2 chamados ótimos não passa à frente de quem tem 25 muito bons", () => {
    const ls: LinhaMonitor[] = [
      ...Array.from({ length: 2 }, (_, i) => linha({ id: `s${i}`, solicitante_id: "sen", solicitante_nome: "Poucos", ia: ia(9.6) })),
      ...Array.from({ length: 25 }, (_, i) => linha({ id: `f${i}`, solicitante_id: "fer", solicitante_nome: "Muitos", ia: ia(9) })),
      ...Array.from({ length: 30 }, (_, i) => linha({ id: `o${i}`, solicitante_id: `o${i % 6}`, solicitante_nome: `Outro ${i % 6}`, ia: ia(6) })),
    ];
    const r = rankingSolicitantes(ls);
    expect(r[0].nome).toBe("Muitos");
    expect(r[1].nome).toBe("Poucos");
    // a média simples continua aparecendo como é
    expect(r[1].indiceMedio).toBeGreaterThan(r[0].indiceMedio);
    expect(r[0].notaRanking).toBeGreaterThan(r[1].notaRanking);
    expect(r[0]).toMatchObject({ total: 25, pctBons: 100, avaliadosIa: 25 });
  });

  it("com volume parecido, a melhor média vence", () => {
    const ls = [
      ...Array.from({ length: 10 }, (_, i) => linha({ id: `a${i}`, solicitante_id: "a", solicitante_nome: "A", ia: ia(7) })),
      ...Array.from({ length: 10 }, (_, i) => linha({ id: `b${i}`, solicitante_id: "b", solicitante_nome: "B", ia: ia(8.5) })),
    ];
    expect(rankingSolicitantes(ls).map((x) => x.nome)).toEqual(["B", "A"]);
  });
});
