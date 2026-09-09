import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/**
 * Links dos BIs — o catálogo de painéis e quem enxerga cada um.
 *
 * DUAS CAMADAS, QUE NÃO SE CONFUNDEM (ver a migration 20260930000079)
 *   A TELA é gateada por `app_menu` como qualquer outra do ERP. O CARD tem
 *   recorte próprio, por setor ou por pessoa — isso é conteúdo, não permissão
 *   de tela, e segue o que o Painel de Formulários já faz.
 *
 * O filtro por setor/pessoa acontece na RLS, não aqui: esta lista já chega
 * recortada. O que existe aqui é heurística de UI (mostrar botão), e é por
 * isso que quem gere recebe `ativo` e inativo juntos — para poder reativar o
 * que ele mesmo desligou.
 */

export const MENU_BI_LINKS = "bi_links";
export const BUCKET_CAPAS = "bi-capas";

export interface BiLink {
  id: string;
  titulo: string;
  descricao: string | null;
  url: string;
  imagem_url: string | null;
  grupo: string | null;
  ordem: number;
  ativo: boolean;
  created_at: string;
}

/** Uma regra de quem vê o card: setor OU pessoa, nunca os dois. */
export interface BiLinkAcesso {
  id: number;
  link_id: string;
  setor: string | null;
  user_id: string | null;
}

export interface FormBiLink {
  id?: string;
  titulo: string;
  descricao: string;
  url: string;
  imagem_url: string;
  grupo: string;
  ativo: boolean;
  /** Setores liberados. Vazio + sem pessoas = card de todos. */
  setores: string[];
  /** Pessoas liberadas, por id do profile. */
  usuarios: string[];
}

export const FORM_BI_VAZIO: FormBiLink = {
  titulo: "", descricao: "", url: "", imagem_url: "", grupo: "", ativo: true,
  setores: [], usuarios: [],
};

/** O que impede de salvar. Mensagem única, na ordem em que a pessoa preenche. */
export function erroDoLink(f: FormBiLink): string | null {
  if (!f.titulo.trim()) return "Escreva o título do BI.";
  if (!f.url.trim()) return "Cole o link do painel.";
  // Link sem esquema abre como caminho relativo do ERP e leva a lugar nenhum
  // — o erro aparece só no clique, longe daqui.
  if (!/^https?:\/\//i.test(f.url.trim())) return "O link precisa começar com http:// ou https://";
  if (f.imagem_url && !/^https?:\/\//i.test(f.imagem_url)) return "A imagem precisa ser uma URL http(s).";
  return null;
}

export function useBiLinks() {
  const { can } = usePermissoes();
  const qc = useQueryClient();

  const podeVer = can("visualizar", undefined, MENU_BI_LINKS);
  const podeCriar = can("incluir", undefined, MENU_BI_LINKS);
  const podeEditar = can("alterar", undefined, MENU_BI_LINKS);
  const podeExcluir = can("excluir", undefined, MENU_BI_LINKS);

  const linksQ = useQuery({
    queryKey: ["bi_links"],
    enabled: podeVer || podeEditar,
    staleTime: 60_000,
    queryFn: async (): Promise<BiLink[]> => {
      const { data, error } = await sb
        .from("BI_LINK")
        .select("*")
        .order("ordem")
        .order("titulo");
      if (error) throw error;
      return (data ?? []) as BiLink[];
    },
  });

  /**
   * As regras de acesso. Quem gere lê todas; quem só usa lê as suas — e é o
   * que permite a tela dizer "você vê este card porque é do setor X".
   */
  const acessosQ = useQuery({
    queryKey: ["bi_links_acessos"],
    enabled: podeVer || podeEditar,
    staleTime: 60_000,
    queryFn: async (): Promise<BiLinkAcesso[]> => {
      const { data, error } = await sb.from("BI_LINK_ACESSO").select("*");
      if (error) throw error;
      return (data ?? []) as BiLinkAcesso[];
    },
  });

  /** Os setores do catálogo — a mesma fonte que o resto do ERP usa. */
  const setoresQ = useQuery({
    queryKey: ["setor_catalogo"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await sb.from("setor_catalogo").select("nome").order("nome");
      if (error) throw error;
      return (data ?? []).map((s: { nome: string }) => s.nome);
    },
  });

  /** As pessoas, para liberar um card nominalmente. Só quem gere precisa. */
  const pessoasQ = useQuery({
    queryKey: ["bi_links_pessoas"],
    enabled: podeEditar,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<{ id: string; nome: string }[]> => {
      const { data, error } = await sb
        .from("profiles")
        .select("id,display_name,email")
        .order("display_name");
      if (error) throw error;
      return (data ?? []).map((p: { id: string; display_name: string | null; email: string | null }) => ({
        id: p.id,
        nome: p.display_name || p.email || "(sem nome)",
      }));
    },
  });

  /**
   * Grava o card e REESCREVE as regras de acesso dele.
   *
   * Apagar tudo e inserir de novo, em vez de calcular o que entrou e o que
   * saiu: a lista tem dezenas de linhas no pior caso, o diff seria código
   * novo para economizar milissegundos, e é ele que erraria em silêncio.
   */
  const salvar = useMutation({
    mutationFn: async (f: FormBiLink) => {
      const linha = {
        titulo: f.titulo.trim(),
        descricao: f.descricao.trim() || null,
        url: f.url.trim(),
        imagem_url: f.imagem_url.trim() || null,
        grupo: f.grupo.trim() || null,
        ativo: f.ativo,
      };

      let id = f.id;
      if (id) {
        const { error } = await sb.from("BI_LINK").update(linha).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from("BI_LINK").insert(linha).select("id").single();
        if (error) throw error;
        id = data.id as string;
      }

      const { error: erroApagar } = await sb.from("BI_LINK_ACESSO").delete().eq("link_id", id);
      if (erroApagar) throw erroApagar;

      const regras = [
        ...f.setores.map((setor) => ({ link_id: id, setor, user_id: null })),
        ...f.usuarios.map((user_id) => ({ link_id: id, setor: null, user_id })),
      ];
      if (regras.length) {
        const { error } = await sb.from("BI_LINK_ACESSO").insert(regras);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bi_links"] });
      qc.invalidateQueries({ queryKey: ["bi_links_acessos"] });
    },
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      // As regras de acesso somem por CASCADE — não há o que limpar aqui.
      const { error } = await sb.from("BI_LINK").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bi_links"] });
      qc.invalidateQueries({ queryKey: ["bi_links_acessos"] });
    },
  });

  /** Sobe a capa e devolve a URL pública. O bucket é público de propósito. */
  const subirCapa = async (arquivo: File): Promise<string> => {
    const ext = arquivo.name.split(".").pop()?.toLowerCase() || "png";
    const caminho = `capas/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET_CAPAS).upload(caminho, arquivo, { upsert: false });
    if (error) throw error;
    return supabase.storage.from(BUCKET_CAPAS).getPublicUrl(caminho).data.publicUrl;
  };

  return {
    links: linksQ.data ?? [],
    acessos: acessosQ.data ?? [],
    setores: setoresQ.data ?? [],
    pessoas: pessoasQ.data ?? [],
    carregando: linksQ.isLoading,
    podeVer, podeCriar, podeEditar, podeExcluir,
    salvar, excluir, subirCapa,
  };
}
