import { describe, expect, it, vi } from "vitest";
import {
  desfazerAcao,
  refazerAcao,
  descreverAcao,
  type AcaoMapa,
  type Aplicador,
} from "@/pages/ti/mapa3d/historico";
import type { TiAtivo, TiElemento } from "@/hooks/useTiMapa";

/**
 * Ctrl+Z do editor do mapa.
 *
 * Aqui cada ação já foi GRAVADA no banco quando o usuário soltou o mouse, então
 * desfazer é mandar a operação inversa — e um inverso trocado não quebra nada
 * visível na hora: a peça só vai para o lugar errado, ou some quando deveria
 * voltar. É exatamente o tipo de erro que ninguém pega clicando.
 */

const parede = (p: Partial<TiElemento> = {}): TiElemento => ({
  id: p.id ?? "el-1",
  planta_id: "p1",
  tipo: "parede",
  rotulo: null,
  x: p.x ?? 100,
  y: p.y ?? 100,
  largura: p.largura ?? 400,
  altura: 15,
  rotacao: p.rotacao ?? 0,
  altura_z: null,
  cor: null,
  setor: null,
  z_index: 0,
  meta: {},
});

const pc = (p: Partial<TiAtivo> = {}): TiAtivo =>
  ({ id: p.id ?? "a-1", nome: "PC-01", tipo: "desktop", pos_x: p.pos_x ?? 0, pos_y: p.pos_y ?? 0 }) as TiAtivo;

function espiao(): Aplicador & { chamadas: string[] } {
  const chamadas: string[] = [];
  return {
    chamadas,
    criarElemento: (el) => chamadas.push(`criar:${el.id}:${el.x}`),
    atualizarElemento: (el) => chamadas.push(`atualizar:${el.id}:${el.x}`),
    removerElemento: (id) => chamadas.push(`remover:${id}`),
    atualizarAtivo: (a) => chamadas.push(`ativo:${a.id}:${a.pos_x}`),
  };
}

describe("desfazer", () => {
  it("o inverso de criar é remover a peça criada", () => {
    const ap = espiao();
    desfazerAcao({ tipo: "criar_elemento", depois: parede({ id: "nova" }) }, ap);
    expect(ap.chamadas).toEqual(["remover:nova"]);
  });

  it("o inverso de remover é recriar COM O MESMO id", () => {
    // O id importa: sem ele, o Ctrl+Y seguinte removeria a peça errada,
    // porque o histórico guarda o id de antes.
    const ap = espiao();
    desfazerAcao({ tipo: "remover_elemento", antes: parede({ id: "sumida" }) }, ap);
    expect(ap.chamadas).toEqual(["criar:sumida:100"]);
  });

  it("o inverso de mover é gravar o estado ANTERIOR, não o novo", () => {
    const ap = espiao();
    desfazerAcao(
      { tipo: "atualizar_elemento", antes: parede({ x: 100 }), depois: parede({ x: 900 }) },
      ap,
    );
    expect(ap.chamadas).toEqual(["atualizar:el-1:100"]);
  });

  it("vale igual para equipamento", () => {
    const ap = espiao();
    desfazerAcao({ tipo: "atualizar_ativo", antes: pc({ pos_x: 50 }), depois: pc({ pos_x: 800 }) }, ap);
    expect(ap.chamadas).toEqual(["ativo:a-1:50"]);
  });
});

describe("refazer", () => {
  it("refazer aplica a ação no sentido original", () => {
    const ap = espiao();
    refazerAcao(
      { tipo: "atualizar_elemento", antes: parede({ x: 100 }), depois: parede({ x: 900 }) },
      ap,
    );
    expect(ap.chamadas).toEqual(["atualizar:el-1:900"]);
  });

  it("desfazer e refazer se cancelam — a peça volta para onde estava", () => {
    const ap = espiao();
    const acao: AcaoMapa = {
      tipo: "atualizar_elemento",
      antes: parede({ x: 100 }),
      depois: parede({ x: 900 }),
    };
    desfazerAcao(acao, ap);
    refazerAcao(acao, ap);
    expect(ap.chamadas).toEqual(["atualizar:el-1:100", "atualizar:el-1:900"]);
  });

  it("refazer um 'criar' recria; refazer um 'remover' remove de novo", () => {
    const ap = espiao();
    refazerAcao({ tipo: "criar_elemento", depois: parede({ id: "x" }) }, ap);
    refazerAcao({ tipo: "remover_elemento", antes: parede({ id: "y" }) }, ap);
    expect(ap.chamadas).toEqual(["criar:x:100", "remover:y"]);
  });
});

describe("descrição da ação", () => {
  it("descreve em português o que o botão vai desfazer", () => {
    expect(descreverAcao({ tipo: "criar_elemento", depois: parede() })).toBe("criar peça");
    expect(descreverAcao({ tipo: "remover_elemento", antes: parede() })).toBe("remover peça");
    expect(descreverAcao({ tipo: "atualizar_ativo", antes: pc(), depois: pc() })).toBe(
      "mover equipamento",
    );
  });
});
