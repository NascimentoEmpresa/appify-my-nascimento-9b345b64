import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  contarRevisoes, mostraCardObservacao, normalizarObservacao, passaNoFiltroRevisao,
  proximoEstadoNaLista, visualRevisao,
} from "@/pages/chamados/revisaoPessoal";

// SIS-2026-0938 — marcação pessoal de revisão do solicitante.
describe("revisão pessoal do chamado", () => {
  it("clique na lista: nada → revisar → nada; revisado → revisar", () => {
    expect(proximoEstadoNaLista(null)).toBe("revisar");
    expect(proximoEstadoNaLista("revisar")).toBeNull();
    expect(proximoEstadoNaLista("revisado")).toBe("revisar");
  });

  it("rótulos e dica do botão", () => {
    expect(visualRevisao(null).rotulo).toBe("Revisar");
    expect(visualRevisao(null).dica).toContain("Clique para ativar a marcação de Revisar neste chamado");
    expect(visualRevisao("revisar").rotulo).toBe("Revisar");
    expect(visualRevisao("revisado").rotulo).toBe("Revisado");
  });

  it("card de observação só para quem marcou", () => {
    expect(mostraCardObservacao(null)).toBe(false);
    expect(mostraCardObservacao("revisar")).toBe(true);
    expect(mostraCardObservacao("revisado")).toBe(true);
  });

  it("filtro e contadores", () => {
    expect(passaNoFiltroRevisao(null, "")).toBe(true);
    expect(passaNoFiltroRevisao("revisar", "revisar")).toBe(true);
    expect(passaNoFiltroRevisao("revisado", "revisar")).toBe(false);
    expect(passaNoFiltroRevisao(null, "revisado")).toBe(false);
    expect(contarRevisoes([null, "revisar", "revisado", "revisar"])).toEqual({ revisar: 2, revisado: 1 });
  });

  it("observação em branco não grava", () => {
    expect(normalizarObservacao("   ")).toBeNull();
    expect(normalizarObservacao(" ok ")).toBe("ok");
  });

  it("não entra na trava de pendências nem toca no CHAMADO_SISTEMA", () => {
    const lista = readFileSync("src/pages/chamados/listaSolicitante.ts", "utf8");
    expect(lista).not.toMatch(/revis/i);
    const sql = readFileSync("supabase/migrations/20261119050000_sis_2026_0938_chamado_revisao_pessoal.sql", "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sql).not.toMatch(/ALTER TABLE public\."CHAMADO_SISTEMA"\s/);
    expect(sql).not.toMatch(/UPDATE public\."CHAMADO_SISTEMA"\s/);
    // RLS por dono, sem bypass. auth.uid() dentro de (SELECT ...): o guardião
    // de desempenho (M1) barra a função solta, reavaliada em cada linha.
    expect(sql).toMatch(/USING \(user_id = \(SELECT auth\.uid\(\)\)\)/);
    expect(sql).not.toMatch(/has_screen_access|has_role|tem_acesso_menu/);
  });
});
