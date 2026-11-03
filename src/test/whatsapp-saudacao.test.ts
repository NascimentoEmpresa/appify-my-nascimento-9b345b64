import { describe, it, expect } from "vitest";
import {
  avisoPendente, avisoForaDaJanela, motivoFalha, AVISO_LIMITE_MARKETING, type WaMensagem,
} from "../pages/whatsapp/types";
import { primeiroNome } from "../../supabase/functions/_shared/whatsapp-saudacao";

// Conversa ADRIEL (03/11/2026): a saudação levava 131049 e a mensagem da
// recrutadora seguia dizendo "enviamos a saudação" — ninguém sabia que o
// candidato não tinha sido avisado.
const msg = (p: Partial<WaMensagem>): WaMensagem => ({
  id: Math.random().toString(36), conversa_id: "c", contato_id: "k", direcao: "saida", tipo: "text",
  texto: "x", wa_message_id: null, status: "enviada", origem: "atendente", autor_id: null,
  criada_em: "2026-11-03T11:12:00Z", payload: null, ...p,
});
const saudacaoBarrada = msg({
  tipo: "template", status: "erro", criada_em: "2026-11-03T11:11:58Z",
  payload: { erro: { codigo: 131049, titulo: "healthy ecosystem" } },
});

describe("aviso da mensagem pendente", () => {
  it("saudação barrada (131049 que chegou depois pelo webhook) vira aviso de ligar", () => {
    const pend = msg({ status: "pendente", payload: { saudacao: { modo: "marketing" } } });
    const a = avisoPendente(pend, [saudacaoBarrada, pend]);
    expect(a.barrada).toBe(true);
    expect(a.texto).toMatch(/Ligue/);
  });

  it("pendentes seguintes da mesma espera (até 24h) herdam o bloqueio", () => {
    const pend = msg({ status: "pendente", criada_em: "2026-11-03T18:41:00Z" });
    expect(avisoPendente(pend, [saudacaoBarrada, pend]).barrada).toBe(true);
  });

  it("bloqueio de outro dia não contamina a espera nova", () => {
    const pend = msg({ status: "pendente", criada_em: "2026-11-05T11:00:00Z" });
    expect(avisoPendente(pend, [saudacaoBarrada, pend]).barrada).toBe(false);
  });

  it("modo barrada gravado pelo whatsapp-enviar basta, sem erro na lista", () => {
    const pend = msg({ status: "pendente", payload: { saudacao: { modo: "barrada" } } });
    expect(avisoPendente(pend, [pend]).barrada).toBe(true);
  });

  it("outro erro (número sem WhatsApp) não é confundido com o limite", () => {
    const outro = msg({ status: "erro", criada_em: "2026-11-03T11:11:58Z", payload: { erro: { codigo: 131026 } } });
    const pend = msg({ status: "pendente" });
    expect(avisoPendente(pend, [outro, pend]).barrada).toBe(false);
  });
});

describe("toast fora da janela e motivo da falha", () => {
  it("barrada é grave; utility é o aviso de sempre", () => {
    expect(avisoForaDaJanela({ modo: "barrada" }).grave).toBe(true);
    expect(avisoForaDaJanela({ modo: "utility" }).descricao).toMatch(/modelo aprovado/);
    expect(avisoForaDaJanela({ modo: "marketing" }).descricao).toMatch(/pode não entregar/);
    expect(avisoForaDaJanela(undefined).grave).toBe(false);
  });

  it("131049 e 130472 não mandam mais 'tentar amanhã'", () => {
    expect(motivoFalha({ codigo: 131049 })).toBe(AVISO_LIMITE_MARKETING);
    expect(motivoFalha({ codigo: 130472 })).toBe(AVISO_LIMITE_MARKETING);
    expect(AVISO_LIMITE_MARKETING).not.toMatch(/amanhã/);
  });

  it("primeiro nome do cadastro em caixa alta", () => {
    expect(primeiroNome("ADRIEL JOSE S.L")).toBe("Adriel");
    expect(primeiroNome("  ")).toBe("");
  });
});
