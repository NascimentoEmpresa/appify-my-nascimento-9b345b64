import { describe, expect, it } from "vitest";
import {
  copiaDoEmail, dentroDaJanela, faixaDeDias, garantirEnvioPermitido, maiorFaixa, montarEmail, planejarCobrancas, variaveisDoEmail,
  type ConfigCobranca, type EntradaPlano, type NotaAberta,
} from "../../supabase/functions/_shared/cobranca-automatica";

// 2026-10-20 12:00 em Brasília
const AGORA = new Date("2026-10-20T15:00:00Z");
const HOJE = "2026-10-20";

// Data de emissão que dá `dias` dias corridos até hoje.
const emissaoHaDias = (dias: number) => new Date(Date.UTC(2026, 9, 20) - dias * 86_400_000).toISOString().slice(0, 10);

const nota = (dias: number, o: Partial<NotaAberta> = {}): NotaAberta => ({
  id: `n${dias}`, numero: String(1000 + dias), contratoId: "c1", dataEmissao: emissaoHaDias(dias), competencia: "2026-08-01", valor: 1000, ...o,
});

const CONFIG: ConfigCobranca = { intervalo_dias: { aviso: 0, verde: 7, amarela: 7, laranja: 7, vermelha: 7 }, aviso_dias_antes: 5 };

function entrada(o: Partial<EntradaPlano> = {}): EntradaPlano {
  return {
    notas: [nota(40)],
    contratos: new Map([["c1", { id: "c1", nome: "UFRGS - LIMPEZA - 047/2022", empresaCodigo: "HAGG" }]]),
    emailsPorContrato: new Map([["c1", ["compras@ufrgs.br"]]]),
    contratosSoManual: new Set(),
    enviosAnteriores: [],
    config: CONFIG,
    agora: AGORA,
    ...o,
  };
}

describe("SIS-2026-0653 · faixas (mesma régua do sistema antigo)", () => {
  it("atraso real = dias desde a emissão − 30", () => {
    expect(faixaDeDias(25)).toBe("aviso");
    expect(faixaDeDias(30)).toBe("aviso");
    expect(faixaDeDias(31)).toBe("verde");
    expect(faixaDeDias(45)).toBe("verde");
    expect(faixaDeDias(46)).toBe("amarela");
    expect(faixaDeDias(60)).toBe("amarela");
    expect(faixaDeDias(61)).toBe("laranja");
    expect(faixaDeDias(90)).toBe("laranja");
    expect(faixaDeDias(91)).toBe("vermelha");
    expect(faixaDeDias(120)).toBe("vermelha");
    expect(faixaDeDias(121)).toBe("roxa");
    expect(faixaDeDias(150)).toBe("roxa");
    expect(faixaDeDias(151)).toBe("preta");
  });

  it("a maior faixa é a da nota mais atrasada", () => {
    expect(maiorFaixa(["verde", "vermelha", "amarela"])).toBe("vermelha");
    expect(maiorFaixa([])).toBeNull();
  });
});

describe("SIS-2026-0653 · faixa judicial/roxa nunca é automática", () => {
  it("contrato na faixa roxa fica fora, mesmo com e-mail cadastrado e sem nenhum envio anterior", () => {
    const [p] = planejarCobrancas(entrada({ notas: [nota(135)] }));
    expect(p.faixa).toBe("roxa");
    expect(p.decisao).toBe("judicial");
  });

  it("faixa preta também fica fora", () => {
    const [p] = planejarCobrancas(entrada({ notas: [nota(200)] }));
    expect(p.decisao).toBe("judicial");
  });

  it("basta uma nota roxa para o contrato inteiro sair do automático, mesmo com notas novas na verde", () => {
    const [p] = planejarCobrancas(entrada({ notas: [nota(135, { id: "a" }), nota(35, { id: "b" })] }));
    expect(p.faixa).toBe("roxa");
    expect(p.decisao).toBe("judicial");
  });

  it("não presume etapa anterior: contrato roxo sem cobrança prévia não recebe a 1ª cobrança automática", () => {
    const planos = planejarCobrancas(entrada({ notas: [nota(135)], enviosAnteriores: [] }));
    expect(planos.filter((p) => p.decisao === "enviar")).toHaveLength(0);
  });

  it("a barreira final recusa roxa e preta, e aceita as faixas do Financeiro", () => {
    expect(() => garantirEnvioPermitido("roxa")).toThrow();
    expect(() => garantirEnvioPermitido("preta")).toThrow();
    for (const f of ["aviso", "verde", "amarela", "laranja", "vermelha"] as const) expect(() => garantirEnvioPermitido(f)).not.toThrow();
  });
});

describe("SIS-2026-0653 · decisão por contrato", () => {
  it("primeira vez numa faixa do Financeiro: envia", () => {
    const [p] = planejarCobrancas(entrada());
    expect(p.faixa).toBe("verde");
    expect(p.decisao).toBe("enviar");
    expect(p.destinatarios).toEqual(["compras@ufrgs.br"]);
  });

  it("sem e-mail do tomador: não envia e avisa o motivo", () => {
    const [p] = planejarCobrancas(entrada({ emailsPorContrato: new Map() }));
    expect(p.decisao).toBe("sem_destinatario");
  });

  it("contrato marcado como só manual fica fora", () => {
    const [p] = planejarCobrancas(entrada({ contratosSoManual: new Set(["c1"]) }));
    expect(p.decisao).toBe("manual");
  });

  it("nota que ainda não chegou na janela do aviso não entra na cobrança", () => {
    expect(planejarCobrancas(entrada({ notas: [nota(20)] }))).toHaveLength(0);
    expect(planejarCobrancas(entrada({ notas: [nota(25)] }))[0].faixa).toBe("aviso");
  });

  it("já cobrado na faixa dentro do intervalo: aguarda e diz quando sai o próximo", () => {
    const [p] = planejarCobrancas(entrada({ enviosAnteriores: [{ contratoId: "c1", faixa: "verde", enviadoEm: "2026-10-17T13:00:00Z" }] }));
    expect(p.decisao).toBe("aguardar");
    expect(p.proximoEnvio).toBe("2026-10-24");
  });

  it("passado o intervalo, reenvia", () => {
    const [p] = planejarCobrancas(entrada({ enviosAnteriores: [{ contratoId: "c1", faixa: "verde", enviadoEm: "2026-10-13T13:00:00Z" }] }));
    expect(p.decisao).toBe("enviar");
  });

  it("faixa com intervalo 0 não repete", () => {
    const [p] = planejarCobrancas(entrada({ notas: [nota(27)], enviosAnteriores: [{ contratoId: "c1", faixa: "aviso", enviadoEm: "2026-09-01T13:00:00Z" }] }));
    expect(p.faixa).toBe("aviso");
    expect(p.decisao).toBe("aguardar");
  });

  it("ao subir de faixa envia na hora, sem esperar o intervalo da anterior", () => {
    const [p] = planejarCobrancas(entrada({ notas: [nota(50)], enviosAnteriores: [{ contratoId: "c1", faixa: "verde", enviadoEm: "2026-10-19T13:00:00Z" }] }));
    expect(p.faixa).toBe("amarela");
    expect(p.decisao).toBe("enviar");
  });

  it("junta todas as notas do contrato num único plano e soma o valor", () => {
    const planos = planejarCobrancas(entrada({ notas: [nota(40, { id: "a" }), nota(35, { id: "b", valor: 500 })] }));
    expect(planos).toHaveLength(1);
    expect(planos[0].notas).toHaveLength(2);
    expect(planos[0].valorTotal).toBe(1500);
  });

  it("lista primeiro o que vai sair", () => {
    const outros = new Map(entrada().contratos);
    outros.set("c2", { id: "c2", nome: "TJRS", empresaCodigo: "SN" });
    const planos = planejarCobrancas(entrada({ notas: [nota(135, { contratoId: "c2" }), nota(40)], contratos: outros }));
    expect(planos.map((p) => p.decisao)).toEqual(["enviar", "judicial"]);
  });
});

describe("SIS-2026-0653 · texto do e-mail", () => {
  const modelo = { assunto: "Pendência de pagamento - {{cliente}}", corpo: "Prezado(a), referente {{t_nota}}{{t_num}}{{t_venc}} {{lista_html}} Total: {{valor_total}}" };

  it("uma nota: singular, número e vencimento real (emissão + 30 dias)", () => {
    const [p] = planejarCobrancas(entrada({ notas: [nota(40)] }));
    const vars = variaveisDoEmail(p, HOJE);
    expect(vars.t_nota).toBe("à Nota Fiscal");
    expect(vars.t_num).toBe(" nº 1040");
    // emissão há 40 dias = 10/09/2026 → vence em 10/10/2026
    expect(vars.t_venc).toBe(" cujo vencimento está programado para o dia 10/10/2026,");
  });

  it("várias notas: plural, 'detalhadas abaixo' e sem vencimento solto", () => {
    const [p] = planejarCobrancas(entrada({ notas: [nota(40, { id: "a" }), nota(35, { id: "b" })] }));
    const vars = variaveisDoEmail(p, HOJE);
    expect(vars.t_nota).toBe("às Notas Fiscais");
    expect(vars.t_num).toBe(" detalhadas abaixo");
    expect(vars.t_venc).toBe("");
  });

  it("assunto leva as NFs, e a razão social sai do mapa da empresa", () => {
    const [p] = planejarCobrancas(entrada({ notas: [nota(40, { id: "a" }), nota(35, { id: "b" })] }));
    const m = montarEmail(p, { assunto: modelo.assunto, corpo: "{{ass_emp}}" }, HOJE);
    expect(m.assunto).toBe("Pendência de pagamento - UFRGS - LIMPEZA - 047/2022 (NFs: 1040, 1035)");
    expect(m.corpo).toContain("Nascimento Serviços de Limpeza Ltda");
  });

  it("a assinatura entra depois do corpo", () => {
    const [p] = planejarCobrancas(entrada());
    expect(montarEmail(p, modelo, HOJE, "<p>ASSINATURA</p>").corpo.endsWith("<p>ASSINATURA</p>")).toBe(true);
  });

  it("cópia: Gerência Operacional em todas, menos no aviso amigável", () => {
    expect(copiaDoEmail("verde", ["gerencia@x.com", " gerencia@x.com "])).toEqual(["gerencia@x.com"]);
    expect(copiaDoEmail("aviso", ["gerencia@x.com"])).toEqual([]);
  });
});

describe("SIS-2026-0653 · janela de envio", () => {
  const janela = { somente_dias_uteis: true, hora_inicio: 8, hora_fim: 17 };
  it("terça às 12h de Brasília: dentro", () => expect(dentroDaJanela(AGORA, janela)).toBe(true));
  it("terça às 20h de Brasília: fora", () => expect(dentroDaJanela(new Date("2026-10-20T23:00:00Z"), janela)).toBe(false));
  it("sábado ao meio-dia: fora", () => expect(dentroDaJanela(new Date("2026-10-24T15:00:00Z"), janela)).toBe(false));
});
