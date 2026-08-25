import { describe, it, expect } from "vitest";
import { custoDoItem, precoVencido, fmtBRL } from "@/hooks/useSupEstoque";

/**
 * SIS-2026-0199 — custo do item no estoque.
 *
 * O gerente de Suprimentos pediu o custo na consulta de estoque, e foi
 * específico sobre QUAL custo: o último valor pago, não a média.
 *
 *   "Não, o último custo, o último valor pago. Porque daí é o valor
 *    atualizado. Se eu for subir para uma cotação hoje, eu posso subir por
 *    aquele valor ali."
 *
 * O caso difícil é quando o mesmo material tem etiquetas de valores
 * diferentes. Acontece porque peça devolvida e higienizada vale menos:
 *
 *   "Comprei do Roverim, comprei da Invest, e eu tenho o higienizado que cai
 *    pela metade. Não tem como nós fazer uma média. Tem que manter o mais
 *    alto, pra nós não perder dinheiro."
 *
 * Média subestimaria o estoque e faria o comprador cotar abaixo do que a peça
 * nova custa de verdade.
 */
describe("custoDoItem — o maior valor prevalece", () => {
  it("sem etiqueta com preço próprio, vale o valor do cadastro", () => {
    expect(custoDoItem(50, [])).toBe(50);
    expect(custoDoItem(50, [null, null])).toBe(50);
  });

  it("peça nova e peça higienizada: prevalece a nova", () => {
    // 120 é a jaqueta nova; 60 é a que voltou do contrato e foi higienizada.
    expect(custoDoItem(0, [120, 60])).toBe(120);
  });

  it("NÃO tira média — é o erro que ele pediu para evitar", () => {
    const media = (120 + 60) / 2;
    expect(custoDoItem(0, [120, 60])).not.toBe(media);
  });

  it("etiqueta mais cara que o cadastro puxa o custo para cima", () => {
    expect(custoDoItem(80, [95])).toBe(95);
  });

  it("etiqueta mais barata NÃO derruba o custo do cadastro", () => {
    expect(custoDoItem(80, [40])).toBe(80);
  });

  it("valor zero em etiqueta é ausência de preço, não preço zero", () => {
    // Entrada sem valor informado grava 0. Se isso contasse como preço, o
    // material apareceria custando nada.
    expect(custoDoItem(70, [0, 0])).toBe(70);
  });

  it("material sem preço nenhum fica em zero, para a tela mostrar travessão", () => {
    expect(custoDoItem(0, [])).toBe(0);
  });

  it("vários fornecedores: o mais caro manda", () => {
    expect(custoDoItem(90, [85, 110, 95])).toBe(110);
  });
});

describe("precoVencido — a validade negociada com o fornecedor", () => {
  const ontem = () => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const amanha = () => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const hoje = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  it("sem prazo definido nunca está vencido", () => {
    // "Talvez não mude nada, mas eu acho interessante ter essa atualização" —
    // a validade é opcional, e sem ela o preço não vira alerta.
    expect(precoVencido(null)).toBe(false);
    expect(precoVencido(undefined)).toBe(false);
  });

  it("prazo no futuro está válido", () => {
    expect(precoVencido(amanha())).toBe(false);
  });

  it("o último dia ainda vale", () => {
    // O fornecedor segurou o preço ATÉ essa data — no próprio dia ainda dá.
    expect(precoVencido(hoje())).toBe(false);
  });

  it("prazo no passado está vencido", () => {
    expect(precoVencido(ontem())).toBe(true);
  });
});

describe("fmtBRL", () => {
  it("formata em real", () => {
    expect(fmtBRL(1234.5)).toContain("1.234,50");
    expect(fmtBRL(1234.5)).toContain("R$");
  });

  it("nulo vira zero, não quebra", () => {
    expect(fmtBRL(null)).toContain("0,00");
  });
});
