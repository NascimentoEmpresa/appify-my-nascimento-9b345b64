import { describe, it, expect } from "vitest";
import {
  diasUteisEntre, somaDiasUteis, dataMinimaVaga, avaliarPrazo, grauPorDiasUteis,
  cargoExigeCnh, aplicarReqCnh, motivoLabel, MOTIVO_EXPANSAO,
  GRAU_ALTA, GRAU_MEDIA, GRAU_BAIXA, REQ_CNH_TEXTO,
  contratoDoEmpregado, rotuloReferencia, mostraNomeReferencia,
  MENU_VAGA_ADMINISTRATIVA, podeVagaAdministrativa, filtrarAdministrativas,
  vagaSeguraSubstituido, substituidosComVagaViva,
} from "@/lib/recrutamento/vagaRegras";

// Datas fixas p/ o teste não depender de "hoje":
//   2026-08-14 é uma sexta-feira; 07/09 (Independência) é uma segunda-feira.
describe("dias úteis", () => {
  it("não conta sábado e domingo", () => {
    // sex 14/08 -> seg 17/08 = 1 dia útil (sáb e dom fora)
    expect(diasUteisEntre("2026-08-14", "2026-08-17")).toBe(1);
    // sex 14/08 -> sex 21/08 = 5 dias úteis
    expect(diasUteisEntre("2026-08-14", "2026-08-21")).toBe(5);
  });

  it("não conta feriado nacional", () => {
    // 07/09/2026 (segunda, Independência) não conta;
    // qui 03/09 -> ter 08/09 = sex 04, seg 07 (feriado, fora), ter 08 => 2
    expect(diasUteisEntre("2026-09-03", "2026-09-08")).toBe(2);
  });

  it("soma dias úteis pulando fim de semana", () => {
    // sex 14/08 + 7 dias úteis = ter 25/08
    expect(somaDiasUteis("2026-08-14", 7)).toBe("2026-08-25");
  });

  it("data mínima da vaga é hoje + 7 dias úteis", () => {
    expect(dataMinimaVaga("2026-08-14")).toBe("2026-08-25");
  });
});

describe("grau de urgência pelo prazo", () => {
  it("mapeia as faixas pedidas", () => {
    expect(grauPorDiasUteis(6)).toBeNull();      // abaixo do mínimo
    expect(grauPorDiasUteis(7)).toBe(GRAU_ALTA);
    expect(grauPorDiasUteis(13)).toBe(GRAU_ALTA);
    expect(grauPorDiasUteis(14)).toBe(GRAU_MEDIA);
    expect(grauPorDiasUteis(20)).toBe(GRAU_MEDIA);
    expect(grauPorDiasUteis(21)).toBe(GRAU_BAIXA);
    expect(grauPorDiasUteis(40)).toBe(GRAU_BAIXA);
  });

  it("barra data abaixo do mínimo e explica a primeira data possível", () => {
    const r = avaliarPrazo("2026-08-18", "2026-08-14");   // 2 dias úteis
    expect(r.ok).toBe(false);
    expect(r.grau).toBeNull();
    expect(r.erro).toContain("25/08/2026");
  });

  it("aceita exatamente 7 dias úteis como urgente", () => {
    const r = avaliarPrazo("2026-08-25", "2026-08-14");
    expect(r.ok).toBe(true);
    expect(r.dias).toBe(7);
    expect(r.grau).toBe(GRAU_ALTA);
  });

  it("data no passado não passa", () => {
    expect(avaliarPrazo("2026-08-10", "2026-08-14").ok).toBe(false);
  });
});

describe("CNH obrigatória por cargo", () => {
  it("pega os cargos da regra, com ou sem acento", () => {
    expect(cargoExigeCnh("MOTORISTA")).toBe("Motorista");
    expect(cargoExigeCnh("motorista de caminhão")).toBe("Motorista");
    expect(cargoExigeCnh("Tratorista")).toBe("Tratorista");
    expect(cargoExigeCnh("OPERADOR DE RETROESCAVADEIRA")).toBe("Operador de retroescavadeira");
    expect(cargoExigeCnh("Supervisor Operacional")).toBe("Supervisor operacional");
    expect(cargoExigeCnh("Supervisora Operacional")).toBe("Supervisor operacional");
  });

  it("não pega cargo que só parece", () => {
    expect(cargoExigeCnh("Auxiliar de Limpeza")).toBeNull();
    expect(cargoExigeCnh("Supervisor de Contratos")).toBeNull();
    expect(cargoExigeCnh("")).toBeNull();
  });

  it("injeta o requisito uma vez só", () => {
    const um = aplicarReqCnh("Experiência de 6 meses", "MOTORISTA");
    expect(um).toContain(REQ_CNH_TEXTO);
    expect(aplicarReqCnh(um, "MOTORISTA")).toBe(um);            // não duplica
    expect(aplicarReqCnh("CNH categoria D", "MOTORISTA")).toBe("CNH categoria D");  // já tinha
    expect(aplicarReqCnh("Ensino médio", "Auxiliar")).toBe("Ensino médio");         // cargo sem regra
  });
});

describe("motivo da vaga", () => {
  it("mostra as vagas antigas com o nome novo", () => {
    expect(motivoLabel("Expansão")).toBe(MOTIVO_EXPANSAO);
    expect(motivoLabel(MOTIVO_EXPANSAO)).toBe(MOTIVO_EXPANSAO);
    expect(motivoLabel("Substituição")).toBe("Substituição");
  });
});

describe("colaborador de referência", () => {
  it("só mostra o nome quando a vaga é de substituição", () => {
    expect(mostraNomeReferencia("Substituição")).toBe(true);
    expect(mostraNomeReferencia(MOTIVO_EXPANSAO)).toBe(false);
    expect(mostraNomeReferencia("Admissão")).toBe(false);
    expect(rotuloReferencia("Substituição")).toBe("Colaborador a Substituir");
    expect(rotuloReferencia("Retorno")).toBe("Selecione alguém com o mesmo cargo");
  });
});

describe("contrato do empregado", () => {
  // A filial 1093 tem DOIS contratos ativos: era daí que saía o "LIMPEZA HUSM"
  // em quem trabalha no administrativo.
  const contratos = [
    { id: 27,  "NOME CONTRATO": "LIMPEZA HUSM",           Filial: 1093 },
    { id: 195, "NOME CONTRATO": "ADM E ESTAGIARIOS - NH", Filial: 1093 },
    { id: 12,  "NOME CONTRATO": "UFRGS - LIMPEZA GERAL",  Filial: 1050 },
  ];

  it("desempata pelo Nome Filial quando a filial tem mais de um contrato", () => {
    const emp = { Filial: 1093, "Nome Filial": "ADM E ESTAGIARIOS - NH" };
    expect(contratoDoEmpregado(contratos, emp)?.id).toBe(195);
  });

  it("pega o único contrato quando a filial não tem empate", () => {
    expect(contratoDoEmpregado(contratos, { Filial: 1050, "Nome Filial": "qualquer" })?.id).toBe(12);
  });

  it("cai no primeiro da filial quando o Nome Filial não casa com nenhum", () => {
    expect(contratoDoEmpregado(contratos, { Filial: 1093, "Nome Filial": "" })?.id).toBe(27);
  });

  it("devolve null sem filial", () => {
    expect(contratoDoEmpregado(contratos, { Filial: "" })).toBeNull();
    expect(contratoDoEmpregado(contratos, null)).toBeNull();
  });
});

describe("substituído em uma vaga só", () => {
  // Vaga viva segura o colaborador; reprovada e cancelada soltam.
  it("sabe quais status seguram o substituído", () => {
    expect(vagaSeguraSubstituido("Pendente Operacional")).toBe(true);
    expect(vagaSeguraSubstituido("Vaga aberta - Seleção de Currículos")).toBe(true);
    expect(vagaSeguraSubstituido("Concluída")).toBe(true);
    expect(vagaSeguraSubstituido("Reprovada")).toBe(false);
    expect(vagaSeguraSubstituido("Cancelada")).toBe(false);
  });

  const sbFake = (linhas: any[], erro: any = null) => ({
    from: () => ({ select: () => ({ in: async () => ({ data: linhas, error: erro }) }) }),
  });

  it("mapeia o colaborador para a vaga que já o segura", async () => {
    const presos = await substituidosComVagaViva(sbFake([
      { id: 41, substituido_id: 11763, status: "Pendente Operacional" },
      { id: 42, substituido_id: 900,   status: "Reprovada" },
    ]), [11763, 900]);
    expect(presos.get(11763)).toBe(41);
    expect(presos.has(900)).toBe(false);   // reprovada não segura
  });

  it("fica com a vaga mais antiga quando há mais de uma", async () => {
    const presos = await substituidosComVagaViva(sbFake([
      { id: 7, substituido_id: 5, status: "Pendente Recrutamento" },
      { id: 9, substituido_id: 5, status: "Pendente Operacional" },
    ]), [5]);
    expect(presos.get(5)).toBe(7);
  });

  it("não trava a tela quando o banco ainda não tem a coluna", async () => {
    const presos = await substituidosComVagaViva(sbFake(null, { message: "column does not exist" }), [1]);
    expect(presos.size).toBe(0);
  });

  it("nem consulta sem ids", async () => {
    const sb = { from: () => { throw new Error("não devia consultar"); } };
    expect((await substituidosComVagaViva(sb, [])).size).toBe(0);
  });
});

describe("vaga administrativa", () => {
  // Vaga do escritório é gerida só pela diretoria: quem não tem a capacidade
  // não VÊ a vaga — logo não aprova nem reprova. A RLS é quem recusa; estes
  // helpers só escondem botão e recortam cache antigo.
  const comAcesso = (_a: string, _m?: string, menu?: string) => menu === MENU_VAGA_ADMINISTRATIVA;
  const semAcesso = () => false;

  it("o código é o do menu de capacidade cadastrado nos dois módulos", () => {
    expect(MENU_VAGA_ADMINISTRATIVA).toBe("recrutamento_vaga_administrativa");
  });

  it("só quem enxerga vaga administrativa pode marcar uma", () => {
    // Sem isto a pessoa criaria a vaga e ela sumiria da própria vista.
    expect(podeVagaAdministrativa(comAcesso)).toBe(true);
    expect(podeVagaAdministrativa(semAcesso)).toBe(false);
  });

  it("some da lista de quem não pode ver, e a comum fica", () => {
    const vagas = [
      { id: 1, administrativa: false },
      { id: 2, administrativa: true },
      { id: 3 },                        // coluna ainda nula: não é administrativa
    ];
    expect(filtrarAdministrativas(vagas, false).map(v => v.id)).toEqual([1, 3]);
    expect(filtrarAdministrativas(vagas, true).map(v => v.id)).toEqual([1, 2, 3]);
  });
});
