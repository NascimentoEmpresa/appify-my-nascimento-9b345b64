import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IconeCabecalho } from "@/components/notificacoes/IconeCabecalho";
import {
  CORES_CABECALHO, FORM_VAZIO, ICONES_CABECALHO, avisoDoFormulario, corCabecalhoDe, formDoAviso,
  iconeCabecalhoDe, type Notificacao,
} from "@/lib/notificacoes";

// Pedido do Pablo (16/10/2026): "deixa customizar essa cor e ícone aqui de
// cima também onde tá amarelo". Aviso antigo continua amarelo com "!".

describe("cabeçalho do aviso", () => {
  it("aviso antigo (NULL) e valor estranho ficam no amarelo com '!' de antes", () => {
    expect(corCabecalhoDe(null).faixa).toBe("bg-amber-50 dark:bg-amber-950/30");
    expect(corCabecalhoDe(null).quadrado).toBe("bg-amber-500 text-white");
    expect(corCabecalhoDe("turquesa").valor).toBe("");
    expect(iconeCabecalhoDe(null)).toBe("");
    expect(iconeCabecalhoDe("foguete")).toBe("");
  });

  it("oito cores e doze ícones, cada cor com faixa e quadrado para os dois temas", () => {
    expect(CORES_CABECALHO).toHaveLength(8);
    expect(ICONES_CABECALHO).toHaveLength(12);
    for (const c of CORES_CABECALHO) {
      expect(c.faixa).toMatch(/dark:/);
      expect(c.quadrado).toContain("text-white");
    }
  });

  it("vai do formulário para a prévia e volta na edição; padrão vai como NULL", () => {
    const a = avisoDoFormulario({ ...FORM_VAZIO, titulo: "t", mensagem: "mensagem longa", cabecalho_cor: "verde", cabecalho_icone: "festa" }, null);
    expect([a.cabecalho_cor, a.cabecalho_icone]).toEqual(["verde", "festa"]);
    const f = formDoAviso({ ...a, id: 4 } as Notificacao);
    expect([f.cabecalho_cor, f.cabecalho_icone]).toEqual(["verde", "festa"]);
    const p = avisoDoFormulario({ ...FORM_VAZIO, titulo: "t", mensagem: "mensagem longa" }, null);
    expect([p.cabecalho_cor, p.cabecalho_icone]).toEqual([null, null]);
  });

  it("todo ícone da lista tem desenho (nenhum cai no '!' por engano)", () => {
    const alerta = render(<IconeCabecalho icone="" />).container.innerHTML;
    for (const i of ICONES_CABECALHO.filter((x) => x.valor)) {
      expect(render(<IconeCabecalho icone={i.valor} />).container.innerHTML).not.toBe(alerta);
    }
  });
});
