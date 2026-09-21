import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  chaveCaixote,
  enderecoCabeNoModulo,
  parseEndereco,
  type EnderecoEstoque,
  type ModuloMapa,
} from "@/lib/suprimentos/enderecoEstoque";

/**
 * Mapa 3D do estoque (SIS-2026-0442).
 *
 * A leitura vem de `v_sup_estoque_mapa` (ficha + endereço já quebrado + saldo
 * de sup_estoque_saldo) e de `sup_estoque_modulo` (as estantes desenhadas).
 * A escrita passa pelas RPCs sup_mapa_* — as tabelas não têm policy de
 * INSERT/UPDATE de propósito, para ninguém editar a planta por fora.
 *
 * Ver supabase/migrations/20260930000197_sup_estoque_mapa_3d.sql.
 */

const sb = supabase as any;

export interface LayoutMapa {
  id: string;
  almoxarifado_id: string;
  nome: string;
  largura_m: number;
  profundidade_m: number;
  pe_direito_m: number;
  mesa_x: number;
  mesa_z: number;
  mesa_rotacao: number;
  observacoes: string | null;
}

/** Uma ficha de estoque como o mapa precisa dela. */
export interface FichaMapa {
  item_estoque_id: string;
  sup_item_id: string;
  codigo_item: string | null;
  material: string;
  tipo_material: string | null;
  tamanho: string | null;
  material_base: string | null;
  localizacao: string | null;
  endereco: EnderecoEstoque | null;
  estoque_minimo: number;
  fisico: number;
  reservado: number;
  disponivel: number;
  /** Abaixo do mínimo cadastrado — pinta o caixote de laranja no desenho. */
  emFalta: boolean;
}

export type SituacaoFicha =
  | "no_desenho"
  /** Endereço legível, mas a estante daquela letra não existe no desenho. */
  | "estante_ausente"
  /** Endereço legível e estante existe, mas o nível/coluna passa da grade. */
  | "fora_da_grade"
  /** Texto preenchido que o parser não reconhece ('TESTE', 'N/A', '0-00-00'). */
  | "endereco_ilegivel"
  /** Ficha sem nenhum endereço escrito. */
  | "sem_endereco";

export interface CaixoteOcupado {
  rua: string;
  nivel: number;
  coluna: number;
  fichas: FichaMapa[];
  fisico: number;
  disponivel: number;
  temFalta: boolean;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export function useAlmoxarifadosDoMapa() {
  return useQuery({
    queryKey: ["sup_mapa_almoxarifados"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("sup_estoque_layout")
        .select("id, almoxarifado_id, nome, almoxarifado:almoxarifado_id (id, nome, codigo)")
        .order("nome");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        layout_id: r.id as string,
        almoxarifado_id: r.almoxarifado_id as string,
        nome: (r.almoxarifado?.nome ?? r.nome) as string,
        codigo: (r.almoxarifado?.codigo ?? "") as string,
      }));
    },
  });
}

export function useLayoutMapa(almoxarifadoId: string | null) {
  return useQuery({
    queryKey: ["sup_mapa_layout", almoxarifadoId],
    enabled: !!almoxarifadoId,
    queryFn: async (): Promise<{ layout: LayoutMapa | null; modulos: ModuloMapa[] }> => {
      const { data: l, error: e1 } = await sb
        .from("sup_estoque_layout")
        .select("*")
        .eq("almoxarifado_id", almoxarifadoId)
        .maybeSingle();
      if (e1) throw e1;
      if (!l) return { layout: null, modulos: [] };

      const { data: m, error: e2 } = await sb
        .from("sup_estoque_modulo")
        .select("*")
        .eq("layout_id", l.id)
        .eq("ativo", true)
        .order("ordem")
        .order("codigo");
      if (e2) throw e2;

      return {
        layout: {
          ...l,
          largura_m: Number(l.largura_m),
          profundidade_m: Number(l.profundidade_m),
          pe_direito_m: Number(l.pe_direito_m),
          mesa_x: Number(l.mesa_x),
          mesa_z: Number(l.mesa_z),
          mesa_rotacao: Number(l.mesa_rotacao),
        },
        modulos: (m ?? []).map(normalizarModulo),
      };
    },
  });
}

function normalizarModulo(r: any): ModuloMapa {
  return {
    id: r.id,
    codigo: r.codigo,
    nome: r.nome ?? null,
    pos_x: Number(r.pos_x),
    pos_z: Number(r.pos_z),
    rotacao_graus: Number(r.rotacao_graus),
    colunas: Number(r.colunas),
    niveis: Number(r.niveis),
    largura_vao_m: Number(r.largura_vao_m),
    altura_nivel_m: Number(r.altura_nivel_m),
    profundidade_m: Number(r.profundidade_m),
    caixotes_ocultos: Array.isArray(r.caixotes_ocultos) ? r.caixotes_ocultos : [],
    ordem: Number(r.ordem ?? 0),
    ativo: r.ativo !== false,
  };
}

export function useFichasDoMapa(almoxarifadoId: string | null) {
  return useQuery({
    queryKey: ["sup_mapa_fichas", almoxarifadoId],
    enabled: !!almoxarifadoId,
    queryFn: async (): Promise<FichaMapa[]> => {
      const { data, error } = await sb
        .from("v_sup_estoque_mapa")
        .select("*")
        .eq("almoxarifado_id", almoxarifadoId);
      if (error) throw error;

      return (data ?? []).map((r: any): FichaMapa => {
        const fisico = Number(r.fisico ?? 0);
        const minimo = Number(r.estoque_minimo ?? 0);
        return {
          item_estoque_id: r.item_estoque_id,
          sup_item_id: r.sup_item_id,
          codigo_item: r.codigo_item ?? null,
          material: r.material ?? "—",
          tipo_material: r.tipo_material ?? null,
          tamanho: r.tamanho ?? null,
          material_base: r.material_base ?? null,
          localizacao: r.localizacao ?? null,
          // A view já devolve rua/nivel/coluna, mas quem manda no desenho é o
          // parser do navegador — são provadamente idênticos (teste de
          // paridade), e depender de um só evita a tela ter duas verdades.
          endereco: parseEndereco(r.localizacao),
          estoque_minimo: minimo,
          fisico,
          reservado: Number(r.reservado ?? 0),
          disponivel: Number(r.disponivel ?? 0),
          emFalta: minimo > 0 && fisico < minimo,
        };
      });
    },
  });
}

/**
 * Junta planta + fichas: o que cada caixote guarda, e o que sobrou de fora do
 * desenho. O "sobrou de fora" é tão importante quanto o resto — é o que
 * transforma o mapa em ferramenta de faxina em vez de esconder o problema.
 */
export function useOcupacaoDoMapa(modulos: ModuloMapa[], fichas: FichaMapa[]) {
  return useMemo(() => {
    const porCodigo = new Map(modulos.map((m) => [m.codigo, m]));
    const porCaixote = new Map<string, CaixoteOcupado>();
    const situacoes = new Map<string, SituacaoFicha>();
    const foraDoDesenho: FichaMapa[] = [];

    for (const f of fichas) {
      let situacao: SituacaoFicha;

      if (!f.endereco) {
        situacao = f.localizacao?.trim() ? "endereco_ilegivel" : "sem_endereco";
      } else {
        const m = porCodigo.get(f.endereco.rua);
        if (!m) situacao = "estante_ausente";
        else if (!enderecoCabeNoModulo(m, f.endereco)) situacao = "fora_da_grade";
        else situacao = "no_desenho";
      }

      situacoes.set(f.item_estoque_id, situacao);

      if (situacao === "no_desenho" && f.endereco) {
        const k = chaveCaixote(f.endereco);
        const atual = porCaixote.get(k) ?? {
          rua: f.endereco.rua,
          nivel: f.endereco.nivel,
          coluna: f.endereco.coluna,
          fichas: [],
          fisico: 0,
          disponivel: 0,
          temFalta: false,
        };
        atual.fichas.push(f);
        atual.fisico += f.fisico;
        atual.disponivel += f.disponivel;
        atual.temFalta = atual.temFalta || f.emFalta;
        porCaixote.set(k, atual);
      } else {
        foraDoDesenho.push(f);
      }
    }

    const contagem = {
      no_desenho: 0,
      estante_ausente: 0,
      fora_da_grade: 0,
      endereco_ilegivel: 0,
      sem_endereco: 0,
    } as Record<SituacaoFicha, number>;
    for (const s of situacoes.values()) contagem[s]++;

    return { porCaixote, situacoes, foraDoDesenho, contagem };
  }, [modulos, fichas]);
}

// ---------------------------------------------------------------------------
// Escrita — sempre pelas RPCs
// ---------------------------------------------------------------------------

function useInvalidarMapa(almoxarifadoId: string | null) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["sup_mapa_layout", almoxarifadoId] });
    qc.invalidateQueries({ queryKey: ["sup_mapa_fichas", almoxarifadoId] });
    // A lista de Estoque & Etiquetas mostra a mesma localização.
    qc.invalidateQueries({ queryKey: ["sup_estoque_lista"] });
  };
}

export function useSalvarModulo(almoxarifadoId: string | null) {
  const invalidar = useInvalidarMapa(almoxarifadoId);
  return useMutation({
    mutationFn: async (p: Partial<ModuloMapa> & { layout_id: string; codigo: string }) => {
      const { data, error } = await sb.rpc("sup_mapa_salvar_modulo", { p });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidar(); toast.success("Estante salva no desenho"); },
    onError: (e: any) => toast.error(e.message ?? "Não deu para salvar a estante"),
  });
}

export function useExcluirModulo(almoxarifadoId: string | null) {
  const invalidar = useInvalidarMapa(almoxarifadoId);
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.rpc("sup_mapa_excluir_modulo", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Estante removida do desenho"); },
    onError: (e: any) => toast.error(e.message ?? "Não deu para remover a estante"),
  });
}

export function useSalvarLayout(almoxarifadoId: string | null) {
  const invalidar = useInvalidarMapa(almoxarifadoId);
  return useMutation({
    mutationFn: async (p: Partial<LayoutMapa> & { almoxarifado_id: string }) => {
      const { data, error } = await sb.rpc("sup_mapa_salvar_layout", { p });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidar(); toast.success("Planta salva"); },
    onError: (e: any) => toast.error(e.message ?? "Não deu para salvar a planta"),
  });
}

/**
 * Endereçar um item direto do desenho — o "entrar no 3D e dizer onde fica"
 * do pedido. Grava no mesmo campo de texto que a tela de entrada usa.
 */
export function useEnderecarItem(almoxarifadoId: string | null) {
  const invalidar = useInvalidarMapa(almoxarifadoId);
  return useMutation({
    mutationFn: async (p: {
      item_estoque_id: string;
      endereco: EnderecoEstoque | null;
    }) => {
      const { error } = await sb.rpc("sup_mapa_enderecar_item", {
        p_item_estoque_id: p.item_estoque_id,
        p_rua: p.endereco?.rua ?? null,
        p_nivel: p.endereco?.nivel ?? null,
        p_coluna: p.endereco?.coluna ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      invalidar();
      toast.success(v.endereco ? "Item endereçado no desenho" : "Item tirado do desenho");
    },
    onError: (e: any) => toast.error(e.message ?? "Não deu para gravar a localização"),
  });
}
