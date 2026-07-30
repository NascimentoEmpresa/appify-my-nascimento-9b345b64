import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { useToast } from "@/hooks/use-toast";
import { Plus, RefreshCw, Database, FileSpreadsheet, Search } from "lucide-react";

type BatchStatus = "rascunho" | "processando" | "validado_com_erros" | "validado_ok" | "aprovado" | "rejeitado" | "carregado" | "arquivado";

interface BatchRow {
  id: string;
  codigo: string;
  descricao: string | null;
  status: BatchStatus;
  total_linhas: number | null;
  linhas_validas: number | null;
  linhas_invalidas: number | null;
  created_at: string;
  empresa_id: string;
  layout_id: string | null;
}

const statusVariant: Record<BatchStatus, { label: string; className: string }> = {
  rascunho:              { label: "Rascunho",            className: "bg-muted text-muted-foreground" },
  processando:           { label: "Processando",         className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  validado_com_erros:    { label: "Validado c/ erros",   className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  validado_ok:           { label: "Validado OK",         className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  aprovado:              { label: "Aprovado",            className: "bg-primary/15 text-primary" },
  rejeitado:             { label: "Rejeitado",           className: "bg-destructive/15 text-destructive" },
  carregado:             { label: "Carregado no ERP",    className: "bg-emerald-600/20 text-emerald-700 dark:text-emerald-300" },
  arquivado:             { label: "Arquivado",           className: "bg-muted text-muted-foreground" },
};

export default function IntegracaoBatches() {
  const { user } = useAuth();
  const { empresaId, can } = usePermissoes();
  const { toast } = useToast();
  const nav = useNavigate();
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const podeGerenciar = can("alterar", undefined, "integracao");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("integration_batches")
      .select("id, codigo, descricao, status, total_linhas, linhas_validas, linhas_invalidas, created_at, empresa_id, layout_id")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast({ title: "Erro ao carregar lotes", description: error.message, variant: "destructive" });
    } else {
      setRows((data ?? []) as BatchRow[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!r.codigo.toLowerCase().includes(q) && !(r.descricao ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, filterStatus, search]);

  const createBatch = async () => {
    if (!user || !empresaId) {
      toast({ title: "Sessão necessária", description: "Faça login para criar um lote.", variant: "destructive" });
      return;
    }
    setCreating(true);
    const codigo = `BATCH-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const { data, error } = await supabase
      .from("integration_batches")
      .insert({
        codigo,
        empresa_id: empresaId,
        enviado_por: user.id,
        status: "rascunho",
        descricao: "Novo lote de integração",
      })
      .select("id")
      .single();
    setCreating(false);
    if (error || !data) {
      toast({ title: "Erro ao criar lote", description: error?.message ?? "", variant: "destructive" });
      return;
    }
    nav(`/app/integracao/${data.id}`);
  };

  const stats = useMemo(() => {
    const c = (s: BatchStatus) => rows.filter((r) => r.status === s).length;
    return {
      total: rows.length,
      rascunho: c("rascunho"),
      validado: c("validado_ok") + c("validado_com_erros"),
      aprovado: c("aprovado"),
      carregado: c("carregado"),
    };
  }, [rows]);

  return (
    <div>
      <PageHeader
        module="Integração & Migração"
        breadcrumb={["Lotes de Integração"]}
        title="Integração & Migração de Dados"
        subtitle="Receba planilhas, valide contra os layouts mestre e alimente o ERP de forma rastreável."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            {podeGerenciar && (
              <Button size="sm" onClick={createBatch} disabled={creating}>
                <Plus className="h-4 w-4" />
                Novo lote
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard icon={Database} label="Total de lotes" value={stats.total} />
        <StatCard icon={FileSpreadsheet} label="Rascunho" value={stats.rascunho} />
        <StatCard icon={FileSpreadsheet} label="Validados" value={stats.validado} />
        <StatCard icon={FileSpreadsheet} label="Aprovados" value={stats.aprovado} />
        <StatCard icon={FileSpreadsheet} label="Carregados" value={stats.carregado} />
      </div>

      <Card className="p-4">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por código ou descrição..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full md:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {Object.entries(statusVariant).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Linhas</TableHead>
                <TableHead className="text-right">Válidas</TableHead>
                <TableHead className="text-right">Inválidas</TableHead>
                <TableHead>Criado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                    Nenhum lote encontrado. {podeGerenciar && "Clique em Novo lote para começar."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r) => {
                const sv = statusVariant[r.status];
                return (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => nav(`/app/integracao/${r.id}`)}>
                    <TableCell className="font-mono text-xs">
                      <Link to={`/app/integracao/${r.id}`} className="hover:underline">{r.codigo}</Link>
                    </TableCell>
                    <TableCell className="max-w-md truncate">{r.descricao ?? "—"}</TableCell>
                    <TableCell><Badge className={sv.className}>{sv.label}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{r.total_linhas ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{r.linhas_validas ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-amber-700 dark:text-amber-400">{r.linhas_invalidas ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR")}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="font-display text-xl font-bold tabular-nums">{value}</p>
        </div>
      </div>
    </Card>
  );
}
