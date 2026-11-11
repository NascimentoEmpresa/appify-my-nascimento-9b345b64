// =====================================================================
// Organograma — VÍNCULO COM O ENCARREGADO (SIS-2026-0770, reaberto 10/11/2026)
//
// Helena: "só faltou o vínculo de quem cada encarregado é responsável. Mesmo
// que tenha 2, 3 encarregados vinculados em um único contrato, precisamos saber
// a quem esses colaboradores se reportam. Ex.: pesquisa de clima — se buscarmos
// pelo colaborador, saberemos de qual liderança ele está reclamando."
//
// O vínculo é o "reporta a" do organograma (parent_id) — o mesmo que a árvore
// de pessoas usa; aqui só se LÊ. Dentro de um contrato:
//   • Encarregado = função de liderança de campo (encarregado, líder, chefe de
//     turma, feitor, mestre de obras — a função escrita no organograma vale
//     sobre o cargo da Senior) OU quem já tem gente do contrato abaixo dele.
//   • A turma de um encarregado = quem, subindo pelo "reporta a" sem sair do
//     contrato, chega nele primeiro (o vigia que responde ao líder de turma, que
//     responde ao encarregado, é da turma do líder de turma).
//   • Sem encarregado = quem sobe e sai do contrato sem passar por nenhum — só
//     conta quando o contrato TEM encarregado (senão todos respondem ao
//     supervisor e não falta nada).
// A mesma regra de "é encarregado" está no banco (organograma_eh_encarregado,
// mig 20261110230000), que solta a pessoa do encarregado quando ela troca de
// contrato.
// =====================================================================

import type { ContratoEstrutura, Estrutura } from "./estruturaSetores";
import { funcaoDe, type NoPessoa } from "./pessoas";

const semAcento = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

const FUNCAO_ENCARREGADO = /ENCARREGAD|\bLIDER(ES)?\b|CHEFE DE (TURMA|EQUIPE|SETOR)|FEITOR|MESTRE DE OBRAS?/;

/** Função de liderança de campo (a escrita no organograma vale sobre o cargo). */
export const ehEncarregado = (n: Pick<NoPessoa, "funcao_manual" | "cargo">) =>
  FUNCAO_ENCARREGADO.test(semAcento(n.funcao_manual) || semAcento(n.cargo));

export interface TurmaEncarregado {
  encarregado: NoPessoa;
  /** Quem chega nele primeiro subindo pelo "reporta a" dentro do contrato. */
  equipe: NoPessoa[];
  /** O encarregado responde a outro encarregado do mesmo contrato. */
  acima: NoPessoa | null;
}

export interface LiderancaContrato {
  encarregados: TurmaEncarregado[];
  /** Ninguém do contrato acima (só vale quando há encarregado no contrato). */
  semEncarregado: NoPessoa[];
}

const porNome = (a: NoPessoa, b: NoPessoa) => a.nome.localeCompare(b.nome, "pt-BR");

/** Primeiro encarregado do contrato subindo a partir do chefe de `n` (sem sair do contrato). */
function encarregadoAcima(n: NoPessoa, noContrato: Map<string, NoPessoa>, lideres: Set<string>): NoPessoa | null {
  let atual = n.parent_id ? noContrato.get(n.parent_id) : undefined;
  const vistos = new Set<string>([n.id]);
  while (atual && !vistos.has(atual.id)) {
    if (lideres.has(atual.id)) return atual;
    vistos.add(atual.id);
    atual = atual.parent_id ? noContrato.get(atual.parent_id) : undefined;
  }
  return null;
}

export function liderancaDoContrato(c: Pick<ContratoEstrutura, "membros">): LiderancaContrato {
  const noContrato = new Map(c.membros.map((m) => [m.id, m]));
  const temEquipe = new Set<string>();
  c.membros.forEach((m) => { if (m.parent_id && noContrato.has(m.parent_id)) temEquipe.add(m.parent_id); });
  const lideres = new Set(c.membros.filter((m) => ehEncarregado(m) || temEquipe.has(m.id)).map((m) => m.id));

  const turmas = new Map<string, NoPessoa[]>();
  const semEncarregado: NoPessoa[] = [];
  c.membros.forEach((m) => {
    if (lideres.has(m.id)) return;
    const enc = encarregadoAcima(m, noContrato, lideres);
    if (enc) turmas.set(enc.id, [...(turmas.get(enc.id) ?? []), m]);
    else semEncarregado.push(m);
  });

  const encarregados = c.membros.filter((m) => lideres.has(m.id)).map((m) => ({
    encarregado: m,
    equipe: (turmas.get(m.id) ?? []).sort(porNome),
    acima: encarregadoAcima(m, noContrato, lideres),
  }));
  // Quem tem mais gente primeiro; sub-encarregado logo depois do dele não importa aqui.
  encarregados.sort((a, b) => b.equipe.length - a.equipe.length || porNome(a.encarregado, b.encarregado));

  return { encarregados, semEncarregado: lideres.size ? semEncarregado.sort(porNome) : [] };
}

// ── Liderança por colaborador (busca e exportação) ─────────────────────

export interface LinhaLideranca {
  pessoa: NoPessoa;
  /** Nome do contrato (campo) ou do setor (escritório). */
  lotacao: string;
  campo: boolean;
  /** Encarregado do contrato a quem a pessoa responde (campo). */
  encarregado: NoPessoa | null;
  /** O "reporta a" direto, seja quem for. */
  liderImediato: NoPessoa | null;
  /** Supervisor do contrato (definido ou pelo cadastro). */
  supervisor: NoPessoa | null;
  /** Do chefe direto até o topo. */
  cadeia: NoPessoa[];
  /** A própria pessoa é encarregado no contrato. */
  ehEncarregado: boolean;
  /** Contrato tem encarregado e a pessoa não está ligada a nenhum. */
  semEncarregado: boolean;
}

export function liderancas(nos: NoPessoa[], e: Estrutura): LinhaLideranca[] {
  const ativos = nos.filter((n) => n.ativo !== false);
  const porId = new Map(ativos.map((n) => [n.id, n]));
  const cadeiaDe = (n: NoPessoa) => {
    const l: NoPessoa[] = [];
    const vistos = new Set([n.id]);
    let atual = n.parent_id ? porId.get(n.parent_id) : undefined;
    while (atual && !vistos.has(atual.id) && l.length < 60) { l.push(atual); vistos.add(atual.id); atual = atual.parent_id ? porId.get(atual.parent_id) : undefined; }
    return l;
  };

  const linhas: LinhaLideranca[] = [];
  const jaFoi = new Set<string>();
  e.contratos.forEach((c) => {
    const lid = liderancaDoContrato(c);
    const encDe = new Map<string, NoPessoa>();
    const encs = new Set(lid.encarregados.map((t) => t.encarregado.id));
    lid.encarregados.forEach((t) => {
      t.equipe.forEach((p) => encDe.set(p.id, t.encarregado));
      if (t.acima) encDe.set(t.encarregado.id, t.acima);
    });
    const sem = new Set(lid.semEncarregado.map((p) => p.id));
    c.membros.forEach((p) => {
      jaFoi.add(p.id);
      linhas.push({
        pessoa: p, lotacao: c.nome, campo: true,
        encarregado: encDe.get(p.id) ?? null,
        liderImediato: p.parent_id ? porId.get(p.parent_id) ?? null : null,
        supervisor: c.supervisor, cadeia: cadeiaDe(p),
        ehEncarregado: encs.has(p.id), semEncarregado: sem.has(p.id),
      });
    });
  });
  // Escritório (e o topo): o líder é o "reporta a".
  const setorDe = new Map<string, string>();
  e.setores.forEach((s) => s.membros.forEach((m) => setorDe.set(m.id, s.nome)));
  ativos.forEach((p) => {
    if (jaFoi.has(p.id)) return;
    linhas.push({
      pessoa: p, lotacao: setorDe.get(p.id) ?? (p.setor?.trim() || "—"), campo: false,
      encarregado: null, liderImediato: p.parent_id ? porId.get(p.parent_id) ?? null : null,
      supervisor: null, cadeia: cadeiaDe(p), ehEncarregado: false, semEncarregado: false,
    });
  });
  return linhas.sort((a, b) => porNome(a.pessoa, b.pessoa));
}

/** A liderança que a pessoa enxerga no dia a dia: o encarregado (campo) ou o chefe direto. */
export const liderDe = (l: LinhaLideranca) => l.encarregado ?? l.liderImediato;

const normal = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca pelo colaborador, pelo líder (encarregado/chefe) ou pelo contrato. */
export function casaLideranca(l: LinhaLideranca, termo: string): boolean {
  const t = normal(termo).trim();
  if (!t) return true;
  return [l.pessoa.nome, funcaoDe(l.pessoa), l.lotacao, l.encarregado?.nome, l.liderImediato?.nome, l.supervisor?.nome]
    .some((x) => normal(x).includes(t));
}

/** Planilha da pesquisa de clima: uma linha por colaborador. */
export function linhasCsvLideranca(linhas: LinhaLideranca[]): string[][] {
  return [
    ["Colaborador", "Função", "Contrato / Setor", "Encarregado", "Reporta a (líder imediato)", "Supervisor do contrato", "Cadeia até o topo"],
    ...linhas.map((l) => [
      l.pessoa.nome, funcaoDe(l.pessoa), l.lotacao,
      l.ehEncarregado ? "(é encarregado)" : l.encarregado?.nome ?? (l.semEncarregado ? "SEM ENCARREGADO" : ""),
      l.liderImediato?.nome ?? "", l.supervisor?.nome ?? "",
      l.cadeia.map((c) => c.nome).join(" > "),
    ]),
  ];
}
