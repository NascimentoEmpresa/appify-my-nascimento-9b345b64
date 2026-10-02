import { describe, expect, it } from "vitest";
import { preencherVariaveis, temVariaveis, ContextoDescricao } from "@/pages/financeiro/nf-emissao/descricaoVariaveis";

const item = (o: Partial<ContextoDescricao["itens"][number]> = {}): ContextoDescricao["itens"][number] => ({
  valor_contrato_exec: 0, vlr_va: 0, vlr_vt: 0, vlr_materiais: 0, faltas: 0, posto_nao_implementado: 0,
  multas: 0, glosas: 0, outros_descontos: 0, multas_pos_emissao: 0, glosas_pos_emissao: 0,
  outros_descontos_pos_emissao: 0, vlr_bruto: 0, vlr_mao_obra: 0, inss: 0, total_descontos: 0, ...o,
});

const ctx = (itens: ContextoDescricao["itens"], extra: Partial<ContextoDescricao> = {}): ContextoDescricao => ({
  competencia: "2026-09-01", itens, ...extra,
});

describe("preencherVariaveis", () => {
  it("troca competência e valores pelo total da nota", () => {
    const t = "REFERENTE A {competencia}.\nVALE ALIMENTAÇÃO: {va}.";
    const r = preencherVariaveis(t, ctx([item({ vlr_va: 100 }), item({ vlr_va: 50.5 })]));
    expect(r).toBe("REFERENTE A 09/2026.\nVALE ALIMENTAÇÃO: R$ 150,50.");
  });

  it("linha só com variáveis zeradas some inteira", () => {
    const t = "REFERENTE A {competencia}.\nDESCONTO DE {faltas} REFERENTE A FALTAS.\nFIM";
    expect(preencherVariaveis(t, ctx([item()]))).toBe("REFERENTE A 09/2026.\nFIM");
  });

  it("linha mista mantém as demais e escreve R$ 0,00 na zerada", () => {
    const t = "VA: {va}. VT: {vt}.";
    expect(preencherVariaveis(t, ctx([item({ vlr_va: 10 })]))).toBe("VA: R$ 10,00. VT: R$ 0,00.");
  });

  it("junta os motivos dos itens sem repetir", () => {
    const t = "Glosas {glosas}: {motivo_glosas}";
    const r = preencherVariaveis(
      t,
      ctx([
        item({ glosas: 100, justificativa_glosas: "posto descoberto" }),
        item({ glosas: 50, justificativa_glosas: "posto descoberto" }),
        item({ glosas: 20, justificativa_glosas: "atraso na entrega" }),
      ])
    );
    expect(r).toBe("Glosas R$ 170,00: posto descoberto; atraso na entrega");
  });

  it("variável desconhecida fica como está", () => {
    expect(preencherVariaveis("Empenho {empenho}", ctx([item()]))).toBe("Empenho {empenho}");
  });

  it("código de serviço/CNAE/NBS vêm da nota; vazio faz a linha sumir", () => {
    const t = "CÓD. SERVIÇO: {codigo_servico}\nNBS: {nbs}";
    expect(preencherVariaveis(t, ctx([item()], { codigo_servico: "17.05" }))).toBe("CÓD. SERVIÇO: 17.05");
  });

  it("temVariaveis", () => {
    expect(temVariaveis("a {va} b")).toBe(true);
    expect(temVariaveis("sem nada")).toBe(false);
  });
});
