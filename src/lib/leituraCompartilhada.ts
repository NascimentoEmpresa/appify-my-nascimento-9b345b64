// =====================================================================
// LEITURA COMPARTILHADA — uma requisição para quem pede junto (03/11/2026)
//
// O boot de UMA aba fazia ~36 requisições, e medido no log do Kong na
// tempestade de 03/11 (19:02–19:08 UTC), por boot:
//   GET /rest/v1/profiles ... ~7 vezes  (display_name, select=*, empresa,
//                                        must_change_password — cada contexto
//                                        e cada hook buscando o seu pedaço da
//                                        MESMA linha)
//   GET /auth/v1/user ....... ~4 vezes  (supabase.auth.getUser() espalhado em
//                                        64 lugares, cada um indo ao GoTrue)
// No dia inteiro: 23.912 leituras de `profiles` e 25.287 de `auth/v1/user`
// para no máximo 62 abas abertas.
//
// `compartilhar` junta chamadas iguais: enquanto uma está em voo, quem pedir
// recebe a MESMA promessa; depois que ela volta, o resultado vale por
// `validadeMs` (curto de propósito — serve para o boot, quando tudo pede ao
// mesmo tempo, e não para segurar dado velho). Erro não fica guardado.
// `esquecer()` joga fora na hora (troca de usuário, gravação do próprio dado).
// =====================================================================

export interface LeituraCompartilhada<T> {
  ler: (chave: string, buscar: () => Promise<T>) => Promise<T>;
  esquecer: (chave?: string) => void;
}

export function compartilhar<T>(validadeMs: number, agora: () => number = Date.now): LeituraCompartilhada<T> {
  const guardado = new Map<string, { promessa: Promise<T>; ate: number }>();
  return {
    ler(chave, buscar) {
      const g = guardado.get(chave);
      if (g && agora() < g.ate) return g.promessa;
      const promessa = buscar();
      // "ate" = infinito enquanto em voo; ao voltar, começa a contar a validade
      const item = { promessa, ate: Number.POSITIVE_INFINITY };
      guardado.set(chave, item);
      promessa.then(
        () => { if (guardado.get(chave) === item) item.ate = agora() + validadeMs; },
        () => { if (guardado.get(chave) === item) guardado.delete(chave); },
      );
      return promessa;
    },
    esquecer(chave) {
      if (chave === undefined) guardado.clear();
      else guardado.delete(chave);
    },
  };
}
