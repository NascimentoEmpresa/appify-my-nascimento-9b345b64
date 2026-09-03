import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// =====================================================================
// ESPAÇO DO COLABORADOR — acesso a dados
//
// Tudo aqui passa por RPC (`esp_col_*`, migration 20260930000050) e nunca
// por `.from("EMPREGADOS")`. Não é preferência de estilo: EMPREGADOS guarda
// CPF, salário, chave PIX e conta bancária na mesma linha que o nome, e o
// RLS do Postgres filtra LINHA, não COLUNA. Um `select("*")` para montar a
// ficha entregaria os dados bancários da pessoa ao navegador de quem só ia
// olhar o cargo. As RPCs devolvem lista fixa de campos, nenhum sensível.
// =====================================================================

/**
 * O cliente é tipado a partir de `integrations/supabase/types.ts`, que é
 * gerado e ainda não conhece as `esp_col_*`. O resto do projeto contorna com
 * `supabase as any`; aqui vai um shape mínimo de `rpc()` em vez disso, que
 * custa as mesmas duas linhas e ainda deixa o compilador cobrar o tipo de
 * retorno em cada chamada.
 */
type ChamadaRpc = <T>(
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: T | null; error: { message: string } | null }>;

const sb = supabase as unknown as { rpc: ChamadaRpc };

export interface NoFuncaoCatalogo {
  id: string;
  nome: string;
}

export interface NoPostoCatalogo {
  id: string;
  nome: string;
  descricao: string | null;
  funcoes: NoFuncaoCatalogo[];
}

export interface NoContrato {
  id: string;
  nome: string;
  cliente: string | null;
  status: string | null;
  /** Contagem, não lista: o nó mostra "48 colaboradores" sem baixar os 48. */
  colaboradores: number;
  /** Estrutura CONTRATADA (sup_posto/sup_funcao), que é outra coisa do
   *  posto onde a pessoa está lotada — ver o comentário em `agruparPorPosto`. */
  postos: NoPostoCatalogo[];
}

export interface ColaboradorLinha {
  empregado_id: number;
  matricula: string | null;
  nome: string;
  cargo: string | null;
  posto: string | null;
  filial: string | null;
  situacao: string | null;
  admissao: string | null;
  contrato_id: string | null;
}

export interface FichaColaborador {
  empregado_id: number;
  matricula: string | null;
  nome: string;
  cargo: string | null;
  posto: string | null;
  filial: string | null;
  empresa: string | null;
  setor: string | null;
  situacao: string | null;
  admissao: string | null;
  escala: string | null;
  lider: string | null;
  contrato_id: string | null;
  contrato_nome: string | null;
}

export type OrigemHistorico = "advertencia" | "troca_funcao" | "material";

/** Uma peca de uniforme/EPI dentro de um pedido. */
export interface ItemMaterial {
  id: string;
  nome: string;
  tipo: string | null;
  tamanho: string | null;
  quantidade: number;
}

/**
 * O jsonb solto que cada origem anexa ao evento. As chaves variam por origem
 * (advertencia manda `grau`, troca de funcao manda `cargo_novo`), entao o
 * indexador e `unknown`: a ficha lista o que vier sem inventar significado.
 * `itens` e a excecao — e a unica chave que a tela renderiza estruturada.
 */
export interface ExtraHistorico {
  itens?: ItemMaterial[];
  [chave: string]: unknown;
}

export interface EventoHistorico {
  origem: OrigemHistorico;
  /** A chave na tabela de origem. É o que torna o evento rastreável. */
  origem_id: string;
  /** O número que o usuário reconhece (protocolo do pedido, id da solicitação). */
  protocolo: string | null;
  data_ref: string | null;
  titulo: string | null;
  detalhe: string | null;
  status: string | null;
  extra: ExtraHistorico | null;
}

export interface MarcacaoLinha {
  data: string;
  minutos: number | null;
}

export interface RespostaMarcacoes {
  disponivel: boolean;
  motivo?: string;
  matricula?: string;
  colunas?: Record<string, string>;
  linhas: MarcacaoLinha[];
}

/** A estrutura de contratos/postos/funções. Poucos KB — cabe numa chamada. */
export function useArvoreContratos() {
  return useQuery({
    queryKey: ["esp-col", "arvore"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<NoContrato[]> => {
      const { data, error } = await sb.rpc<NoContrato[]>("esp_col_arvore");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * As pessoas de um contrato — só quando o nó é expandido.
 *
 * `enabled` é o ponto: sem ele, abrir a tela dispararia uma consulta por
 * contrato e traria os 2.4 mil de uma vez para mostrar, no fim, os 40 de um
 * contrato só.
 */
export function useColaboradoresDoContrato(contratoId: string | null, ativo: boolean) {
  return useQuery({
    queryKey: ["esp-col", "colaboradores", contratoId],
    enabled: ativo && !!contratoId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ColaboradorLinha[]> => {
      const { data, error } = await sb.rpc<ColaboradorLinha[]>("esp_col_colaboradores", {
        p_contrato_id: contratoId,
        p_busca: null,
        p_limite: 2000,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Busca global por nome, para quem já sabe quem procura e não quer navegar a
 * árvore inteira. Só dispara com 2+ caracteres: com 1 letra a resposta seria
 * o limite inteiro de linhas e nenhuma delas útil.
 */
export function useBuscaColaboradores(termo: string) {
  const limpo = termo.trim();
  return useQuery({
    queryKey: ["esp-col", "busca", limpo],
    enabled: limpo.length >= 2,
    staleTime: 60_000,
    queryFn: async (): Promise<ColaboradorLinha[]> => {
      const { data, error } = await sb.rpc<ColaboradorLinha[]>("esp_col_colaboradores", {
        p_contrato_id: null,
        p_busca: limpo,
        p_limite: 60,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * A ficha. `ref` é matrícula OU id — a RPC resolve os dois, porque o QR Code
 * do crachá carrega a matrícula e os links internos carregam o id.
 */
export function useFichaColaborador(ref: string | undefined) {
  return useQuery({
    queryKey: ["esp-col", "ficha", ref],
    enabled: !!ref,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FichaColaborador | null> => {
      const { data, error } = await sb.rpc<FichaColaborador[]>("esp_col_ficha", { p_ref: ref });
      if (error) throw error;
      return (data ?? [])[0] ?? null;
    },
  });
}

/** Advertências + trocas de função + uniformes/EPI, já ordenados por data. */
export function useHistoricoColaborador(empregadoId: number | null | undefined) {
  return useQuery({
    queryKey: ["esp-col", "historico", empregadoId],
    enabled: !!empregadoId,
    staleTime: 60_000,
    queryFn: async (): Promise<EventoHistorico[]> => {
      const { data, error } = await sb.rpc<EventoHistorico[]>("esp_col_historico", { p_empregado_id: empregadoId });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * As batidas de um mês.
 *
 * Devolve SEMPRE um objeto, mesmo quando o espelho do relógio não existe —
 * a aba de ponto precisa explicar a ausência, e um `throw` aqui viraria um
 * toast vermelho de "erro" para uma situação que não é erro de ninguém.
 */
export function useMarcacoesDoMes(
  empregadoId: number | null | undefined,
  ano: number,
  mes: number,
) {
  return useQuery({
    queryKey: ["esp-col", "marcacoes", empregadoId, ano, mes],
    enabled: !!empregadoId,
    staleTime: 60_000,
    queryFn: async (): Promise<RespostaMarcacoes> => {
      const { data, error } = await sb.rpc<RespostaMarcacoes>("esp_col_marcacoes", {
        p_empregado_id: empregadoId,
        p_ano: ano,
        p_mes: mes,
      });
      if (error) {
        return { disponivel: false, motivo: error.message, linhas: [] };
      }
      return {
        disponivel: !!data?.disponivel,
        motivo: data?.motivo,
        matricula: data?.matricula,
        colunas: data?.colunas,
        linhas: data?.linhas ?? [],
      };
    },
  });
}

// ── Agrupamentos que a árvore usa ────────────────────────────────────

/**
 * Supervisor e Encarregado NÃO são tabelas.
 *
 * A hierarquia que a operação descreve é Contrato → Supervisor → Posto →
 * Encarregado → Função → Colaborador, mas no banco não existe nem tabela de
 * supervisão nem coluna ligando encarregado a posto: as duas chefias são
 * CARGOS dentro de EMPREGADOS, como qualquer outro.
 *
 * Então a árvore deriva os dois níveis do "Título do Cargo" em vez de fingir
 * um vínculo que ninguém cadastrou. Fica honesto sobre o que é dado e o que
 * é leitura: se amanhã existir a tabela de verdade, troca-se esta função e
 * a árvore inteira continua igual.
 */
export const ehSupervisor = (cargo: string | null | undefined) =>
  /SUPERVISOR/i.test(cargo ?? "");

export const ehEncarregado = (cargo: string | null | undefined) =>
  /ENCARREGAD/i.test(cargo ?? "");

export interface GrupoPosto {
  posto: string;
  funcoes: { funcao: string; pessoas: ColaboradorLinha[] }[];
  total: number;
}

/**
 * Agrupa as pessoas de um contrato em Posto → Função.
 *
 * O `posto` aqui é EMPREGADOS."Nome do Posto" — a lotação REAL da pessoa — e
 * não o sup_posto do catálogo de compras. Os dois têm o mesmo nome e não se
 * conversam: a migration 20260830000001 registrou que os "Nome do Posto" não
 * têm NENHUMA correspondência com sup_posto. Misturar os dois faria a árvore
 * pendurar gente em posto errado, então a estrutura contratada aparece como
 * informação do contrato e as pessoas se agrupam pela própria lotação.
 */
export function agruparPorPosto(pessoas: ColaboradorLinha[]): GrupoPosto[] {
  const porPosto = new Map<string, Map<string, ColaboradorLinha[]>>();

  for (const p of pessoas) {
    const posto = (p.posto ?? "").trim() || "Sem posto informado";
    const funcao = (p.cargo ?? "").trim() || "Sem função informada";
    if (!porPosto.has(posto)) porPosto.set(posto, new Map());
    const funcoes = porPosto.get(posto)!;
    if (!funcoes.has(funcao)) funcoes.set(funcao, []);
    funcoes.get(funcao)!.push(p);
  }

  return [...porPosto.entries()]
    .map(([posto, funcoes]) => ({
      posto,
      total: [...funcoes.values()].reduce((s, l) => s + l.length, 0),
      funcoes: [...funcoes.entries()]
        .map(([funcao, pessoas]) => ({
          funcao,
          pessoas: [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
        }))
        .sort((a, b) => a.funcao.localeCompare(b.funcao, "pt-BR")),
    }))
    // "Sem posto informado" por último: é o resto do cadastro, não uma
    // unidade da operação, e no topo empurraria os postos reais para baixo.
    .sort((a, b) => {
      const semA = a.posto === "Sem posto informado";
      const semB = b.posto === "Sem posto informado";
      if (semA !== semB) return semA ? 1 : -1;
      return a.posto.localeCompare(b.posto, "pt-BR");
    });
}
