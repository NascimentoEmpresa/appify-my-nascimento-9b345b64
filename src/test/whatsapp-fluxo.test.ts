import { describe, it, expect } from "vitest";
import {
  rotearBot, inferirModo, acharOpcao, AVISO_TRANSFERIR_PADRAO, type BotConfig,
  extrairTransferencia, montarPastas, montarVagas,
} from "../../supabase/functions/_shared/whatsapp-bot.ts";

// Config mínima do bot com um menu em CASCATA (texto / submenu / ia / humano).
// O reducer e o inferidor de modo são puros, então dá para exercitar o fluxo
// inteiro sem banco, sem WhatsApp e sem IA.
const cfg = (menu: BotConfig["menu"]): BotConfig => ({
  ativo: true,
  persona: "p",
  fallback: "fb",
  atende_24h: true,
  horario_inicio: "08:00",
  horario_fim: "18:00",
  dias_semana: [0, 1, 2, 3, 4, 5, 6],
  fora_horario_msg: "fora",
  provedor: "groq",
  modelo: "m",
  max_tokens: 512,
  menu,
});

const MENU = {
  titulo: "Olá! Selecione a opção que deseja:",
  opcoes: [
    { id: "vagas", titulo: "Vagas", acao: "texto" as const, valor: "acesse o site" },
    {
      id: "rh", titulo: "RH", acao: "submenu" as const, valor: "",
      submenu: {
        titulo: "RH — escolha uma opção:",
        opcoes: [
          { id: "rh_ia", titulo: "Atendimento por I.A", acao: "ia" as const, valor: "" },
          { id: "rh_doc", titulo: "Documentos", acao: "texto" as const, valor: "mande o documento" },
        ],
      },
    },
    { id: "humano", titulo: "Falar com atendente", acao: "humano" as const, valor: "" },
  ],
};

const base = cfg(MENU);

describe("rotearBot — fluxo único guiado por menu em cascata", () => {
  it("fora do horário responde o aviso e para", () => {
    const r = rotearBot(base, { modo: "menu", texto: "oi", replyId: null, dentroHorario: false });
    expect(r.tipo).toBe("fora_horario");
  });

  it("texto livre em modo menu apresenta o menu RAIZ (nunca cai direto na IA)", () => {
    const r = rotearBot(base, { modo: "menu", texto: "tem vaga?", replyId: null, dentroHorario: true });
    expect(r.tipo).toBe("menu");
    if (r.tipo === "menu") {
      expect(r.menu.titulo).toBe(MENU.titulo);
      expect(r.menu.opcoes.map((o) => o.id)).toEqual(["vagas", "rh", "humano"]);
    }
  });

  it("clique numa opção de texto envia a resposta pronta", () => {
    const r = rotearBot(base, { modo: "menu", texto: null, replyId: "vagas", dentroHorario: true });
    expect(r).toMatchObject({ tipo: "texto", texto: "acesse o site", modo: "menu" });
  });

  it("clique numa opção de submenu desce a cascata (mostra as sub-opções)", () => {
    const r = rotearBot(base, { modo: "menu", texto: null, replyId: "rh", dentroHorario: true });
    expect(r.tipo).toBe("menu");
    if (r.tipo === "menu") {
      expect(r.menu.titulo).toBe("RH — escolha uma opção:");
      expect(r.menu.opcoes.map((o) => o.id)).toEqual(["rh_ia", "rh_doc"]);
    }
  });

  it("clique numa sub-opção de texto (2º nível) responde o texto dela", () => {
    const r = rotearBot(base, { modo: "menu", texto: null, replyId: "rh_doc", dentroHorario: true });
    expect(r).toMatchObject({ tipo: "texto", texto: "mande o documento", modo: "menu" });
  });

  it("clique na opção de IA dentro do submenu entra na IA", () => {
    const r = rotearBot(base, { modo: "menu", texto: null, replyId: "rh_ia", dentroHorario: true });
    expect(r.tipo).toBe("ia_intro");
    expect(r.modo).toBe("ia");
  });

  it("clique em atendente encaminha para humano", () => {
    const r = rotearBot(base, { modo: "menu", texto: null, replyId: "humano", dentroHorario: true });
    expect(r.tipo).toBe("humano");
    expect(r.modo).toBe("menu");
  });

  it("texto livre em modo IA vai para a IA", () => {
    const r = rotearBot(base, { modo: "ia", texto: "tem vaga de cozinheiro?", replyId: null, dentroHorario: true });
    expect(r).toMatchObject({ tipo: "ia", modo: "ia" });
  });

  it('digitar "menu" em modo IA volta para o menu raiz', () => {
    const r = rotearBot(base, { modo: "ia", texto: "menu", replyId: null, dentroHorario: true });
    expect(r.tipo).toBe("menu");
    if (r.tipo === "menu") expect(r.menu.titulo).toBe(MENU.titulo);
  });

  it("sem menu configurado o bot NÃO responde nada (a IA nunca atende por conta própria)", () => {
    const r = rotearBot(cfg({ titulo: "", opcoes: [] }), { modo: "menu", texto: "oi", replyId: null, dentroHorario: true });
    expect(r.tipo).toBe("nada");
    const r2 = rotearBot(cfg(null), { modo: "menu", texto: "oi", replyId: null, dentroHorario: true });
    expect(r2.tipo).toBe("nada");
  });

  it("opção que não existe mais reapresenta o menu raiz", () => {
    const r = rotearBot(base, { modo: "menu", texto: null, replyId: "inexistente", dentroHorario: true });
    expect(r.tipo).toBe("menu");
    if (r.tipo === "menu") expect(r.menu.titulo).toBe(MENU.titulo);
  });

  it("submenu sem opções (config pela metade) volta ao menu raiz", () => {
    const comVazio = cfg({
      titulo: "raiz",
      opcoes: [{ id: "s", titulo: "Setores", acao: "submenu", valor: "", submenu: { titulo: "vazio", opcoes: [] } }],
    });
    const r = rotearBot(comVazio, { modo: "menu", texto: null, replyId: "s", dentroHorario: true });
    expect(r.tipo).toBe("menu");
    if (r.tipo === "menu") expect(r.menu.titulo).toBe("raiz");
  });
});

describe("inferirModo — reconstrói o modo a partir do histórico", () => {
  it("sem eventos definidores fica no menu", () => {
    expect(inferirModo(base, [{ direcao: "entrada", texto: "oi", payload: null }])).toBe("menu");
  });

  it("clique na opção de IA DENTRO do submenu deixa a conversa em modo IA", () => {
    const hist = [
      { direcao: "entrada", texto: "oi", payload: null },
      { direcao: "saida", texto: MENU.titulo, payload: null },
      { direcao: "entrada", texto: "RH", payload: { reply_id: "rh" } },
      { direcao: "saida", texto: "RH — escolha uma opção:", payload: null },
      { direcao: "entrada", texto: "Atendimento por I.A", payload: { reply_id: "rh_ia" } },
      { direcao: "saida", texto: "Perfeito!", payload: null },
      { direcao: "entrada", texto: "tem vaga?", payload: null },
    ];
    expect(inferirModo(base, hist)).toBe("ia");
  });

  it("clique num submenu NÃO muda o modo (continua no menu)", () => {
    const hist = [
      { direcao: "entrada", texto: "RH", payload: { reply_id: "rh" } },
    ];
    expect(inferirModo(base, hist)).toBe("menu");
  });

  it('digitar "menu" depois do clique de IA volta o modo para menu', () => {
    const hist = [
      { direcao: "entrada", texto: "Atendimento por I.A", payload: { reply_id: "rh_ia" } },
      { direcao: "entrada", texto: "menu", payload: null },
    ];
    expect(inferirModo(base, hist)).toBe("menu");
  });

  it("um clique em opção de texto mantém o modo menu", () => {
    const hist = [
      { direcao: "entrada", texto: "Atendimento por I.A", payload: { reply_id: "rh_ia" } },
      { direcao: "entrada", texto: "Documentos", payload: { reply_id: "rh_doc" } },
    ];
    expect(inferirModo(base, hist)).toBe("menu");
  });

  it("sem menu configurado o modo é menu (bot mudo)", () => {
    expect(inferirModo(cfg(null), [{ direcao: "entrada", texto: "oi", payload: null }])).toBe("menu");
  });
});

// Resposta com botões: o texto vira o corpo da mensagem e os botões os próximos
// passos. Como cada botão é uma opção comum, isso se repete em profundidade.
describe("rotearBot — resposta com botões", () => {
  const MENU_B = {
    titulo: "Selecione:",
    opcoes: [
      {
        id: "vagas", titulo: "Vagas", acao: "texto" as const, valor: "Acesse o site: exemplo.com",
        submenu: {
          titulo: "",
          opcoes: [
            {
              id: "vagas_como", titulo: "Como me candidato?", acao: "texto" as const, valor: "É só preencher o formulário.",
              submenu: {
                titulo: "",
                opcoes: [{ id: "vagas_prazo", titulo: "Qual o prazo?", acao: "texto" as const, valor: "Até dia 30." }],
              },
            },
            { id: "vagas_humano", titulo: "Falar com alguém", acao: "humano" as const, valor: "Já te transfiro!" },
          ],
        },
      },
      { id: "simples", titulo: "Simples", acao: "texto" as const, valor: "resposta sem botão" },
    ],
  };
  const bb = cfg(MENU_B);

  it("resposta SEM botões continua sendo texto puro", () => {
    const r = rotearBot(bb, { modo: "menu", texto: null, replyId: "simples", dentroHorario: true });
    expect(r.tipo).toBe("texto");
    if (r.tipo === "texto") expect(r.texto).toBe("resposta sem botão");
  });

  it("resposta COM botões vira uma mensagem só: texto no corpo + botões", () => {
    const r = rotearBot(bb, { modo: "menu", texto: null, replyId: "vagas", dentroHorario: true });
    expect(r.tipo).toBe("menu");
    if (r.tipo === "menu") {
      expect(r.menu.titulo).toBe("Acesse o site: exemplo.com");
      expect(r.menu.opcoes.map((o) => o.id)).toEqual(["vagas_como", "vagas_humano"]);
    }
  });

  // O ponto do pedido: a resposta da resposta também tem botões.
  it("o botão de uma resposta abre outra resposta com botões", () => {
    const r = rotearBot(bb, { modo: "menu", texto: null, replyId: "vagas_como", dentroHorario: true });
    expect(r.tipo).toBe("menu");
    if (r.tipo === "menu") {
      expect(r.menu.titulo).toBe("É só preencher o formulário.");
      expect(r.menu.opcoes.map((o) => o.id)).toEqual(["vagas_prazo"]);
    }
  });

  it("no terceiro nível, sem mais botões, volta a ser texto puro", () => {
    const r = rotearBot(bb, { modo: "menu", texto: null, replyId: "vagas_prazo", dentroHorario: true });
    expect(r.tipo).toBe("texto");
    if (r.tipo === "texto") expect(r.texto).toBe("Até dia 30.");
  });

  // Sem isto o clique num botão pendurado numa RESPOSTA não seria encontrado
  // (a busca só descia por opção de ação "submenu") e o bot devolveria o menu raiz.
  it("acha opção de qualquer ação em qualquer profundidade", () => {
    expect(acharOpcao(MENU_B, "vagas_prazo")?.titulo).toBe("Qual o prazo?");
    expect(acharOpcao(MENU_B, "vagas_humano")?.acao).toBe("humano");
    expect(acharOpcao(MENU_B, "nao_existe")).toBeNull();
  });

  it("botão de atendente dentro de uma resposta continua transferindo", () => {
    const r = rotearBot(bb, { modo: "menu", texto: null, replyId: "vagas_humano", dentroHorario: true });
    expect(r.tipo).toBe("humano");
    if (r.tipo === "humano") expect(r.aviso).toBe("Já te transfiro!");
  });
});

// Transferir para pasta (fila de setor). A conversa sai do bot e passa a
// pertencer a uma pasta; só quem tem acesso àquela pasta enxerga.
describe("rotearBot — transferir para pasta", () => {
  const MENU_T = {
    titulo: "Selecione:",
    opcoes: [
      { id: "t_rh", titulo: "Suporte RH", acao: "transferir" as const, valor: "Encaminhei pro RH!", pasta: "rh" },
      { id: "t_sem", titulo: "Sem pasta", acao: "transferir" as const, valor: "" },
      {
        id: "setores", titulo: "Setores", acao: "submenu" as const, valor: "",
        submenu: {
          titulo: "Qual setor?",
          opcoes: [{ id: "t_jur", titulo: "Jurídico", acao: "transferir" as const, valor: "", pasta: "juridico" }],
        },
      },
    ],
  };
  const bt = cfg(MENU_T);

  it("clicar na opção manda para a pasta configurada, com o aviso escolhido", () => {
    const r = rotearBot(bt, { modo: "menu", texto: null, replyId: "t_rh", dentroHorario: true });
    expect(r.tipo).toBe("transferir");
    if (r.tipo === "transferir") {
      expect(r.pasta).toBe("rh");
      expect(r.aviso).toBe("Encaminhei pro RH!");
    }
  });

  it("transferir sem aviso configurado usa o texto padrão", () => {
    const r = rotearBot(cfg({
      titulo: "t",
      opcoes: [{ id: "x", titulo: "X", acao: "transferir" as const, valor: "", pasta: "sst" }],
    }), { modo: "menu", texto: null, replyId: "x", dentroHorario: true });
    expect(r.tipo).toBe("transferir");
    if (r.tipo === "transferir") expect(r.aviso).toBe(AVISO_TRANSFERIR_PADRAO);
  });

  // Config pela metade não pode largar a conversa num limbo: sem pasta ela vira
  // atendimento humano comum, que pelo menos aparece para quem vê "todas".
  it("transferir SEM pasta escolhida vira atendimento humano", () => {
    const r = rotearBot(bt, { modo: "menu", texto: null, replyId: "t_sem", dentroHorario: true });
    expect(r.tipo).toBe("humano");
  });

  it("transferir funciona em qualquer nível da cascata", () => {
    const r = rotearBot(bt, { modo: "menu", texto: null, replyId: "t_jur", dentroHorario: true });
    expect(r.tipo).toBe("transferir");
    if (r.tipo === "transferir") expect(r.pasta).toBe("juridico");
  });

  it("clique em transferir mantém o modo menu (não entrega a conversa à IA)", () => {
    expect(inferirModo(bt, [
      { direcao: "entrada", texto: "Suporte RH", payload: { reply_id: "t_rh" } },
    ])).toBe("menu");
  });
});

// ── Transferência pedida pela IA ────────────────────────────────────────
// A IA não move nada sozinha: ela escreve uma marca e o webhook decide. O que
// se protege aqui é o contrato dessa marca — principalmente que ela NUNCA
// sobre para o WhatsApp, mesmo quando o código não existe.
describe("extrairTransferencia", () => {
  const PASTAS = ["recrutamento", "rh", "juridico"];

  it("sem marca devolve o texto intacto e nenhuma pasta", () => {
    const r = extrairTransferencia("Posso te ajudar com mais alguma coisa?", PASTAS);
    expect(r.pasta).toBeNull();
    expect(r.texto).toBe("Posso te ajudar com mais alguma coisa?");
  });

  it("extrai a pasta e tira a marca do texto", () => {
    const r = extrairTransferencia("Beleza, já encaminhei!\n[[TRANSFERIR:recrutamento]]", PASTAS);
    expect(r.pasta).toBe("recrutamento");
    expect(r.texto).toBe("Beleza, já encaminhei!");
  });

  it("código inexistente não transfere, mas a marca some do texto", () => {
    const r = extrairTransferencia("Já encaminhei!\n[[TRANSFERIR:financeiro]]", PASTAS);
    expect(r.pasta).toBeNull();
    expect(r.texto).toBe("Já encaminhei!");
  });

  it("aceita espaços e maiúsculas na marca", () => {
    expect(extrairTransferencia("ok [[ transferir : RH ]]", PASTAS).pasta).toBe("rh");
  });

  // O modelo às vezes responde só com a marca. Sem tratar, o bot enviaria uma
  // mensagem vazia justamente no fim do atendimento.
  it("marca sozinha deixa o texto vazio para o chamador usar a despedida padrão", () => {
    const r = extrairTransferencia("[[TRANSFERIR:rh]]", PASTAS);
    expect(r.pasta).toBe("rh");
    expect(r.texto).toBe("");
  });

  it("remove todas as marcas, não só a primeira", () => {
    const r = extrairTransferencia("[[TRANSFERIR:xx]] tchau [[TRANSFERIR:rh]]", PASTAS);
    expect(r.pasta).toBe("rh");
    expect(r.texto).toBe("tchau");
  });
});

describe("montarPastas", () => {
  it("sem pastas não gera bloco nenhum no prompt", () => {
    expect(montarPastas([])).toBe("");
  });

  it("lista os códigos disponíveis e exige confirmação antes de transferir", () => {
    const txt = montarPastas([{ codigo: "recrutamento", nome: "Recrutamento" }]);
    expect(txt).toContain("recrutamento — Recrutamento");
    expect(txt).toMatch(/PERGUNTE antes/);
    expect(txt).toContain("[[TRANSFERIR:codigo]]");
  });
});

// A lista de vagas é o que impede a IA de inventar cargo e salário.
describe("montarVagas", () => {
  it("sem vagas manda dizer que não há e proíbe inventar", () => {
    const txt = montarVagas([]);
    expect(txt).toContain("nenhuma");
    expect(txt).toMatch(/Não invente vagas/);
  });

  // Valores propositalmente fictícios: o que se testa aqui é o FORMATO do
  // bloco, não o conteúdo. Ler do banco deixaria o teste quebrar sozinho toda
  // vez que o RH abrisse ou fechasse uma vaga.
  //
  // Existe por causa de um caso real: a IA respondeu "não temos vagas na sua
  // cidade" para a cidade que tinha a única vaga aberta. O campo `local` é o
  // que ela usa para comparar, então ele não pode sumir do prompt.
  it("descreve a vaga com cidade para a IA não negar a cidade certa", () => {
    const txt = montarVagas([{ cargo: "CARGO DE EXEMPLO", cidade: "Cidade Exemplo", estado: "XX", salario: "1234,56" }]);
    expect(txt).toContain("CARGO DE EXEMPLO");
    expect(txt).toContain("local: Cidade Exemplo/XX");
    expect(txt).toContain("salário: 1234,56");
  });
});
