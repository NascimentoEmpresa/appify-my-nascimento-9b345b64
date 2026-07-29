import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { History } from "lucide-react";
import { fmtDataHora } from "./types";

// Feed "Atualizações recentes" compartilhado pelos três painéis (solicitante,
// gestor e desenvolvedor). Lê os últimos eventos de CHAMADO_SISTEMA_EVENTO — a
// RLS já recorta o que cada papel pode ver:
//   - gestor       → eventos de todos os chamados
//   - responsável  → eventos dos chamados atribuídos a ele
//   - solicitante  → eventos dos próprios chamados (sem observações internas)
// Atualiza sozinho a cada 60s.

interface FeedEvento {
  id: string;
  chamado_id: string;
  autor_id: string;
  tipo: string;
  texto: string | null;
  created_at: string;
}

const DOT: Record<string, string> = {
  evento: "bg-info",
  comentario: "bg-primary",
  observacao_interna: "bg-muted-foreground",
};

export function FeedAtualizacoes({
  title = "Atualizações recentes",
  limit = 12,
  buildHref,
}: {
  title?: string;
  limit?: number;
  /** Se informado, cada item vira link para o chamado. */
  buildHref?: (chamadoId: string) => string;
}) {
  const nav = useNavigate();

  const { data: usuarios = [] } = useQuery({
    queryKey: ["chamados-usuarios"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("listar_usuarios_ativos");
      return (data ?? []) as Array<{ id: string; display_name: string }>;
    },
  });
  const nomeDe = (uid: string | null) => (uid ? usuarios.find((u) => u.id === uid)?.display_name ?? "—" : "—");

  const { data: feed = { eventos: [], chamados: {} } } = useQuery({
    queryKey: ["chamados-feed", limit],
    refetchInterval: 60_000,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: evs } = await (supabase as any)
        .from("CHAMADO_SISTEMA_EVENTO")
        .select("id, chamado_id, autor_id, tipo, texto, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      const eventos = (evs ?? []) as FeedEvento[];
      const ids = [...new Set(eventos.map((e) => e.chamado_id))];
      const chamados: Record<string, { numero: string; assunto: string }> = {};
      if (ids.length) {
        const { data: chs } = await (supabase as any)
          .from("CHAMADO_SISTEMA")
          .select("id, numero, assunto")
          .in("id", ids);
        for (const c of chs ?? []) chamados[c.id] = { numero: c.numero, assunto: c.assunto };
      }
      return { eventos, chamados };
    },
  });
  const { eventos, chamados } = feed;

  return (
    <Card className="p-4">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
        <History className="h-4 w-4 text-primary" /> {title}
      </p>
      {/* Janela rolável: o feed não empurra o layout nem deixa vão branco. */}
      <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
        {eventos.map((e) => {
          const ch = chamados[e.chamado_id];
          return (
          <button
            key={e.id}
            type="button"
            disabled={!buildHref}
            onClick={() => buildHref && nav(buildHref(e.chamado_id))}
            className={`block w-full rounded border border-border/60 px-2.5 py-1.5 text-left ${buildHref ? "cursor-pointer hover:border-primary/40" : "cursor-default"}`}
          >
            <p className="flex items-center gap-2 text-[11px]">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[e.tipo] ?? "bg-muted-foreground"}`} />
              <span className="font-mono font-semibold">#{ch?.numero ?? "—"}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">{fmtDataHora(e.created_at)}</span>
            </p>
            {ch?.assunto && <p className="truncate text-[11px] text-muted-foreground">{ch.assunto}</p>}
            {e.texto && <p className="whitespace-pre-wrap text-xs">{e.texto}</p>}
            <p className="text-[10px] text-muted-foreground">por {nomeDe(e.autor_id)}</p>
          </button>
          );
        })}
        {eventos.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma atualização recente.</p>}
      </div>
    </Card>
  );
}
