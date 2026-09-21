import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { montarExcel, montarHtml, nomeArquivo, type DadosExportacao } from "@/pages/juridico/patrimonio/exportar";

const PAT_A = {
  id: 1, codigo: "2", descricao: "Casa <Triunfo>", tipo: "Imóvel", cidade: "TRIUNFO", status: "Ativo",
  situacao_pagamento: "PAGANDO", valor_contrato: "250000.5", valor_falta: 100000, qtd_parcelas: 10, parcelas_pagas: 4,
  possui_escritura: null, transferida: true, created_at: "2026-09-01T10:00:00Z",
};
const PAT_B = { id: 7, codigo: "10", descricao: "Terreno Canoas", tipo: "Terreno", status: "Ativo", situacao_pagamento: "PAGO" };

const dados = (pats: Record<string, unknown>[]): DadosExportacao => ({
  patrimonios: pats,
  obrigacoes: [
    { id: 1, patrimonio_id: 1, categoria: "Financiamento", tipo_lancamento: "parcela", parcela_numero: 1, parcela_total: 10, valor: "1500", vencimento: "2026-01-10", status: "Pendente" },
    { id: 2, patrimonio_id: 1, categoria: "IPTU", valor: 300, vencimento: "2026-03-01", status: "Pago", pago_em: "2026-03-01" },
    { id: 3, patrimonio_id: 7, categoria: "Luz", valor: 90, vencimento: "2026-02-01", status: "Pendente" },
  ],
  parcelas: [],
  itens: [
    { id: 1, patrimonio_id: 1, kind: "acesso", servico: "Portal IPTU", link: "https://iptu.exemplo.gov.br", usuario: "juridico" },
    { id: 2, patrimonio_id: 1, kind: "historico", acao: "Patrimônio cadastrado", autor: "Fulano", created_at: "2026-09-01T10:00:00Z" },
  ],
  comentarios: [{ id: 1, entidade_id: "7", texto: "ok", autor_nome: "Ana", created_at: "2026-09-02T10:00:00Z" }],
});
const opcoes = { seloDaConta: (o: Record<string, unknown>) => String(o.status), autor: "Teste" };

const lerExcel = (b: ArrayBuffer) => XLSX.read(new Uint8Array(b), { type: "array", cellDates: true });

describe("Exportar patrimônios — Excel", () => {
  it("todos: resumo + uma linha por patrimônio + abas só do que tem dado, com código/patrimônio em cada linha", async () => {
    const wb = lerExcel(montarExcel(dados([PAT_A, PAT_B]), opcoes));
    expect(wb.SheetNames).toEqual(["Resumo", "Patrimônios", "Contas e obrigações", "Acessos", "Histórico", "Comentários"]);
    const pats = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Patrimônios"]);
    expect(pats).toHaveLength(2);
    // Valor em R$ sai como NÚMERO (dá pra somar), mesmo vindo do banco como texto.
    expect(pats[0]["Valor do contrato"]).toBe(250000.5);
    expect(pats[0]["Transferência concluída"]).toBe("Sim");
    // "Falta pagar" = parcelas em aberto de Financiamento/Consórcio (a conta da
    // tela), não o valor_falta da importação (100000 no fixture).
    expect(pats[0]["Valor que falta pagar"]).toBe(1500);
    const contas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Contas e obrigações"]);
    expect(contas.map(c => [c["Código"], c["Categoria"]])).toEqual([["2", "Financiamento"], ["2", "IPTU"], ["10", "Luz"]]);
    expect(contas[0]["Parcela"]).toBe("1/10");
    expect(contas[0]["Vencimento"]).toBeInstanceOf(Date);
  });

  it("apenas um: ficha vertical no lugar do resumo, sem colunas de código", async () => {
    const wb = lerExcel(montarExcel(dados([PAT_A]), opcoes));
    expect(wb.SheetNames[0]).toBe("Patrimônio");
    const ficha = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Patrimônio"], { header: 1 });
    expect(ficha.find(l => l[0] === "Possui escritura")?.[1]).toBe("Não informado");
    const contas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Contas e obrigações"]);
    expect(Object.keys(contas[0])).not.toContain("Código");
  });
});

describe("Exportar patrimônios — HTML", () => {
  it("escapa texto do banco, torna link clicável e traz índice quando são todos", async () => {
    const html = montarHtml(dados([PAT_A, PAT_B]), opcoes);
    expect(html).toContain("Casa &lt;Triunfo&gt;");
    expect(html).not.toContain("Casa <Triunfo>");
    expect(html).toContain('href="https://iptu.exemplo.gov.br"');
    expect(html).toContain('id="indice"');
    expect(html).toContain('href="#pat-7"');
  });

  it("um só: sem índice", async () => {
    const html = montarHtml(dados([PAT_B]), opcoes);
    expect(html).not.toContain('id="indice"');
    expect(html).toContain("Terreno Canoas");
  });
});

describe("nome do arquivo", () => {
  it("usa código e descrição sem acento quando é um só", () => {
    expect(nomeArquivo(dados([{ ...PAT_A, descricao: "Prédio São José" }]), true)).toMatch(/^patrimonio-2-predio-sao-jose-\d{4}-\d{2}-\d{2}$/);
    expect(nomeArquivo(dados([PAT_A, PAT_B]), false)).toMatch(/^patrimonios-completo-/);
  });
});
