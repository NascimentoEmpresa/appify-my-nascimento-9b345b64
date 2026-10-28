// =====================================================================
// Recrutamento › "Já trabalhou conosco — e há quanto tempo saiu?" (27/10/2026)
//
// Pedido do Pablo (chamado Gestão Recrutamento): mostrar quanto tempo faz
// que o candidato saiu da empresa na última passagem, para não recontratar
// quem acabou de sair. Mover para TRIAGEM quem saiu há JANELA_EX_COLABORADOR
// dias ou menos pede confirmação.
//
// A fonte é a RPC empregados_por_cpfs (mig 20261027000910): um cadastro em
// EMPREGADOS por passagem, com a Situação da Senior e a Data Afastamento.
// Saída = Situação de demissão/rescisão/desligamento — mesma leitura que o
// selo da lupa já fazia (Recrutamento.tsx, "Cadastros na empresa"). Se
// QUALQUER cadastro está ativo (Trabalhando, férias, atestado…), a pessoa
// ainda é da casa e a saída antiga não conta.
// =====================================================================

import { diasEntre, hojeSP } from "@/lib/recrutamento/dashboardRecrutamento";

/** Saiu há este número de dias ou menos → pede confirmação para seguir. */
export const JANELA_EX_COLABORADOR = 90;

/** O que a tela lê de cada cadastro devolvido por empregados_por_cpfs. */
export interface CadastroEmpresa {
  situacao?: string | null;
  afastamento?: string | null;
  admissao?: string | null;
  cargo?: string | null;
  empresa?: string | null;
  filial?: string | null;
}

export const ehSaida = (situacao: string | null | undefined) => /demit|rescis|deslig/i.test(situacao ?? "");

export type VinculoEmpresa =
  | { tipo: "nenhum" }
  | { tipo: "ativo"; cadastro: CadastroEmpresa }
  | {
      tipo: "saiu";
      cadastro: CadastroEmpresa;
      /** "YYYY-MM-DD" da última saída; null = demitido sem data na Senior. */
      saida: string | null;
      /** Dias desde a saída (null sem data). */
      dias: number | null;
      /** Saiu dentro da janela de JANELA_EX_COLABORADOR dias. */
      recente: boolean;
    };

/** O vínculo da pessoa com a empresa, a partir de todos os cadastros dela. */
export function vinculoNaEmpresa(cads: CadastroEmpresa[] | null | undefined, hoje = hojeSP()): VinculoEmpresa {
  const lista = cads ?? [];
  if (!lista.length) return { tipo: "nenhum" };
  const ativo = lista.find((c) => !ehSaida(c.situacao));
  if (ativo) return { tipo: "ativo", cadastro: ativo };
  // Só saídas: a mais recente vale. Sem data fica atrás de qualquer data.
  const ordenadas = [...lista].sort((a, b) => String(b.afastamento ?? "").localeCompare(String(a.afastamento ?? "")));
  const ultima = ordenadas[0];
  const saida = ultima.afastamento ? String(ultima.afastamento).slice(0, 10) : null;
  const dias = saida ? Math.max(0, diasEntre(saida, hoje)) : null;
  return { tipo: "saiu", cadastro: ultima, saida, dias, recente: dias != null && dias <= JANELA_EX_COLABORADOR };
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Tempo de calendário entre duas datas "YYYY-MM-DD", por extenso:
 * "hoje", "12 dias", "2 meses e 5 dias", "1 ano e 3 meses".
 */
export function tempoDesde(de: string, ate = hojeSP()): string {
  const fim = ate.slice(0, 10);
  if (de.slice(0, 10) >= fim) return "hoje";
  const [ya, ma, da] = de.slice(0, 10).split("-").map(Number);
  const [yb, mb] = fim.split("-").map(Number);
  // "de" + k meses, preso ao último dia do mês (31/01 + 1 mês = 28/02).
  const ancora = (k: number) => {
    const ultimo = new Date(Date.UTC(ya, ma - 1 + k + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ya, ma - 1 + k, Math.min(da, ultimo))).toISOString().slice(0, 10);
  };
  let meses = (yb - ya) * 12 + (mb - ma);
  if (ancora(meses) > fim) meses -= 1;
  const dias = diasEntre(ancora(meses), fim);
  const anos = Math.floor(meses / 12);
  meses %= 12;
  if (anos > 0) return meses > 0 ? `${plural(anos, "ano", "anos")} e ${plural(meses, "mês", "meses")}` : plural(anos, "ano", "anos");
  if (meses > 0) return dias > 0 ? `${plural(meses, "mês", "meses")} e ${plural(dias, "dia", "dias")}` : plural(meses, "mês", "meses");
  return dias > 0 ? plural(dias, "dia", "dias") : "hoje";
}

/** Frase curta para selo e histórico: "Saiu há 2 meses e 5 dias (12/08/2026)". */
export function textoSaida(v: VinculoEmpresa, hoje = hojeSP()): string {
  if (v.tipo === "nenhum") return "";
  if (v.tipo === "ativo") return "Trabalha na empresa hoje";
  if (!v.saida) return "Já trabalhou na empresa (data de saída não informada)";
  const quando = v.saida.split("-").reverse().join("/");
  const ha = tempoDesde(v.saida, hoje);
  return ha === "hoje" ? `Saiu hoje (${quando})` : `Saiu há ${ha} (${quando})`;
}
