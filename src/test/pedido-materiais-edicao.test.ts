import { describe, expect, it } from "vitest";
import {
  edicaoReduzida,
  itensTravados,
  montarItensPayload,
  resumoAlteracoes,
  validarEdicao,
  type LinhaEditavel,
} from "@/lib/suprimentos/pedidoEdicao";

/** Linha pronta e válida, para cada teste mexer só no que interessa. */
function linha(over: Partial<LinhaEditavel> = {}): LinhaEditavel {
  return {
    id: "item-1",
    item_id: "material-botina",
    nome_item: "BOTINA DE SEGURANÇA",
    tamanho: "42",
    litros: "",
    quantidade: "1",
    ...over,
  };
}

const semTamanhoObrigatorio = () => false;

// Editar existe porque a única correção possível era apagar o pedido e
// refazer — perdendo protocolo, data e trilha. Mas editar depois que a peça
// saiu é reescrever o que aconteceu, não corrigir.
describe("até onde a edição vai, por status do pedido", () => {
  it("libera a edição inteira enquanto o pedido está vivo", () => {
    expect(edicaoReduzida("EM PREPARACAO")).toBe(false);
    expect(edicaoReduzida("AGUARDANDO ENVIO")).toBe(false);
    expect(edicaoReduzida("AGUARDANDO COMPRA")).toBe(false);
  });

  it("reduz a observações quando a peça já saiu ou o pedido morreu", () => {
    expect(edicaoReduzida("DESPACHADO")).toBe(true);
    expect(edicaoReduzida("CANCELADO")).toBe(true);
  });

  it("não trava por status desconhecido nem por status ausente", () => {
    expect(edicaoReduzida(null)).toBe(false);
    expect(edicaoReduzida(undefined)).toBe(false);
  });
});

// §12.7 do legado: lá a TAG se amarrava ao ÍNDICE do item dentro de um array
// JSONB, e editar o pedido reordenava o array, desamarrando tudo em silêncio.
// Aqui o item que já consumiu etiqueta simplesmente não se mexe.
describe("itens travados por etiqueta já consumida", () => {
  it("trava exatamente os itens que aparecem nas etiquetas do pedido", () => {
    const travados = itensTravados([
      { pedido_item_id: "item-1" },
      { pedido_item_id: "item-1" }, // duas peças do mesmo item
      { pedido_item_id: "item-3" },
    ]);

    expect(travados.has("item-1")).toBe(true);
    expect(travados.has("item-3")).toBe(true);
    expect(travados.has("item-2")).toBe(false);
    expect(travados.size).toBe(2);
  });

  it("pedido sem baixa nenhuma não trava item algum", () => {
    expect(itensTravados([]).size).toBe(0);
  });
});

describe("validação do formulário de edição", () => {
  it("aceita a edição completa e correta", () => {
    expect(validarEdicao({
      admissao: false,
      nomeColaborador: "",
      temColaborador: true,
      tipoPedido: "uniforme",
      linhas: [linha()],
      exigeTamanho: semTamanhoObrigatorio,
    })).toBeNull();
  });

  it("cobra o nome quando é admissão, porque a pessoa ainda não está na folha", () => {
    expect(validarEdicao({
      admissao: true,
      nomeColaborador: "   ",
      temColaborador: false,
      tipoPedido: "uniforme",
      linhas: [linha()],
      exigeTamanho: semTamanhoObrigatorio,
    })).toBe("Informe o nome do novo colaborador.");
  });

  it("cobra o colaborador escolhido na lista fora do caso de admissão", () => {
    expect(validarEdicao({
      admissao: false,
      nomeColaborador: "",
      temColaborador: false,
      tipoPedido: "uniforme",
      linhas: [linha()],
      exigeTamanho: semTamanhoObrigatorio,
    })).toBe('Escolha o colaborador na lista, ou marque "É admissão".');
  });

  // Material de posto não atende ninguém em específico — é o único pedido
  // que existe sem colaborador.
  it("dispensa o colaborador em pedido só de insumos", () => {
    expect(validarEdicao({
      admissao: false,
      nomeColaborador: "",
      temColaborador: false,
      tipoPedido: "insumos",
      linhas: [linha()],
      exigeTamanho: semTamanhoObrigatorio,
    })).toBeNull();
  });

  it("recusa pedido que ficou sem nenhum item", () => {
    expect(validarEdicao({
      admissao: false,
      nomeColaborador: "",
      temColaborador: true,
      tipoPedido: "uniforme",
      linhas: [],
      exigeTamanho: semTamanhoObrigatorio,
    })).toBe("O pedido precisa ter ao menos um item.");
  });

  it("cobra o tamanho só nos itens em que o catálogo oferece tamanho", () => {
    const contexto = {
      admissao: false,
      nomeColaborador: "",
      temColaborador: true,
      tipoPedido: "uniforme",
      linhas: [linha({ tamanho: "" })],
    };

    expect(validarEdicao({ ...contexto, exigeTamanho: () => true }))
      .toBe("Escolha o tamanho de BOTINA DE SEGURANÇA.");
    expect(validarEdicao({ ...contexto, exigeTamanho: () => false })).toBeNull();
  });

  it("recusa quantidade zerada, negativa ou apagada do campo", () => {
    for (const q of ["0", "-2", ""]) {
      expect(validarEdicao({
        admissao: false,
        nomeColaborador: "",
        temColaborador: true,
        tipoPedido: "uniforme",
        linhas: [linha({ quantidade: q })],
        exigeTamanho: semTamanhoObrigatorio,
      })).toBe("A quantidade de BOTINA DE SEGURANÇA precisa ser 1 ou mais.");
    }
  });
});

describe("payload dos itens enviado à RPC", () => {
  it("mantém o id do item que já existe e manda nulo no que está entrando agora", () => {
    const [existente, novo] = montarItensPayload([
      linha(),
      linha({ id: null, item_id: "material-luva", nome_item: "LUVA", tamanho: "M" }),
    ]);

    expect(existente.id).toBe("item-1");
    expect(novo.id).toBeNull();
    expect(novo.item_id).toBe("material-luva");
  });

  // Campo vazio precisa virar NULL: como "" a coluna aparece nos relatórios
  // como se fosse um tamanho de verdade.
  it("converte campo em branco para nulo, e não para string vazia", () => {
    const [p] = montarItensPayload([linha({ tamanho: "  ", litros: "" })]);
    expect(p.tamanho).toBeNull();
    expect(p.litros).toBeNull();
  });

  it("normaliza a quantidade digitada para um inteiro de no mínimo 1", () => {
    expect(montarItensPayload([linha({ quantidade: "3" })])[0].quantidade).toBe(3);
    expect(montarItensPayload([linha({ quantidade: "2.7" })])[0].quantidade).toBe(2);
    expect(montarItensPayload([linha({ quantidade: "0" })])[0].quantidade).toBe(1);
    expect(montarItensPayload([linha({ quantidade: "" })])[0].quantidade).toBe(1);
  });
});

describe("resumo do que mudou, no aviso de sucesso", () => {
  it("cita só o que aconteceu de fato", () => {
    expect(resumoAlteracoes({ itens_incluidos: 2, itens_alterados: 0, itens_removidos: 1 }))
      .toBe("2 item(ns) incluído(s), 1 removido(s)");
  });

  it("volta vazio quando a edição não tocou em item nenhum", () => {
    expect(resumoAlteracoes({ itens_incluidos: 0, itens_alterados: 0, itens_removidos: 0 }))
      .toBe("");
  });
});

// Pedido criado antes de 30/08/2026 tem nome de colaborador e nenhum vínculo
// com EMPREGADOS. Exigir a escolha na lista travaria o operador que só quer
// corrigir uma observação num pedido antigo.
describe("colaborador de pedido anterior ao vínculo com a folha", () => {
  const base = {
    admissao: false,
    nomeColaborador: "",
    temColaborador: false,
    tipoPedido: "uniforme",
    linhas: [linha()],
    exigeTamanho: semTamanhoObrigatorio,
  };

  it("deixa salvar preservando o nome que já estava gravado", () => {
    expect(validarEdicao({ ...base, nomeJaGravado: "JOSE DA SILVA" })).toBeNull();
  });

  it("continua cobrando o colaborador quando não há nome nenhum", () => {
    expect(validarEdicao({ ...base, nomeJaGravado: "  " }))
      .toBe('Escolha o colaborador na lista, ou marque "É admissão".');
    expect(validarEdicao({ ...base, nomeJaGravado: null }))
      .toBe('Escolha o colaborador na lista, ou marque "É admissão".');
  });
});
