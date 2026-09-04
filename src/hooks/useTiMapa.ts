import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * T.I — Mapa de Hardware.
 *
 * Backend em supabase/migrations/20260930000060_ti_mapa_hardware.sql. O
 * cabeçalho de lá explica o desenho; o resumo para quem lê só este arquivo:
 *
 *   TI_PLANTA           → o escritório (um por andar/unidade)
 *   TI_PLANTA_ELEMENTO  → o cenário (paredes, salas, mesas) — não é hardware
 *   TI_ATIVO            → o hardware; sem planta_id = ainda não posicionado
 *   TI_ATIVO_EVENTO     → histórico (trigger escreve; a tela só lê e anota)
 *
 * Coordenadas em CENTÍMETROS com origem no canto superior esquerdo da planta.
 *
 * As tabelas TI_* são novas e ainda não estão em
 * src/integrations/supabase/types.ts (gerado à mão, fora do CI), então as
 * chamadas passam pelo `sb` destipado — mesmo padrão de useDiarias. O cast
 * fica isolado nesta borda: o que sai daqui é tipado pelas interfaces abaixo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export const BUCKET_TI = "ti-ativos";

export type TiStatusAtivo =
  | "em_uso"
  | "disponivel"
  | "manutencao"
  | "reservado"
  | "emprestado"
  | "inativo"
  | "descartado";

export type TiCriticidade = "baixa" | "media" | "alta";

export interface TiPlanta {
  id: string;
  nome: string;
  descricao: string | null;
  endereco: string | null;
  largura_cm: number;
  altura_cm: number;
  cor_piso: string;
  /** Altura das paredes do ambiente, em cm — a dimensão vertical da cena 3D. */
  pe_direito_cm: number;
  /** Andar: 0 = térreo, 1 = primeiro andar, -1 = subsolo. A cena empilha por aqui. */
  nivel: number;
  ordem: number;
  ativo: boolean;
}

export interface TiElemento {
  id: string;
  planta_id: string;
  tipo: string;
  rotulo: string | null;
  x: number;
  y: number;
  largura: number;
  altura: number;
  rotacao: number;
  /**
   * Altura VERTICAL do elemento em cm. NULL = usa o padrão do catálogo.
   * Não confunda com `altura`, que é a profundidade vista de cima.
   */
  altura_z: number | null;
  cor: string | null;
  /** Setor dono da área (mesmo vocabulário de EMPREGADOS.Setor_ERP). */
  setor: string | null;
  z_index: number;
  meta: Record<string, unknown>;
}

export interface TiAtivo {
  id: string;
  codigo: string | null;
  patrimonio: string | null;
  tipo: string;
  nome: string;
  hostname: string | null;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  status: TiStatusAtivo;
  criticidade: TiCriticidade;

  cpu: string | null;
  cpu_nucleos: number | null;
  ram_gb: number | null;
  ram_tipo: string | null;
  armazenamento_tipo: string | null;
  armazenamento_gb: number | null;
  armazenamento_extra: string | null;
  placa_video: string | null;
  placa_mae: string | null;
  fonte_watts: number | null;
  sistema_operacional: string | null;
  so_versao: string | null;
  so_licenca: string | null;
  office_versao: string | null;
  office_licenca: string | null;
  antivirus: string | null;
  monitores_qtd: number | null;
  perifericos: string | null;
  especificacoes: Record<string, unknown>;

  ip: string | null;
  ip_tipo: string | null;
  mac: string | null;
  mascara: string | null;
  gateway: string | null;
  dns: string | null;
  vlan: string | null;
  dominio: string | null;
  rede_tipo: string | null;
  switch_nome: string | null;
  switch_porta: string | null;
  ponto_rede: string | null;

  anydesk: string | null;
  teamviewer: string | null;
  observacoes_internas: string | null;

  responsavel_empregado_id: number | null;
  responsavel_nome: string | null;
  setor: string | null;
  fornecedor: string | null;
  nota_fiscal: string | null;
  data_aquisicao: string | null;
  valor_aquisicao: number | null;
  garantia_ate: string | null;
  vida_util_meses: number | null;
  ultima_manutencao: string | null;
  proxima_manutencao: string | null;
  observacoes: string | null;

  planta_id: string | null;
  pos_x: number | null;
  pos_y: number | null;
  /** Altura de apoio em cm. NULL = a cena resolve (chão, ou o móvel embaixo). */
  pos_z: number | null;
  rotacao: number;
  escala: number;
  cor: string | null;
  ativo_pai_id: string | null;

  created_at: string;
  updated_at: string;
}

export interface TiEvento {
  id: string;
  ativo_id: string;
  tipo: string;
  texto: string | null;
  meta: Record<string, unknown>;
  autor_id: string | null;
  created_at: string;
}

export interface TiAnexo {
  id: string;
  ativo_id: string;
  storage_path: string;
  nome_arquivo: string;
  mime_type: string | null;
  tamanho_bytes: number | null;
  categoria: string;
  created_at: string;
}

/** O que a tela edita de um ativo — tudo opcional menos nome e tipo. */
export type TiAtivoInput = Partial<Omit<TiAtivo, "id" | "created_at" | "updated_at">> & {
  nome: string;
  tipo: string;
};

// O PostgREST devolve numeric como string. Converter na borda evita que
// "1200.00" entre no cálculo de posição do mapa e vire concatenação.
const num = (v: unknown, padrao = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
};
const numOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapearElemento(e: any): TiElemento {
  return {
    id: e.id,
    planta_id: e.planta_id,
    tipo: e.tipo,
    rotulo: e.rotulo ?? null,
    x: num(e.x),
    y: num(e.y),
    largura: num(e.largura, 100),
    altura: num(e.altura, 100),
    rotacao: num(e.rotacao),
    altura_z: numOuNulo(e.altura_z),
    cor: e.cor ?? null,
    setor: e.setor ?? null,
    z_index: num(e.z_index),
    meta: e.meta ?? {},
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapearAtivo(a: any): TiAtivo {
  return {
    ...a,
    ram_gb: numOuNulo(a.ram_gb),
    armazenamento_gb: numOuNulo(a.armazenamento_gb),
    valor_aquisicao: numOuNulo(a.valor_aquisicao),
    pos_x: numOuNulo(a.pos_x),
    pos_y: numOuNulo(a.pos_y),
    pos_z: numOuNulo(a.pos_z),
    rotacao: num(a.rotacao),
    escala: num(a.escala, 1),
    especificacoes: a.especificacoes ?? {},
  } as TiAtivo;
}

// ── Plantas ───────────────────────────────────────────────────────────

export function usePlantasTi() {
  return useQuery({
    queryKey: ["ti_plantas"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TiPlanta[]> => {
      const { data, error } = await sb
        .from("TI_PLANTA")
        .select("id, nome, descricao, endereco, largura_cm, altura_cm, cor_piso, pe_direito_cm, nivel, ordem, ativo")
        .eq("ativo", true)
        .order("nivel")
        .order("nome");
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((p: any) => ({
        ...p,
        largura_cm: num(p.largura_cm, 2400),
        altura_cm: num(p.altura_cm, 1600),
        pe_direito_cm: num(p.pe_direito_cm, 280),
        nivel: num(p.nivel, 0),
      }));
    },
  });
}

export function useSalvarPlanta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (planta: Partial<TiPlanta> & { nome: string }) => {
      const payload = {
        nome: planta.nome,
        descricao: planta.descricao ?? null,
        endereco: planta.endereco ?? null,
        largura_cm: planta.largura_cm ?? 2400,
        altura_cm: planta.altura_cm ?? 1600,
        cor_piso: planta.cor_piso ?? "#f1f5f9",
        pe_direito_cm: planta.pe_direito_cm ?? 280,
        nivel: planta.nivel ?? 0,
        ordem: planta.ordem ?? 0,
      };
      if (planta.id) {
        const { data, error } = await sb.from("TI_PLANTA").update(payload).eq("id", planta.id).select("id").single();
        if (error) throw error;
        return data.id as string;
      }
      const { data, error } = await sb.from("TI_PLANTA").insert(payload).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ti_plantas"] });
      toast.success("Planta salva.");
    },
    onError: (e: Error) => {
      // O texto cru do Postgres ("violates check constraint
      // TI_PLANTA_altura_cm_check") chegou ao toast e não dizia a ninguém o
      // que corrigir. As medidas são o único CHECK desta tabela.
      const medidas = /largura_cm_check|altura_cm_check/.test(e.message ?? "");
      toast.error(
        medidas
          ? "A planta precisa ter entre 1 e 200 metros de cada lado."
          : e.message || "Não foi possível salvar a planta.",
      );
    },
  });
}

export function useExcluirPlanta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("TI_PLANTA").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ti_plantas"] });
      qc.invalidateQueries({ queryKey: ["ti_ativos"] });
      toast.success("Planta excluída.");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível excluir a planta."),
  });
}

// ── Elementos do desenho ──────────────────────────────────────────────

export function useElementosTi(plantaId: string | null | undefined) {
  return useQuery({
    queryKey: ["ti_elementos", plantaId],
    enabled: !!plantaId,
    staleTime: 60_000,
    queryFn: async (): Promise<TiElemento[]> => {
      const { data, error } = await sb
        .from("TI_PLANTA_ELEMENTO")
        .select("*")
        .eq("planta_id", plantaId)
        .order("z_index");
      if (error) throw error;
      return (data ?? []).map(mapearElemento);
    },
  });
}

type ElementoInput = Partial<TiElemento> & { planta_id: string; tipo: string };

export function useSalvarElemento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (el: ElementoInput) => {
      const payload = {
        planta_id: el.planta_id,
        tipo: el.tipo,
        rotulo: el.rotulo ?? null,
        x: el.x ?? 0,
        y: el.y ?? 0,
        largura: el.largura ?? 100,
        altura: el.altura ?? 100,
        rotacao: el.rotacao ?? 0,
        altura_z: el.altura_z ?? null,
        cor: el.cor ?? null,
        setor: el.setor ?? null,
        z_index: el.z_index ?? 0,
        meta: el.meta ?? {},
      };
      if (el.id) {
        const { data, error } = await sb.from("TI_PLANTA_ELEMENTO").update(payload).eq("id", el.id).select("*").single();
        if (error) throw error;
        return mapearElemento(data);
      }
      const { data, error } = await sb.from("TI_PLANTA_ELEMENTO").insert(payload).select("*").single();
      if (error) throw error;
      return mapearElemento(data);
    },
    onSuccess: (el) => {
      qc.invalidateQueries({ queryKey: ["ti_elementos", el.planta_id] });
      qc.invalidateQueries({ queryKey: ["ti_elementos_varias"] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar o elemento."),
  });
}

export function useExcluirElemento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; plantaId: string }) => {
      const { error } = await sb.from("TI_PLANTA_ELEMENTO").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["ti_elementos", v.plantaId] });
      qc.invalidateQueries({ queryKey: ["ti_elementos_varias"] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível excluir o elemento."),
  });
}

// ── Ativos ────────────────────────────────────────────────────────────

/**
 * Todos os ativos de uma vez. O parque de um escritório é da ordem de
 * centenas de linhas — paginar aqui só atrasaria o primeiro render do mapa,
 * que precisa de tudo junto para desenhar. Se um dia passar de alguns
 * milhares, o corte natural é por `planta_id` + uma aba de inventário
 * paginada, não um `.range()` no meio do mapa.
 */
export function useAtivosTi() {
  return useQuery({
    queryKey: ["ti_ativos"],
    staleTime: 60_000,
    queryFn: async (): Promise<TiAtivo[]> => {
      const { data, error } = await sb.from("TI_ATIVO").select("*").order("codigo");
      if (error) throw error;
      return (data ?? []).map(mapearAtivo);
    },
  });
}

/** Colunas que a tela nunca manda de volta (o banco é dono delas). */
const CAMPOS_SO_LEITURA = new Set(["id", "codigo", "created_at", "updated_at", "created_by"]);

function limparPayloadAtivo(ativo: TiAtivoInput) {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ativo)) {
    if (CAMPOS_SO_LEITURA.has(k)) continue;
    // "" em coluna date/numeric estoura no Postgres ("invalid input syntax");
    // no banco a ausência de valor é NULL, não string vazia.
    saida[k] = v === "" ? null : v;
  }
  return saida;
}

export function useSalvarAtivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...ativo }: TiAtivoInput & { id?: string }) => {
      const payload = limparPayloadAtivo(ativo as TiAtivoInput);
      if (id) {
        const { data, error } = await sb.from("TI_ATIVO").update(payload).eq("id", id).select("*").single();
        if (error) throw error;
        return mapearAtivo(data);
      }
      const { data, error } = await sb.from("TI_ATIVO").insert(payload).select("*").single();
      if (error) throw error;
      return mapearAtivo(data);
    },
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["ti_ativos"] });
      qc.invalidateQueries({ queryKey: ["ti_eventos", a.id] });
      toast.success(`${a.codigo ?? "Ativo"} salvo.`);
    },
    onError: (e: Error) => {
      // O índice uq_ti_ativo_ip_fixo é a rede reclamando de IP repetido —
      // traduzir aqui evita o "duplicate key value violates unique constraint"
      // cru na cara de quem está cadastrando uma máquina.
      const msg = e.message?.includes("uq_ti_ativo_ip_fixo")
        ? "Esse IP fixo já está em uso por outro equipamento ativo."
        : e.message || "Não foi possível salvar o ativo.";
      toast.error(msg);
    },
  });
}

/**
 * Só a posição no mapa. É mutação separada do salvar-tudo de propósito:
 * arrastar um ícone dispara isto dezenas de vezes, e mandar o cadastro
 * inteiro a cada solta faria o `guard` do banco e a timeline trabalharem à
 * toa. A tela move o ícone localmente e só chama aqui no `pointerup`.
 */
export function usePosicionarAtivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      id: string;
      planta_id: string | null;
      pos_x: number | null;
      pos_y: number | null;
      pos_z?: number | null;
      rotacao?: number;
      escala?: number;
    }) => {
      const { id, ...resto } = p;
      const { error } = await sb.from("TI_ATIVO").update(resto).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ti_ativos"] }),
    onError: (e: Error) => toast.error(e.message || "Não foi possível mover o equipamento."),
  });
}

export function useExcluirAtivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("TI_ATIVO").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ti_ativos"] });
      toast.success("Equipamento excluído.");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível excluir o equipamento."),
  });
}

// ── Histórico ─────────────────────────────────────────────────────────

export function useEventosAtivoTi(ativoId: string | null | undefined) {
  return useQuery({
    queryKey: ["ti_eventos", ativoId],
    enabled: !!ativoId,
    queryFn: async (): Promise<TiEvento[]> => {
      const { data, error } = await sb
        .from("TI_ATIVO_EVENTO")
        .select("*")
        .eq("ativo_id", ativoId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as TiEvento[];
    },
  });
}

export function useAnotarEventoTi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { ativo_id: string; texto: string; tipo?: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await sb.from("TI_ATIVO_EVENTO").insert({
        ativo_id: p.ativo_id,
        tipo: p.tipo ?? "nota",
        texto: p.texto,
        autor_id: userData.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["ti_eventos", v.ativo_id] });
      toast.success("Anotação registrada.");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível anotar."),
  });
}

// ── Anexos ────────────────────────────────────────────────────────────

export function useAnexosAtivoTi(ativoId: string | null | undefined) {
  return useQuery({
    queryKey: ["ti_anexos", ativoId],
    enabled: !!ativoId,
    queryFn: async (): Promise<TiAnexo[]> => {
      const { data, error } = await sb
        .from("TI_ATIVO_ANEXO")
        .select("*")
        .eq("ativo_id", ativoId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TiAnexo[];
    },
  });
}

export function useEnviarAnexoTi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { ativo_id: string; arquivo: File; categoria?: string }) => {
      const ext = p.arquivo.name.split(".").pop() ?? "bin";
      const path = `${p.ativo_id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET_TI).upload(path, p.arquivo, { upsert: false });
      if (upErr) throw upErr;
      const { error } = await sb.from("TI_ATIVO_ANEXO").insert({
        ativo_id: p.ativo_id,
        storage_path: path,
        nome_arquivo: p.arquivo.name,
        mime_type: p.arquivo.type || null,
        tamanho_bytes: p.arquivo.size,
        categoria: p.categoria ?? "foto",
      });
      if (error) throw error;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["ti_anexos", v.ativo_id] });
      toast.success("Anexo enviado.");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível enviar o anexo."),
  });
}

/** URL assinada (o bucket é privado). */
export async function urlAnexoTi(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET_TI).createSignedUrl(storagePath, 60 * 30);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// ── Colaboradores (para o campo "Responsável") ────────────────────────

export interface ColaboradorTi {
  id: number;
  nome: string;
  setor: string | null;
  cargo: string | null;
}

/**
 * EMPREGADOS é a fonte única do cadastro de pessoas (não criar view/tabela
 * espelho). São 2200+ ativos — mais que o teto de linhas por request do
 * PostgREST —, então pagina com `.range()` até a página vir incompleta, o
 * mesmo cuidado de useIntegrantes em useMaloteDespesa.
 */
export function useColaboradoresTi() {
  return useQuery({
    queryKey: ["ti_colaboradores"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<ColaboradorTi[]> => {
      const PAGE = 1000;
      const todos: ColaboradorTi[] = [];
      for (let pagina = 0; ; pagina++) {
        const { data, error } = await sb
          .from("EMPREGADOS")
          .select('"ID", "Nome", "Setor_ERP", "Título do Cargo", "Situação"')
          .eq("Situação", "Trabalhando")
          .order("Nome")
          .range(pagina * PAGE, pagina * PAGE + PAGE - 1);
        if (error) throw error;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lote = (data ?? []).map((e: any) => ({
          id: e.ID as number,
          nome: (e.Nome as string) ?? "",
          setor: e.Setor_ERP ?? null,
          cargo: e["Título do Cargo"] ?? null,
        }));
        todos.push(...lote);
        if (lote.length < PAGE) break;
      }
      return todos;
    },
  });
}

/**
 * Elementos de VÁRIAS plantas de uma vez — o modo "ver todos os andares".
 *
 * Uma query só com `in`, e não uma por planta: são poucos andares, mas cada
 * query extra é um round-trip antes de a cena poder desenhar.
 */
export function useElementosDeVariasTi(plantaIds: string[]) {
  const chave = [...plantaIds].sort().join(",");
  return useQuery({
    queryKey: ["ti_elementos_varias", chave],
    enabled: plantaIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<TiElemento[]> => {
      const { data, error } = await sb
        .from("TI_PLANTA_ELEMENTO")
        .select("*")
        .in("planta_id", plantaIds)
        .order("z_index");
      if (error) throw error;
      return (data ?? []).map(mapearElemento);
    },
  });
}

/**
 * Recria um elemento COM O ID ORIGINAL — existe para o Ctrl+Z do editor.
 *
 * Um insert normal geraria id novo, e aí o Ctrl+Y seguinte removeria "o
 * elemento errado" (o histórico guarda o id de antes). Reaproveitar o id
 * mantém a linha do tempo coerente.
 */
export function useRecriarElemento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (el: TiElemento) => {
      const { error } = await sb.from("TI_PLANTA_ELEMENTO").insert({
        id: el.id,
        planta_id: el.planta_id,
        tipo: el.tipo,
        rotulo: el.rotulo,
        x: el.x,
        y: el.y,
        largura: el.largura,
        altura: el.altura,
        rotacao: el.rotacao,
        altura_z: el.altura_z,
        cor: el.cor,
        setor: el.setor,
        z_index: el.z_index,
        meta: el.meta ?? {},
      });
      if (error) throw error;
      return el;
    },
    onSuccess: (el) => {
      qc.invalidateQueries({ queryKey: ["ti_elementos", el.planta_id] });
      qc.invalidateQueries({ queryKey: ["ti_elementos_varias"] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível restaurar a peça."),
  });
}

/** Os setores que já existem no cadastro de pessoas — para marcar a sala. */
export function useSetoresTi() {
  return useQuery({
    queryKey: ["ti_setores"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await sb
        .from("EMPREGADOS")
        .select('"Setor_ERP"')
        .eq("Situação", "Trabalhando")
        .not("Setor_ERP", "is", null)
        .limit(5000);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nomes = new Set<string>((data ?? []).map((e: any) => String(e.Setor_ERP ?? "").trim()).filter(Boolean));
      return [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
    },
  });
}

/**
 * Aumenta o piso 1 metro num dos lados (o "+" do chão, no editor).
 *
 * Passa por RPC porque crescer para o norte/oeste move a origem: além da
 * planta, todas as peças e equipamentos precisam andar junto, em três tabelas,
 * na mesma transação. Ver o cabeçalho de 20260930000067.
 */
export function useExpandirPlanta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { planta_id: string; lado: "norte" | "sul" | "leste" | "oeste"; metros?: number }) => {
      const { error } = await sb.rpc("ti_expandir_planta", {
        p_planta: p.planta_id,
        p_lado: p.lado,
        p_metros: p.metros ?? 1,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ti_plantas"] });
      qc.invalidateQueries({ queryKey: ["ti_elementos"] });
      qc.invalidateQueries({ queryKey: ["ti_elementos_varias"] });
      qc.invalidateQueries({ queryKey: ["ti_ativos"] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível aumentar a planta."),
  });
}

// ── Piso por células (o quadrado de 1 m²) ─────────────────────────────

export interface TiCelula {
  cx: number;
  cy: number;
}

/**
 * Os quadrados que formam o piso.
 *
 * Lista vazia NÃO quer dizer "sem piso": quer dizer planta antiga, ainda
 * retangular — a tela desenha o retângulo inteiro nesse caso. A primeira
 * edição materializa as células no banco.
 */
export function useCelulasTi(plantaId: string | null | undefined) {
  return useQuery({
    queryKey: ["ti_celulas", plantaId],
    enabled: !!plantaId,
    staleTime: 60_000,
    queryFn: async (): Promise<TiCelula[]> => {
      const { data, error } = await sb
        .from("TI_PLANTA_CELULA")
        .select("cx, cy")
        .eq("planta_id", plantaId);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((c: any) => ({ cx: Number(c.cx), cy: Number(c.cy) }));
    },
  });
}

/** Ocupa (ou libera) um quadrado de 1 m² do piso. */
export function useDefinirCelula() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { planta_id: string; cx: number; cy: number; ocupar: boolean }) => {
      const { error } = await sb.rpc("ti_celula_definir", {
        p_planta: p.planta_id,
        p_cx: p.cx,
        p_cy: p.cy,
        p_ocupar: p.ocupar,
      });
      if (error) throw error;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["ti_celulas", v.planta_id] });
      qc.invalidateQueries({ queryKey: ["ti_celulas_varias"] });
      // A RPC pode ter empurrado o mundo (célula com índice negativo) e
      // crescido a moldura: planta, peças e equipamentos podem ter mudado.
      qc.invalidateQueries({ queryKey: ["ti_plantas"] });
      qc.invalidateQueries({ queryKey: ["ti_elementos"] });
      qc.invalidateQueries({ queryKey: ["ti_elementos_varias"] });
      qc.invalidateQueries({ queryKey: ["ti_ativos"] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível mudar o piso."),
  });
}

/** Células de várias plantas — usado ao mostrar mais de um andar. */
export function useCelulasDeVariasTi(plantaIds: string[]) {
  const chave = [...plantaIds].sort().join(",");
  return useQuery({
    queryKey: ["ti_celulas_varias", chave],
    enabled: plantaIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<(TiCelula & { planta_id: string })[]> => {
      const { data, error } = await sb
        .from("TI_PLANTA_CELULA")
        .select("planta_id, cx, cy")
        .in("planta_id", plantaIds);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((c: any) => ({
        planta_id: c.planta_id,
        cx: Number(c.cx),
        cy: Number(c.cy),
      }));
    },
  });
}
