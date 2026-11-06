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
//   Operação     → quem fica sem setor vai para o contrato dele.
//
// A ÁRVORE DE SETORES sai da cadeia de comando, não de cadastro à parte: o
// responsável do setor é a cabeça com mais gente abaixo (quem é do setor e
// responde para fora dele); o setor-pai é o setor do chefe desse
// responsável. Ex. (dados de 06/11): Gerente de RH responde à Diretora
// Administrativa → RH fica debaixo da Diretoria Administrativa. Responsável
// que responde direto à presidência/conselho (ou a ninguém) liga o setor ao
// topo. Ciclo entre setores (A sob B sob A) é cortado: o setor vai ao topo.
// =====================================================================

import { funcaoDe, type NoPessoa } from "./pessoas";

export type Papel = "conselho" | "presidencia";

const semAcento = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

export function papelDe(n: Pick<NoPessoa, "funcao_manual" | "cargo">): Papel | null {
  const t = `${semAcento(n.funcao_manual)} | ${semAcento(n.cargo)}`;
  if (/CONSELH|PROPRIETARI/.test(t)) return "conselho";
  if (/PRESIDEN|\bCEO\b/.test(t) && !/VICE/.test(t)) return "presidencia";
  return null;
}

/** Valores de Setor_ERP que não são setor de verdade. */
const NAO_E_SETOR = new Set(["PADRAO", "PADRÃO", "PRESIDENCIA", "SEM SETOR", "-", ""]);

/** Chave do setor (para agrupar) — null quando não é setor. */
export function chaveSetor(s: string | null | undefined): string | null {
  const k = semAcento(s);
  return NAO_E_SETOR.has(k) ? null : k;
}

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
  tipo: "setor" | "contrato";
  /** Quem está ligado direto à cadeira do setor: do setor e com o chefe fora dele. O responsável vem primeiro. */
  cabecas: NoPessoa[];
  /** A cabeça com mais gente abaixo. */
  responsavel: NoPessoa | null;
  /** Todos do setor. */
  membros: NoPessoa[];
  /** Setores debaixo deste (pela cadeia de comando do responsável). */
  filhos: SetorEstrutura[];
  /** Cadeira do topo a que o setor responde direto (null = não responde ao topo direto). */
  ligadoA: string | null;
}

export interface Estrutura {
  conselho: NoPessoa[];
  presidencia: NoPessoa[];
  /** Setores ligados direto ao topo (os outros estão em `filhos`). */
  raiz: SetorEstrutura[];
  /** Todos os setores, numa lista (busca, contagem). */
  setores: SetorEstrutura[];
  contratos: SetorEstrutura[];
  equipeDe: (id: string) => NoPessoa[];
  totalAbaixo: (id: string) => number;
}

const ordenarPessoas = (l: NoPessoa[]) =>
  l.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));

export function montarEstrutura(todos: NoPessoa[]): Estrutura {
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

  const montarGrupos = (tipo: "setor" | "contrato", chave: (n: NoPessoa) => string | null): SetorEstrutura[] => {
    const grupos = new Map<string, NoPessoa[]>();
    nos.forEach((n) => {
      if (noTopo.has(n.id)) return;
      const k = chave(n);
      if (k) grupos.set(k, [...(grupos.get(k) ?? []), n]);
    });
    return [...grupos.entries()].map(([k, membros]) => {
      const cabecas = membros.filter((m) => {
        const chefe = m.parent_id ? porId.get(m.parent_id) : undefined;
        return !chefe || noTopo.has(chefe.id) || chave(chefe) !== k;
      });
      // Responsável primeiro (mais gente abaixo), depois a ordem da árvore.
      cabecas.sort((a, b) => totalAbaixo(b.id) - totalAbaixo(a.id) || a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));
      return {
        chave: k, nome: tipo === "setor" ? nomeSetor(k) : k, tipo, cabecas, responsavel: cabecas[0] ?? null,
        membros: ordenarPessoas(membros), filhos: [], ligadoA: null,
      };
    }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  };

  const setoresKey = (n: NoPessoa) => chaveSetor(n.setor);
  const setores = montarGrupos("setor", setoresKey);
  const contratos = montarGrupos("contrato", (n) => (setoresKey(n) ? null : n.contrato?.trim() || null));

  // Setor-pai: sobe pelo chefe do responsável até achar alguém do topo
  // (ligado ao topo) ou de outro setor (fica debaixo dele).
  const porChave = new Map(setores.map((s) => [s.chave, s]));
  const pai = new Map<string, string | null>();
  setores.forEach((s) => {
    let atual = s.responsavel?.parent_id ? porId.get(s.responsavel.parent_id) : undefined;
    let passos = 0;
    while (atual && passos++ < 500) {
      if (noTopo.has(atual.id)) { s.ligadoA = atual.id; break; }
      const k = setoresKey(atual);
      if (k && k !== s.chave && porChave.has(k)) { pai.set(s.chave, k); break; }
      atual = atual.parent_id ? porId.get(atual.parent_id) : undefined;
    }
  });
  // Corta ciclo: se subir pelos pais volta ao próprio setor, ele vai ao topo.
  pai.forEach((_, k) => {
    const vistos = new Set([k]);
    let p = pai.get(k);
    while (p) {
      if (vistos.has(p)) { pai.delete(k); return; }
      vistos.add(p);
      p = pai.get(p) ?? null;
    }
  });
  const raiz: SetorEstrutura[] = [];
  setores.forEach((s) => {
    const p = pai.get(s.chave);
    if (p) porChave.get(p)!.filhos.push(s); else raiz.push(s);
  });

  return { conselho, presidencia, raiz, setores, contratos, equipeDe, totalAbaixo };
}

/** O setor (ou algum abaixo dele) tem o termo no nome ou em alguém de dentro. */
export function casaSetor(s: SetorEstrutura, termo: string): boolean {
  const t = semAcento(termo);
  if (!t) return true;
  if (semAcento(s.nome).includes(t) || semAcento(s.chave).includes(t)) return true;
  if (s.membros.some((m) => semAcento(m.nome).includes(t) || semAcento(funcaoDe(m)).includes(t))) return true;
  return s.filhos.some((f) => casaSetor(f, t));
}

/** Total de pessoas do setor e dos setores abaixo dele. */
export const pessoasNoRamo = (s: SetorEstrutura): number => s.membros.length + s.filhos.reduce((a, f) => a + pessoasNoRamo(f), 0);
