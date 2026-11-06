// =====================================================================
// Organograma — visão ESTRUTURA (06/11/2026, chamado reaberto pela Helena)
//
// "Precisa estruturar em forma de árvore, o principal é a estrutura que temos
// aqui: conselheiros (Antonio e Guiomar), presidência e os setores
// respectivamente ligados a cada setor. Clicando no setor vai abrindo quem
// está diretamente ligado à cadeira dessa equipe."
//
// Lógica pura, sobre os MESMOS nós da árvore de pessoas (organograma_arvore,
// alimentada pelo cadastro) — nada é digitado à parte: contratação,
// desligamento e troca de chefe refletem aqui sozinhos.
//
//   Conselho     → "CONSELH" ou "PROPRIETÁRI" na função/cargo (no cadastro os
//                  dois aparecem como PROPRIETÁRIO/PROPRIETÁRIA)
//   Presidência  → "PRESIDEN" / "CEO"
//   Setores      → um por Setor_ERP, com nome normalizado: "Diretor
//                  Operacional" e "DIRETOR OPERACIONAL" são o mesmo setor.
//                  "PADRAO" (o valor padrão da carga, 400+ pessoas da
//                  operação) e "PRESIDÊNCIA" (o próprio topo) não são setor.
//
// A ÁRVORE DE SETORES sai da cadeia de comando: o responsável do setor é a
// cabeça com mais gente abaixo (quem é do setor e responde para fora dele);
// o setor-pai é o setor do chefe desse responsável. Ciclo entre setores
// (A sob B sob A) é cortado: o setor vai ao topo.
//
// CAMPO DENTRO DO CONTRATO (06/11/2026, pedido do Pablo ao ver o Operacional):
// "essas pessoas soltas assim não podem ficar ... os vigias têm que ficar
// dentro do contrato deles da Senior ... os contratos dentro dos supervisores
// ... não faz sentido ter pessoas fora do contrato dentro do supervisor".
//   • Quem é de CAMPO não é listado solto em setor nenhum: vai para o
//     contrato da Senior (Empresa/Filial do cadastro). Campo = sem setor de
//     escritório OU com função de campo (vigia, limpeza, servente, porteiro…)
//     — a aux. de limpeza do escritório vai para o contrato dela também.
//     Quem é contratado hoje num contrato já aparece nele, sem passo manual.
//   • O CONTRATO fica pendurado no supervisor: o definido em
//     ORGANOGRAMA_CONTRATO_SUPERVISOR (arrastar/definir na tela) ou, sem
//     isso, o deduzido pelo cadastro — o supervisor que está no próprio
//     contrato, senão o supervisor mais próximo subindo pela cadeia de
//     comando de quem está no contrato. Sem nenhum: "sem supervisor".
// =====================================================================

import { chaveContrato, type NoComContrato } from "./arvore";
import { funcaoDe, type NoPessoa } from "./pessoas";

export type Papel = "conselho" | "presidencia";

const semAcento = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

const textoFuncao = (n: Pick<NoPessoa, "funcao_manual" | "cargo">) => `${semAcento(n.funcao_manual)} | ${semAcento(n.cargo)}`;

export function papelDe(n: Pick<NoPessoa, "funcao_manual" | "cargo">): Papel | null {
  const t = textoFuncao(n);
  if (/CONSELH|PROPRIETARI/.test(t)) return "conselho";
  if (/PRESIDEN|\bCEO\b/.test(t) && !/VICE/.test(t)) return "presidencia";
  return null;
}

/** Valores de Setor_ERP que não são setor de verdade. */
const NAO_E_SETOR = new Set(["PADRAO", "PRESIDENCIA", "SEM SETOR", "-", ""]);

/** Chave do setor (para agrupar) — null quando não é setor. */
export function chaveSetor(s: string | null | undefined): string | null {
  const k = semAcento(s);
  return NAO_E_SETOR.has(k) ? null : k;
}

/** Função de quem trabalha no posto do cliente — vai para o contrato, não fica solto no setor. */
const FUNCAO_DE_CAMPO = /LIMPEZA|VIGIA|VIGILANTE|SERVENTE|PORTEIR|ZELADOR|SERVICOS GERAIS|COPEIR|JARDINEIR|ROCADOR|COLETOR|\bGARI\b|MOTORISTA|OPERADOR DE|AJUDANTE|PEDREIRO|PINTOR|ELETRICISTA|ENCANADOR|RECEPCIONISTA|TELEFONISTA|CONTINUO|MENSAGEIRO|CUIDADOR|LAVADEIR|COZINHEIR|MERENDEIR|DIGITADOR|ENCARREGAD|CONTROLADOR DE ACESSO|BOMBEIRO CIVIL|BRIGADISTA/;

/**
 * A função que vale: a escrita no organograma, se houver; senão o cargo da
 * Senior. Ex.: a supervisora do Triunfo Vigias tem cargo de campo na Senior e
 * "Supervisora Operacional" escrito no organograma — é supervisora.
 */
const funcaoQueVale = (n: Pick<NoPessoa, "funcao_manual" | "cargo">) => semAcento(n.funcao_manual) || semAcento(n.cargo);

export const ehDeCampo = (n: Pick<NoPessoa, "setor" | "funcao_manual" | "cargo">) =>
  !chaveSetor(n.setor) || FUNCAO_DE_CAMPO.test(funcaoQueVale(n));

/** Pode ter contrato pendurado: supervisor/coordenador de escritório. */
export const ehSupervisor = (n: Pick<NoPessoa, "setor" | "funcao_manual" | "cargo">) =>
  !ehDeCampo(n) && /SUPERVIS|COORDENAD/.test(funcaoQueVale(n));

// Como mostrar: acento e caixa certos nos nomes que o cadastro escreve em
// maiúsculas sem acento; "DIRETOR X" é a cadeira — o setor é a Diretoria X.
const NOMES: Record<string, string> = {
  RH: "RH", SST: "SST", TI: "TI", JURIDICO: "Jurídico", LICITACAO: "Licitação", LICITACOES: "Licitações",
  "DIRETOR OPERACIONAL": "Diretoria Operacional", "DIRETOR ADMINISTRATIVO": "Diretoria Administrativa",
  "DIRETORIA OPERACIONAL": "Diretoria Operacional", "DIRETORIA ADMINISTRATIVA": "Diretoria Administrativa",
};
const PALAVRAS: Record<string, string> = { LICITACAO: "Licitação", JURIDICO: "Jurídico", GESTAO: "Gestão", SAUDE: "Saúde", SEGURANCA: "Segurança", MANUTENCAO: "Manutenção", COMUNICACAO: "Comunicação", INFORMACAO: "Informação" };
const MINUSCULAS = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"]);

export function nomeSetor(chave: string): string {
  if (NOMES[chave]) return NOMES[chave];
  return chave.split(" ").map((p, i) =>
    PALAVRAS[p] ?? (i > 0 && MINUSCULAS.has(p) ? p.toLowerCase() : p.length <= 3 ? p : p[0] + p.slice(1).toLowerCase()),
  ).join(" ");
}

export interface SetorEstrutura {
  chave: string;
  nome: string;
  tipo: "setor";
  /** Quem está ligado direto à cadeira do setor: do setor e com o chefe fora dele. O responsável vem primeiro. */
  cabecas: NoPessoa[];
  /** A cabeça com mais gente abaixo. */
  responsavel: NoPessoa | null;
  /** Todos do setor (só escritório: o campo está nos contratos). */
  membros: NoPessoa[];
  /** Setores debaixo deste (pela cadeia de comando do responsável). */
  filhos: SetorEstrutura[];
  /** Cadeira do topo a que o setor responde direto (null = não responde ao topo direto). */
  ligadoA: string | null;
}

export type OrigemSupervisor = "definido" | "cadastro" | null;

export interface ContratoEstrutura {
  chave: string; empresa: number | null; filial: number | null; nome: string;
  /** Todo o pessoal de campo do contrato. */
  membros: NoPessoa[];
  /** Topo do contrato: quem tem o chefe fora dele (encarregados, quem responde direto ao escritório). */
  cabecas: NoPessoa[];
  supervisor: NoPessoa | null;
  origem: OrigemSupervisor;
}

export interface Estrutura {
  conselho: NoPessoa[];
  presidencia: NoPessoa[];
  /** Setores ligados direto ao topo (os outros estão em `filhos`). */
  raiz: SetorEstrutura[];
  /** Todos os setores, numa lista (busca, contagem). */
  setores: SetorEstrutura[];
  contratos: ContratoEstrutura[];
  /** Contratos sem supervisor (nem definido, nem deduzido). */
  semSupervisor: ContratoEstrutura[];
  /** Quem pode receber contrato: supervisores/coordenadores do setor Operacional (ou do escritório todo, se não houver). */
  supervisores: NoPessoa[];
  /** O setor que cuida dos contratos (Operacional) — todos os contratos ficam dentro dele. */
  setorOperacional: string | null;
  /** Contratos debaixo de um setor: os dos supervisores dele e, no Operacional, também os sem supervisor (= todos). */
  contratosDoSetor: (chave: string) => ContratoEstrutura[];
  /** Equipe direta de ESCRITÓRIO (o campo direto da pessoa está nos contratos). */
  equipeEscritorio: (id: string) => NoPessoa[];
  /** Contratos pendurados na pessoa. */
  contratosDe: (id: string) => ContratoEstrutura[];
  /** Equipe direta dentro do mesmo contrato (encarregado → a turma dele). */
  equipeNoContrato: (id: string, contrato: string) => NoPessoa[];
  totalAbaixo: (id: string) => number;
}

const ordenarPessoas = (l: NoPessoa[]) =>
  l.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));

export const chaveContratoDe = (n: NoComContrato) =>
  n.empresa != null && n.filial != null ? chaveContrato(n.empresa, n.filial) : "sem";

/**
 * @param definidos supervisor gravado por contrato (chave "empresa-filial" → id do nó),
 *                  de ORGANOGRAMA_CONTRATO_SUPERVISOR.
 */
export function montarEstrutura(todos: NoPessoa[], definidos: Map<string, string> = new Map()): Estrutura {
  const nos = todos.filter((n) => n.ativo !== false);
  const porId = new Map(nos.map((n) => [n.id, n]));
  const filhosPessoa = new Map<string, NoPessoa[]>();
  nos.forEach((n) => {
    if (n.parent_id && porId.has(n.parent_id)) filhosPessoa.set(n.parent_id, [...(filhosPessoa.get(n.parent_id) ?? []), n]);
  });
  filhosPessoa.forEach(ordenarPessoas);
  const equipeDe = (id: string) => filhosPessoa.get(id) ?? [];

  const cacheTotal = new Map<string, number>();
  const totalAbaixo = (id: string): number => {
    const ja = cacheTotal.get(id);
    if (ja != null) return ja;
    // Iterativo: milhares de pessoas, e um ciclo sujo não pode travar a tela.
    const vistos = new Set<string>();
    const pilha = equipeDe(id).map((f) => f.id);
    while (pilha.length) {
      const x = pilha.pop()!;
      if (vistos.has(x) || x === id) continue;
      vistos.add(x);
      equipeDe(x).forEach((f) => pilha.push(f.id));
    }
    cacheTotal.set(id, vistos.size);
    return vistos.size;
  };

  const conselho = ordenarPessoas(nos.filter((n) => papelDe(n) === "conselho"));
  let presidencia = ordenarPessoas(nos.filter((n) => papelDe(n) === "presidencia"));
  if (!conselho.length && !presidencia.length) {
    // Sem título em ninguém: o topo da árvore (com equipe) faz o papel de presidência.
    presidencia = ordenarPessoas(nos.filter((n) => (!n.parent_id || !porId.has(n.parent_id)) && equipeDe(n.id).length));
  }
  const noTopo = new Set([...conselho, ...presidencia].map((n) => n.id));
  const campo = (n: NoPessoa) => !noTopo.has(n.id) && ehDeCampo(n);

  // ── Setores (só escritório) ─────────────────────────────────────────
  const grupos = new Map<string, NoPessoa[]>();
  nos.forEach((n) => {
    if (noTopo.has(n.id) || campo(n)) return;
    const k = chaveSetor(n.setor);
    if (k) grupos.set(k, [...(grupos.get(k) ?? []), n]);
  });
  const setores: SetorEstrutura[] = [...grupos.entries()].map(([k, membros]) => {
    const cabecas = membros.filter((m) => {
      const chefe = m.parent_id ? porId.get(m.parent_id) : undefined;
      return !chefe || noTopo.has(chefe.id) || campo(chefe) || chaveSetor(chefe.setor) !== k;
    });
    // Responsável primeiro (mais gente abaixo), depois a ordem da árvore.
    cabecas.sort((a, b) => totalAbaixo(b.id) - totalAbaixo(a.id) || a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));
    return {
      chave: k, nome: nomeSetor(k), tipo: "setor" as const, cabecas, responsavel: cabecas[0] ?? null,
      membros: ordenarPessoas(membros), filhos: [], ligadoA: null,
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  // Setor-pai: sobe pelo chefe do responsável até achar alguém do topo
  // (ligado ao topo) ou de outro setor (fica debaixo dele).
  const porChave = new Map(setores.map((s) => [s.chave, s]));
  const setorDe = (n: NoPessoa) => (campo(n) ? null : chaveSetor(n.setor));
  const pai = new Map<string, string>();
  setores.forEach((s) => {
    let atual = s.responsavel?.parent_id ? porId.get(s.responsavel.parent_id) : undefined;
    let passos = 0;
    while (atual && passos++ < 500) {
      if (noTopo.has(atual.id)) { s.ligadoA = atual.id; break; }
      const k = setorDe(atual);
      if (k && k !== s.chave && porChave.has(k)) { pai.set(s.chave, k); break; }
      atual = atual.parent_id ? porId.get(atual.parent_id) : undefined;
    }
  });
  // Corta ciclo: se subir pelos pais volta ao próprio setor, ele vai ao topo.
  [...pai.keys()].forEach((k) => {
    const vistos = new Set([k]);
    let p = pai.get(k);
    while (p) {
      if (vistos.has(p)) { pai.delete(k); return; }
      vistos.add(p);
      p = pai.get(p);
    }
  });
  const raiz: SetorEstrutura[] = [];
  setores.forEach((s) => {
    const p = pai.get(s.chave);
    if (p) porChave.get(p)!.filhos.push(s); else raiz.push(s);
  });

  // ── Contratos (todo o campo) ────────────────────────────────────────
  // TODOS OS CONTRATOS NO OPERACIONAL (06/11/2026, Pablo: "tem que estar
  // TODOS os 64 contratos ali dentro do operacional, porque é o operacional que
  // cuida de todos os contratos"). Só supervisor do Operacional recebe
  // contrato — antes o cadastro levava contrato para supervisor do RH, de
  // Compras, da Controladoria. Contrato sem supervisor do Operacional fica em
  // "sem supervisor", que também é mostrado dentro do Operacional.
  const setorOperacional = setores.find((s) => /OPERAC/.test(s.chave) && !/DIRETOR/.test(s.chave))?.chave ?? null;
  const todosSup = nos.filter((n) => !noTopo.has(n.id) && ehSupervisor(n));
  const doOperacional = setorOperacional ? todosSup.filter((n) => chaveSetor(n.setor) === setorOperacional) : [];
  const supervisores = ordenarPessoas(doOperacional.length ? doOperacional : todosSup);
  const ehSup = new Set(supervisores.map((s) => s.id));
  const porContrato = new Map<string, NoPessoa[]>();
  nos.forEach((n) => {
    if (!campo(n)) return;
    const k = chaveContratoDe(n);
    porContrato.set(k, [...(porContrato.get(k) ?? []), n]);
  });
  const contratos: ContratoEstrutura[] = [...porContrato.entries()].map(([k, membros]) => {
    const ref = membros[0];
    const cabecas = membros.filter((m) => {
      const chefe = m.parent_id ? porId.get(m.parent_id) : undefined;
      return !chefe || !campo(chefe) || chaveContratoDe(chefe) !== k;
    });
    cabecas.sort((a, b) => totalAbaixo(b.id) - totalAbaixo(a.id) || a.nome.localeCompare(b.nome, "pt-BR"));

    let supervisor: NoPessoa | null = null;
    let origem: OrigemSupervisor = null;
    const def = definidos.get(k);
    if (def && porId.has(def) && !campo(porId.get(def)!)) { supervisor = porId.get(def)!; origem = "definido"; }
    if (!supervisor && k !== "sem") {
      // 1º o supervisor que está no próprio contrato (ex.: a supervisora do Triunfo Vigias).
      const doContrato = supervisores.find((s) => chaveContratoDe(s) === k);
      // 2º o supervisor mais próximo subindo de quem está no contrato (voto da maioria).
      const votos = new Map<string, number>();
      if (!doContrato) {
        cabecas.forEach((c) => {
          let atual = c.parent_id ? porId.get(c.parent_id) : undefined;
          let passos = 0;
          while (atual && passos++ < 60 && !noTopo.has(atual.id)) {
            if (ehSup.has(atual.id)) { votos.set(atual.id, (votos.get(atual.id) ?? 0) + 1 + totalAbaixo(c.id)); break; }
            atual = atual.parent_id ? porId.get(atual.parent_id) : undefined;
          }
        });
      }
      const eleito = doContrato?.id ?? [...votos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (eleito) { supervisor = porId.get(eleito)!; origem = "cadastro"; }
    }
    return {
      chave: k, empresa: ref.empresa, filial: ref.filial,
      nome: k === "sem" ? "Sem contrato no cadastro" : (ref.contrato?.trim() || `Contrato ${ref.filial}`),
      membros: ordenarPessoas(membros), cabecas, supervisor, origem,
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }));

  const contratosPorSup = new Map<string, ContratoEstrutura[]>();
  contratos.forEach((c) => { if (c.supervisor) contratosPorSup.set(c.supervisor.id, [...(contratosPorSup.get(c.supervisor.id) ?? []), c]); });

  return {
    conselho, presidencia, raiz, setores, contratos,
    semSupervisor: contratos.filter((c) => !c.supervisor),
    supervisores,
    setorOperacional,
    contratosDoSetor: (chave) => {
      const ids = new Set((porChave.get(chave)?.membros ?? []).map((m) => m.id));
      return contratos.filter((c) => (c.supervisor ? ids.has(c.supervisor.id) : chave === setorOperacional));
    },
    equipeEscritorio: (id) => equipeDe(id).filter((f) => !campo(f)),
    contratosDe: (id) => contratosPorSup.get(id) ?? [],
    equipeNoContrato: (id, k) => equipeDe(id).filter((f) => campo(f) && chaveContratoDe(f) === k),
    totalAbaixo,
  };
}

/** O setor (ou algum abaixo dele) tem o termo no nome ou em alguém de dentro. */
export function casaSetor(s: SetorEstrutura, termo: string): boolean {
  const t = semAcento(termo);
  if (!t) return true;
  if (semAcento(s.nome).includes(t) || semAcento(s.chave).includes(t)) return true;
  if (s.membros.some((m) => semAcento(m.nome).includes(t) || semAcento(funcaoDe(m)).includes(t))) return true;
  return s.filhos.some((f) => casaSetor(f, t));
}

export function casaContrato(c: ContratoEstrutura, termo: string): boolean {
  const t = semAcento(termo);
  if (!t) return true;
  return semAcento(c.nome).includes(t) || c.membros.some((m) => semAcento(m.nome).includes(t) || semAcento(funcaoDe(m)).includes(t));
}
