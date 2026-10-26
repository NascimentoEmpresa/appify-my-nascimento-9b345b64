// =====================================================================
// Recrutamento × Jurídico — CADASTRO RESTRITIVO (mig 20261025000020).
// A lista de CPFs com restrição para contratação (RECRUTAMENTO_CPF_BLACKLIST):
// nome, CPF e motivo. Regras puras com teste em
// src/test/recrutamento-cadastro-restritivo.test.ts.
// =====================================================================

export type OrigemRestricao = "recrutamento" | "juridico";

export interface Restricao {
  cpf_digits: string; cpf_fmt: string | null; nome: string | null; motivo: string; origem: OrigemRestricao | null;
  criado_por: string | null; criado_em: string; atualizado_por: string | null; atualizado_em: string | null;
}
export interface EventoRestricao {
  id: number; cpf_digits: string; nome: string | null; motivo: string | null; origem: string | null;
  acao: "incluido" | "alterado" | "removido"; observacao: string | null; por: string | null; em: string;
}

export const ROTULO_ORIGEM: Record<OrigemRestricao, string> = { recrutamento: "Recrutamento", juridico: "Jurídico" };

export const soDigitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

/** "12345678909" → "123.456.789-09" (parcial enquanto digita). */
export function formatarCpf(s: string | null | undefined): string {
  const d = soDigitos(s).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Dígitos verificadores do CPF (mesma conta de is_cpf_valido no banco). */
export function cpfValido(s: string | null | undefined): boolean {
  const c = soDigitos(s);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const r = 11 - (soma % 11);
    return r >= 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export interface FormRestricao { nome: string; cpf: string; motivo: string }

/** Erros do formulário. CPF fora da regra só avisa (CPF antigo/estrangeiro pode estar na lista). */
export function errosRestricao(f: FormRestricao): string[] {
  const e: string[] = [];
  if (!f.nome.trim()) e.push("Informe o nome.");
  if (soDigitos(f.cpf).length !== 11) e.push("Informe o CPF com 11 dígitos.");
  if (!f.motivo.trim()) e.push("Informe o motivo da restrição.");
  return e;
}

const norm = (s: string | null | undefined) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca por nome, CPF (com ou sem máscara) ou motivo; filtro por origem. */
export function filtrarRestricoes(lista: Restricao[], busca: string, origem: OrigemRestricao | "" = ""): Restricao[] {
  const q = norm(busca).trim();
  const qd = soDigitos(busca);
  return lista
    .filter((r) => !origem || (r.origem ?? "juridico") === origem)
    .filter((r) => !q || norm(r.nome).includes(q) || norm(r.motivo).includes(q) || (qd.length >= 3 && r.cpf_digits.includes(qd)))
    .sort((a, b) => String(b.atualizado_em ?? b.criado_em).localeCompare(String(a.atualizado_em ?? a.criado_em)));
}

/** Mascarar o CPF na listagem impressa/exportada: ***.456.789-** (LGPD). */
export const cpfMascarado = (d: string) => (d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : d);
