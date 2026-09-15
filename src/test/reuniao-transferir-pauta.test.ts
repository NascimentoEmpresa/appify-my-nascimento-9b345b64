import { describe, expect, it } from "vitest";
import {
  JUSTIFICATIVA_DURACAO_EXTRAORDINARIA, mensagemErroTransferencia, montarReuniaoExtraordinaria,
  pessoasObrigatoriasReuniao, tituloReuniaoExtraordinaria,
} from "../pages/central-servicos/reunioes/transferenciaPauta";

const origem = {
  numero: "REU-2026-0042",
  organizador_user_id: "org",
  responsavel_preenchimento_user_id: "resp",
  tipo_reuniao: "comite" as const,
  finalidade: ["decisao" as const],
  resultado_esperado: ["acao_definida" as const],
  notificar_por: ["erp" as const, "email" as const],
  setor_responsavel: "Controladoria",
};

const base = {
  origem,
  convidadosOrigem: [
    { user_id: "ana", papel: "convidado" as const },
    { user_id: "bia", papel: "observador" as const },
    { user_id: "ana", papel: "observador" as const },
  ],
  tituloPauta: "  Faturamento e lucratividade  ",
  titulo: "",
  dataHoraIso: "2026-09-20T13:00:00.000Z",
  duracaoMinutos: 90,
  tipoLocal: "presencial" as const,
  localOuLink: "Sala de Reunião - 2º Andar",
  linkOnline: "https://meet.exemplo/abc",
};

describe("montarReuniaoExtraordinaria", () => {
  it("herda organizador, responsável pela ata, tipo, setor e finalidades da reunião de origem", () => {
    const nova = montarReuniaoExtraordinaria(base);
    expect(nova.organizador_user_id).toBe("org");
    expect(nova.responsavel_preenchimento_user_id).toBe("resp");
    expect(nova.tipo_reuniao).toBe("comite");
    expect(nova.setor_responsavel).toBe("Controladoria");
    expect(nova.finalidade).toEqual(["decisao"]);
    expect(nova.resultado_esperado).toEqual(["acao_definida"]);
    expect(nova.notificar_por).toEqual(["erp", "email"]);
    expect(nova.pauta).toEqual([]);
    expect(nova.objetivo).toBe('Tratar a pauta "Faturamento e lucratividade", transferida da reunião REU-2026-0042.');
  });

  it("usa o título sugerido quando o título vem vazio", () => {
    expect(montarReuniaoExtraordinaria(base).titulo).toBe(tituloReuniaoExtraordinaria("Faturamento e lucratividade"));
    expect(montarReuniaoExtraordinaria({ ...base, titulo: " Extra do comitê " }).titulo).toBe("Extra do comitê");
  });

  it("observador que também é convidado fica só como convidado", () => {
    const nova = montarReuniaoExtraordinaria(base);
    expect(nova.convidados).toEqual(["ana"]);
    expect(nova.observadores).toEqual(["bia"]);
  });

  it("só justifica a duração quando ela foge do padrão do tipo", () => {
    expect(montarReuniaoExtraordinaria(base).justificativa_alteracao_duracao).toBeNull();
    expect(montarReuniaoExtraordinaria({ ...base, duracaoMinutos: 30 }).justificativa_alteracao_duracao).toBe(JUSTIFICATIVA_DURACAO_EXTRAORDINARIA);
    expect(montarReuniaoExtraordinaria({ ...base, origem: { ...origem, tipo_reuniao: "outro" as const }, duracaoMinutos: 30 }).justificativa_alteracao_duracao).toBeNull();
  });

  it("link_online só vai junto em reunião híbrida", () => {
    expect(montarReuniaoExtraordinaria(base).link_online).toBeNull();
    expect(montarReuniaoExtraordinaria({ ...base, tipoLocal: "hibrido" }).link_online).toBe("https://meet.exemplo/abc");
  });

  it("sem canal de notificação na origem, cai no padrão do banco (erp)", () => {
    expect(montarReuniaoExtraordinaria({ ...base, origem: { ...origem, notificar_por: [] } }).notificar_por).toEqual(["erp"]);
  });
});

describe("pessoasObrigatoriasReuniao", () => {
  it("organizador, responsável e convidados, sem duplicatas e sem observadores", () => {
    const nova = montarReuniaoExtraordinaria({ ...base, convidadosOrigem: [...base.convidadosOrigem, { user_id: "org", papel: "convidado" as const }] });
    expect(pessoasObrigatoriasReuniao(nova)).toEqual(["org", "resp", "ana"]);
  });
});

describe("mensagemErroTransferencia", () => {
  it("traduz o código levantado pela RPC", () => {
    expect(mensagemErroTransferencia("pauta_ja_transferida")).toBe("Esta pauta já foi transferida para outra reunião.");
    expect(mensagemErroTransferencia('P0001: reuniao_destino_nao_agendada')).toMatch(/precisa estar agendada/);
  });

  it("mantém a mensagem original quando o erro é desconhecido", () => {
    expect(mensagemErroTransferencia("falha de rede")).toBe("falha de rede");
  });
});
