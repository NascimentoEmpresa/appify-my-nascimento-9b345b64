import type { SupabaseClient } from "@supabase/supabase-js";

// =====================================================================
// INSERT/UPSERT EM LOTE: coluna que a linha não trouxe usa o DEFAULT
// (19/10/2026)
//
// O erro que o Pablo mostrou ao salvar uma campanha em Treinamentos:
//   null value in column "created_at" of relation "TRN_CAMPANHA_ITEM"
//   violates not-null constraint
// O banco tinha o DEFAULT now(). Quem mandou o NULL foi o supabase-js. Quando
// .insert()/.upsert() recebe uma LISTA, ele junta as chaves de todas as linhas
// no parâmetro `columns`, e o padrão dele (`defaultToNull: true`) faz o
// PostgREST gravar NULL na linha que não tem a chave, em vez do DEFAULT. Na
// campanha, os itens que já existiam voltaram do select("*") com created_at,
// e o item novo, criado no navegador, veio sem created_at, por isso NULL.
// É a mesma coisa em qualquer tela que salva uma lista com linhas velhas e
// novas (são mais de 140 chamadas com lista): "existem vários erros assim no
// sistema".
//
// Corrigir aqui vale para todas as chamadas: `defaultToNull: false` manda
// `Prefer: missing=default` (PostgREST 12+; o cluster roda o 12.2.3), e a
// chave ausente passa a usar o DEFAULT da coluna. Coluna sem DEFAULT continua
// NULL, como antes. Em linha única, ou quando nenhuma linha traz a chave,
// nada muda, porque a coluna nem entra no `columns`. Quem quiser o NULL de
// propósito ainda pode passar `defaultToNull: true` na chamada.
// =====================================================================

type Opcoes = { defaultToNull?: boolean } & Record<string, unknown>;
type Metodo = (this: unknown, valores: unknown, opcoes?: Opcoes) => unknown;
const MARCA = "__insertComDefault";

export function instalarInsertComDefault(cliente: SupabaseClient<any, any, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  // O protótipo da classe que o próprio cliente usa (PostgrestQueryBuilder),
  // pego pela instância para não depender de qual cópia do pacote o Vite carregou.
  const proto = Object.getPrototypeOf(cliente.from("__")) as Record<string, Metodo> & { [MARCA]?: boolean };
  if (proto[MARCA]) return;
  for (const nome of ["insert", "upsert"] as const) {
    const original = proto[nome];
    proto[nome] = function (this: unknown, valores: unknown, opcoes: Opcoes = {}) {
      return original.call(this, valores, { defaultToNull: false, ...opcoes });
    };
  }
  proto[MARCA] = true;
}
