import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  cpfFormatado, filtrosEmTexto, montarExcelAlunos, nomeArquivoAlunos,
  type AlunoRelatorio, type FiltrosRelatorioAlunos,
} from "@/lib/treinamentos/relatorioAlunos";

// Treinamentos › Gerenciar alunos — relatório do filtro (08/10/2026,
// mig 20261008000011): todas as linhas do filtro, num Excel do motor comum.

const aluno = (p: Partial<AlunoRelatorio>): AlunoRelatorio => ({
  id: p.id ?? "a1", nome: p.nome ?? "ANA SILVA", email: p.email ?? "ana@x.com", documento: p.documento ?? "60122483006",
  status: p.status ?? "inativo", situacao: p.situacao ?? "Trabalhando", contrato: p.contrato ?? "1040 - UFRGS - JARDINAGEM - 062/2025",
  cargo: p.cargo ?? "JARDINEIRO", empregado_id: p.empregado_id ?? 10, origem: p.origem ?? "senior", acesso_completo: p.acesso_completo ?? false,
  cursos: p.cursos ?? 1, ultimo_acesso_em: p.ultimo_acesso_em ?? null, sincronizado_em: p.sincronizado_em ?? null,
  admissao: p.admissao ?? "2026-07-17", afastamento: p.afastamento ?? null, email_sintetico: p.email_sintetico ?? false,
});

const SEM_FILTRO: FiltrosRelatorioAlunos = { busca: "", status: "", situacao: "", contratos: [] };
const ler = (b: ArrayBuffer) => XLSX.read(new Uint8Array(b), { type: "array", cellDates: true });

describe("relatório de alunos do filtro", () => {
  it("Resumo com os filtros e os totais; uma linha por aluno, com as colunas da tela", () => {
    const f: FiltrosRelatorioAlunos = { busca: "", status: "inativo", situacao: "", contratos: ["1040 - UFRGS - JARDINAGEM - 062/2025", "1035 - UFRGS - LIMPEZA - 020/2022"] };
    const alunos = [
      aluno({ id: "a1", nome: "ADRIA ROBERTH", ultimo_acesso_em: null }),
      aluno({ id: "a2", nome: "ADRIANI CARDOSO", email: "126@colaborador.nascimento.local", email_sintetico: true, situacao: "Auxílio Doença", contrato: "1035 - UFRGS - LIMPEZA - 020/2022", cursos: 3 }),
    ];
    const wb = ler(montarExcelAlunos(alunos, f, "Pablo"));
    expect(wb.SheetNames).toEqual(["Resumo", "Alunos"]);

    const resumo = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Resumo"], { header: 1 });
    const mapa = Object.fromEntries(resumo.filter((l) => l.length >= 2).map((l) => [l[0], l[1]]));
    expect(mapa["Filtro · Status do aluno"]).toBe("Inativos (nunca acessou)");
    expect(mapa["Filtro · Contratos"]).toBe("1040 - UFRGS - JARDINAGEM - 062/2025; 1035 - UFRGS - LIMPEZA - 020/2022");
    expect(mapa["Filtro · Situação (Senior)"]).toBe("Todas as situações");
    expect(mapa["Total de alunos"]).toBe(2);
    expect(mapa["Inativos"]).toBe(2);
    expect(mapa["Ativos"]).toBe(0);
    expect(mapa["Gerado por"]).toBe("Pablo");

    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Alunos"]);
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ Colaborador: "ADRIA ROBERTH", "E-mail": "ana@x.com", "Sem e-mail no cadastro": "Não", CPF: "601.224.830-06", Aluno: "Inativo", Acesso: "Personalizado", Cursos: 1 });
    // E-mail gerado pelo ERP não sai como se fosse do colaborador.
    expect(linhas[1]).toMatchObject({ Colaborador: "ADRIANI CARDOSO", "Sem e-mail no cadastro": "Sim", "Situação (Senior)": "Auxílio Doença", Cursos: 3 });
    expect(linhas[1]["E-mail"]).toBeUndefined();
    // Data sai como data (dá para filtrar e ordenar no Excel).
    expect(linhas[0]["Admissão"]).toBeInstanceOf(Date);
    // Coluna sem nenhum dado no filtro (último acesso, afastamento) não sai.
    expect(Object.keys(linhas[0])).not.toContain("Último acesso");
    expect(Object.keys(linhas[0])).not.toContain("Afastamento");
  });

  it("sem filtro, o Resumo diz 'todos' em cada um", () => {
    expect(filtrosEmTexto(SEM_FILTRO)).toEqual([
      ["Busca", "(sem busca)"], ["Contratos", "Todos os contratos"], ["Status do aluno", "Todos os status"], ["Situação (Senior)", "Todas as situações"],
    ]);
  });

  it("nome do arquivo resume o filtro e leva a data", () => {
    const hoje = new Date(2026, 9, 8);
    expect(nomeArquivoAlunos(SEM_FILTRO, hoje)).toBe("alunos-treinamentos-todos-2026-10-08.xlsx");
    expect(nomeArquivoAlunos({ ...SEM_FILTRO, status: "inativo", contratos: ["a", "b", "c"] }, hoje)).toBe("alunos-treinamentos-inativos-3-contratos-2026-10-08.xlsx");
    expect(nomeArquivoAlunos({ ...SEM_FILTRO, status: "ativo", contratos: ["1040 - UFRGS - JARDINAGEM - 062/2025"] }, hoje))
      .toBe("alunos-treinamentos-ativos-1040-ufrgs-jardinagem-062-2025-2026-10-08.xlsx");
    expect(nomeArquivoAlunos({ ...SEM_FILTRO, busca: "Silva", situacao: "Férias" }, hoje)).toBe("alunos-treinamentos-ferias-busca-silva-2026-10-08.xlsx");
  });

  it("CPF formatado só quando tem 11 dígitos", () => {
    expect(cpfFormatado("60122483006")).toBe("601.224.830-06");
    expect(cpfFormatado("123")).toBe("123");
    expect(cpfFormatado(null)).toBe("");
  });
});
