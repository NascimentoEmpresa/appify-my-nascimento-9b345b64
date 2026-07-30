import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

type AliasTipo = "contratos" | "centros_custo" | "empresas" | "bancos" | "formas_pagamento" | "contas_contabeis" | "dre";

interface AliasRow {
  id: string;
  alias: string;
  status: "pendente" | "resolvido" | "ignorado";
  resolvido_em: string | null;
  contrato_id?: string | null;
  centro_custo_id?: string | null;
  empresa_destino_id?: string | null;
  banco_id?: string | null;
  forma_pagamento?: string | null;
  conta_contabil_id?: string | null;
  dre_linha_id?: string | null;
}

interface InternalOption { id: string; label: string; }

const TIPO_CFG: Record<AliasTipo, {
  table: string;
  idCol: keyof AliasRow;
  label: string;
  loadOptions: (empresaId: string) => Promise<InternalOption[]>;
}> = {
  contratos: {
    table: "integration_alias_contratos",
    idCol: "contrato_id",
    label: "Contratos",
    loadOptions: async (empresaId) => {
      const { data } = await supabase.from("contrato")
        .select("id, numero, objeto").eq("empresa_id", empresaId).limit(500);
      return (data ?? []).map((c: any) => ({ id: c.id, label: `${c.numero} — ${c.objeto ?? ""}`.slice(0, 80) }));
    },
  },
  centros_custo: {
    table: "integration_alias_centros_custo",
    idCol: "centro_custo_id",
    label: "Centros de custo",
    loadOptions: async (empresaId) => {
      const { data } = await supabase.from("centros_custo")
        .select("id, codigo, nome").eq("empresa_id", empresaId).limit(500);
      return (data ?? []).map((c: any) => ({ id: c.id, label: `${c.codigo} — ${c.nome}` }));
    },
  },
  empresas: {
    table: "integration_alias_empresas",
    idCol: "empresa_destino_id",
    label: "Empresas",
    loadOptions: async () => {
      const { data } = await supabase.from("empresas").select("id, nome_fantasia, razao_social").limit(500);
      return (data ?? []).map((e: any) => ({ id: e.id, label: e.nome_fantasia ?? e.razao_social }));
    },
  },
  bancos: {
    table: "integration_alias_bancos",
    idCol: "banco_id",
    label: "Bancos / Contas",
    loadOptions: async (empresaId) => {
      const { data } = await supabase.from("conta_bancaria")
        .select("id, banco, agencia, conta").eq("empresa_id", empresaId).limit(500);
      return (data ?? []).map((b: any) => ({ id: b.id, label: `${b.banco} ${b.agencia ?? ""}/${b.conta ?? ""}` }));
    },
  },
  formas_pagamento: {
    table: "integration_alias_formas_pagamento",
    idCol: "forma_pagamento" as any,
    label: "Formas de pagamento",
    loadOptions: async () => {
      const enumVals = ["boleto","ted","pix","transferencia","dinheiro","cheque","debito_automatico"];
      return enumVals.map((v) => ({ id: v, label: v }));
    },
  },
  contas_contabeis: {
    table: "integration_alias_contas_contabeis",
    idCol: "conta_contabil_id",
    label: "Plano de contas",
    loadOptions: async () => {
      const { data } = await supabase.from("conta_contabil")
        .select("id, codigo, nome").order("codigo").limit(2000);
      return (data ?? []).map((c: any) => ({ id: c.id, label: `${c.codigo} — ${c.nome}` }));
    },
  },
  dre: {
    table: "integration_alias_dre",
    idCol: "dre_linha_id",
    label: "Linhas DRE",
    loadOptions: async () => {
      const { data } = await supabase.from("dre_linhas")
        .select("id, codigo, descricao").order("ordem").limit(500);
      return (data ?? []).map((c: any) => ({ id: c.id, label: `${c.codigo} — ${c.descricao}` }));
    },
  },
};

export default function Aliases() {
  const { empresaId, can } = usePermissoes();
  const { toast } = useToast();
  const podeGerenciar = can("alterar", undefined, "integracao-aliases");

  const [tipo, setTipo] = useState<AliasTipo>("contratos");
  const [rows, setRows] = useState<AliasRow[]>([]);
  const [options, setOptions] = useState<InternalOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pendente" | "resolvido">("pendente");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pendingValue, setPendingValue] = useState<Record<string, string>>({});

  const cfg = TIPO_CFG[tipo];

  const load = useCallback(async () => {
    if (!empresaId) return;
    setLoading(true);
    const [aliasRes, opts] = await Promise.all([
      supabase.from(cfg.table as any).select("*").eq("empresa_id", empresaId).order("created_at", { ascending: false }).limit(500),
      cfg.loadOptions(empresaId),
    ]);
    setRows((aliasRes.data ?? []) as any);
    setOptions(opts);
    setLoading(false);
  }, [empresaId, cfg]);

  useEffect(() => { load(); }, [load]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (filter && !r.alias.toLowerCase().includes(filter.toLowerCase())) return false;
      return true;
    });
  }, [rows, filter, statusFilter]);

  const counts = useMemo(() => ({
    pendente: rows.filter((r) => r.status === "pendente").length,
    resolvido: rows.filter((r) => r.status === "resolvido").length,
    total: rows.length,
  }), [rows]);

  const handleResolve = async (alias: string) => {
    const internalId = pendingValue[alias];
    if (!internalId || !empresaId) return;
    setSavingId(alias);
    const { error } = await supabase.rpc("integration_resolve_alias", {
      p_tipo: tipo,
      p_alias: alias,
      p_id_interno: internalId,
      p_empresa_id: empresaId,
    });
    setSavingId(null);
    if (error) toast({ title: "Erro ao resolver alias", description: error.message, variant: "destructive" });
    else { toast({ title: "Alias vinculado" }); load(); }
  };

  if (!podeGerenciar) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Apenas administradores podem gerenciar aliases.
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        module="Integração & Migração"
        breadcrumb={[<Link key="b" to="/app/integracao" className="hover:underline">Lotes</Link> as any, "Aliases"]}
        title="Resolução de aliases"
        subtitle="Vincule nomes externos (planilhas) aos cadastros internos do ERP"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/app/integracao"><ArrowLeft className="h-4 w-4" /> Voltar</Link>
          </Button>
        }
      />

      <Tabs value={tipo} onValueChange={(v) => setTipo(v as AliasTipo)} className="mb-4">
        <TabsList>
          {(Object.keys(TIPO_CFG) as AliasTipo[]).map((t) => (
            <TabsTrigger key={t} value={t}>{TIPO_CFG[t].label}</TabsTrigger>
          ))}
        </TabsList>
        {(Object.keys(TIPO_CFG) as AliasTipo[]).map((t) => (
          <TabsContent key={t} value={t} />
        ))}
      </Tabs>

      <Card className="p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setStatusFilter("pendente")}
              className={`rounded px-2 py-1 ${statusFilter === "pendente" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 font-medium" : "text-muted-foreground"}`}
            >Pendentes ({counts.pendente})</button>
            <button
              onClick={() => setStatusFilter("resolvido")}
              className={`rounded px-2 py-1 ${statusFilter === "resolvido" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-medium" : "text-muted-foreground"}`}
            >Resolvidos ({counts.resolvido})</button>
            <button
              onClick={() => setStatusFilter("all")}
              className={`rounded px-2 py-1 ${statusFilter === "all" ? "bg-muted font-medium" : "text-muted-foreground"}`}
            >Todos ({counts.total})</button>
          </div>
          <Input
            placeholder="Buscar alias..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-64"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhum alias encontrado para este filtro.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alias (texto externo)</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead>Vincular a</TableHead>
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((r) => {
                  const currentId = (r as any)[cfg.idCol] as string | null;
                  const currentLabel = options.find((o) => o.id === currentId)?.label;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm font-medium">{r.alias}</TableCell>
                      <TableCell>
                        {r.status === "resolvido" ? (
                          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="mr-1 h-3 w-3" /> Resolvido
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="mr-1 h-3 w-3" /> {r.status}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={pendingValue[r.alias] ?? currentId ?? ""}
                          onValueChange={(v) => setPendingValue((p) => ({ ...p, [r.alias]: v }))}
                        >
                          <SelectTrigger className="w-full max-w-md text-xs">
                            <SelectValue placeholder={currentLabel ?? "Selecionar..."} />
                          </SelectTrigger>
                          <SelectContent>
                            {options.map((o) => (
                              <SelectItem key={o.id} value={o.id} className="text-xs">{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!pendingValue[r.alias] || savingId === r.alias}
                          onClick={() => handleResolve(r.alias)}
                        >
                          {savingId === r.alias ? <Loader2 className="h-4 w-4 animate-spin" /> : "Vincular"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
