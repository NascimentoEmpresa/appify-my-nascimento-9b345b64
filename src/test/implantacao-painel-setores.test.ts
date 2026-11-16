import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assinaturaRespostas,
  categoriaDaPergunta,
  categoriasDasLinhas,
  filtrarLinhas,
  itensDoSetor,
  listarSetores,
  mapaRespostas,
  montarPainel,
  setorPorSlug,
  setoresDoResponsavel,
  slugSetor,
  valorLegivel,
  type ConfirmacaoPainel,
  type ItemPainel,
  type RespostaPainel,
} from "@/lib/implantacao/painelSetores";

// Recorte fiel do seed real (20260622000001 + 20260930000062): as quatro
// formas de "Resp. ação" que existem no banco.
const ITENS: ItemPainel[] = [
  { row_index: 3, item: "Locais de cada posto de trabalho", responsavel_acao: "RH" },
  { row_index: 8, item: "Forma de envio", responsavel_acao: "Financeiro" },
  { row_index: 9, item: "Documentação enviada antes ou junto da NF", responsavel_acao: "Financeiro" },
  { row_index: 10, item: "Medição de qualidade", responsavel_acao: "Operação" },
  { row_index: 63, item: "Supervisor do Contrato", responsavel_acao: "Operacional" },
  { row_index: 12, item: "CNPJ do contratante", responsavel_acao: "Todos" },
  { row_index: 30, item: "Uniformes", responsavel_acao: "SST/Compras" },
  { row_index: 40, item: "Sem responsável", responsavel_acao: null },
];

describe("setor de cada pergunta (Resp. ação)", () => {
  it("separa setores combinados e junta as grafias de Operacional", () => {
    expect(setoresDoResponsavel("SST/Compras")).toEqual(["SST", "Compras"]);
    expect(setoresDoResponsavel(" SST / Treinamentos ")).toEqual(["SST", "Treinamentos"]);
    expect(setoresDoResponsavel("Operação")).toEqual(["Operacional"]);
    expect(setoresDoResponsavel("todos")).toEqual(["Todos"]);
    expect(setoresDoResponsavel(null)).toEqual([]);
  });

  it("lista uma página por setor, sem 'Todos' e sem duplicar Operação/Operacional", () => {
    expect(listarSetores(ITENS)).toEqual(["Compras", "Financeiro", "Operacional", "RH", "SST"]);
  });

  it("slug estável e reversível pela lista de setores", () => {
    expect(slugSetor("Licitação")).toBe("licitacao");
    expect(slugSetor("SST/Compras")).toBe("sst-compras");
    expect(setorPorSlug(ITENS, "operacional")).toBe("Operacional");
    expect(setorPorSlug(ITENS, "nao-existe")).toBeNull();
  });

  it("o setor recebe as próprias perguntas e as comuns", () => {
    expect(itensDoSetor(ITENS, "Financeiro").map((i) => i.row_index)).toEqual([8, 9, 12]);
    expect(itensDoSetor(ITENS, "Compras").map((i) => i.row_index)).toEqual([12, 30]);
    expect(itensDoSetor(ITENS, "SST").map((i) => i.row_index)).toEqual([12, 30]);
  });
});

describe("painel geral e por setor", () => {
  const respostas: RespostaPainel[] = [
    { row_index: 8, resposta: '["E-mail","SEI"]' },
    { row_index: 9, resposta: "Antes da NF" },
    { row_index: 12, resposta: "00.000.000/0001-00" },
    { row_index: 3, resposta: "   " }, // em branco não conta
  ];

  it("status e contagens saem só das respostas gravadas", () => {
    const p = montarPainel(ITENS, respostas, []);
    const fin = p.setores.find((s) => s.setor === "Financeiro")!;
    expect(fin).toMatchObject({ total: 3, respondidos: 3, pendentes: 0, pct: 100, status: "em_andamento", prontoParaConfirmar: true });
    expect(fin.linhas[0].valor).toBe("E-mail, SEI");
    expect(fin.linhas.find((l) => l.row_index === 12)!.comum).toBe(true);

    // RH só tem a comum respondida → continua pendente e não conta como
    // acionado: as comuns não fazem o setor "andar" sozinhas.
    const rh = p.setores.find((s) => s.setor === "RH")!;
    expect(rh).toMatchObject({ status: "pendente", respondidos: 1, respondidosProprios: 0 });
    expect(p).toMatchObject({ totalSetores: 5, acionados: 1, confirmados: 0, pendencias: 5, progressoPct: 0 });
    expect(p.itensRespondidos).toBe(3);
    expect(p.itensTotal).toBe(ITENS.length);
  });

  it("setor sem resposta nenhuma fica pendente", () => {
    const p = montarPainel(ITENS, [], []);
    expect(p.setores.every((s) => s.status === "pendente")).toBe(true);
    expect(p.acionados).toBe(0);
  });

  it("confirmação vale enquanto as respostas não mudam", () => {
    const antes = montarPainel(ITENS, respostas, []);
    const fin = antes.setores.find((s) => s.setor === "Financeiro")!;
    const conf: ConfirmacaoPainel[] = [
      { setor: "Financeiro", assinatura: fin.assinatura, confirmado_em: "2026-11-12T10:00:00Z", confirmado_por: "u1" },
    ];

    const confirmado = montarPainel(ITENS, respostas, conf);
    const finOk = confirmado.setores.find((s) => s.setor === "Financeiro")!;
    expect(finOk).toMatchObject({ status: "concluido", prontoParaConfirmar: false, confirmacaoDesatualizada: false });
    expect(confirmado).toMatchObject({ confirmados: 1, pendencias: 4, progressoPct: 20 });

    // Alterar uma resposta no formulário derruba a confirmação.
    const alteradas = respostas.map((r) => (r.row_index === 9 ? { ...r, resposta: "Junto da NF" } : r));
    const depois = montarPainel(ITENS, alteradas, conf);
    const finDepois = depois.setores.find((s) => s.setor === "Financeiro")!;
    expect(finDepois).toMatchObject({ status: "em_andamento", confirmacaoDesatualizada: true, prontoParaConfirmar: true });

    // Mudança numa pergunta comum também derruba (ela é do setor).
    const comumAlterada = respostas.map((r) => (r.row_index === 12 ? { ...r, resposta: "11.111.111/0001-11" } : r));
    expect(montarPainel(ITENS, comumAlterada, conf).setores.find((s) => s.setor === "Financeiro")!.status).toBe("em_andamento");

    // Mudança em pergunta de OUTRO setor não mexe na confirmação do Financeiro.
    const outro = [...respostas, { row_index: 63, resposta: "Fulano" }];
    expect(montarPainel(ITENS, outro, conf).setores.find((s) => s.setor === "Financeiro")!.status).toBe("concluido");
  });

  it("assinatura ignora espaços nas pontas e muda com resposta apagada", () => {
    const itens = itensDoSetor(ITENS, "Financeiro");
    const a = assinaturaRespostas(itens, mapaRespostas(respostas));
    const b = assinaturaRespostas(itens, mapaRespostas(respostas.map((r) => ({ ...r, resposta: ` ${r.resposta} ` }))));
    const c = assinaturaRespostas(itens, mapaRespostas(respostas.filter((r) => r.row_index !== 9)));
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it("valorLegivel lê lista JSON e mantém texto comum", () => {
    expect(valorLegivel('["ASO","CTPS"]')).toBe("ASO, CTPS");
    expect(valorLegivel("[rascunho")).toBe("[rascunho");
    expect(valorLegivel(null)).toBe("");
  });
});

describe("Implantação › página do setor — categorias e filtros", () => {
  it("comuns viram Dados do contrato / Informações gerais; as do setor, o grupo do tema", () => {
    expect(categoriaDaPergunta("CNPJ do contratante", true)).toBe("Dados do contrato");
    expect(categoriaDaPergunta("Nº pessoas (Quantidade de postos)", true)).toBe("Dados do contrato");
    expect(categoriaDaPergunta("Cidade", true)).toBe("Informações gerais");
    expect(categoriaDaPergunta("Compras de crachá", false)).toBe("Uniformes e compras");
    expect(categoriaDaPergunta("Prazo envio ASOs", false)).toBe("Saúde e treinamentos");
    expect(categoriaDaPergunta("Documentos mensais para emissão da nota", false)).toBe("Documentação e faturamento");
    expect(categoriaDaPergunta("Escala de horário de postos", false)).toBe("Informações específicas");
  });

  it("abas na ordem fixa e filtro por busca, status e categoria", () => {
    const linha = (row: number, pergunta: string, comum: boolean, valor: string) => ({
      row_index: row, pergunta, valor, respondido: !!valor, comum, plano_acao: "Recebimento dados", onde: "ERP",
      categoria: categoriaDaPergunta(pergunta, comum),
    });
    const linhas = [
      linha(1, "Escala de horário de postos", false, ""),
      linha(2, "CNPJ do contratante", true, "00.000.000/0001-00"),
      linha(3, "Compras de uniformes", false, "Pedido feito"),
    ];
    expect(categoriasDasLinhas(linhas)).toEqual(["Dados do contrato", "Uniformes e compras", "Informações específicas"]);
    expect(filtrarLinhas(linhas, "", "pendentes", "todas").map((l) => l.row_index)).toEqual([1]);
    expect(filtrarLinhas(linhas, "pedido", "todos", "todas").map((l) => l.row_index)).toEqual([3]);
    expect(filtrarLinhas(linhas, "", "preenchidos", "Dados do contrato").map((l) => l.row_index)).toEqual([2]);
  });
});

describe("Implantação › submódulo Resumo dos Contratos (Sidebar)", () => {
  it("os links do menu batem com o slug de cada setor do checklist", () => {
    const fonte = readFileSync(resolve(__dirname, "../components/layout/Sidebar.tsx"), "utf8");
    const nomes = ["Compras", "Financeiro", "Licitação", "Operação", "Recrutamento", "RH", "SST", "Treinamentos"];
    for (const nome of nomes) {
      const setor = setoresDoResponsavel(nome)[0];
      expect(fonte).toContain(`"/app/licitacoes/implantacao/painel/${slugSetor(setor)}"`);
    }
  });
});
