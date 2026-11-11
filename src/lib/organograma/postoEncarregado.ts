// =====================================================================
// Organograma — ENCARREGADO POR POSTO (SIS-2026-0770, 11/11/2026)
//
// Helena: "vincular os postos de um contrato aos encarregados disponíveis
// nesse contrato — vínculo de encarregado por contrato e por posto que
// fiscaliza e é responsável."
//
// A regra mora no banco (ORGANOGRAMA_POSTO_ENCARREGADO, mig 20261111120000):
// salvar liga quem está no posto ao encarregado, e quem entrar depois no posto
// já nasce ligado (organograma_superior_por_posto olha a regra primeiro).
// Aqui só a leitura: os postos do contrato com quem está neles e o encarregado.
// =====================================================================

import type { ContratoEstrutura } from "./estruturaSetores";
import type { NoPessoa } from "./pessoas";

export interface RegraPosto {
  empresa: number;
  filial: number;
  posto_codigo: string;
  encarregado_no: string;
}

export interface PostoDoContrato {
  codigo: string;
  nome: string;
  pessoas: NoPessoa[];
  /** Encarregado definido para o posto (a regra), se houver. */
  encarregado: NoPessoa | null;
  /** Regra aponta para alguém que não está mais no contrato. */
  encarregadoFora: boolean;
  /** Quantos do posto ainda não respondem ao encarregado definido (direto ou por um líder abaixo dele). */
  foraDoEncarregado: number;
}

export const chaveRegra = (empresa: number, filial: number, posto: string) => `${empresa}-${filial}-${posto}`;

/** O encarregado está na cadeia acima de `n` (dentro do que se conhece)? */
function respondeA(n: NoPessoa, encId: string, porId: Map<string, NoPessoa>): boolean {
  const vistos = new Set<string>([n.id]);
  let pai = n.parent_id;
  while (pai && !vistos.has(pai)) {
    if (pai === encId) return true;
    vistos.add(pai);
    pai = porId.get(pai)?.parent_id ?? null;
  }
  return false;
}

/**
 * Postos do contrato (pelo posto de cada pessoa), com o encarregado definido.
 * `todos` serve para achar o encarregado mesmo fora do contrato e para subir a
 * cadeia; sem ele, só o contrato.
 */
export function postosDoContrato(
  c: Pick<ContratoEstrutura, "empresa" | "filial" | "membros">,
  regras: Map<string, string>,
  todos?: NoPessoa[],
): PostoDoContrato[] {
  const porId = new Map((todos ?? c.membros).map((n) => [n.id, n]));
  c.membros.forEach((m) => porId.set(m.id, m));
  const noContrato = new Set(c.membros.map((m) => m.id));

  const grupos = new Map<string, { nome: string; pessoas: NoPessoa[] }>();
  c.membros.forEach((m) => {
    const cod = m.posto_codigo?.trim();
    if (!cod) return;
    const g = grupos.get(cod) ?? { nome: m.posto_nome?.trim() || cod, pessoas: [] };
    g.pessoas.push(m);
    grupos.set(cod, g);
  });

  const lista: PostoDoContrato[] = [...grupos.entries()].map(([codigo, g]) => {
    const encId = c.empresa != null && c.filial != null ? regras.get(chaveRegra(c.empresa, c.filial, codigo)) : undefined;
    const enc = encId ? porId.get(encId) ?? null : null;
    const pessoas = g.pessoas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return {
      codigo, nome: g.nome, pessoas, encarregado: enc,
      encarregadoFora: !!encId && !noContrato.has(encId),
      foraDoEncarregado: encId ? pessoas.filter((p) => p.id !== encId && !respondeA(p, encId, porId)).length : 0,
    };
  });
  return lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.codigo.localeCompare(b.codigo));
}

/** Resumo do contrato: postos com e sem encarregado definido. */
export function resumoPostos(postos: PostoDoContrato[]): { total: number; comEncarregado: number; semEncarregado: number } {
  const com = postos.filter((p) => p.encarregado).length;
  return { total: postos.length, comEncarregado: com, semEncarregado: postos.length - com };
}
