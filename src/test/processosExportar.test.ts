import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { montarExcel, montarHtml, nomeArquivo, type ExtrasProcesso, type ProcessoExp } from "@/pages/juridico/processos/exportar";

const proc = (over: Partial<ProcessoExp> = {}): ProcessoExp => ({
  id: 10, id_sequencial: 123, numero_processo: "0020035-59.2024.5.04.0001",
  reclamante: "Fulana <de Tal>", reclamada: "HAGG", status: "EM ANDAMENTO", comarca: "Porto Alegre", ano_processo: 2024,
  data_entrada_reclamatoria: "15/03/2024", // texto do sistema antigo: sai como veio
  motivo_items: [{ motivo: "Horas extras", valor_pedidos: 1000, valor_acordo: 0, valor_sentenca: 500, valor_final: 0 }],
  valores_a_parte: [{ motivo: "Honorários periciais", valor: 300, descricao: "", destino: "custo_final" }],
  audiencias: [{ data: "2024-06-10", tipo_audiencia: "Instrução", propostas: [{ quem: "Juiz", tipo: "Judicial", valor: 800, descricao: "proposta 1" }] }],
  propostas: [{ data: "2024-08-01", quem: "Reclamada", tipo: "Extrajudicial", valor: 900, descricao: "proposta 2" }],
  totais: { pedidos: 1000, acordo: 0, sentenca: 500, custoFinal: 800, aParte: 300 },
  ...over,
});
const extras = (ps: ProcessoExp[]): ExtrasProcesso => ({
  comentarios: new Map([[ps[0].numero_processo, [{ texto: "ok", autor_nome: "Ana", created_at: "2026-09-01T10:00:00Z" }]]]),
  // Chave = número do processo (22/09/2026): o id da linha muda a cada "Salvar".
  pagamentos: new Map([[ps[0].numero_processo, {
    malote: [{ numero: "DM-2026-0921", nome: "Acordo", status: "Pago", valor_total: 800, origem: "malote_auto", parcelas: [{ pago_em: "2026-09-01" }, {}] }],
    anexos: [],
  }]]),
});
const ler = (b: ArrayBuffer) => XLSX.read(new Uint8Array(b), { type: "array", cellDates: true });

describe("Exportar processos", () => {
  it("custo final e demais totais vêm prontos da tela (não recalcula)", () => {
    const ps = [proc(), proc({ id: 11, id_sequencial: 124, numero_processo: "0000001-00.2025.5.04.0002", totais: { pedidos: 0, acordo: 0, sentenca: 0, custoFinal: 50, aParte: 0 } })];
    const wb = ler(montarExcel(ps, extras(ps), "Teste"));
    expect(wb.SheetNames).toEqual(["Resumo", "Processos", "Motivos", "Valores à parte", "Audiências", "Propostas", "Pagamentos (Malote)", "Comentários"]);
    const resumo = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Resumo"], { header: 1 });
    expect(resumo.find(l => l[0] === "Custo final")?.[1]).toBe(850);
    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Processos"]);
    expect(linhas[0]["Custo final"]).toBe(800);
    expect(linhas[0]["Entrada da reclamatória"]).toBe("15/03/2024");
  });

  it("propostas: as da audiência dizem de qual audiência saíram, as outras 'no decorrer'", () => {
    const ps = [proc()];
    const wb = ler(montarExcel(ps, extras(ps), "Teste"));
    const props = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Propostas"]);
    expect(props.map(p => p["Onde"])).toEqual(["Audiência de 10/06/2024 (Instrução)", "No decorrer do processo"]);
    const mal = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Pagamentos (Malote)"]);
    expect(mal[0]["Parcelas"]).toBe("1 de 2 paga(s)");
    expect(mal[0]["Como entrou"]).toBe("Pelo nº do processo no Malote");
  });

  it("HTML escapa o reclamante e um só não tem índice", () => {
    const ps = [proc()];
    const html = montarHtml(ps, extras(ps), "Teste");
    expect(html).toContain("Fulana &lt;de Tal&gt;");
    expect(html).not.toContain('id="indice"');
    expect(nomeArquivo(ps)).toMatch(/^processo-123-0020035-59-2024-5-04-0001-\d{4}-\d{2}-\d{2}$/);
  });
});
