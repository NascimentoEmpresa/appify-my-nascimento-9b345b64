// Turnover: contrato encerrado com o cliente sai da conta (mig 20261116130000).
// Pedido do Pablo (16/11/2026): HUSM e Salto do Jacuí "estão puxando como
// turnover também, mas fim de contrato não pode ser turnover".
//
// A regra mora no banco (provada num PostgreSQL 18 descartável com dados de
// teste). Aqui: (1) as cinco contas de turnover usam a MESMA regra — se uma
// ficar de fora, a TV e a tela deixam de bater; (2) a tela trata o contrato
// encerrado como turnover zero.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { analistas, turnoverPorContrato, type ContratoTurnover } from "@/lib/diretoria/turnover";

const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261116130000_turnover_contrato_encerrado_fora.sql"), "utf8");

/** Corpo de cada CREATE FUNCTION da migration, pelo nome. */
function funcoes(txt: string): Record<string, string> {
  const out: Record<string, string> = {};
  const partes = txt.split(/^CREATE OR REPLACE FUNCTION public\./m).slice(1);
  for (const p of partes) out[p.slice(0, p.indexOf("("))] = p;
  return out;
}
const fns = funcoes(sql);
const CONTAS = [
  "dir_turnover_painel_dados", "dir_rel_turnover_dados", "dir_turnover_variacao_efetivo",
  "ope_contratos_ind_dados", "cs_form_rotatividade",
];

describe("regra do contrato encerrado no banco", () => {
  it("o encerrado vem do status da Licitação › Contratos, não da data de vigência", () => {
    const regra = fns.turnover_contrato_encerrado_locais;
    expect(regra).toBeDefined();
    expect(regra).toMatch(/COALESCE\(c\.status, 'ativo'\) = 'encerrado'/);
    // Contrato prorrogado fica com data velha: usar a data zeraria contrato ativo.
    expect(regra).not.toMatch(/data_fim_vigencia/);
    // Renovação com o mesmo nome: vale o contrato que NÃO está encerrado.
    expect(regra).toMatch(/ORDER BY public\.rh_norm_contrato\(c\.nome\), \(COALESCE\(c\.status, 'ativo'\) = 'encerrado'\)/);
  });

  it.each(CONTAS)("%s tira o desligamento de contrato encerrado do turnover", (nome) => {
    const corpo = fns[nome];
    expect(corpo, `${nome} sumiu da migration`).toBeDefined();
    expect(corpo).toContain("ct_enc AS MATERIALIZED (SELECT * FROM public.turnover_contrato_encerrado_locais())");
    // Os três motivos juntos: solicitação marcada (SIS-2026-0854), contrato
    // encerrado ou "Fim do Contrato de Trabalho".
    expect(corpo).toMatch(/'Demitido' AND \(public\.turnover_desconsidera\(\w\."ID"\) OR COALESCE\(\(btrim\(\w\."Nome Filial"\)[^\n]*IN \(SELECT f\.filial, f\.local FROM ct_enc f\), false\) OR upper\(btrim\(COALESCE\(\w\."Descrição \(Causa\)", ''\)\)\) = 'FIM DO CONTRATO DE TRABALHO'\)\)/);
    // A regra antiga, sozinha, não pode ter sobrado em nenhuma conta.
    expect(corpo).not.toMatch(/'Demitido' AND public\.turnover_desconsidera\(\w\."ID"\)\)/);
  });

  it("efetivo do grupo (base da taxa) sem contrato encerrado, no painel e no relatório da Diretoria", () => {
    const painel = fns.dir_turnover_painel_dados;
    expect(painel).toContain("count(*) FILTER (WHERE NOT e.contrato_encerrado) n_base");
    expect(painel).toContain("(SELECT COALESCE(sum(n_base), 0) FROM ef WHERE ef.ini = mm.ini) efetivo");
    expect(painel).toContain("ef_medio_grupo AS (SELECT COALESCE(sum(n_base), 0)");
    expect(painel).toContain("(SELECT empresa, sum(n_base) / (SELECT n FROM nmes) ef FROM ef GROUP BY 1) ee");
    // Avisos trabalhado/indenizado (Analistas) também saem.
    expect(painel).toContain("NOT EXISTS (SELECT 1 FROM ct_enc f WHERE f.filial = btrim(s.contrato))");
    expect(fns.dir_rel_turnover_dados).toMatch(/WHERE NOT e\.contrato_encerrado AND e\.adm < g::date[^\n]*\) base/);
  });

  it("'Fim do Contrato de Trabalho' sai só das demissões; 'Fim Antecipado', aprendiz e estágio continuam", () => {
    // Pablo, 16/11/2026: "tirar também". O efetivo não muda (a pessoa trabalhou até sair).
    const semComentarios = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(semComentarios.match(/'FIM DO CONTRATO DE TRABALHO'/g)).toHaveLength(5);
    expect(semComentarios).not.toMatch(/FIM ANTECIPADO|APRENDI|ESTAGIO|ESTÁGIO/i);
    expect(fns.dir_turnover_painel_dados).not.toMatch(/contrato_encerrado[^\n]*FIM DO CONTRATO/);
  });
});

describe("tela: contrato encerrado aparece com turnover zero", () => {
  const base = { empresa: "HAGG", aviso_trabalhado: 0, aviso_indenizado: 0 };
  const ufrgs: ContratoTurnover = { ...base, contrato: "1050 - UFRGS - 047/2022", efetivo_medio: 100, efetivo_atual: 100, demissoes: 4, demissoes_todas: 4, encerrado: false };
  // O que a RPC devolve para o HUSM: efetivo do próprio contrato, nenhuma demissão.
  const husm: ContratoTurnover = { ...base, contrato: "1097 - HUSM SANTA MARIA - LAVANDERIA - 020/2021", efetivo_medio: 30, efetivo_atual: 0, demissoes: 0, demissoes_todas: 0, encerrado: true };

  it("não entra no gráfico de turnover por contrato", () => {
    const linhas = turnoverPorContrato({ por_contrato: [ufrgs, husm], efetivo_medio: 100 });
    expect(linhas.map((l) => l.nome)).toEqual(["UFRGS - 047/2022"]);
    expect(linhas[0].grupo).toBe(4);
  });

  it("não aparece em Analistas (sem efetivo hoje, sem desligamento contado)", () => {
    const linhas = analistas({ por_contrato: [ufrgs, husm], fator_projecao: 1 }, "demissao");
    expect(linhas.map((l) => l.nome)).toEqual(["UFRGS - 047/2022"]);
  });
});
