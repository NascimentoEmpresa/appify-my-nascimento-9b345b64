import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// =====================================================================
// ESPAÇO DO COLABORADOR — acesso a dados
//
// Tudo aqui passa por RPC (`esp_col_*`, migrations 20260930000051 e
// 20260930000052) e nunca por `.from("EMPREGADOS")`. Não é preferência de
// estilo: EMPREGADOS guarda CPF, salário, chave PIX e conta bancária na mesma
// linha que o nome, e o RLS do Postgres filtra LINHA, não COLUNA. Um
// `select("*")` para montar a ficha entregaria os dados bancários da pessoa ao
// navegador de quem só ia olhar o cargo. As RPCs devolvem lista fixa de
// campos, nenhum sensível.
//
// DE ONDE VEM CADA NÍVEL DA ÁRVORE
//
//   Contrato    → `contratos`, alimentada por Licitações.
//   Posto       → `planilha_custo` (uma linha por posto do contrato, criada
//                 junto com o contrato na licitação). NÃO é `sup_posto`, que
//                 é o catálogo de COMPRAS e serve para montar o enxoval de
//                 uniforme/EPI de uma função.
//   Colaborador → `EMPREGADOS`, que só passa a existir depois que RH e
//                 Recrutamento fazem a admissão e a matrícula sincroniza.
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

/** Onde um posto fica fisicamente, e quantas pessoas comporta ali. */
export interface LocalDoPosto {
  id: string;
  nome: string | null;
  municipio: string | null;
  uf: string | null;
  orcadas: number;
  executadas: number;
}

/** Um posto do contrato, como a licitação o cadastrou em `planilha_custo`. */
export interface PostoContratado {
  id: string;
  nome: string;
  servico: string | null;
  /** `qt_postos`: quantas pessoas o posto comporta. */
  vagas: number | null;
  vigencia: string | null;
  locais: LocalDoPosto[];
}

export interface NoContrato {
  id: string;
  nome: string;
  cliente: string | null;
  status: string | null;
  /** Contagem, não lista: o nó mostra "48 colaboradores" sem baixar os 48. */
  colaboradores: number;
  qtd_postos: number;
  /** Soma de `qt_postos` — o total de vagas contratadas. */
  vagas: number;
  /**
   * A designação da Operação, de `RH_CONTRATO_ENCARREGADO`. É por CONTRATO,
   * não por posto — a amarração encarregado→posto ainda não tem tabela.
   */
  encarregado_designado: { id: number; nome: string | null } | null;
  postos: PostoContratado[];
}

export interface ColaboradorLinha {
  empregado_id: number;
  matricula: string | null;
  nome: string;
  cargo: string | null;
  /** `"Nome do Posto"`: a lotação da pessoa, texto livre do cadastro. */
  posto: string | null;
  /** `"Descrição do Local"`: o nome do contrato a que a pessoa pertence. */
  local: string | null;
  filial: string | null;
  situacao: string | null;
  admissao: string | null;
  /** `"LIDER"`: o nível hierárquico DA PESSOA, não quem lidera ela. */
  nivel: string | null;
  contrato_id: string | null;
}

export interface FichaColaborador {
  empregado_id: number;
  matricula: string | null;
  nome: string;
  cargo: string | null;
  posto: string | null;
  local: string | null;
  filial: string | null;
  empresa: string | null;
  setor: string | null;
  situacao: string | null;
  admissao: string | null;
  escala: string | null;
  nivel: string | null;
  contrato_id: string | null;
  contrato_nome: string | null;
  /** Quem a Operação designou como encarregado do contrato desta pessoa. */
  encarregado_nome: string | null;
}

export type OrigemHistorico = "advertencia" | "troca_funcao" | "material";

/** Uma peça de uniforme/EPI dentro de um pedido. */
export interface ItemMaterial {
  id: string;
  nome: string;
  tipo: string | null;
  tamanho: string | null;
  quantidade: number;
}

/**
 * O jsonb solto que cada origem anexa ao evento. As chaves variam por origem
 * (advertência manda `grau`, troca de função manda `cargo_novo`), então o
 * indexador é `unknown`: a ficha lista o que vier sem inventar significado.
 * `itens` é a exceção — a única chave que a tela renderiza estruturada.
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

/** A estrutura de contratos e seus postos. Poucos KB — cabe numa chamada. */
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

// ── Chefia: derivada do NÍVEL, não do cargo ──────────────────────────

const semAcento = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

/**
 * Supervisor e Encarregado saem de `EMPREGADOS."LIDER"`.
 *
 * Apesar do nome, essa coluna guarda o NÍVEL HIERÁRQUICO DA PRÓPRIA PESSOA —
 * ADMIN, CEO, DIREÇÃO, DIRETOR, GERENTE, COORDENADOR, SUPERVISOR,
 * ENCARREGADO, LÍDER — e não o nome de quem lidera ela. É a mesma lista de
 * `NIVEIS` em LideresSetor.tsx, e o EmpregadoDetalheModal chega a avisar na
 * tela quando o valor não é um nível conhecido.
 *
 * A comparação normaliza acento e caixa porque o cadastro é espelho do
 * Senior e chega com grafia inconsistente.
 */
export const ehSupervisor = (nivel: string | null | undefined) =>
  semAcento(nivel) === "SUPERVISOR";

export const ehEncarregado = (nivel: string | null | undefined) =>
  semAcento(nivel) === "ENCARREGADO";

// ── Montagem dos nós de posto ────────────────────────────────────────

/** Normaliza nome de posto para casar cadastro × planilha de custo. */
const normPosto = (s: string | null | undefined) =>
  semAcento(s).replace(/\s+/g, " ");

export interface NoPosto {
  chave: string;
  nome: string;
  /**
   * `contratado` = veio de planilha_custo (existe no contrato).
   * `cadastro`   = só existe como texto na lotação de alguém.
   */
  origem: "contratado" | "cadastro";
  servico: string | null;
  vagas: number | null;
  locais: LocalDoPosto[];
  funcoes: { funcao: string; pessoas: ColaboradorLinha[] }[];
  total: number;
}

function agruparPorFuncao(lista: ColaboradorLinha[]) {
  const m = new Map<string, ColaboradorLinha[]>();
  for (const p of lista) {
    const f = (p.cargo ?? "").trim() || "Sem função informada";
    if (!m.has(f)) m.set(f, []);
    m.get(f)!.push(p);
  }
  return [...m.entries()]
    .map(([funcao, pessoas]) => ({
      funcao,
      pessoas: [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    }))
    .sort((a, b) => a.funcao.localeCompare(b.funcao, "pt-BR"));
}

/**
 * Cruza os postos CONTRATADOS com a lotação REAL das pessoas.
 *
 * São duas fontes sem chave em comum — `planilha_custo.posto` é o que a
 * licitação orçou, `EMPREGADOS."Nome do Posto"` é texto livre vindo do
 * Senior — então o casamento é por nome normalizado e pode não fechar. Em vez
 * de esconder isso, a árvore mostra os dois lados:
 *
 *   • posto contratado sem ninguém casado aparece assim mesmo, com as vagas
 *     que tem — é exatamente o que interessa a quem confere efetivo;
 *   • posto que só existe no cadastro entra marcado como `cadastro`, para
 *     ninguém achar que é posto do contrato.
 *
 * Esconder qualquer um dos dois transformaria divergência de cadastro em
 * "não tem ninguém nesse posto", que é conclusão errada e cara.
 */
export function montarPostos(
  contratados: PostoContratado[],
  pessoas: ColaboradorLinha[],
): NoPosto[] {
  const restantes = new Map<number, ColaboradorLinha>(
    pessoas.map((p) => [p.empregado_id, p]),
  );

  const nos: NoPosto[] = (contratados ?? []).map((pc) => {
    const alvo = normPosto(pc.nome);
    const casados = alvo === ""
      ? []
      : pessoas.filter((p) => normPosto(p.posto) === alvo);
    casados.forEach((p) => restantes.delete(p.empregado_id));
    return {
      chave: `contratado:${pc.id}`,
      nome: pc.nome,
      origem: "contratado" as const,
      servico: pc.servico,
      vagas: pc.vagas,
      locais: pc.locais ?? [],
      funcoes: agruparPorFuncao(casados),
      total: casados.length,
    };
  });

  // O que sobrou, agrupado pela lotação que o cadastro informa.
  const sobra = new Map<string, ColaboradorLinha[]>();
  for (const p of restantes.values()) {
    const nome = (p.posto ?? "").trim() || "Sem posto informado";
    if (!sobra.has(nome)) sobra.set(nome, []);
    sobra.get(nome)!.push(p);
  }

  for (const [nome, ps] of sobra) {
    nos.push({
      chave: `cadastro:${nome}`,
      nome,
      origem: "cadastro",
      servico: null,
      vagas: null,
      locais: [],
      funcoes: agruparPorFuncao(ps),
      total: ps.length,
    });
  }

  // Contratados primeiro (são a estrutura do contrato); dentro de cada grupo,
  // por nome. "Sem posto informado" fecha a lista: é o resto do cadastro, não
  // uma unidade da operação.
  return nos.sort((a, b) => {
    if (a.origem !== b.origem) return a.origem === "contratado" ? -1 : 1;
    const semA = a.nome === "Sem posto informado";
    const semB = b.nome === "Sem posto informado";
    if (semA !== semB) return semA ? 1 : -1;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}
