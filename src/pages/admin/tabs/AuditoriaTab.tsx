import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw } from "lucide-react";
import { usePermissoes } from "@/context/PermissoesContext";

interface AuditRow {
  id: number;
  ts: string;
  user_id: string | null;
  schema_name: string;
  table_name: string;
  op: string;
  pk: string | null;
  diff: any;
}

export function AuditoriaTab() {
  const qc = useQueryClient();
  const { can } = usePermissoes();
  const canSee = can("visualizar", undefined, "administracao");

  const [tabela, setTabela] = useState("");

  const auditQ = useQuery({
    enabled: canSee,
    queryKey: ["audit_log_recent", tabela],
    queryFn: async () => {
      let q = supabase.from("audit_log").select("*").order("ts", { ascending: false }).limit(150);
      if (tabela.trim()) q = q.ilike("table_name", `%${tabela.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  if (!canSee) {
    return <section className="card-elevated p-6 text-sm text-muted-foreground">Apenas administradores e controladoria podem visualizar a trilha de auditoria.</section>;
  }

  return (
    <section className="card-elevated">
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div>
          <h2 className="font-display text-sm font-bold">Auditoria de ações sensíveis</h2>
          <p className="text-xs text-muted-foreground">
            Trilha imutável (tabela <code className="rounded bg-muted px-1">audit_log</code>) — últimos {auditQ.data?.length ?? 0} eventos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/app/admin/smoke-helena"
            className="inline-flex h-9 items-center rounded-md border border-primary/40 bg-primary/5 px-3 text-xs font-medium text-primary hover:bg-primary/10"
          >
            Smoke Test Helena →
          </a>
          <Input placeholder="Filtrar por tabela…" value={tabela} onChange={(e) => setTabela(e.target.value)} className="h-9 w-56" />
          <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["audit_log_recent"] })} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </Button>
        </div>
      </header>
      <div className="max-h-[600px] divide-y divide-border overflow-y-auto">
        {auditQ.isLoading && <p className="px-5 py-6 text-center text-sm text-muted-foreground">Carregando…</p>}
        {!auditQ.isLoading && (auditQ.data ?? []).length === 0 && (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">Nenhum evento auditado.</p>
        )}
        {(auditQ.data ?? []).map((a) => {
          const tone = a.op === "D" ? "destructive" : a.op === "U" ? "warning" : a.op === "I" ? "success" : "muted-foreground";
          const opLabel = a.op === "I" ? "INSERT" : a.op === "U" ? "UPDATE" : a.op === "D" ? "DELETE" : a.op;
          return (
            <div key={a.id} className="px-5 py-3 text-xs">
              <div className="flex items-center gap-3">
                <span className={`chip border border-${tone}/30 bg-${tone}/10 text-${tone}`}>{opLabel}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{new Date(a.ts).toLocaleString("pt-BR")}</span>
                <span className="font-mono">{a.schema_name}.{a.table_name}</span>
                {a.pk && <span className="font-mono text-muted-foreground">#{a.pk}</span>}
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">{a.user_id ?? "sistema"}</span>
              </div>
              {a.diff && Object.keys(a.diff).length > 0 && (
                <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted/40 p-2 text-[11px] leading-relaxed">{JSON.stringify(a.diff, null, 2)}</pre>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
