// Formatação de valor para o COPY ... FORMAT csv do Postgres.
//
// Vive em módulo próprio para poder ser testado sozinho: escape de CSV é
// silencioso quando erra — não estoura, só desloca coluna e corrompe dado.
// Ver csv.teste.mjs, que roda os casos maldosos contra um Postgres de verdade.

// Nulo sai como \N SEM aspas — é assim que o COPY distingue nulo de texto
// vazio. Todo o resto sai entre aspas, inclusive número: assim uma vírgula,
// uma quebra de linha ou um ponto-e-vírgula no meio do dado não deslocam a
// coluna. Aspa dentro do valor dobra, que é o escape do próprio CSV.
//
// Em modo CSV a barra invertida não é escape, então bytea pode ir na forma
// \x<hex> dentro das aspas que o Postgres converte na entrada.
export function csv(v) {
  if (v === null || v === undefined) return '\\N';
  if (Buffer.isBuffer(v)) return `"\\x${v.toString('hex')}"`;
  const texto = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `"${texto.replace(/"/g, '""')}"`;
}
