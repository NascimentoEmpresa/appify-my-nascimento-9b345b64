import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BIO_LIMITE, ESTRUTURA_VAZIA, membroPendente, membrosPendentes, type Estrutura, type Membro,
} from "@/lib/organograma/estruturaProcessos";

// Organograma › Estrutura e Processos — pessoas reais, perfil e bio
// (mig 20261022000300).

const membro = (id: string, setorId: string, o: Partial<Membro> = {}): Membro => ({
  id, setor_id: setorId, nome: `Pessoa ${id}`, cargo: "Cargo", nivel: 3, parent_id: null, responsavel: false, atividades: null,
  empregado_id: null, user_id: null, ordem: 0, ...o,
});

// Dados fictícios: nada de nome de gente (nem cargo) da estrutura de verdade.
const E: Estrutura = {
  ...ESTRUTURA_VAZIA,
  membros: [
    membro("m1", "setor-a", { nome: "Cargo de exemplo" }),              // cargo no lugar do nome: pendente
    membro("m2", "setor-a", { empregado_id: 101, user_id: "u-101" }),
    membro("m3", "setor-a", { empregado_id: 102 }),                     // sem login: vinculado mesmo assim
    membro("m4", "setor-b"),
  ],
};

describe("pendentes de vínculo", () => {
  it("pendente é quem não tem empregado_id — login não conta", () => {
    expect(membroPendente(E.membros[0])).toBe(true);
    expect(membroPendente(E.membros[1])).toBe(false);
    expect(membroPendente(E.membros[2])).toBe(false);
  });

  it("vale também para o retrato publicado antes da mig (sem o campo pendente)", () => {
    const antigo = { ...membro("x", "setor-a"), pendente: undefined };
    expect(membroPendente(antigo)).toBe(true);
  });

  it("lista por setor e no geral", () => {
    expect(membrosPendentes(E).map((m) => m.id)).toEqual(["m1", "m4"]);
    expect(membrosPendentes(E, "setor-a").map((m) => m.id)).toEqual(["m1"]);
    expect(membrosPendentes(E, "setor-c")).toEqual([]);
  });
});

describe("bio", () => {
  const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261022000300_organograma_processos_pessoas_reais_perfil_bio.sql"), "utf8");

  it("limite igual ao do banco (CHECK profiles_bio_tamanho e a RPC)", () => {
    expect(BIO_LIMITE).toBe(500);
    expect(sql).toContain("> 500");
  });

  it("a RPC grava em profiles.bio (a mesma de Meu Perfil), não numa cópia", () => {
    expect(sql).toMatch(/UPDATE public\.profiles SET bio = /);
    expect(sql).not.toMatch(/CREATE TABLE/i);
  });

  it("escrever a bio de outra pessoa exige 'alterar' do cadastro; o dono sempre pode", () => {
    expect(sql).toContain("v_uid = auth.uid() OR public.org_proc_pode('alterar')");
  });

  it("o perfil do organograma não expõe CPF nem nascimento", () => {
    const perfil = sql.slice(sql.indexOf("FUNCTION public.org_proc_perfil_pessoa"), sql.indexOf("FUNCTION public.org_proc_salvar_bio"));
    expect(perfil).not.toMatch(/"CPF"|Nascimento/);
  });
});
