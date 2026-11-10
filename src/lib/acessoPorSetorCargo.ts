/**
 * Liberação de acesso em massa por Setor e Cargo (SIS-2026-0851, 10/11/2026).
 *
 * Pedido do Iury: liberar tela "por setor ou por cargo", para que "pessoas do
 * mesmo setor com o mesmo cargo" tenham as mesmas telas com uma liberação só.
 *
 * A REGRA QUE NÃO PODE SE PERDER: setor e nível só ESCOLHEM AS PESSOAS. O que
 * vai para o banco continua sendo uma linha por pessoa em
 * `screen_permission_user`, exatamente o que o switch de "Acesso por Usuário"
 * grava — `has_screen_access` e companhia não mudaram uma linha. Dois motivos:
 *   1. cargo não decide acesso (REGRAS-PR J1.F) — aqui ele só filtra gente
 *      numa tela de admin;
 *   2. a exceção individual vence tudo (J1.B). Em 10/11/2026 havia 8.283
 *      linhas allow=false: uma "regra viva por setor" seria vencida por elas e
 *      o admin marcaria o setor sem a pessoa ver a tela, sem nada que
 *      explicasse.
 *
 * Quem entra no setor depois não ganha sozinho: o cadastro de usuário oferece
 * "aplicar o modelo do grupo" (decisão do Eduardo, 10/11/2026).
 *
 * Regra de permissão mora em `src/lib` com teste — mesmo desenho de
 * acoesDoToggleAcesso.ts, de onde vem o pacote de ações de cada tela.
 */
import { acoesGravadasPeloToggle, type AppAcao } from "@/lib/acoesDoToggleAcesso";

export type NivelCargo = "presidente" | "diretor" | "gerente" | "supervisor" | "adm" | "aprendiz";

/** Ordem de exibição. Os códigos são os do CHECK de "CARGO_CATALOGO".nivel. */
export const NIVEIS_CARGO: readonly { codigo: NivelCargo; rotulo: string }[] = [
  { codigo: "presidente", rotulo: "Presidente" },
  { codigo: "diretor", rotulo: "Diretor" },
  { codigo: "gerente", rotulo: "Gerente" },
  { codigo: "supervisor", rotulo: "Supervisor" },
  { codigo: "adm", rotulo: "ADM" },
  { codigo: "aprendiz", rotulo: "Aprendiz" },
];

export const rotuloNivelCargo = (nivel: string | null | undefined): string =>
  NIVEIS_CARGO.find((n) => n.codigo === nivel)?.rotulo ?? "Todos os níveis";

// Os dois erros de digitação que existiam em 10/11/2026. A migration
// 20261110008510 corrigiu os dados; isto impede que voltem pelo "novo cargo".
const CORRECOES_CARGO: Readonly<Record<string, string>> = {
  ENCAREGADO: "ENCARREGADO",
  CONTABIIDADE: "CONTABILIDADE",
};

/** Nome de cargo como o catálogo guarda: espaços normalizados, maiúscula. */
export function limparNomeCargo(texto: string | null | undefined): string | null {
  const limpo = (texto ?? "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR");
  if (!limpo) return null;
  return CORRECOES_CARGO[limpo] ?? limpo;
}

/**
 * Nível sugerido pelo nome do cargo — a mesma regra (e a mesma ordem) da
 * carga inicial da migration. É só sugestão: o admin troca na aba Cargos.
 */
export function sugerirNivelPorCargo(cargo: string | null | undefined): NivelCargo {
  const nome = limparNomeCargo(cargo) ?? "";
  if (nome.includes("PRESIDENTE")) return "presidente";
  if (nome.includes("DIRETOR")) return "diretor";
  if (nome.includes("GERENTE")) return "gerente";
  if (nome.includes("SUPERVISOR")) return "supervisor";
  if (nome.includes("APRENDIZ")) return "aprendiz";
  return "adm";
}

/**
 * O Malote decide quem é supervisor pelo TEXTO do cargo:
 * `malote_supervisor_por_cargo` (mig 20260830000001 — CONTROLADORIA, DIRETOR,
 * SISTEMAS ou exatamente PRESIDENTE) e `malote_gerente_financeiro`
 * (mig 20261014000001 — GERENTE FINANCEIRO). Renomear ou juntar um cargo
 * desses muda quem aprova despesa, sem erro nenhum — a aba Cargos avisa.
 */
export function cargoUsadoPeloMalote(nome: string | null | undefined): boolean {
  const n = (nome ?? "").toLocaleUpperCase("pt-BR");
  return n.includes("CONTROLADORIA") || n.includes("DIRETOR") || n.includes("SISTEMAS")
    || n.trim() === "PRESIDENTE" || n.includes("GERENTE FINANCEIRO");
}

export interface PessoaAcesso {
  id: string;
  nome: string;
  cargo: string | null;
  nivel: NivelCargo | null;
  setores: string[];
  ativo: boolean;
}

/** Quem é do grupo. Nível nulo = o setor inteiro. Pessoa com 2 setores entra nos dois. */
export function pessoasDoGrupo(pessoas: readonly PessoaAcesso[], setor: string, nivel: NivelCargo | null): PessoaAcesso[] {
  return pessoas
    .filter((p) => p.ativo && p.setores.includes(setor) && (nivel === null || p.nivel === nivel))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
}

export interface ModeloAcesso {
  id: string;
  setor: string;
  nivel: NivelCargo | null;
  telas: string[];
}

export function modeloDoGrupo(modelos: readonly ModeloAcesso[], setor: string, nivel: NivelCargo | null): ModeloAcesso | null {
  return modelos.find((m) => m.setor === setor && m.nivel === nivel) ?? null;
}

/**
 * O que o grupo deve ter: o modelo do grupo SOMADO ao "setor · todos os níveis".
 * O protótipo do chamado usava interseção (setor E cargo); somar é o mesmo
 * jeito que os perfis já se combinam e evita o "marquei no cargo e não
 * apareceu porque faltou no setor".
 */
export function telasDoGrupo(modelos: readonly ModeloAcesso[], setor: string, nivel: NivelCargo | null): Set<string> {
  const telas = new Set(modeloDoGrupo(modelos, setor, nivel)?.telas ?? []);
  if (nivel !== null) for (const t of modeloDoGrupo(modelos, setor, null)?.telas ?? []) telas.add(t);
  return telas;
}

/** Tudo que os modelos dão a uma pessoa, somando cada setor dela. */
export function telasDoModeloParaPessoa(modelos: readonly ModeloAcesso[], pessoa: PessoaAcesso): Set<string> {
  const telas = new Set<string>();
  for (const setor of pessoa.setores) {
    for (const t of telasDoGrupo(modelos, setor, pessoa.nivel)) telas.add(t);
  }
  return telas;
}

export interface LinhaPermissao {
  user_id: string;
  menu_codigo: string;
  acao: AppAcao;
  allow: boolean;
}

export interface EntradaPlano {
  /** Pessoas que vão receber a aplicação (o grupo, menos quem o admin desmarcou). */
  pessoas: readonly PessoaAcesso[];
  /** Telas que o grupo deve ter. */
  liberar: Iterable<string>;
  /** Telas que o admin marcou, uma a uma, para tirar. */
  remover: Iterable<string>;
  /** O que cada pessoa VÊ hoje (visualizar efetivo: exceção > Admin Geral > perfis). */
  efetivo: ReadonlyMap<string, ReadonlySet<string>>;
  /** Quem tem o perfil "concede tudo" (Administrador Geral). */
  adminGeral: ReadonlySet<string>;
  /** Telas ativas e visíveis no gerenciamento; o resto é descartado. */
  menusValidos: ReadonlySet<string>;
}

export interface PlanoAplicacao {
  linhas: LinhaPermissao[];
  porPessoa: Map<string, { liberar: string[]; remover: string[] }>;
  /** Pares pessoa × tela que já estavam liberados (não são tocados). */
  jaTem: number;
  /** Administradores Gerais que ficaram fora da remoção. */
  adminGeralPoupados: string[];
}

/**
 * Transforma "o grupo deve ter / não deve ter" nas linhas que a RPC
 * acesso_aplicar_em_massa grava.
 *
 * - LIBERAR só para quem ainda não vê a tela. Quem já vê não é tocado: o
 *   switch de ações finas (ex.: aprovar desligado à mão) continua como está.
 *   O pacote gravado é o do toggle (acoesGravadasPeloToggle(codigo, true)).
 * - REMOVER só o que o admin marcou, e só de quem vê a tela. Grava o pacote
 *   inteiro com false, exceções incluídas — igual a desligar o switch.
 * - Administrador Geral nunca entra em remoção: allow=false vence o
 *   concede_tudo (J1.B) e o trancaria naquela tela para sempre. A RPC também
 *   recusa, mas o plano já não manda.
 */
export function planejarAplicacao(e: EntradaPlano): PlanoAplicacao {
  const liberar = [...new Set(e.liberar)].filter((t) => e.menusValidos.has(t));
  const liberarSet = new Set(liberar);
  const remover = [...new Set(e.remover)].filter((t) => e.menusValidos.has(t) && !liberarSet.has(t));

  const linhas: LinhaPermissao[] = [];
  const porPessoa = new Map<string, { liberar: string[]; remover: string[] }>();
  const adminGeralPoupados: string[] = [];
  let jaTem = 0;

  for (const p of e.pessoas) {
    const ve = e.efetivo.get(p.id) ?? new Set<string>();
    const resumo = { liberar: [] as string[], remover: [] as string[] };

    for (const tela of liberar) {
      if (ve.has(tela)) { jaTem++; continue; }
      resumo.liberar.push(tela);
      for (const acao of acoesGravadasPeloToggle(tela, true)) linhas.push({ user_id: p.id, menu_codigo: tela, acao, allow: true });
    }

    const removiveis = remover.filter((t) => ve.has(t));
    if (removiveis.length > 0 && e.adminGeral.has(p.id)) {
      adminGeralPoupados.push(p.id);
    } else {
      for (const tela of removiveis) {
        resumo.remover.push(tela);
        for (const acao of acoesGravadasPeloToggle(tela, false)) linhas.push({ user_id: p.id, menu_codigo: tela, acao, allow: false });
      }
    }

    if (resumo.liberar.length || resumo.remover.length) porPessoa.set(p.id, resumo);
  }

  return { linhas, porPessoa, jaTem, adminGeralPoupados };
}

/**
 * Telas que alguém do grupo tem e que os modelos dela não dão — as candidatas
 * a "remover também" na prévia. Administrador Geral fica fora (vê tudo pelo
 * concede_tudo e não recebe remoção em massa).
 */
export function telasForaDoModelo(
  pessoas: readonly PessoaAcesso[],
  modelos: readonly ModeloAcesso[],
  efetivo: ReadonlyMap<string, ReadonlySet<string>>,
  adminGeral: ReadonlySet<string>,
  menusValidos: ReadonlySet<string>,
): Map<string, number> {
  const contagem = new Map<string, number>();
  for (const p of pessoas) {
    if (adminGeral.has(p.id)) continue;
    const doModelo = telasDoModeloParaPessoa(modelos, p);
    for (const tela of efetivo.get(p.id) ?? []) {
      if (!menusValidos.has(tela) || doModelo.has(tela)) continue;
      contagem.set(tela, (contagem.get(tela) ?? 0) + 1);
    }
  }
  return contagem;
}

/** Quantas telas do modelo a pessoa ainda não vê (o selo "faltam X telas"). */
export function telasFaltando(
  pessoa: PessoaAcesso,
  modelos: readonly ModeloAcesso[],
  efetivo: ReadonlyMap<string, ReadonlySet<string>>,
  menusValidos: ReadonlySet<string>,
): string[] {
  const ve = efetivo.get(pessoa.id) ?? new Set<string>();
  return [...telasDoModeloParaPessoa(modelos, pessoa)].filter((t) => menusValidos.has(t) && !ve.has(t));
}
