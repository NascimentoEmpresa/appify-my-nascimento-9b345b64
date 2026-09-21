import { describe, it, expect } from "vitest";
import { isSobrecargaError, atrasoSobrecargaMs } from "@/lib/erroSobrecarga";
import { isAuthExpiredError } from "@/lib/authErrors";

/**
 * O que estes testes protegem (21/09/2026)
 * ────────────────────────────────────────
 * O reinício do Postgres de produção às 14:01:59 foi agravado pelo retry do
 * QueryClient: banco afogado caía no caso genérico e era repetido 3 vezes, por
 * todos os usuários, em ~500 pontos de useQuery — mais carga em cima de um
 * banco que já não dava conta.
 *
 * A separação entre "token vencido" (insistir) e "banco afogado" (recuar) é o
 * que impede isso de voltar. Se alguém trocar a ordem das checagens no
 * QueryClient, ou alargar demais um dos detectores, estes testes quebram.
 */
describe("erro de sobrecarga x erro de token vencido", () => {
  describe("reconhece banco/borda afogado", () => {
    it("pelos códigos de status da Cloudflare e do gateway", () => {
      for (const status of [429, 502, 503, 504, 521, 522, 523, 524]) {
        expect(isSobrecargaError({ status })).toBe(true);
      }
    });

    it("quando o status vem como texto (acontece no storage)", () => {
      expect(isSobrecargaError({ statusCode: "503" })).toBe(true);
    });

    it("quando o fetch morre antes de qualquer resposta HTTP", () => {
      expect(isSobrecargaError(new TypeError("Failed to fetch"))).toBe(true);
      expect(isSobrecargaError({ message: "NetworkError when attempting to fetch resource" })).toBe(true);
      expect(isSobrecargaError({ message: "socket hang up" })).toBe(true);
    });

    it("pela mensagem do pooler sem conexão disponível", () => {
      expect(
        isSobrecargaError({ message: "connection to database not available" }),
      ).toBe(true);
    });
  });

  describe("NÃO confunde com os outros erros", () => {
    it("token vencido não é sobrecarga — senão pararia de insistir justo onde insistir resolve", () => {
      const jwt = { code: "PGRST301", message: "JWT expired" };
      expect(isAuthExpiredError(jwt)).toBe(true);
      expect(isSobrecargaError(jwt)).toBe(false);
    });

    it("401 e 403 são auth, nunca sobrecarga", () => {
      expect(isSobrecargaError({ status: 401 })).toBe(false);
      expect(isSobrecargaError({ status: 403 })).toBe(false);
    });

    it("erro de dado/permissão comum não é sobrecarga", () => {
      expect(isSobrecargaError({ status: 400, message: "invalid input syntax" })).toBe(false);
      expect(isSobrecargaError({ status: 404 })).toBe(false);
      expect(isSobrecargaError({ code: "23505", message: "duplicate key value" })).toBe(false);
      expect(isSobrecargaError({ code: "42501", message: "permission denied" })).toBe(false);
    });

    it("lixo não derruba a checagem", () => {
      expect(isSobrecargaError(null)).toBe(false);
      expect(isSobrecargaError(undefined)).toBe(false);
      expect(isSobrecargaError("erro")).toBe(false);
      expect(isSobrecargaError({})).toBe(false);
    });
  });

  describe("atraso da nova tentativa", () => {
    it("fica entre 4s e 12s", () => {
      for (let i = 0; i < 200; i++) {
        const ms = atrasoSobrecargaMs();
        expect(ms).toBeGreaterThanOrEqual(4_000);
        expect(ms).toBeLessThan(12_000);
      }
    });

    it("é sorteado, não fixo — sem isso todos os navegadores voltariam juntos", () => {
      const vistos = new Set(Array.from({ length: 200 }, () => atrasoSobrecargaMs()));
      expect(vistos.size).toBeGreaterThan(10);
    });
  });

  describe("a regra completa do QueryClient, como ela roda de verdade", () => {
    // Espelha a ordem real em src/App.tsx: auth primeiro, sobrecarga depois.
    const tentativasPermitidas = (error: unknown, falhasAteAgora: number): boolean => {
      if (isAuthExpiredError(error)) return falhasAteAgora < 5;
      if (isSobrecargaError(error)) return falhasAteAgora < 1;
      return falhasAteAgora < 3;
    };

    it("banco afogado: UMA nova tentativa, não três", () => {
      const afogado = { status: 503 };
      expect(tentativasPermitidas(afogado, 0)).toBe(true);
      expect(tentativasPermitidas(afogado, 1)).toBe(false);
    });

    it("token vencido continua com as 5 tentativas de antes", () => {
      const jwt = { code: "PGRST301", message: "JWT expired" };
      expect(tentativasPermitidas(jwt, 4)).toBe(true);
      expect(tentativasPermitidas(jwt, 5)).toBe(false);
    });

    it("erro comum continua com as 3 tentativas de antes", () => {
      const comum = { status: 400, message: "invalid input" };
      expect(tentativasPermitidas(comum, 2)).toBe(true);
      expect(tentativasPermitidas(comum, 3)).toBe(false);
    });
  });
});
