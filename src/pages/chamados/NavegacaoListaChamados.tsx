// Setas para passar ao chamado anterior/próximo da lista de onde ele foi
// aberto (?lista= na URL — ver src/lib/chamados/navegacaoLista.ts). A URL
// carrega a lista, então sobrevive a F5 e a aba nova.
//
// 16/11/2026: sem lista na URL (link direto, notificação, chat), as setas
// andam pela fila do RESPONSÁVEL do chamado (chamados ativos dele, na ordem
// do "Nº na fila"). Essa fila vem de um SELECT comum em CHAMADO_SISTEMA, então
// o RLS só devolve o que o usuário já pode ver — nunca leva a um chamado que
// ele não abriria pela lista. Chamado encerrado aberto sem lista não está na
// fila: as setas não aparecem.
//
// As setas do teclado (← →) também andam, fora de campo de texto, menu,
// lista de opções e diálogo (o chat do chamado é textarea: não é afetado).
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  PARAM_LISTA, hrefNaLista, lerLista, ordemFilaResponsavel, posicaoNaLista, type ItemFila,
} from "@/lib/chamados/navegacaoLista";
import { STATUS_ENCERRADOS, chamadoAtivo, type Chamado } from "./types";

type Props = { chamado: Pick<Chamado, "id" | "responsavel_id"> };

export function NavegacaoListaChamados({ chamado }: Props) {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const listaUrl = lerLista(params.get(PARAM_LISTA));
  const posUrl = posicaoNaLista(listaUrl, chamado.id);

  // Fila do responsável — só quando não veio lista válida na URL.
  const { data: fila = [] } = useQuery({
    queryKey: ["chamado-nav-fila-responsavel", chamado.responsavel_id],
    enabled: !posUrl && !!chamado.responsavel_id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("CHAMADO_SISTEMA")
        .select("id, status, responsavel_id, posicao_dev, created_at")
        .eq("responsavel_id", chamado.responsavel_id)
        .not("status", "in", `(${STATUS_ENCERRADOS.join(",")})`);
      if (error) throw error;
      return (data ?? []) as ItemFila[];
    },
  });

  const lista = posUrl ? listaUrl : ordemFilaResponsavel(fila, chamado.responsavel_id, chamadoAtivo);
  const pos = posUrl ?? posicaoNaLista(lista, chamado.id);
  // Fila do responsável anda sem ?lista= (a ordem é recalculada no destino).
  const hrefDe = (destino: string) => (posUrl ? hrefNaLista(destino, lista) : `/app/sistemas/chamados/${destino}`);

  // Número dos vizinhos, para o title dos botões.
  const vizinhos = [pos?.anterior, pos?.proximo].filter((v): v is string => !!v);
  const { data: numeros = {} } = useQuery({
    queryKey: ["chamado-nav-numeros", ...vizinhos],
    enabled: vizinhos.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("CHAMADO_SISTEMA").select("id, numero").in("id", vizinhos);
      return Object.fromEntries(((data ?? []) as Array<{ id: string; numero: string }>).map((c) => [c.id, c.numero])) as Record<string, string>;
    },
  });

  useEffect(() => {
    if (!pos) return;
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target instanceof Element ? e.target : null;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (alvo?.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu], [role=listbox], [role=combobox]")) return;
      if (e.key === "ArrowLeft" && pos.anterior) nav(hrefDe(pos.anterior));
      if (e.key === "ArrowRight" && pos.proximo) nav(hrefDe(pos.proximo));
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  if (!pos) return null;
  const rotulo = (destino: string | null, sentido: string, tecla: string) =>
    destino ? `${sentido}: #${numeros[destino] ?? "…"} (${tecla})` : `Sem ${sentido.toLowerCase()} nesta lista`;
  return (
    <div className="flex items-center gap-1 rounded-md border bg-background px-1">
      <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!pos.anterior}
        onClick={() => pos.anterior && nav(hrefDe(pos.anterior))} aria-label="Chamado anterior"
        title={rotulo(pos.anterior, "Anterior", "←")}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[56px] text-center text-xs tabular-nums text-muted-foreground"
        title={posUrl ? "Posição na lista de onde você abriu o chamado" : "Posição na fila do responsável"}>
        {pos.indice + 1} de {pos.total}
      </span>
      <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!pos.proximo}
        onClick={() => pos.proximo && nav(hrefDe(pos.proximo))} aria-label="Próximo chamado"
        title={rotulo(pos.proximo, "Próximo", "→")}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
