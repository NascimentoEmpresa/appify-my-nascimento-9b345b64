/**
 * Executa tarefas assíncronas sem ultrapassar o número de operações em voo.
 *
 * Útil para telas que precisam paginar dados grandes: limitar cada fonte
 * isoladamente não basta quando a tela abre várias fontes ao mesmo tempo.
 */
export function criarLimitadorDeConcorrencia(limite: number) {
  if (!Number.isInteger(limite) || limite < 1) {
    throw new Error("O limite de concorrência deve ser um inteiro maior que zero.");
  }

  let emAndamento = 0;
  const fila: Array<() => void> = [];

  return async function executar<T>(tarefa: () => Promise<T>): Promise<T> {
    if (emAndamento >= limite) {
      await new Promise<void>((liberar) => fila.push(liberar));
    }

    emAndamento += 1;
    try {
      return await tarefa();
    } finally {
      emAndamento -= 1;
      fila.shift()?.();
    }
  };
}
