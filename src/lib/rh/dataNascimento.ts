// Data de nascimento do EMPREGADOS editada no modal de RH › Colaboradores.
//
// EMPREGADOS."Nascimento" é TEXTO com dois formatos misturados: ISO
// ("1990-06-11", a maioria) e DD/MM/AAAA (minoria, é o que a Senior manda).
// No banco quem entende os dois é rh_data_br_para_date(); aqui é este arquivo.
// O ERP grava sempre em ISO (o formato que domina) e marca
// EMPREGADOS.nascimento_ajustado_em — com essa marca o sync da Senior para de
// reescrever a data (mig 20261116120000).

/** "AAAA-MM-DD" ou "DD/MM/AAAA" (com ou sem hora) → "AAAA-MM-DD"; resto → null. */
export function nascimentoParaIso(valor: unknown): string | null {
  const t = String(valor ?? "").trim();
  if (!t) return null;
  let a: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (r) { a = +r[1]; m = +r[2]; d = +r[3]; }
  else {
    r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
    if (!r) return null;
    d = +r[1]; m = +r[2]; a = +r[3];
  }
  // Data que não existe (31/02, mês 13) não vira outra data por arredondamento.
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Mudou de verdade? Compara como data: "11/06/1990" e "1990-06-11" são iguais. */
export function nascimentoMudou(antes: unknown, depois: unknown): boolean {
  return nascimentoParaIso(antes) !== nascimentoParaIso(depois);
}

/** Erro para mostrar ao salvar, ou null se a data serve. Vazio é aceito (sem data). */
export function validarNascimento(iso: string, hoje: Date = new Date()): string | null {
  if (!iso) return null;
  const n = nascimentoParaIso(iso);
  if (!n) return "Data de nascimento inválida.";
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  if (n > hojeIso) return "A data de nascimento não pode ser no futuro.";
  if (n < "1900-01-01") return "Data de nascimento antes de 1900 — confira o ano.";
  return null;
}
