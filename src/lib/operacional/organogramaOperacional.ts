// =====================================================================
// Organograma › Operacional (17/11/2026, mig 20261117000100_ope_organograma_operacional)
//
// GERENTE OPERACIONAL › SUPERVISORES › ENCARREGADOS › CONTRATO › colaboradores.
// O banco guarda, por contrato da Licitação, o encarregado e o supervisor
// (OPE_ORG_CONTRATO). Aqui mora a montagem da árvore e as regras que a tela
// e o cadastro de login repetem do banco:
//   - encarregadoEfetivo: o definido no organograma é o encarregado do contrato
//     para Ponto, Documentos do RH e Treinamento (rh_hier_responsaveis); demitido
//     não conta. A Hierarquia de Postos, que era a reserva, foi removida em
//     17/11/2026 (mig 20261117000300) — o que ela apontava foi copiado para cá;
//   - validarLoginEncarregado: login novo de ENCARREGADO precisa do colaborador
//     do cadastro e de ao menos um contrato.
// =====================================================================

export interface PessoaOrg {
  id: number;
  nome: string;
  cargo: string | null;
  situacao: string | null;
  avatar_url?: string | null;
  tem_login?: boolean;
}

export interface ContratoOrg {
  id: string;
  nome: string;
  status: string;
  encarregado_id: number | null;
  supervisor_id: number | null;
  colaboradores: number;
}

export interface HistoricoOrg {
  id: number;
  acao: string;
  contrato_id: string | null;
  contrato_nome: string | null;
  antes_nome: string | null;
  depois_nome: string | null;
  motivo: string | null;
  autor_nome: string | null;
  created_at: string;
}

export interface PainelOrg {
  contratos: ContratoOrg[];
  pessoas: PessoaOrg[];
  papeis: { empregado_id: number; papel: "gerente" | "supervisor" }[];
  historico: HistoricoOrg[];
  pode_alterar: boolean;
}

export type OrigemEncarregado = "organograma" | "nenhum";

const demitido = (p?: PessoaOrg | null) => (p?.situacao ?? "").trim() === "Demitido";

/** Quem responde pelo contrato hoje (para Ponto/Documentos/Treinamento). */
export function encarregadoEfetivo(c: ContratoOrg, pessoas: Map<number, PessoaOrg>): { ids: number[]; origem: OrigemEncarregado } {
  if (c.encarregado_id != null) {
    const p = pessoas.get(c.encarregado_id);
    if (!demitido(p)) return { ids: [c.encarregado_id], origem: "organograma" };
  }
  return { ids: [], origem: "nenhum" };
}

export interface RamoEncarregado { pessoa: PessoaOrg; contratos: ContratoOrg[] }
export interface RamoSupervisor {
  /** null = a caixa "Sem supervisor". */
  pessoa: PessoaOrg | null;
  encarregados: RamoEncarregado[];
  /** Contratos deste supervisor ainda sem encarregado definido no organograma. */
  semEncarregado: ContratoOrg[];
}
export interface ArvoreOrg {
  gerente: PessoaOrg | null;
  supervisores: RamoSupervisor[];
  semSupervisor: RamoSupervisor;
  totalContratos: number;
  contratosSemEncarregado: number;
}

const porNome = <T extends { nome: string }>(a: T, b: T) => a.nome.localeCompare(b.nome, "pt-BR");
const pessoaFantasma = (id: number): PessoaOrg => ({ id, nome: `Colaborador #${id}`, cargo: null, situacao: null });

function agrupar(pessoa: PessoaOrg | null, contratos: ContratoOrg[], pessoas: Map<number, PessoaOrg>): RamoSupervisor {
  const enc = new Map<number, ContratoOrg[]>();
  const sem: ContratoOrg[] = [];
  for (const c of contratos) {
    if (c.encarregado_id == null) { sem.push(c); continue; }
    enc.set(c.encarregado_id, [...(enc.get(c.encarregado_id) ?? []), c]);
  }
  const encarregados = [...enc.entries()]
    .map(([id, cs]) => ({ pessoa: pessoas.get(id) ?? pessoaFantasma(id), contratos: cs.sort(porNome) }))
    .sort((a, b) => porNome(a.pessoa, b.pessoa));
  return { pessoa, encarregados, semEncarregado: sem.sort(porNome) };
}

/**
 * Monta a árvore. Supervisor aparece se foi cadastrado (papel) OU se algum
 * contrato aponta para ele. Um encarregado com contratos sob supervisores
 * diferentes aparece debaixo de cada um, só com os contratos daquele.
 */
export function montarArvore(p: PainelOrg): ArvoreOrg {
  const pessoas = new Map(p.pessoas.map((x) => [x.id, x]));
  const gerenteId = p.papeis.find((x) => x.papel === "gerente")?.empregado_id ?? null;
  const supIds = new Set<number>(p.papeis.filter((x) => x.papel === "supervisor").map((x) => x.empregado_id));
  for (const c of p.contratos) if (c.supervisor_id != null) supIds.add(c.supervisor_id);

  const porSup = new Map<number, ContratoOrg[]>();
  const semSup: ContratoOrg[] = [];
  for (const c of p.contratos) {
    if (c.supervisor_id == null) semSup.push(c);
    else porSup.set(c.supervisor_id, [...(porSup.get(c.supervisor_id) ?? []), c]);
  }
  const supervisores = [...supIds]
    .map((id) => agrupar(pessoas.get(id) ?? pessoaFantasma(id), porSup.get(id) ?? [], pessoas))
    .sort((a, b) => porNome(a.pessoa!, b.pessoa!));
  return {
    gerente: gerenteId != null ? pessoas.get(gerenteId) ?? pessoaFantasma(gerenteId) : null,
    supervisores,
    semSupervisor: agrupar(null, semSup, pessoas),
    totalContratos: p.contratos.length,
    contratosSemEncarregado: p.contratos.filter((c) => c.encarregado_id == null).length,
  };
}

/** Os contratos que um encarregado tem no organograma inteiro. */
export function contratosDoEncarregado(contratos: ContratoOrg[], encarregadoId: number): ContratoOrg[] {
  return contratos.filter((c) => c.encarregado_id === encarregadoId);
}

/** Os contratos de um supervisor (para "Remover supervisor" avisar quantos ficam soltos). */
export function contratosDoSupervisor(contratos: ContratoOrg[], supervisorId: number): ContratoOrg[] {
  return contratos.filter((c) => c.supervisor_id === supervisorId);
}

// ── Menu de contexto ──────────────────────────────────────────────────

export type AlvoMenu =
  | { tipo: "gerente"; pessoa: PessoaOrg | null }
  | { tipo: "supervisor"; pessoa: PessoaOrg }
  | { tipo: "encarregado"; pessoa: PessoaOrg; supervisorId: number | null }
  | { tipo: "contrato"; contrato: ContratoOrg }
  | { tipo: "colaborador"; pessoa: PessoaOrg; contrato: ContratoOrg };

export type AcaoMenu =
  | "definir_gerente" | "incluir_supervisor" | "remover_supervisor"
  | "mover_contrato_encarregado" | "mover_contrato_supervisor"
  | "definir_encarregado" | "trocar_supervisor" | "remover_encarregado" | "remover_supervisor_contrato"
  | "trocar_supervisor_encarregado" | "tirar_encarregado_de_todos"
  | "tornar_encarregado" | "historico_contrato";

/** O que o botão direito oferece em cada coisa. Sem permissão de alterar, só o histórico. */
export function acoesDoMenu(alvo: AlvoMenu, podeAlterar: boolean): AcaoMenu[] {
  if (!podeAlterar) return alvo.tipo === "contrato" ? ["historico_contrato"] : [];
  switch (alvo.tipo) {
    case "gerente": return ["definir_gerente", "incluir_supervisor"];
    case "supervisor": return ["incluir_supervisor", "remover_supervisor"];
    case "encarregado": return ["trocar_supervisor_encarregado", "tirar_encarregado_de_todos"];
    case "contrato": {
      const base: AcaoMenu[] = ["mover_contrato_encarregado", "mover_contrato_supervisor", "definir_encarregado", "trocar_supervisor"];
      if (alvo.contrato.encarregado_id != null) base.push("remover_encarregado");
      if (alvo.contrato.supervisor_id != null) base.push("remover_supervisor_contrato");
      base.push("historico_contrato");
      return base;
    }
    case "colaborador": return ["tornar_encarregado"];
  }
}

// ── Cadastro de login ─────────────────────────────────────────────────

/** Setor dos encarregados em Administração › Setores (igual a SETOR_ENCARREGADOS do UsuariosReal). */
export const SETOR_ENCARREGADOS = "Encarregados";

/** É login de ENCARREGADO? Pelo cargo (contém "encarregad") ou pelo setor Encarregados. */
export function ehLoginEncarregado(cargo: string | null | undefined, setores: string[] = []): boolean {
  const c = (cargo ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  return /ENCARREGAD/.test(c) || setores.includes(SETOR_ENCARREGADOS);
}

/** Devolve o motivo de recusa, ou null se pode criar. */
export function validarLoginEncarregado(x: {
  cargo: string | null | undefined; setores: string[]; empregadoId: number | null; contratos: string[];
}): string | null {
  if (!ehLoginEncarregado(x.cargo, x.setores)) return null;
  if (x.empregadoId == null) return "Encarregado precisa estar no cadastro de colaboradores: escolha o colaborador no topo.";
  if (!x.contratos.length) return "Encarregado: escolha de qual(is) contrato(s) ele é responsável.";
  return null;
}

/** Contrato que já tem outro encarregado: o cadastro avisa que vai trocar. */
export function contratosQueTrocamDeEncarregado(
  escolhidos: string[], opcoes: { id: string; nome: string; encarregado_id: number | null; encarregado_nome: string | null }[], empregadoId: number | null,
): { nome: string; atual: string }[] {
  const sel = new Set(escolhidos);
  return opcoes
    .filter((o) => sel.has(o.id) && o.encarregado_id != null && o.encarregado_id !== empregadoId)
    .map((o) => ({ nome: o.nome, atual: o.encarregado_nome ?? `#${o.encarregado_id}` }));
}
