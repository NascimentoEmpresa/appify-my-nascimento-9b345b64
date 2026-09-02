import { describe, expect, it } from "vitest";
import {
  agregarSetor,
  elegivel,
  limparNomesProprios,
  normalizaSetor,
  validarDiagnostico,
  MAX_ITENS_POR_BLOCO,
  type PerguntaDiagnostico,
  type RespostaDiagnostico,
} from "../../supabase/functions/_shared/diagnostico-feedback.ts";

const perguntas: PerguntaDiagnostico[] = [
  {
    id: "p-colaborador",
    tipo: "colaborador",
    titulo: "IDENTIFICAÇÃO DO COLABORADOR",
    opcoes: [],
  },
  {
    id: "p-situacao",
    tipo: "multipla_escolha",
    titulo: "Como você acredita que está o seu trabalho hoje?",
    opcoes: ["Muito bem", "Com dificuldades"],
  },
  {
    id: "p-lideranca",
    tipo: "texto_longo",
    titulo: "O que você precisa mais da sua liderança para melhorar seu desempenho?",
    opcoes: [],
  },
  {
    id: "p-entrega",
    tipo: "lista_suspensa",
    titulo: "O nível de entrega dele hoje é:",
    opcoes: ["Acima", "Dentro", "Abaixo"],
  },
  {
    id: "p-melhoria",
    tipo: "texto_longo",
    titulo: "Ponto de melhoria principal",
    opcoes: [],
  },
  {
    id: "p-acao",
    tipo: "texto_longo",
    titulo: "Ação definida (treinamento ou acompanhamento)",
    opcoes: [],
  },
];

const resposta = (situacao: string, extra: Partial<RespostaDiagnostico> = {}): RespostaDiagnostico => ({
  setor: "LICITAÇÃO",
  respondente_nome: "NOME ULTRASSECRETO",
  respondente_email: "email-ultrassecreto@empresa.com",
  respondente_cadastro: "CADASTRO_ULTRASSECRETO",
  criado_por: "UUID_ULTRASSECRETO",
  itens: {
    "p-situacao": situacao,
    "p-colaborador": "ÍSADORA NASCIMENTO",
    "p-lideranca": "SABER DELEGAR MAIS ATIVIDADES PARA A ISADORA, SOMENTE FAZER ANÁLISE DOS DOCUMENTOS",
    "p-entrega": "Dentro",
    "p-melhoria": "Organização da rotina",
    "p-acao": "Acompanhamento quinzenal",
  },
  ...extra,
});

describe("normalização de setor", () => {
  it("junta LICITAÇÃO e LICITACAO na mesma chave", () => {
    expect(normalizaSetor("  LICITAÇÃO ")).toBe("LICITACAO");
    expect(normalizaSetor("licitacao")).toBe("LICITACAO");
  });
});

describe("agregado determinístico", () => {
  const respostas = [
    resposta("Muito bem"),
    resposta("Muito bem", { setor: "LICITACAO" }),
    resposta("Com dificuldades"),
  ];
  const agregado = agregarSetor(perguntas, respostas);

  it("calcula contagem e percentual antes da IA", () => {
    const fechada = agregado.liderados_para_lider.fechadas[0];
    expect(fechada.total_respondido).toBe(3);
    expect(fechada.distribuicao).toEqual([
      { opcao: "Muito bem", n: 2, pct: 66.7 },
      { opcao: "Com dificuldades", n: 1, pct: 33.3 },
    ]);
  });

  it("não copia campos identificadores para o payload", () => {
    const json = JSON.stringify(agregado);
    expect(json).not.toContain("respondente_nome");
    expect(json).not.toContain("respondente_email");
    expect(json).not.toContain("respondente_cadastro");
    expect(json).not.toContain("criado_por");
    expect(json).not.toContain("NOME ULTRASSECRETO");
    expect(json).not.toContain("email-ultrassecreto@empresa.com");
    expect(json).not.toContain("CADASTRO_ULTRASSECRETO");
    expect(json).not.toContain("UUID_ULTRASSECRETO");
  });

  it("remove em caixa alta somente o nome presente no dicionário", () => {
    const textos = agregado.liderados_para_lider.abertas
      .find((pergunta) => pergunta.pergunta.startsWith("O que você precisa"))?.textos ?? [];
    const texto = textos[0] ?? "";
    expect(texto).not.toMatch(/ISADORA/i);
    expect(texto).toContain("[pessoa]");
    expect(texto).toContain("DELEGAR");
    expect(texto).toContain("ATIVIDADES");
    expect(texto).toContain("ANÁLISE");
    expect(texto).toContain("DOCUMENTOS");
  });

  it("leva o fechamento ao eixo da liderança e ao plano", () => {
    expect(agregado.lider_para_liderados.abertas.some((p) => p.pergunta.startsWith("Ação definida"))).toBe(true);
    expect(agregado.plano.abertas.some((p) => p.pergunta.startsWith("Ação definida"))).toBe(true);
  });
});

describe("anonimização de textos livres", () => {
  const dicionario = new Set(["ISADORA NASCIMENTO"]);

  it("preserva integralmente texto em caixa alta sem nome do dicionário", () => {
    const texto = "ORGANIZAÇÃO E COMPROMETIMENTOS COM OS PROCESSOS SOLICITADOS";
    expect(limparNomesProprios(texto, dicionario)).toBe(texto);
  });

  it("não confunde cargo ou processo com pessoa", () => {
    const texto = "Apresenta bom desempenho nas atividades de Contas a Pagar, demonstrando organização";
    expect(limparNomesProprios(texto, dicionario)).toBe(texto);
  });

  it("não remove mais de 5% das palavras de uma massa em caixa alta sem nomes", () => {
    const textos = [
      "ORGANIZAÇÃO E COMPROMETIMENTOS COM OS PROCESSOS SOLICITADOS",
      "AGORA SENDO SUPERVISOR VEJO QUE PROCURA SEMPRE ORIENTAR E AJUDAR A EQUIPE",
      "SABER DIZER NÃO QUANDO NECESSÁRIO E MANTER O FOCO NAS PRIORIDADES",
      "MELHORAR A COMUNICAÇÃO ENTRE AS ÁREAS E DOCUMENTAR OS ACORDOS REALIZADOS",
      "APRESENTA BOM DESEMPENHO NAS ATIVIDADES DE CONTAS A PAGAR",
      "CONTINUAR APOIANDO O TIME NA OTIMIZAÇÃO DOS PROCESSOS INTERNOS",
    ];
    const contarPalavras = (texto: string) => texto.match(/\p{L}+/gu)?.length ?? 0;
    const antes = textos.reduce((total, texto) => total + contarPalavras(texto), 0);
    const depois = textos.reduce(
      (total, texto) => total + contarPalavras(limparNomesProprios(texto, dicionario)),
      0,
    );

    expect((antes - depois) / antes).toBeLessThanOrEqual(0.05);
  });
});

describe("elegibilidade", () => {
  // SIS-2026-0311 derrubou o mínimo de 5. Só o setor sem resposta nenhuma
  // continua barrado — e por economia de chamada de IA, não por privacidade
  // (essa é da policy cs_form_diag_select).
  it("barra apenas setor sem resposta nenhuma", () => {
    expect(elegivel(0)).toBe(false);
    expect(elegivel(1)).toBe(true);
    expect(elegivel(4)).toBe(true);
    expect(elegivel(5)).toBe(true);
  });
});

const itemTema = { tema: "Comunicação", evidencia: "Há demanda recorrente por alinhamento.", forca: "Alta" };
const diagnosticoValido = {
  setor: "LICITAÇÃO",
  qtd_respostas: 13,
  liderados_para_lider: [itemTema],
  lider_para_liderados: [itemTema],
  convergencias: [{ tema: "Alinhamento", leitura: "Os dois eixos apontam a mesma necessidade." }],
  plano_de_acao: [{ acao: "Criar rotina semanal", porque: "Ataca a lacuna observada.", prazo_sugerido_dias: 30, prioridade: "Alta" }],
};

describe("validação da saída da IA", () => {
  it("rejeita resposta sem os quatro blocos", () => {
    const { plano_de_acao, ...semPlano } = diagnosticoValido;
    const resultado = validarDiagnostico(semPlano);
    expect(resultado.ok).toBe(false);
  });

  it("trunca listas maiores que o contrato", () => {
    const muitos = Array.from({ length: MAX_ITENS_POR_BLOCO + 4 }, (_, i) => ({ ...itemTema, tema: `Tema ${i}` }));
    const resultado = validarDiagnostico({ ...diagnosticoValido, liderados_para_lider: muitos });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.diagnostico.liderados_para_lider).toHaveLength(MAX_ITENS_POR_BLOCO);
  });
});
