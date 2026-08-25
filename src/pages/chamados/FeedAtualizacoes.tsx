import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { History } from "lucide-react";
import { fmtDataHora } from "./types";

// Feed "Atualizações recentes" compartilhado pelos três painéis. O recorte NÃO
// depende só da RLS (que é ampla para quem tem o painel/coordenação): cada tela
// passa um `scope` que filtra explicitamente pelos chamados do usuário.
//   - "all"         → coordenação: todos os chamados (RLS recorta).
//   - "involved"    → desenvolvedor: só os chamados em que ele é solicitante ou
//                     responsável (os que abriu + os direcionados a ele).
//   - "solicitante" → abrir chamado: só os chamados que ELE abriu (sem
//                     observações internas).
// Atualiza sozinho a cada 60s.

interface FeedEvento {
  id: string;
  chamado_id: string;
  autor_id: string;
  tipo: string;
  texto: string | null;
  created_at: string;
}

type ChamadoLabel = { numero: string; assunto: string; responsavel_id?: string | null };

const DOT: Record<string, string> = {
  evento: "bg-info",
  comentario: "bg-primary",
  observacao_interna: "bg-muted-foreground",
};

export function FeedAtualizacoes({
  title = "Atualizações recentes",
  limit = 12,
  scope = "all",
  buildHref,
}: {
  title?: string;
  limit?: number;
  /** Recorte do feed por envolvimento do usuário. Ver comentário no topo. */
  scope?: "all" | "involved" | "solicitante";
  /** Se informado, cada item vira link para o chamado. */
  buildHref?: (chamadoId: string) => string;
}) {
  const nav = useNavigate();
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const { data: usuarios = [] } = useQuery({
    queryKey: ["chamados-usuarios"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("listar_usuarios_ativos");
      return (data ?? []) as Array<{ id: string; display_name: string }>;
    },
  });
  const nomeDe = (uid: string | null) => (uid ? usuarios.find((u) => u.id === uid)?.display_name ?? "—" : "—");

  const { data: feed = { eventos: [], chamados: {} } } = useQuery({
    queryKey: ["chamados-feed", scope, uid, limit],
    enabled: scope === "all" || !!uid,
    refetchInterval: 60_000,
    staleTime: 30_000,
    queryFn: async () => {
      const chamados: Record<string, ChamadoLabel> = {};

      // Recorte por envolvimento: descobre os chamados do usuário e usa como
      // filtro explícito dos eventos (a RLS sozinha liberaria tudo p/ quem tem
      // o painel). Já aproveita para montar os rótulos (número/assunto).
      let ids: string[] | null = null;
      if (scope !== "all") {
        let q = (supabase as any)
          .from("CHAMADO_SISTEMA")
          .select("id, numero, assunto, solicitante_id, responsavel_id");
        q = scope === "solicitante"
          ? q.eq("solicitante_id", uid)
          : q.or(`solicitante_id.eq.${uid},responsavel_id.eq.${uid}`);
        const { data: chs } = await q;
        ids = (chs ?? []).map((c: any) => c.id);
        for (const c of chs ?? []) chamados[c.id] = { numero: c.numero, assunto: c.assunto, responsavel_id: c.responsavel_id };
        if (ids.length === 0) return { eventos: [] as FeedEvento[], chamados };
      }

      let eq = (supabase as any)
        .from("CHAMADO_SISTEMA_EVENTO")
        .select("id, chamado_id, autor_id, tipo, texto, created_at")
        .order("created_at", { ascending: false })
        // scope recortado pode descartar observações internas no filtro JS, então
        // busca uma folga para não exibir menos itens que o limite.
        .limit(scope === "all" ? limit : limit * 3);
      if (ids) eq = eq.in("chamado_id", ids);
      if (scope === "solicitante") eq = eq.neq("tipo", "observacao_interna");
      const { data: evs } = await eq;
      let eventos = (evs ?? []) as FeedEvento[];

      // No painel do dev, observação interna só aparece nos chamados atribuídos
      // a ele — não nos que ele apenas abriu como solicitante.
      if (scope === "involved") {
        eventos = eventos.filter((e) => e.tipo !== "observacao_interna" || chamados[e.chamado_id]?.responsavel_id === uid);
      }
      eventos = eventos.slice(0, limit);

      // scope "all": busca os rótulos dos chamados dos eventos exibidos.
      if (scope === "all") {
        const eids = [...new Set(eventos.map((e) => e.chamado_id))];
        if (eids.length) {
          const { data: chs } = await (supabase as any)
            .from("CHAMADO_SISTEMA").select("id, numero, assunto").in("id", eids);
          for (const c of chs ?? []) chamados[c.id] = { numero: c.numero, assunto: c.assunto };
        }
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
      {/* Janela rolável: o feed não empurra o layout nem deixa vão branco.
          `overflow-x-hidden` porque o conteúdo (URL de PR, sobretudo) é mais
          largo que a coluna e criava barra horizontal no card inteiro. */}
      <div className="max-h-[22rem] space-y-2 overflow-y-auto overflow-x-hidden pr-1">
        {eventos.map((e) => {
          const ch = chamados[e.chamado_id];
          return (
          <button
            key={e.id}
            type="button"
            disabled={!buildHref}
            onClick={() => buildHref && nav(buildHref(e.chamado_id))}
            className={`block w-full min-w-0 overflow-hidden rounded border border-border/60 px-2.5 py-1.5 text-left ${buildHref ? "cursor-pointer hover:border-primary/40" : "cursor-default"}`}
          >
            <p className="flex items-center gap-2 text-[11px]">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[e.tipo] ?? "bg-muted-foreground"}`} />
              <span className="font-mono font-semibold">#{ch?.numero ?? "—"}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">{fmtDataHora(e.created_at)}</span>
            </p>
            {ch?.assunto && <p className="truncate text-[11px] text-muted-foreground">{ch.assunto}</p>}
            {/* `anywhere` e não `break-words`: a URL de um PR é UMA palavra de
                60+ caracteres, e break-word só quebra quando a palavra sozinha
                não cabe na linha — no meio de uma frase ela ainda vazava. */}
            {e.texto && <p className="whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">{e.texto}</p>}
            <p className="text-[10px] text-muted-foreground [overflow-wrap:anywhere]">por {nomeDe(e.autor_id)}</p>
          </button>
          );
        })}
        {eventos.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma atualização recente.</p>}
      </div>
    </Card>
  );
}
