import { describe, expect, it } from "vitest";
import { erroEnderecoTrabalho } from "@/lib/recrutamento/vagaRegras";
import { montarPlanilhaVagas } from "@/lib/recrutamento/exportarVagas";
import * as XLSX from "xlsx";

// Chamado #0849 (Fernanda, 11/11/2026): endereço efetivo do local de
// trabalho, obrigatório na etapa 1 da vaga, logo depois do posto.

describe("endereço efetivo do local de trabalho", () => {
  it("vazio ou só espaços não avança", () => {
    expect(erroEnderecoTrabalho("")).toMatch(/Informe o endereço/);
    expect(erroEnderecoTrabalho("    ")).toMatch(/Informe o endereço/);
    expect(erroEnderecoTrabalho(null)).toMatch(/Informe o endereço/);
  });

  it("texto curto demais pede o endereço completo", () => {
    expect(erroEnderecoTrabalho("Rua A")).toMatch(/muito curto/);
  });

  it("endereço de verdade passa", () => {
    expect(erroEnderecoTrabalho("Rua Marechal Deodoro, 120 - Centro, Bento Gonçalves/RS")).toBeNull();
  });

  it("vai para o Excel das vagas, ao lado do posto", () => {
    const wb = montarPlanilhaVagas([{ id: 1, status: "Pendente Analista", local_exato: "AUX. ADM. 40H 5X2", endereco_trabalho: "Rua X, 10 - Centro, Bento/RS" }]);
    const linhas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    const cab = linhas[0] as string[];
    const i = cab.indexOf("Endereço do local de trabalho");
    expect(cab[i - 1]).toBe("Posto / local");
    expect((linhas[1] as unknown[])[i]).toBe("Rua X, 10 - Centro, Bento/RS");
  });
});
