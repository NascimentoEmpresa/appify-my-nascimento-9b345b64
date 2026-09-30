import { describe, expect, it } from "vitest";
import { PARAM_COMPROVAR, situacaoComprovacaoQr, urlComprovacao } from "@/lib/suprimentos/comprovacaoQr";
import { htmlEtiqueta, type DadosEtiqueta } from "@/lib/suprimentos/etiquetaTermica";

/**
 * O QR da etiqueta do pedido deixou de ser a retirada (que foi para o QR do
 * romaneio) e passou a abrir a comprovação de entrega em "Meus Pedidos".
 */
describe("QR da etiqueta → comprovação de entrega", () => {
  const uuid = "7b1e0c1a-0000-4000-8000-000000000001";

  it("aponta para Meus Pedidos com o uuid do pedido", () => {
    expect(urlComprovacao(uuid, "https://erp.exemplo"))
      .toBe(`https://erp.exemplo/app/encarregados/meus-pedidos?${PARAM_COMPROVAR}=${uuid}`);
  });

  it("fica dentro da área que o usuário externo pode navegar", () => {
    expect(new URL(urlComprovacao(uuid, "https://erp.exemplo")).pathname.startsWith("/app/encarregados/")).toBe(true);
  });

  it("a legenda da etiqueta fala com quem recebe, não mais com o supervisor", () => {
    const dados: DadosEtiqueta = {
      pedido_id: "PED-1", status: "AGUARDANDO ENVIO", statusRotulo: "Aguardando envio",
      nome_colaborador: "FULANO", matricula_colaborador: null, solicitante: "CICLANO",
      funcao_nome: "LIMPEZA", contrato_nome: "CONTRATO", posto_nome: "POSTO",
      itens: [], qrDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    };
    const html = htmlEtiqueta(dados, "PADRAO", "");
    expect(html).toContain("comprovar a entrega");
    expect(html).not.toContain("Supervisor: leia ao retirar");
  });
});

describe("situação do pedido lido no QR", () => {
  it("despachado com comprovação pendente abre o formulário", () => {
    expect(situacaoComprovacaoQr({ status: "DESPACHADO", comprovacao_status: "PENDENTE" })).toBe("PREENCHER");
  });

  it("comprovação já enviada não reabre o formulário", () => {
    expect(situacaoComprovacaoQr({ status: "DESPACHADO", comprovacao_status: "ENVIADO" })).toBe("JA_ENVIADA");
  });

  it("pedido anterior à regra é dispensado", () => {
    expect(situacaoComprovacaoQr({ status: "DESPACHADO", comprovacao_status: "DISPENSADO" })).toBe("DISPENSADA");
  });

  it("retirado mas ainda não despachado espera o Compras", () => {
    expect(situacaoComprovacaoQr({ status: "RETIRADO PARA ENTREGA", comprovacao_status: null })).toBe("AGUARDANDO_DESPACHO");
    expect(situacaoComprovacaoQr({ status: "AGUARDANDO ENVIO", comprovacao_status: undefined })).toBe("AGUARDANDO_DESPACHO");
  });

  it("pedido fora da lista de quem está logado não é encontrado", () => {
    expect(situacaoComprovacaoQr(undefined)).toBe("NAO_ENCONTRADO");
  });
});
