import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { dataPlanilha, FILTROS_ASO_INICIAIS, lerPlanilhaAsos, normNome, paramsDaLista, situacaoDaPlanilha, tipoDaAba } from "@/lib/sst/asoHistorico";

// SIS-2026-0816 — leitura da planilha de exames clínicos (SST › ASOs Realizados).

const CAB = ["NOME EMPRESA", "NOME FILIAL", "PCD?", "NOME", "SOLICITADO POR", "TIPO", "DATA DA SOLICITAÇÃO",
  "TENTATIVA DE AGENDAMENTO 1", "TENTATIVA DE AGENDAMENTO 2", "TENTATIVA DE AGENDAMENTO 3", "TENTATIVA DE AGENDAMENTO 4",
  "TENTATIVA DE AGENDAMENTO 5", "QUANTIDADE DE TENTATIVAS", "DATA DA REALIZAÇÃO", "DATA LIMITE", "STATUS", "AVISO"];
const serial = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
const linha = (o: { emp?: string; filial?: string; nome: string; sol?: string; tent?: string; real?: string; status?: string; aviso?: string }) =>
  [o.emp ?? "HAGG", o.filial ?? "UFRGS", "NÃO", o.nome, "PRISCILA", "X", o.sol ? serial(o.sol) : "", o.tent ? serial(o.tent) : "", "", "", "", "", 1,
   o.real ? serial(o.real) : "", "", o.status ?? "OK", o.aviso ?? "REALIZADO"];

function planilha(abas: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [nome, rows] of Object.entries(abas)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), nome);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

describe("ASOs da planilha", () => {
  it("normNome igual ao sup_norm_nome do banco", () => {
    expect(normNome("Nubia Beatriz da Rosa-Vieira ")).toBe("NUBIABEATRIZDAROSAVIEIRA");
    expect(normNome("JOÃO GONÇALVES")).toBe(normNome("Joao Goncalves"));
  });

  it("aba → tipo; abas de apoio ficam de fora", () => {
    expect(tipoDaAba("PERIÓDICO")).toBe("periodico");
    expect(tipoDaAba("TROCA DE FUNÇÃO - RISCO")).toBe("troca_funcao");
    expect(tipoDaAba("RETORNO")).toBe("retorno");
    expect(tipoDaAba("RESUMO")).toBeNull();
    expect(tipoDaAba("Planilha1")).toBeNull();
  });

  it("situação sai do AVISO, depois do STATUS, depois da data", () => {
    expect(situacaoDaPlanilha("REALIZADO", "OK", true)).toBe("realizado");
    expect(situacaoDaPlanilha("ATENÇÃO", "", false)).toBe("atrasado");
    expect(situacaoDaPlanilha("VÁLIDO", "VÁLIDO", false)).toBe("valido");
    expect(situacaoDaPlanilha("N/C", "", false)).toBe("nao_compareceu");
    expect(situacaoDaPlanilha("", "CANCELADO", false)).toBe("cancelado");
    expect(situacaoDaPlanilha("", "", true)).toBe("realizado");
    expect(situacaoDaPlanilha("", "", false)).toBe("aguardando");
  });

  it("datas antes de 2000 são lixo da planilha", () => {
    expect(dataPlanilha(0)).toBeNull();
    expect(dataPlanilha(8)).toBeNull();
    expect(dataPlanilha(serial("2025-01-10"))).toBe("2025-01-10");
    expect(dataPlanilha("06/02/2025")).toBe("2025-02-06");
  });

  it("lê as abas de tipo, tira cancelados e realizado sem data, e monta chave estável", () => {
    const l = lerPlanilhaAsos(planilha({
      RESUMO: [["PLANILHA DE ASOS"]],
      "PERIÓDICO": [CAB,
        linha({ nome: "Ana Souza", sol: "2025-01-09", real: "2025-01-10" }),
        linha({ nome: "ANA SOUZA", sol: "2025-01-09", real: "2025-01-11" }), // repetida no mesmo dia
        linha({ nome: "Bia", sol: "2025-02-01", status: "CANCELADO", aviso: "CANCELADO" }),
        linha({ nome: "Caio", sol: "2025-02-01" }), // realizado sem data e sem tentativa
        linha({ nome: "Duda", sol: "2025-02-01", tent: "2025-02-03" }), // sem realização: usa a tentativa
        linha({ nome: "Eva", sol: "2026-10-01", status: "", aviso: "AGUARDANDO" }),
      ],
      DEMISSIONAL: [CAB, linha({ nome: "Fabio", sol: "2025-03-01", real: "2025-03-02", aviso: "VÁLIDO", status: "VÁLIDO" })],
    }));
    expect(l.abas.map((a) => [a.tipo, a.lidas, a.canceladas])).toEqual([["periodico", 4, 1], ["demissional", 1, 0]]);
    expect(l.ignoradas).toEqual([expect.objectContaining({ nome: "Caio", motivo: "realizado sem data de realização" })]);
    const [a1, a2, duda, eva] = l.linhas;
    expect(a1.chave).toBe("aso:periodico:ANASOUZA:2025-01-09:1");
    expect(a2.chave).toBe("aso:periodico:ANASOUZA:2025-01-09:2");
    expect(duda.data_realizacao).toBe("2025-02-03");
    expect(eva).toMatchObject({ situacao: "aguardando", data_realizacao: null });
    // Dispensado (ASO anterior válido) não carrega data de realização: não é exame feito.
    expect(l.linhas.at(-1)).toMatchObject({ tipo: "demissional", situacao: "valido", data_realizacao: null });
  });

  it("planilha sem aba de ASO avisa", () => {
    expect(() => lerPlanilhaAsos(planilha({ Outra: [["x"]] }))).toThrow(/Nenhuma aba de ASO/);
  });

  it("filtros da tela viram parâmetros da RPC", () => {
    expect(paramsDaLista({ ...FILTROS_ASO_INICIAIS, busca: "  ana ", tipo: "periodico", soSemVinculo: true }, 50)).toEqual({
      p_busca: "ana", p_tipo: "periodico", p_situacao: null, p_de: null, p_ate: null, p_sem_vinculo: true, p_limite: 50,
    });
  });
});
