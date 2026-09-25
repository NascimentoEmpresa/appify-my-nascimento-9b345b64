import { describe, it, expect } from "vitest";
import {
  type LinhaQuadroForm, LINHA_VAZIA, paraNumero, paraInteiro, chavePosto,
  faltamNaLinha, erroDaLinha, errosDoQuadro, prazoSuficiente,
  totalDeColaboradores, totalDeVagas, totalSalarialMensal, paraPayload,
  conferirContrato, contratoCompleto, pendenciasDoContrato,
  conferirQuadroComContrato,
} from "@/lib/licitacoes/quadroPostos";
import { somaDiasUteis, hojeIso } from "@/lib/recrutamento/vagaRegras";

/** Uma data que passa no prazo de 7 dias úteis, contada de hoje. */
const dataOk = () => somaDiasUteis(hojeIso(), 10);
/** Uma data que NÃO passa (amanhã). */
const dataCurta = () => somaDiasUteis(hojeIso(), 1);

const linha = (p: Partial<LinhaQuadroForm> = {}): LinhaQuadroForm => ({
  ...LINHA_VAZIA,
  posto_nome: "JARDINAGEM CAMPUS CENTRO",
  cargo: "Jardineiro",
  quantidade: "10",
  escala: "5X2 SEG A SEX",
  salario: "1.412,00",
  estado: "RS",
  cidade: "Porto Alegre",
  local_exato: "Campus Centro, prédio 12",
  data_inicio_prevista: dataOk(),
  ...p,
});

describe("paraNumero — salário como as pessoas digitam", () => {
  it("lê pt-BR com separador de milhar", () => {
    expect(paraNumero("R$ 1.412,00")).toBe(1412);
    expect(paraNumero("1.412,00")).toBe(1412);
    expect(paraNumero("1412,50")).toBe(1412.5);
  });

  it("lê o que um <input type=number> devolve (ponto decimal)", () => {
    expect(paraNumero("1412.5")).toBe(1412.5);
    expect(paraNumero(1412.5)).toBe(1412.5);
  });

  // O bug que esta regra existe para evitar: tratar o ponto como decimal
  // quando há vírgula leria "1.412,00" como 1,412.
  it("com vírgula, o ponto é milhar — não decimal", () => {
    expect(paraNumero("1.234.567,89")).toBe(1234567.89);
  });

  it("vazio e lixo viram zero, não NaN", () => {
    expect(paraNumero("")).toBe(0);
    expect(paraNumero("abc")).toBe(0);
    expect(paraNumero(null)).toBe(0);
    expect(paraNumero(undefined)).toBe(0);
  });

  it("paraInteiro recusa zero e negativo", () => {
    expect(paraInteiro("10")).toBe(10);
    expect(paraInteiro("10,9")).toBe(10);
    expect(paraInteiro("0")).toBe(0);
    expect(paraInteiro("-3")).toBe(0);
  });
});

describe("chavePosto — casa com o sup_norm_nome do banco", () => {
  it("ignora acento, caixa e pontuação", () => {
    expect(chavePosto("Jardinagem - Campus Centro"))
      .toBe(chavePosto("JARDINAGEM CAMPUS CENTRO"));
    expect(chavePosto("VIGILÂNCIA")).toBe(chavePosto("vigilancia"));
  });

  // Conferido contra o `sup_norm_nome` do Postgres (migration
  // 20260819000004): o "ª" é INDICADOR ORDINAL, não a letra "a" — não está na
  // lista do `translate` de lá, e cai no `[^A-Za-z0-9]` que descarta. As duas
  // pontas concordam em descartá-lo, então "1ª DP" e "1a DP" são postos
  // DIFERENTES para os dois. Não é o comportamento que se adivinha, e é por
  // isso que está escrito aqui: se um dia o banco passar a tratar o ordinal,
  // este teste é que avisa que a régua da tela ficou para trás.
  it("descarta o indicador ordinal — igual ao banco", () => {
    expect(chavePosto("1ª DP Novo Hamburgo")).toBe("1DPNOVOHAMBURGO");
    expect(chavePosto("1a dp novo hamburgo")).toBe("1ADPNOVOHAMBURGO");
  });
});

describe("faltamNaLinha", () => {
  it("linha completa não tem pendência", () => {
    expect(faltamNaLinha(linha())).toEqual([]);
  });

  it("lista cada obrigatório que falta, com o rótulo da tela", () => {
    const faltam = faltamNaLinha(linha({ posto_nome: "", cargo: "", salario: "" }));
    expect(faltam).toContain("Posto");
    expect(faltam).toContain("Cargo");
    expect(faltam).toContain("Salário");
  });

  it("salário zero é o mesmo que salário em branco", () => {
    expect(faltamNaLinha(linha({ salario: "0" }))).toContain("Salário");
  });

  it("quantidade zero não passa — 0 vagas não é um posto", () => {
    expect(faltamNaLinha(linha({ quantidade: "0" }))).toContain("Quantidade de colaboradores");
  });

  it('experiência "Sim" exige dizer qual', () => {
    expect(faltamNaLinha(linha({ exp_minima: "Sim" }))).toContain("Qual experiência mínima");
    expect(faltamNaLinha(linha({ exp_minima: "Sim", exp_minima_qual: "6 meses" }))).toEqual([]);
  });
});

describe("prazo de 7 dias úteis — a mesma regra do guard da vaga", () => {
  it("aceita data com folga", () => {
    expect(prazoSuficiente(dataOk())).toBe(true);
  });

  it("recusa data curta", () => {
    expect(prazoSuficiente(dataCurta())).toBe(false);
  });

  it("erroDaLinha explica o prazo curto citando o posto", () => {
    const e = erroDaLinha(linha({ data_inicio_prevista: dataCurta() }));
    expect(e).toContain("JARDINAGEM CAMPUS CENTRO");
    expect(e).toContain("dias úteis");
  });

  // Posto declarado no contrato mas que não abre vaga nesta leva não tem
  // prazo a cumprir — ele existe no quadro, só não vira solicitação.
  it("posto sem abrir vaga não é barrado por prazo", () => {
    expect(erroDaLinha(linha({ data_inicio_prevista: dataCurta(), gerar_vagas: false }))).toBeNull();
  });

  it("campo vazio não vira erro de prazo (é outra mensagem)", () => {
    expect(erroDaLinha(linha({ data_inicio_prevista: "", cargo: "" }))).toBeNull();
  });
});

describe("errosDoQuadro", () => {
  it("quadro válido não tem erro", () => {
    expect(errosDoQuadro([linha(), linha({ posto_nome: "VIGILÂNCIA", cargo: "Vigilante" })])).toEqual([]);
  });

  it("acusa posto repetido pelo nome, mesmo com acento/caixa diferentes", () => {
    const erros = errosDoQuadro([
      linha({ posto_nome: "Jardinagem Campus Centro" }),
      linha({ posto_nome: "JARDINAGEM - CAMPUS CENTRO", cargo: "Vigilante" }),
    ]);
    expect(erros.some(e => e.includes("aparece duas vezes"))).toBe(true);
  });

  it("identifica a linha sem nome pelo número", () => {
    const erros = errosDoQuadro([linha({ posto_nome: "" })]);
    expect(erros[0]).toContain("Posto nº 1");
  });

  it("insalubridade fora de 0–100 é recusada", () => {
    expect(errosDoQuadro([linha({ insalubridade_pct: "140" })])[0]).toContain("0 a 100");
  });
});

describe("totais do quadro", () => {
  const q = [
    linha({ posto_nome: "JARDINAGEM", quantidade: "10", salario: "1.412,00" }),
    linha({ posto_nome: "VIGILÂNCIA", quantidade: "10", salario: "2.000,00" }),
    linha({ posto_nome: "ADMINISTRATIVO", quantidade: "10", salario: "2.500,00", gerar_vagas: false }),
  ];

  it("soma 30 colaboradores — o caso do contrato de 30 pessoas", () => {
    expect(totalDeColaboradores(q)).toBe(30);
  });

  it("só conta como vaga o posto marcado para abrir", () => {
    expect(totalDeVagas(q)).toBe(20);
  });

  it("soma salarial multiplica pelo número de pessoas", () => {
    expect(totalSalarialMensal(q)).toBe(10 * 1412 + 10 * 2000 + 10 * 2500);
  });
});

describe("paraPayload — o que vai para a RPC", () => {
  it("converte número e troca vazio por null", () => {
    const [p] = paraPayload([linha({ horario: "", beneficios: "  " })]);
    expect(p.salario).toBe(1412);
    expect(p.quantidade).toBe(10);
    expect(p.horario).toBeNull();
    expect(p.beneficios).toBeNull();
  });

  it("id vazio vira null (linha nova), e a ordem acompanha a posição", () => {
    const p = paraPayload([linha(), linha({ posto_nome: "VIGILÂNCIA" })]);
    expect(p[0].id).toBeNull();
    expect(p[0].ordem).toBe(1);
    expect(p[1].ordem).toBe(2);
  });

  it("estado vai em maiúsculo e os textos sem espaço nas pontas", () => {
    const [p] = paraPayload([linha({ estado: "rs", cargo: "  Jardineiro  " })]);
    expect(p.estado).toBe("RS");
    expect(p.cargo).toBe("Jardineiro");
  });
});

describe("conferirContrato — o card de obrigatórios", () => {
  const completo = {
    empresa_id: "e1", nome: "UFRGS LIMPEZA", cliente: "UFRGS",
    numero_edital: "014/2026", cidade: "Porto Alegre", status_solicitacao: "OK - EMITIDO",
    data_inicio: "2026-10-01", data_fim_vigencia: "2027-10-01",
    vigencia_inicial: "2026-10-01", vigencia_final: "2027-10-01",
    quant_func_estipulado: 30, quant_func_exec: 30,
    valor_mensal_contratado: 100000, valor_executado_mensal: 98000,
  };

  it("contrato completo passa", () => {
    expect(contratoCompleto(completo)).toBe(true);
    expect(pendenciasDoContrato(completo)).toEqual([]);
  });

  // Era o buraco real: o handleSalvar só conferia a empresa, e contrato sem
  // vigência/valor/quantidade entrava com os "*" na tela sem efeito nenhum.
  it("contrato sem vigência, valor e quantidade não passa", () => {
    const p = pendenciasDoContrato({ empresa_id: "e1", nome: "X", cliente: "Y" });
    const campos = p.map(i => i.campo);
    expect(campos).toContain("Vigência Inicial");
    expect(campos).toContain("Valor Mensal Contratado");
    expect(campos).toContain("Qtd. Func. Estip.");
  });

  it("zero não conta como preenchido em quantidade e valor", () => {
    const campos = pendenciasDoContrato({ ...completo, quant_func_estipulado: 0, valor_mensal_contratado: 0 })
      .map(i => i.campo);
    expect(campos).toContain("Qtd. Func. Estip.");
    expect(campos).toContain("Valor Mensal Contratado");
  });

  it("cada pendência sabe a que seção do formulário pertence", () => {
    const p = conferirContrato(completo).find(i => i.campo === "Valor Mensal Contratado");
    expect(p?.secao).toBe("Valores Mensais");
  });
});

describe("conferirQuadroComContrato — avisa, não impede", () => {
  const q30 = [linha({ posto_nome: "A", quantidade: "10" }),
               linha({ posto_nome: "B", quantidade: "10" }),
               linha({ posto_nome: "C", quantidade: "10" })];

  it("quadro batendo com o contrato não gera aviso", () => {
    expect(conferirQuadroComContrato(q30, 30).aviso).toBeNull();
  });

  it("quadro menor avisa a diferença (implantação em fases)", () => {
    const r = conferirQuadroComContrato([linha({ quantidade: "12" })], 30);
    expect(r.diferenca).toBe(-18);
    expect(r.aviso).toContain("18 a MENOS");
  });

  it("quadro maior que o contrato também avisa", () => {
    expect(conferirQuadroComContrato(q30, 25).aviso).toContain("5 a MAIS");
  });

  it("contrato sem quantidade estipulada não tem o que conferir", () => {
    expect(conferirQuadroComContrato(q30, null).aviso).toBeNull();
  });

  it("quadro vazio não acusa divergência", () => {
    expect(conferirQuadroComContrato([], 30).aviso).toBeNull();
  });
});
