// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useEstadoPersistido } from "@/hooks/useEstadoPersistido";

// SIS-2026-0597: o Checklist de Faturamento voltava para o mês atual ao sair e voltar.
// A tela usa useEstadoPersistido("checklist-faturamento", "competencia", mesAtual).
const CHAVE = "checklist-faturamento";
const usar = () => renderHook(() => useEstadoPersistido(CHAVE, "competencia", "2026-10"));

describe("competência do Checklist de Faturamento", () => {
  beforeEach(() => sessionStorage.clear());

  it("primeira vez na sessão: abre no mês atual", () => {
    const { result } = usar();
    expect(result.current[0]).toBe("2026-10");
  });

  it("escolhe setembro, sai da tela (desmonta) e volta: continua em setembro", () => {
    const primeira = usar();
    act(() => primeira.result.current[1]("2026-09"));
    primeira.unmount(); // sair para o Malote

    const volta = usar(); // voltar ao Checklist
    expect(volta.result.current[0]).toBe("2026-09");
  });

  it("só muda quando o próprio usuário troca de novo", () => {
    const a = usar();
    act(() => a.result.current[1]("2026-09"));
    a.unmount();
    const b = usar();
    act(() => b.result.current[1]("2026-08"));
    b.unmount();
    expect(usar().result.current[0]).toBe("2026-08");
  });

  it("outra tela com o mesmo hook não interfere (chave própria)", () => {
    const checklist = usar();
    act(() => checklist.result.current[1]("2026-09"));
    const outra = renderHook(() => useEstadoPersistido("outra-tela", "competencia", "2026-10"));
    expect(outra.result.current[0]).toBe("2026-10");
  });
});
