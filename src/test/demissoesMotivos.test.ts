import { describe, expect, it } from "vitest";
import {
  AGUARDANDO_IA, contarMotivos, contratosPorMotivo, cruzarContratoMotivo, dadosEmpilhados, DEMAIS, filtrarDetalhe, NAO_INFORMADO,
  pendentesIA, SEM_CONTRATO, tituloDetalhe, type LinhaDemissao,
} from "@/lib/relatorios/demissoesMotivos";
import {
  CATEGORIA_SEM_RELATO, CATEGORIAS_RELATO, lerResposta, montarPrompt, normalizarCategoria, separarParaIA, SYSTEM_PROMPT,
} from "../../supabase/functions/_shared/demissao-relato-ia";

let seq = 0;
const linha = (p: Partial<LinhaDemissao>): LinhaDemissao => ({
  id: ++seq, data: "2026-10-01", colaborador: "Fulano", cargo: "SERVENTE", contrato: "1052 - HUSM", status: "Concluída",
  grupo: "concluido", motivo_solicitacao: "Pedido de demissão pelo colaborador", motivo_pedido: "Proposta de outro emprego",
  relato: "colaborador pediu pra sair", categoria_ia: "Pediu para sair (sem detalhar)", ...p,
});

describe("demissões › motivo por contrato", () => {
  const base = [
    linha({ contrato: "A" }),
    linha({ contrato: "A", motivo_solicitacao: "Desligamento sem justa causa" }),
    linha({ contrato: "A" }),
    linha({ contrato: "B", motivo_solicitacao: "Desligamento sem justa causa" }),
    linha({ contrato: "  ", motivo_solicitacao: null }),
  ];

  it("cruza contrato × motivo, contratos e motivos do maior para o menor, total bate", () => {
    const cz = cruzarContratoMotivo(base, "motivo_solicitacao");
    expect(cz.total).toBe(5);
    expect(cz.linhas.map((l) => [l.contrato, l.total])).toEqual([["A", 3], [SEM_CONTRATO, 1], ["B", 1]]);
    expect(cz.linhas[0].porMotivo).toEqual({ "Pedido de demissão pelo colaborador": 2, "Desligamento sem justa causa": 1 });
    expect(cz.motivos[0]).toBe("Desligamento sem justa causa"); // 2 = empate com "Pedido…", desempata por nome
    expect(cz.totalPorMotivo[NAO_INFORMADO]).toBe(1);
    const soma = cz.linhas.reduce((s, l) => s + Object.values(l.porMotivo).reduce((a, b) => a + b, 0), 0);
    expect(soma).toBe(cz.total);
  });

  it("categoria da I.A vazia conta como aguardando, e não como 'não informado'", () => {
    const ls = [linha({ categoria_ia: null }), linha({ categoria_ia: "Faltas e atrasos" })];
    expect(contarMotivos(ls, "categoria_ia").map((x) => x.nome).sort()).toEqual([AGUARDANDO_IA, "Faltas e atrasos"].sort());
    expect(pendentesIA(ls)).toBe(1);
  });

  it("empilhado: motivos além do limite viram 'Demais' e a barra soma o total do contrato", () => {
    const ls = ["m1", "m2", "m3", "m4"].flatMap((m, i) => Array.from({ length: 4 - i }, () => linha({ contrato: "X", motivo_pedido: m })));
    const cz = cruzarContratoMotivo(ls, "motivo_pedido");
    const emp = dadosEmpilhados(cz, 12, 3);
    expect(emp.series).toEqual(["m1", "m2", DEMAIS]);
    expect(emp.dados[0]).toMatchObject({ contrato: "X", total: 10, m1: 4, m2: 3, [DEMAIS]: 3 });
    // Sem passar do limite, não cria "Demais".
    expect(dadosEmpilhados(cz, 12, 4).series).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("detalhe: filtra por contrato, por motivo e resolve 'Demais' pelos visíveis", () => {
    const ls = [linha({ contrato: "A", motivo_pedido: "m1" }), linha({ contrato: "A", motivo_pedido: "m2" }), linha({ contrato: "B", motivo_pedido: "m3" })];
    expect(filtrarDetalhe(ls, { dim: "motivo_pedido", motivo: "m1", contrato: "A" })).toHaveLength(1);
    expect(filtrarDetalhe(ls, { dim: "motivo_pedido", motivo: null, contrato: "A" })).toHaveLength(2);
    expect(filtrarDetalhe(ls, { dim: "motivo_pedido", motivo: DEMAIS, contrato: null, visiveis: ["m1"] }).map((l) => l.motivo_pedido)).toEqual(["m2", "m3"]);
    expect(tituloDetalhe({ dim: "categoria_ia", motivo: "Estudos", contrato: "A" })).toBe("Relato (I.A): Estudos · A");
    expect(tituloDetalhe({ dim: "motivo_pedido", motivo: null, contrato: null })).toBe("Todas as solicitações");
  });
});

describe("demissões › relato agrupado pela I.A (parte pura da Edge)", () => {
  it("normaliza o que a I.A devolve para a lista fechada", () => {
    expect(normalizarCategoria("Proposta de outro emprego")).toBe("Proposta de outro emprego");
    expect(normalizarCategoria("  proposta de OUTRO emprego. ")).toBe("Proposta de outro emprego");
    expect(normalizarCategoria("Problemas de saude")).toBe("Problemas de saúde");
    expect(normalizarCategoria("Aposentado por invalidez")).toBe("Outro"); // não é começo de nenhuma
    expect(normalizarCategoria("Aposentad")).toBe("Aposentadoria"); // começo único
    expect(normalizarCategoria("Problemas")).toBe("Outro"); // começo de duas → não chuta
    expect(normalizarCategoria("Saiu porque quis")).toBe("Outro");
    expect(normalizarCategoria(null)).toBe("Outro");
  });

  it("relatos ditos de jeitos diferentes só viram um grupo se a I.A der a mesma categoria — e a resposta é lida com tolerância", () => {
    const resp = "Claro! ```json\n{\"itens\":[{\"id\":1,\"categoria\":\"Pediu para sair (sem detalhar)\"},{\"id\":2,\"categoria\":\"pediu para sair (sem detalhar)\"},{\"id\":3,\"categoria\":\"Pediu para sair (sem detalhar)\"},{\"id\":99,\"categoria\":\"Estudos\"},{\"id\":1,\"categoria\":\"Estudos\"}]}\n```";
    const m = lerResposta(resp, [1, 2, 3, 4]);
    expect([...m.entries()]).toEqual([[1, "Pediu para sair (sem detalhar)"], [2, "Pediu para sair (sem detalhar)"], [3, "Pediu para sair (sem detalhar)"]]);
    expect(m.has(4)).toBe(false); // não veio → continua pendente
    expect(m.has(99)).toBe(false); // não foi pedido
    expect(lerResposta("não sei", [1]).size).toBe(0);
    expect(lerResposta("{quebrado", [1]).size).toBe(0);
  });

  it("relato curto não vai para a I.A", () => {
    const r = separarParaIA([{ id: 1, relato: "  " }, { id: 2, relato: "saiu" }, { id: 3, relato: "colaborador quis sair da empresa" }]);
    expect(r.semRelato).toEqual([1, 2]);
    expect(r.ia.map((x) => x.id)).toEqual([3]);
    expect(CATEGORIA_SEM_RELATO).not.toBe("Outro");
  });

  it("prompt leva todas as categorias e um JSON por relato, com o motivo de lista", () => {
    for (const c of CATEGORIAS_RELATO) expect(SYSTEM_PROMPT).toContain(`- ${c}`);
    const p = montarPrompt([{ id: 7, relato: "precisava\n sair", motivo_solicitacao: "Pedido de demissão pelo colaborador", motivo_pedido: null }]);
    expect(p).toContain('{"id":7,"motivo_lista":"Pedido de demissão pelo colaborador","relato":"precisava sair"}');
  });
});

describe("demissões › contratos por motivo (tooltip da I.A)", () => {
  it("lista contratos do motivo do maior para o menor, corta em max e conta o resto", () => {
    const ls = [
      linha({ contrato: "B" }), linha({ contrato: "A" }), linha({ contrato: "A" }), linha({ contrato: "C" }),
      linha({ contrato: " ", categoria_ia: null }),
    ];
    const r = contratosPorMotivo(ls, "categoria_ia", 2);
    expect(r.get("Pediu para sair (sem detalhar)")).toEqual({ itens: [{ contrato: "A", n: 2 }, { contrato: "B", n: 1 }], outros: 1 });
    expect(r.get(AGUARDANDO_IA)).toEqual({ itens: [{ contrato: SEM_CONTRATO, n: 1 }], outros: 0 });
  });
});
