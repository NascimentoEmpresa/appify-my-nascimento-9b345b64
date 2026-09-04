import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GRID_CM,
  STATUS_ATIVO,
  TIPOS_ATIVO,
  TIPOS_ELEMENTO,
  arredondarGrid,
  cmParaMetros,
  statusAtivo,
  tipoAtivo,
  tipoElemento,
} from "@/pages/ti/mapa/catalogo";

/**
 * T.I › Mapa de Hardware — o catálogo do front e os CHECKs do banco são a
 * MESMA lista escrita duas vezes, em linguagens diferentes. Quando as duas
 * divergem não há erro de compilação nem de lint: a pessoa escolhe "Firewall"
 * no combo, o PostgREST devolve 400 e o cadastro simplesmente não salva.
 *
 * Estes testes leem o CHECK direto da migration e comparam com o catálogo.
 * Um tipo novo agora exige as duas pontas, ou o teste vermelho avisa antes de
 * alguém descobrir em produção.
 */

const SQL = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20260930000062_ti_mapa_hardware.sql"),
  "utf-8",
);

/**
 * Extrai a lista de um `CHECK (coluna IN ('a','b',…))` da migration.
 *
 * `ancora` desempata quando a mesma coluna tem CHECK em mais de uma tabela —
 * é o caso de `tipo`, que existe tanto em TI_ATIVO quanto em
 * TI_PLANTA_ELEMENTO. Sem ela, o teste comparava a lista de equipamentos com
 * a de paredes e mesas.
 */
function valoresDoCheck(coluna: string, ancora: string): string[] {
  // O CHECK quebra em várias linhas, daí o [\s\S].
  const re = new RegExp(`CHECK \\(${coluna} IN \\(([\\s\\S]*?)\\)\\)`, "g");
  const listas = [...SQL.matchAll(re)].map((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
  const achada = listas.find((lista) => lista.includes(ancora));
  if (!achada) throw new Error(`CHECK de ${coluna} contendo '${ancora}' não encontrado na migration`);
  return achada;
}

describe("catálogo do Mapa de Hardware x CHECKs do banco", () => {
  it("oferece exatamente os tipos de equipamento que o banco aceita", () => {
    expect(new Set(TIPOS_ATIVO.map((t) => t.valor))).toEqual(new Set(valoresDoCheck("tipo", "desktop")));
  });

  it("oferece exatamente os status que o banco aceita", () => {
    expect(new Set(STATUS_ATIVO.map((s) => s.valor))).toEqual(new Set(valoresDoCheck("status", "em_uso")));
  });

  it("oferece exatamente os elementos de planta que o banco aceita", () => {
    expect(new Set(TIPOS_ELEMENTO.map((t) => t.valor))).toEqual(new Set(valoresDoCheck("tipo", "parede")));
  });

  it("não tem valor duplicado em nenhuma das listas", () => {
    for (const lista of [TIPOS_ATIVO.map((t) => t.valor), TIPOS_ELEMENTO.map((t) => t.valor), STATUS_ATIVO.map((s) => s.valor)]) {
      expect(new Set(lista).size).toBe(lista.length);
    }
  });
});

describe("tipo desconhecido não derruba o mapa", () => {
  it("cai no fallback em vez de quebrar o render", () => {
    // Cenário real: alguém adiciona um tipo no banco antes do deploy do front.
    expect(tipoAtivo("holograma").valor).toBe("outro");
    expect(tipoAtivo(null).valor).toBe("outro");
    expect(tipoElemento("teletransporte").valor).toBe("parede");
    expect(statusAtivo(undefined).valor).toBe("inativo");
  });
});

describe("geometria do mapa", () => {
  it("gruda no grid de 25 cm, para os dois lados", () => {
    expect(arredondarGrid(0)).toBe(0);
    expect(arredondarGrid(12)).toBe(0);
    expect(arredondarGrid(13)).toBe(GRID_CM);
    expect(arredondarGrid(137)).toBe(125);
    expect(arredondarGrid(-13)).toBe(-GRID_CM);
  });

  it("mostra centímetros como metros no formato brasileiro", () => {
    expect(cmParaMetros(200)).toBe("2,00 m");
    expect(cmParaMetros(2400)).toBe("24,00 m");
    expect(cmParaMetros(45)).toBe("0,45 m");
  });

  it("dá a todo equipamento uma pegada com área — ícone sem tamanho some do mapa", () => {
    for (const t of TIPOS_ATIVO) {
      expect(t.largura).toBeGreaterThan(0);
      expect(t.altura).toBeGreaterThan(0);
    }
  });
});
