import { describe, it, expect } from "vitest";
import {
  COLS_ERP, ehMEI, montarMapa,
} from "@/components/rh/ImportarColaboradores";

// Duas garantias que a importação de colaboradores tem que manter, porque
// quebrá-las desfaz trabalho manual de quem configurou o cadastro:
//   1. "Configurações extras (ERP)" — Setor, Nível e Perfil — não é da folha.
//      É configuração feita à mão na tela e usada para permissão/encarregado.
//   2. MEI não é tocado, nem para inserir nem para atualizar.
//
// O mapa coluna→coluna é montado uma vez e TODO insert e TODO update saem
// dele. Então travar o mapa trava o resto: se alguém acrescentar uma coluna
// do ERP na EMPREGADOS e esquecer de listá-la aqui, este teste cai.

describe("importação de colaboradores — configurações extras (ERP)", () => {
  // Nomes reais das colunas por trás dos três campos da seção na tela.
  const CAMPOS_DA_TELA = ["Setor_ERP", "LIDER", "Perfil_ERP"];

  it("os três campos da seção estão na lista de colunas protegidas", () => {
    for (const c of CAMPOS_DA_TELA) expect(COLS_ERP.has(c)).toBe(true);
  });

  // O caso que importa: a planilha TEM colunas com esses nomes e mesmo assim
  // elas não podem entrar no mapa.
  it("não entram no mapa nem quando a planilha traz colunas de mesmo nome", () => {
    const colsBanco = ["Nome", "CPF", "Valor Salário", ...CAMPOS_DA_TELA];
    const planilha = new Set(["Nome", "CPF", "Valor Salário", ...CAMPOS_DA_TELA]);
    const mapa = montarMapa(colsBanco, planilha);
    const colunasEscritas = mapa.map(m => m.col);
    for (const c of CAMPOS_DA_TELA) expect(colunasEscritas).not.toContain(c);
    // …e o resto continua sendo importado normalmente.
    expect(colunasEscritas).toContain("Valor Salário");
    expect(colunasEscritas).toContain("Nome");
  });

  // "TIPO DE CONTRATO" é onde mora a marca de MEI: se a importação
  // sobrescrevesse essa coluna, um MEI deixaria de ser reconhecido como MEI na
  // importação seguinte e passaria a ser alterado.
  it("o tipo de contrato também é protegido, senão a marca de MEI se perde", () => {
    expect(COLS_ERP.has("TIPO DE CONTRATO")).toBe(true);
    const mapa = montarMapa(["TIPO DE CONTRATO"], new Set(["TIPO DE CONTRATO"]));
    expect(mapa).toHaveLength(0);
  });
});

describe("importação de colaboradores — MEI", () => {
  it("reconhece MEI pela coluna da própria EMPREGADOS", () => {
    expect(ehMEI({ "TIPO DE CONTRATO": "MEI" })).toBe(true);
    expect(ehMEI({ "TIPO DE CONTRATO": "Contrato MEI mensal" })).toBe(true);
  });

  it("reconhece MEI escrito por extenso", () => {
    expect(ehMEI({ "Descrição (T. Contrato)": "Microempreendedor Individual" })).toBe(true);
  });

  it("reconhece MEI vindo de qualquer uma das colunas de tipo do export", () => {
    expect(ehMEI({ "Descrição (Categoria Contribuinte)": "MEI" })).toBe(true);
    expect(ehMEI({ "Descrição (Cat. eSocial)": "MEI" })).toBe(true);
    expect(ehMEI({ "Descrição (Categoria Sefip)": "MEI" })).toBe(true);
  });

  it("não confunde MEI com palavra que apenas contém as letras", () => {
    expect(ehMEI({ "TIPO DE CONTRATO": "MEIO PERÍODO" })).toBe(false);
    expect(ehMEI({ "TIPO DE CONTRATO": "CLT" })).toBe(false);
  });

  it("registro sem nenhuma coluna de tipo não é MEI", () => {
    expect(ehMEI({ Nome: "Fulano" })).toBe(false);
    expect(ehMEI({})).toBe(false);
    expect(ehMEI(null)).toBe(false);
  });
});
