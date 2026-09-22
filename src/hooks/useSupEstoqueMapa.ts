import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  acharColuna,
  caixoteExiste,
  chaveCaixote,
  parseEndereco,
  type ColunaMapa,
  type CorredorMapa,
  type EnderecoEstoque,
} from "@/lib/suprimentos/enderecoEstoque";

/**
 * Mapa 3D do estoque (SIS-2026-0442).
 *
 * A leitura vem de `v_sup_estoque_mapa` (ficha + endereço já quebrado + saldo
 * de sup_estoque_saldo), de `sup_estoque_corredor`/`sup_estoque_coluna` (o
 * desenho) e de `sup_estoque_marco` (pilar e portas). A escrita passa pelas
 * RPCs sup_mapa_* — as tabelas não têm policy de INSERT/UPDATE de propósito,
 * para ninguém editar a planta por fora.
 *
 * Ver supabase/migrations/20260930000197 e 20260930000200.
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
  mesa_largura_m: number;
  mesa_rotacao: number;
  observacoes: string | null;
}

export interface MarcoMapa {
  id: string;
  tipo: "pilar" | "porta_rua" | "porta_interna" | "bancada";
  nome: string | null;
  pos_x: number;
  pos_z: number;
  largura_m: number;
  profundidade_m: number;
  altura_m: number | null;
  rotacao_graus: number;
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
  /** Abaixo do mínimo cadastrado — pinta o caixote no desenho. */
  emFalta: boolean;
}

export type SituacaoFicha =
  | "no_desenho"
  /** Endereço legível, mas o corredor daquela letra não existe no desenho. */
  | "corredor_ausente"
  /** Corredor existe, mas ninguém desenhou essa coluna ainda. */
  | "coluna_ausente"
  /** Coluna existe, mas não tem essa linha (ou ela está marcada como vão). */
  | "linha_ausente"
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

export interface PlantaMapa {
  layout: LayoutMapa | null;
  corredores: CorredorMapa[];
  marcos: MarcoMapa[];
  /**
   * `true` quando o banco ainda está no formato antigo (antes da 0200). A
   * tela avisa em vez de quebrar — a migration e o deploy do frontend não
   * acontecem no mesmo segundo.
   */
  precisaMigration: boolean;
}

export function useLayoutMapa(almoxarifadoId: string | null) {
  return useQuery({
    queryKey: ["sup_mapa_layout", almoxarifadoId],
    enabled: !!almoxarifadoId,
    queryFn: async (): Promise<PlantaMapa> => {
      const vazio: PlantaMapa = { layout: null, corredores: [], marcos: [], precisaMigration: false };

      const { data: l, error: e1 } = await sb
        .from("sup_estoque_layout")
        .select("*")
        .eq("almoxarifado_id", almoxarifadoId)
        .maybeSingle();
      if (e1) throw e1;
      if (!l) return vazio;

      const { data: cor, error: e2 } = await sb
        .from("sup_estoque_corredor")
        .select("*, colunas:sup_estoque_coluna (*)")
        .eq("layout_id", l.id)
        .eq("ativo", true)
        .order("ordem")
        .order("codigo");

      // A tabela só existe depois da 0200. Enquanto o banco não tiver sido
      // atualizado, a tela mostra o aviso em vez de estourar.
      if (e2) {
        const faltando = /sup_estoque_corredor|schema cache|does not exist/i.test(e2.message ?? "");
        if (faltando) return { ...vazio, layout: normalizarLayout(l), precisaMigration: true };
        throw e2;
      }

      const { data: mar } = await sb
        .from("sup_estoque_marco")
        .select("*")
        .eq("layout_id", l.id);

      return {
        layout: normalizarLayout(l),
        corredores: (cor ?? []).map(normalizarCorredor),
        marcos: (mar ?? []).map(normalizarMarco),
        precisaMigration: false,
      };
    },
  });
}

function normalizarLayout(l: any): LayoutMapa {
  return {
    ...l,
    largura_m: Number(l.largura_m),
    profundidade_m: Number(l.profundidade_m),
    pe_direito_m: Number(l.pe_direito_m),
    mesa_x: Number(l.mesa_x),
    mesa_z: Number(l.mesa_z),
    mesa_largura_m: Number(l.mesa_largura_m ?? 3.2),
    mesa_rotacao: Number(l.mesa_rotacao),
  };
}

function normalizarCorredor(r: any): CorredorMapa {
  return {
    id: r.id,
    codigo: r.codigo,
    nome: r.nome ?? null,
    ordem: Number(r.ordem ?? 0),
    ativo: r.ativo !== false,
    colunas: (r.colunas ?? [])
      .filter((c: any) => c.ativo !== false)
      .map(normalizarColuna)
      .sort((a: ColunaMapa, b: ColunaMapa) => a.indice - b.indice),
  };
}

function normalizarColuna(c: any): ColunaMapa {
  return {
    id: c.id,
    corredor_id: c.corredor_id,
    indice: Number(c.indice),
    pos_x: Number(c.pos_x),
    pos_z: Number(c.pos_z),
    rotacao_graus: Number(c.rotacao_graus),
    largura_m: Number(c.largura_m),
    profundidade_m: Number(c.profundidade_m),
    altura_linha_m: Number(c.altura_linha_m),
    altura_base_m: Number(c.altura_base_m),
    linhas: Number(c.linhas),
    linhas_ocultas: Array.isArray(c.linhas_ocultas) ? c.linhas_ocultas.map(Number) : [],
    ativo: c.ativo !== false,
  };
}

function normalizarMarco(m: any): MarcoMapa {
  return {
    id: m.id,
    tipo: m.tipo,
    nome: m.nome ?? null,
    pos_x: Number(m.pos_x),
    pos_z: Number(m.pos_z),
    largura_m: Number(m.largura_m),
    profundidade_m: Number(m.profundidade_m),
    altura_m: m.altura_m == null ? null : Number(m.altura_m),
    rotacao_graus: Number(m.rotacao_graus ?? 0),
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
 * Junta desenho + fichas: o que cada caixote guarda, e o que sobrou de fora.
 * O "sobrou de fora" é tão importante quanto o resto — é o que transforma o
 * mapa em ferramenta de faxina em vez de esconder o problema.
 */
export function useOcupacaoDoMapa(corredores: CorredorMapa[], fichas: FichaMapa[]) {
  return useMemo(() => {
    const porCodigo = new Map(corredores.map((c) => [c.codigo, c]));
    const porCaixote = new Map<string, CaixoteOcupado>();
    const situacoes = new Map<string, SituacaoFicha>();

    for (const f of fichas) {
      let situacao: SituacaoFicha;

      if (!f.endereco) {
        situacao = f.localizacao?.trim() ? "endereco_ilegivel" : "sem_endereco";
      } else {
        const corredor = porCodigo.get(f.endereco.rua);
        const coluna = acharColuna(corredor, f.endereco);
        if (!corredor) situacao = "corredor_ausente";
        else if (!coluna) situacao = "coluna_ausente";
        else if (!caixoteExiste(coluna, f.endereco.nivel)) situacao = "linha_ausente";
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
      }
    }

    const contagem: Record<SituacaoFicha, number> = {
      no_desenho: 0, corredor_ausente: 0, coluna_ausente: 0,
      linha_ausente: 0, endereco_ilegivel: 0, sem_endereco: 0,
    };
    for (const s of situacoes.values()) contagem[s]++;

    const foraDoDesenho = fichas.filter((f) => situacoes.get(f.item_estoque_id) !== "no_desenho");

    return { porCaixote, situacoes, foraDoDesenho, contagem };
  }, [corredores, fichas]);
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

export function useSalvarCorredor(almoxarifadoId: string | null) {
  const invalidar = useInvalidarMapa(almoxarifadoId);
  return useMutation({
    mutationFn: async (p: { id?: string; layout_id: string; codigo: string; nome?: string | null; ordem?: number }) => {
      const { data, error } = await sb.rpc("sup_mapa_salvar_corredor", { p });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidar(); toast.success("Corredor salvo"); },
    onError: (e: any) => toast.error(e.message ?? "Não deu para salvar o corredor"),
  });
}

export function useExcluirCorredor(almoxarifadoId: string | null) {
  const invalidar = useInvalidarMapa(almoxarifadoId);
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.rpc("sup_mapa_excluir_corredor", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Corredor removido do desenho"); },
    onError: (e: any) => toast.error(e.message ?? "Não deu para remover o corredor"),
  });
}

/**
 * Salva uma ou várias colunas de uma vez. Em lote porque o editor cria
 * "uma linha inteira de colunas" num clique — mandar uma por vez daria N
 * round-trips e N toasts.
 */
export function useSalvarColunas(almoxarifadoId: string | null) {
  const invalidar = useInvalidarMapa(almoxarifadoId);
  return useMutation({
    mutationFn: async (colunas: Partial<ColunaMapa>[]) => {
      const { data, error } = await sb.rpc("sup_mapa_salvar_colunas", { p: colunas });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      invalidar();
      toast.success(v.length === 1 ? "Coluna salva" : `${v.length} colunas salvas`);
    },
    onError: (e: any) => toast.error(e.message ?? "Não deu para salvar"),
  });
}

export function useExcluirColuna(almoxarifadoId: string | null) {
  const invalidar = useInvalidarMapa(almoxarifadoId);
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.rpc("sup_mapa_excluir_coluna", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Coluna removida"); },
    onError: (e: any) => toast.error(e.message ?? "Não deu para remover a coluna"),
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
    mutationFn: async (p: { item_estoque_id: string; endereco: EnderecoEstoque | null }) => {
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
