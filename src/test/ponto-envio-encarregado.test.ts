import { describe, expect, it } from "vitest";
import {
  caminhoAnexo, divergeDoRelogio, envioEditavel, montarItens, pendenciasEnvio, resumoItens, sugerirItem, type ColaboradorRelogio,
} from "@/lib/conferenciaPonto/envioEncarregado";
import { etapaDoStatus, proximoStatus, STATUS_INICIAL } from "@/lib/conferenciaPonto/conferencia";

const col = (o: Partial<ColaboradorRelogio>): ColaboradorRelogio => ({
  empregado_id: 1, nome: "ANA", cadastro: 10, cargo: "SERVENTE", posto: "EMEF X", situacao_senior: "Trabalhando",
  dias_marcados: 20, dias_uteis_sem_marcacao: 0, ...o,
});

describe("envio do encarregado", () => {
  it("sugere a situação pela Senior e pelo relógio", () => {
    expect(sugerirItem(col({}), true).situacao).toBe("ok");
    expect(sugerirItem(col({ dias_uteis_sem_marcacao: 3 }), true)).toMatchObject({ situacao: "faltas", faltas: 3 });
    expect(sugerirItem(col({ dias_uteis_sem_marcacao: 3 }), false).situacao).toBe("ok");
    expect(sugerirItem(col({ situacao_senior: "Férias", dias_uteis_sem_marcacao: 22 }), true).situacao).toBe("ferias");
    expect(sugerirItem(col({ situacao_senior: "Auxílio Doença" }), true).situacao).toBe("afastado");
    expect(sugerirItem(col({ situacao_senior: "Licença Maternidade" }), true).situacao).toBe("afastado");
    expect(sugerirItem(col({ situacao_senior: "Atestado (dias)" }), true).situacao).toBe("atestado");
  });

  it("monta a lista mantendo o que já foi salvo e quem saiu do contrato", () => {
    const itens = montarItens(
      [col({ empregado_id: 1, nome: "BRUNO", dias_uteis_sem_marcacao: 2 }), col({ empregado_id: 2, nome: "ANA" })],
      [{ empregado_id: 1, nome: "BRUNO", situacao: "atestado", observacao: "CID" }, { empregado_id: 9, nome: "CARLA", situacao: "desligado" }],
      true,
    );
    expect(itens.map((i) => i.nome)).toEqual(["ANA", "BRUNO", "CARLA"]);
    expect(itens[1]).toMatchObject({ situacao: "atestado", observacao: "CID", dias_sem_marcacao: 2 });
    expect(itens[2].situacao).toBe("desligado");
  });

  it("pendências antes de enviar", () => {
    const ok = montarItens([col({})], [], true);
    expect(pendenciasEnvio(ok, 1)).toEqual([]);
    expect(pendenciasEnvio(ok, 0)).toEqual(["Anexe a folha/espelho de ponto do mês."]);
    const ruim = [{ ...ok[0], situacao: "faltas" as const, faltas: 0 }, { ...ok[0], situacao: "divergencia" as const, observacao: " " }];
    expect(pendenciasEnvio(ruim, 1)).toHaveLength(2);
    expect(pendenciasEnvio([], 1)[0]).toMatch(/Nenhum/);
  });

  it("resumo, divergência e editável", () => {
    const itens = montarItens([col({ empregado_id: 1, dias_uteis_sem_marcacao: 2 }), col({ empregado_id: 2, nome: "B", dias_marcados: 0 })], [], true);
    const r = resumoItens(itens);
    expect(r).toMatchObject({ total: 2, faltas: 2, semBatida: 1 });
    expect(r.por.faltas).toBe(1);
    expect(divergeDoRelogio({ ...itens[0], situacao: "ok" }, true)).toBe(true);
    expect(divergeDoRelogio({ ...itens[0], situacao: "ok" }, false)).toBe(false);
    expect(envioEditavel("devolvido")).toBe(true);
    expect(envioEditavel("enviado")).toBe(false);
  });

  it("caminho do anexo começa pelo id do envio", () => {
    expect(caminhoAnexo(42, "Folha de Ponto Setembro.pdf", 1)).toBe("42/1-Folha_de_Ponto_Setembro.pdf");
  });

  it("a Conferência de Ponto começa nos encarregados, sem travar o Operacional", () => {
    expect(STATUS_INICIAL).toBe("Pendente Encarregados");
    expect(etapaDoStatus("Pendente Encarregados")).toBe("encarregados");
    expect(proximoStatus("Pendente Encarregados", "aprovar")).toBe("Pendente RH");
    expect(proximoStatus("Pendente Encarregados", "confirmar")).toBeNull();
  });
});
