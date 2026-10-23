import { describe, expect, it } from "vitest";
import { criarLimitadorDeConcorrencia } from "@/lib/limitarConcorrencia";

describe("limitar concorrência", () => {
  it("não deixa mais tarefas em voo do que o limite", async () => {
    const executar = criarLimitadorDeConcorrencia(2);
    let emAndamento = 0;
    let maiorConcorrencia = 0;
    const liberacoes: Array<() => void> = [];

    const tarefa = () => executar(async () => {
      emAndamento += 1;
      maiorConcorrencia = Math.max(maiorConcorrencia, emAndamento);
      await new Promise<void>((liberar) => liberacoes.push(liberar));
      emAndamento -= 1;
    });

    const pendentes = [tarefa(), tarefa(), tarefa(), tarefa()];
    await Promise.resolve();
    expect(maiorConcorrencia).toBe(2);

    for (let i = 0; i < 4; i += 1) {
      for (let tentativa = 0; liberacoes.length === 0 && tentativa < 10; tentativa += 1) {
        await Promise.resolve();
      }
      const liberar = liberacoes.shift();
      expect(liberar).toBeTypeOf("function");
      liberar?.();
    }
    await Promise.all(pendentes);
    expect(maiorConcorrencia).toBe(2);
  });

  it("libera a próxima tarefa mesmo se a anterior falhar", async () => {
    const executar = criarLimitadorDeConcorrencia(1);
    await expect(executar(async () => { throw new Error("falhou"); })).rejects.toThrow("falhou");
    await expect(executar(async () => "ok")).resolves.toBe("ok");
  });
});
