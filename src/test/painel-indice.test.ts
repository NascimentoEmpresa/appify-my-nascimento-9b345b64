import { describe, expect, it } from "vitest";
import {
  buscarPessoas,
  montarIndicePainel,
  montarPromptChat,
  type FormularioPainel,
  type RespostaPainel,
} from "../../supabase/functions/_shared/painel-indice.ts";

// Dois formulários de propósito: a causa nº 1 de um falso "não existe" é a
// pessoa estar no formulário que não está selecionado no topo da tela.
const formularios: FormularioPainel[] = [
  {
    id: "form-lideranca",
    titulo: "FEEDBACK GUIADO | LIDERANÇA",
    perguntas: [
      { id: "p-colaborador", tipo: "colaborador", titulo: "IDENTIFICAÇÃO DO COLABORADOR" },
      { id: "p-melhoria", tipo: "texto_longo", titulo: "Ponto de melhoria principal" },
    ],
  },
  {
    id: "form-clima",
    titulo: "PESQUISA DE CLIMA",
    perguntas: [
      { id: "c-nome", tipo: "texto_curto", titulo: "Nome do colaborador avaliado" },
    ],
  },
];

const respostas: RespostaPainel[] = [
  {
    id: "r1", formulario_id: "form-lideranca", setor: "SISTEMAS",
    respondente_nome: "HELENA NASCIMENTO",
    itens: {
      "p-colaborador": "EDUARDO JEIEL PADILHA MONTEIRO VAZ",
      "p-melhoria": "SEGREDO ABSOLUTO DO FEEDBACK",
    },
  },
  {
    id: "r2", formulario_id: "form-lideranca", setor: "JURÍDICO",
    respondente_nome: "HELENA NASCIMENTO",
    itens: { "p-colaborador": "ÍSADORA NASCIMENTO", "p-melhoria": "OUTRO SEGREDO" },
  },
  {
    id: "r3", formulario_id: "form-clima", setor: "OPERACIONAL",
    respondente_nome: "IURY DE JESUS SILVA",
    itens: { "c-nome": "CARLOS EDUARDO SOUZA" },
  },
];

const indice = montarIndicePainel(formularios, respostas);

describe("índice do painel", () => {
  it("indexa respondente e avaliado, não só quem preencheu", () => {
    const nomes = indice.pessoas.map((p) => p.nome);
    expect(nomes).toContain("HELENA NASCIMENTO");           // respondente
    expect(nomes).toContain("EDUARDO JEIEL PADILHA MONTEIRO VAZ"); // avaliado
    expect(nomes).toContain("CARLOS EDUARDO SOUZA");        // avaliado por título
  });

  it("guarda o setor e o formulário de cada pessoa", () => {
    const eduardo = indice.pessoas.find((p) => p.nome.startsWith("EDUARDO"))!;
    expect(eduardo.setores).toEqual(["SISTEMAS"]);
    expect(eduardo.formularios).toEqual(["FEEDBACK GUIADO | LIDERANÇA"]);
    expect(eduardo.papeis).toEqual(["avaliado"]);
  });

  it("soma os setores de quem aparece em mais de um", () => {
    const helena = indice.pessoas.find((p) => p.nome === "HELENA NASCIMENTO")!;
    expect(helena.setores.sort()).toEqual(["JURÍDICO", "SISTEMAS"]);
    expect(helena.qtd_respostas).toBe(2);
  });

  it("agrega os setores com a contagem de respostas", () => {
    const sistemas = indice.setores.find((s) => s.setor === "SISTEMAS")!;
    expect(sistemas.qtd_respostas).toBe(1);
    expect(indice.total_respostas).toBe(3);
  });
});

describe("busca determinística de pessoa", () => {
  it("acha pelo nome completo escrito dentro da frase", () => {
    const { achados } = buscarPessoas(
      indice,
      "IA, não estou conseguindo localizar o colaborador EDUARDO JEIEL PADILHA MONTEIRO VAZ",
    );
    expect(achados.map((p) => p.nome)).toContain("EDUARDO JEIEL PADILHA MONTEIRO VAZ");
  });

  it("acha por nome parcial, sem acento e em caixa baixa", () => {
    const { achados } = buscarPessoas(indice, "onde esta a isadora nascimento?");
    expect(achados.map((p) => p.nome)).toContain("ÍSADORA NASCIMENTO");
  });

  it("acha quem está em formulário diferente do selecionado na tela", () => {
    const { achados } = buscarPessoas(indice, "cadê o CARLOS EDUARDO SOUZA");
    const carlos = achados.find((p) => p.nome === "CARLOS EDUARDO SOUZA");
    expect(carlos?.formularios).toEqual(["PESQUISA DE CLIMA"]);
  });

  it("com um primeiro nome ambíguo devolve todos os candidatos, nunca vazio", () => {
    const { achados } = buscarPessoas(indice, "procuro o eduardo");
    expect(achados.length).toBeGreaterThanOrEqual(2);
  });

  it("devolve vazio só quando o nome realmente não aparece", () => {
    const { achados } = buscarPessoas(indice, "procuro o ZEBEDEU QUARTZO");
    expect(achados).toHaveLength(0);
  });

  it("não confunde palavra comum da pergunta com nome", () => {
    const { achados } = buscarPessoas(indice, "quais setores tem feedback?");
    expect(achados).toHaveLength(0);
  });
});

describe("prompt do chat", () => {
  const busca = buscarPessoas(indice, "onde está EDUARDO JEIEL PADILHA MONTEIRO VAZ");
  const prompt = montarPromptChat(indice, busca, "onde está EDUARDO JEIEL PADILHA MONTEIRO VAZ");

  it("não leva o conteúdo dos feedbacks para a IA", () => {
    expect(prompt).not.toContain("SEGREDO ABSOLUTO DO FEEDBACK");
    expect(prompt).not.toContain("OUTRO SEGREDO");
  });

  it("leva o resultado da busca já pronto, para a IA não decidir existência", () => {
    expect(prompt).toContain("ACHADOS");
    expect(prompt).toContain("EDUARDO JEIEL PADILHA MONTEIRO VAZ");
    expect(prompt).toContain("SISTEMAS");
  });
});
