import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  Save, RotateCcw, Search, ChevronLeft, ChevronRight, Lock,
  Plus, Trash2, Copy, FolderPlus,
} from "lucide-react";

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const fmt = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PAGE_SIZE = 50;

type Row = {
  id: string;
  empresa_id: string;
  dre_linha_id: string;
  centro_custo_id: string | null;
  conta_contabil_id: string | null;
  ciclo_id: string | null;
  competencia: string; // YYYY-MM-DD
  valor_previsto: number;
  memoria_calculo: string | null;
  origem: "contrato" | "manual";
  orcamento_contrato_id: string | null;
  linha_codigo?: string;
  linha_descricao?: string;
  cc_codigo?: string | null;
  cc_nome?: string | null;
  conta_codigo?: string | null;
  conta_desc?: string | null;
  mes?: number;
};

type Patch = Partial<Pick<Row, "valor_previsto" | "centro_custo_id" | "dre_linha_id" | "conta_contabil_id" | "memoria_calculo" | "competencia">>;

export default function OrcamentoCompleto() {
  const { can } = usePermissoes();
  const canEdit = can("alterar", undefined, "orcamento");

  const [ano, setAno] = useState<number>(new Date().getFullYear());
  const [empresaId, setEmpresaId] = useState<string | undefined>();
  const [cicloId, setCicloId] = useState<string>("todos");
  const [filtroOrigem, setFiltroOrigem] = useState<string>("todos");
  const [filtroLinha, setFiltroLinha] = useState("");
  const [filtroCC, setFiltroCC] = useState("");
  const [filtroConta, setFiltroConta] = useState("");
  const [filtroMes, setFiltroMes] = useState<string>("todos");
  const [page, setPage] = useState(0);
  const [dirty, setDirty] = useState<Record<string, Patch>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openNova, setOpenNova] = useState(false);
  const [openCopiar, setOpenCopiar] = useState(false);
  const [openCiclo, setOpenCiclo] = useState(false);
  const qc = useQueryClient();

  const empresasQ = useQuery({
    queryKey: ["empresas-orc"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("empresas").select("id, codigo, razao_social").eq("ativa", true).order("codigo");
      if (error) throw error;
      return data as Array<{ id: string; codigo: string; razao_social: string }>;
    },
  });

  useEffect(() => {
    if (!empresaId && empresasQ.data?.length) setEmpresaId(empresasQ.data[0].id);
  }, [empresasQ.data, empresaId]);

  const ciclosQ = useQuery({
    queryKey: ["ciclos-orc", empresaId, ano],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orcamento_ciclo")
        .select("id, nome, ano, status")
        .eq("empresa_id", empresaId).eq("ano", ano)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Array<{ id: string; nome: string; ano: number; status: string }>;
    },
  });

  const ccsQ = useQuery({
    queryKey: ["ccs-orc", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("centros_custo").select("id, codigo, nome, tipo")
        .or(`empresa_id.eq.${empresaId},empresa_id.is.null`)
        .eq("ativo", true).order("codigo");
      if (error) throw error;
      return data as Array<{ id: string; codigo: string; nome: string; tipo: string }>;
    },
  });

  const linhasQ = useQuery({
    queryKey: ["dre-linhas-orc", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("dre_linhas").select("id, codigo, descricao, natureza, ordem")
        .or(`empresa_id.eq.${empresaId},empresa_id.is.null`)
        .eq("ativo", true).order("ordem");
      if (error) throw error;
      return data as Array<{ id: string; codigo: string; descricao: string; natureza: string; ordem: number }>;
    },
  });

  const contasQ = useQuery({
    queryKey: ["contas-orc", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("conta_contabil")
        .select("id, conta_reduzida, descricao, ativo")
        .or(`empresa_id.eq.${empresaId},empresa_id.is.null`)
        .eq("ativo", true)
        .order("conta_reduzida").limit(5000);

      if (error) throw error;
      return data as Array<{ id: string; conta_reduzida: string; descricao: string }>;
    },
  });

  const valoresQ = useQuery({
    queryKey: ["orc-linhas", empresaId, ano],
    enabled: !!empresaId,
    queryFn: async () => {
      const inicio = `${ano}-01-01`;
      const fim = `${ano}-12-31`;
      const { data, error } = await (supabase as any)
        .from("orcamento_contrato_linha")
        .select("id, empresa_id, dre_linha_id, centro_custo_id, conta_contabil_id, ciclo_id, competencia, valor_previsto, memoria_calculo, origem, orcamento_contrato_id")
        .eq("empresa_id", empresaId)
        .gte("competencia", inicio).lte("competencia", fim)
        .limit(50000);
      if (error) throw error;
      return data as Row[];
    },
  });

  const rows: Row[] = useMemo(() => {
    const linhaMap = new Map(linhasQ.data?.map((l) => [l.id, l]) ?? []);
    const ccMap = new Map(ccsQ.data?.map((c) => [c.id, c]) ?? []);
    const contaMap = new Map(contasQ.data?.map((c) => [c.id, c]) ?? []);
    return (valoresQ.data ?? []).map((r) => ({
      ...r,
      linha_codigo: linhaMap.get(r.dre_linha_id)?.codigo,
      linha_descricao: linhaMap.get(r.dre_linha_id)?.descricao,
      cc_codigo: r.centro_custo_id ? ccMap.get(r.centro_custo_id)?.codigo ?? null : null,
      cc_nome: r.centro_custo_id ? ccMap.get(r.centro_custo_id)?.nome ?? null : null,
      conta_codigo: r.conta_contabil_id ? contaMap.get(r.conta_contabil_id)?.conta_reduzida ?? null : null,
      conta_desc: r.conta_contabil_id ? contaMap.get(r.conta_contabil_id)?.descricao ?? null : null,
      mes: r.competencia ? Number(r.competencia.slice(5, 7)) : undefined,
    }));
  }, [valoresQ.data, linhasQ.data, ccsQ.data, contasQ.data]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (cicloId !== "todos" && r.ciclo_id !== cicloId) return false;
      if (filtroOrigem !== "todos" && r.origem !== filtroOrigem) return false;
      if (filtroMes !== "todos" && r.mes !== Number(filtroMes)) return false;
      if (filtroLinha && !((r.linha_codigo ?? "") + " " + (r.linha_descricao ?? "")).toLowerCase().includes(filtroLinha.toLowerCase())) return false;
      if (filtroCC && !((r.cc_codigo ?? "") + " " + (r.cc_nome ?? "")).toLowerCase().includes(filtroCC.toLowerCase())) return false;
      if (filtroConta && !((r.conta_codigo ?? "") + " " + (r.conta_desc ?? "")).toLowerCase().includes(filtroConta.toLowerCase())) return false;
      return true;
    }).sort((a, b) => (a.linha_codigo ?? "").localeCompare(b.linha_codigo ?? "") || (a.mes ?? 0) - (b.mes ?? 0));
  }, [rows, cicloId, filtroOrigem, filtroLinha, filtroCC, filtroConta, filtroMes]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); setSelected(new Set()); }, [filtroLinha, filtroCC, filtroConta, filtroMes, cicloId, filtroOrigem, empresaId, ano]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(dirty);
      for (const [id, patch] of updates) {
        const { error } = await (supabase as any).from("orcamento_contrato_linha").update(patch).eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Orçamento salvo", description: `${Object.keys(dirty).length} linha(s) atualizada(s).` });
      setDirty({});
      qc.invalidateQueries({ queryKey: ["orc-linhas", empresaId, ano] });
    },
    onError: (e: any) => toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await (supabase as any).from("orcamento_contrato_linha").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_d, ids) => {
      toast({ title: "Linhas excluídas", description: `${ids.length} linha(s) removida(s).` });
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["orc-linhas", empresaId, ano] });
    },
    onError: (e: any) => toast({ title: "Erro ao excluir", description: e.message, variant: "destructive" }),
  });

  const totalGeral = useMemo(
    () => filtered.reduce((s, r) => s + Number(dirty[r.id]?.valor_previsto ?? r.valor_previsto ?? 0), 0),
    [filtered, dirty]
  );

  const handleExcluirSelecionadas = () => {
    const ids = Array.from(selected);
    const naoManual = ids.filter((id) => rows.find((r) => r.id === id)?.origem !== "manual");
    if (naoManual.length) {
      toast({ title: "Bloqueado", description: "Apenas linhas manuais podem ser excluídas. Desmarque as linhas de contrato.", variant: "destructive" });
      return;
    }
    if (!confirm(`Excluir ${ids.length} linha(s)?`)) return;
    deleteMut.mutate(ids);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        module="Controladoria & Orçamento"
        breadcrumb={["Controladoria", "Orçamento Completo"]}
        title="Orçamento Completo — Edição"
        subtitle="Visualize, edite, insira e exclua linhas do orçamento. Permissão de edição: Presidência, Controladoria e Admin."
        actions={
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <>
                <Button variant="outline" onClick={() => setOpenCiclo(true)}>
                  <FolderPlus className="mr-2 h-4 w-4" /> Novo Ciclo
                </Button>
                <Button variant="outline" onClick={() => setOpenCopiar(true)}>
                  <Copy className="mr-2 h-4 w-4" /> Copiar Ano
                </Button>
                <Button variant="outline" onClick={() => setOpenNova(true)} disabled={!empresaId}>
                  <Plus className="mr-2 h-4 w-4" /> Nova Linha
                </Button>
              </>
            )}
            <Button variant="outline" disabled={!Object.keys(dirty).length} onClick={() => setDirty({})}>
              <RotateCcw className="mr-2 h-4 w-4" /> Descartar
            </Button>
            <Button disabled={!canEdit || !Object.keys(dirty).length || saveMut.isPending} onClick={() => saveMut.mutate()}>
              <Save className="mr-2 h-4 w-4" /> Salvar {Object.keys(dirty).length > 0 && `(${Object.keys(dirty).length})`}
            </Button>
          </div>
        }
      />

      {!canEdit && (
        <div className="card-elevated flex items-center gap-2 border-l-4 border-warning p-3 text-sm">
          <Lock className="h-4 w-4 text-warning" />
          Você está em modo somente leitura. Apenas Presidência, Controladoria e Admin podem editar.
        </div>
      )}

      <div className="card-elevated grid gap-3 p-4 md:grid-cols-8">
        <div className="md:col-span-2">
          <Label>Empresa</Label>
          <Select value={empresaId} onValueChange={setEmpresaId}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {(empresasQ.data ?? []).map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.codigo} — {e.razao_social}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Ano</Label>
          <Input type="number" value={ano} onChange={(e) => setAno(Number(e.target.value) || new Date().getFullYear())} />
        </div>
        <div className="md:col-span-2">
          <Label>Ciclo</Label>
          <Select value={cicloId} onValueChange={setCicloId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os ciclos</SelectItem>
              {(ciclosQ.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.nome} [{c.status}]</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Origem</Label>
          <Select value={filtroOrigem} onValueChange={setFiltroOrigem}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas</SelectItem>
              <SelectItem value="contrato">Contrato</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Mês</Label>
          <Select value={filtroMes} onValueChange={setFiltroMes}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {MESES.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-3">
          <Label>Filtrar Linha DRE</Label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={filtroLinha} onChange={(e) => setFiltroLinha(e.target.value)} placeholder="Código ou descrição" className="pl-8" />
          </div>
        </div>
        <div className="md:col-span-3">
          <Label>Filtrar Centro de Custo</Label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={filtroCC} onChange={(e) => setFiltroCC(e.target.value)} placeholder="Código ou nome" className="pl-8" />
          </div>
        </div>
        <div className="md:col-span-2">
          <Label>Filtrar Conta Contábil</Label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={filtroConta} onChange={(e) => setFiltroConta(e.target.value)} placeholder="Código ou descrição" className="pl-8" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="card-elevated p-4">
          <p className="text-xs uppercase text-muted-foreground">Linhas filtradas</p>
          <p className="font-display text-2xl font-bold">{filtered.length.toLocaleString("pt-BR")}</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-xs uppercase text-muted-foreground">Total (filtro atual)</p>
          <p className={`font-display text-2xl font-bold ${totalGeral < 0 ? "text-destructive" : ""}`}>{fmt(totalGeral)}</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-xs uppercase text-muted-foreground">Alterações pendentes</p>
          <p className="font-display text-2xl font-bold text-info">{Object.keys(dirty).length}</p>
        </div>
        <div className="card-elevated p-4 flex flex-col gap-1">
          <p className="text-xs uppercase text-muted-foreground">Selecionadas ({selected.size})</p>
          <Button
            size="sm"
            variant="destructive"
            disabled={!canEdit || selected.size === 0 || deleteMut.isPending}
            onClick={handleExcluirSelecionadas}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Excluir selecionadas
          </Button>
        </div>
      </div>

      <div className="card-elevated overflow-auto">
        <table className="w-full min-w-[1400px] text-sm">
          <thead className="sticky top-0 bg-muted/70 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-2 w-8">
                <Checkbox
                  checked={pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))}
                  onCheckedChange={(v) => {
                    const next = new Set(selected);
                    pageRows.forEach((r) => { if (v) next.add(r.id); else next.delete(r.id); });
                    setSelected(next);
                  }}
                />
              </th>
              <th className="px-2 py-2 text-left w-20">Origem</th>
              <th className="px-3 py-2 text-left">Linha DRE</th>
              <th className="px-3 py-2 text-left">Centro de Custo</th>
              <th className="px-3 py-2 text-left">Conta Contábil</th>
              <th className="px-3 py-2 text-center w-24">Mês</th>
              <th className="px-3 py-2 text-right w-36">Valor (R$)</th>
              <th className="px-3 py-2 text-left">Memória de cálculo</th>
              <th className="px-2 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {valoresQ.isLoading && (
              <tr><td colSpan={9} className="py-10 text-center text-muted-foreground">Carregando…</td></tr>
            )}
            {!valoresQ.isLoading && filtered.length === 0 && (
              <tr><td colSpan={9} className="py-10 text-center text-muted-foreground">
                Nenhuma linha encontrada com os filtros aplicados.
              </td></tr>
            )}
            {pageRows.map((r) => {
              const patch = dirty[r.id] ?? {};
              const valor = patch.valor_previsto ?? Number(r.valor_previsto);
              const cc = patch.centro_custo_id ?? r.centro_custo_id;
              const linha = patch.dre_linha_id ?? r.dre_linha_id;
              const conta = patch.conta_contabil_id ?? r.conta_contabil_id;
              const mes = patch.competencia ? Number(patch.competencia.slice(5, 7)) : (r.mes ?? 1);
              const memo = patch.memoria_calculo ?? r.memoria_calculo ?? "";
              const isDirty = !!dirty[r.id];
              const isManual = r.origem === "manual";
              const setPatch = (p: Patch) => setDirty((d) => ({ ...d, [r.id]: { ...d[r.id], ...p } }));
              return (
                <tr key={r.id} className={`border-t border-border/60 ${isDirty ? "bg-warning/5" : ""}`}>
                  <td className="px-2 py-2">
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={(v) => {
                        const next = new Set(selected);
                        if (v) next.add(r.id); else next.delete(r.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Badge variant={isManual ? "default" : "outline"} className="text-[10px]">
                      {isManual ? "Manual" : "Contrato"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 min-w-[260px]">
                    {canEdit ? (
                      <Select value={linha} onValueChange={(v) => setPatch({ dre_linha_id: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {(linhasQ.data ?? []).map((l) => (
                            <SelectItem key={l.id} value={l.id}>{l.codigo} — {l.descricao}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <>
                        <div className="font-mono text-xs text-primary">{r.linha_codigo}</div>
                        <div>{r.linha_descricao}</div>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 min-w-[220px]">
                    {canEdit ? (
                      <Select
                        value={cc ?? "__none__"}
                        onValueChange={(v) => setPatch({ centro_custo_id: v === "__none__" ? null : v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          <SelectItem value="__none__">— Sem CC —</SelectItem>
                          {(ccsQ.data ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.codigo} — {c.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs">{r.cc_codigo ? `${r.cc_codigo} — ${r.cc_nome}` : "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 min-w-[220px]">
                    {canEdit ? (
                      <Select
                        value={conta ?? "__none__"}
                        onValueChange={(v) => setPatch({ conta_contabil_id: v === "__none__" ? null : v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          <SelectItem value="__none__">— Sem conta —</SelectItem>
                          {(contasQ.data ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.conta_reduzida} — {c.descricao}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs">{r.conta_codigo ? `${r.conta_codigo} — ${r.conta_desc}` : "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {canEdit ? (
                      <Select
                        value={String(mes)}
                        onValueChange={(v) => setPatch({ competencia: `${ano}-${String(v).padStart(2, "0")}-01` })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {MESES.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline">{r.mes ? MESES[r.mes - 1] : "—"}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canEdit ? (
                      <Input
                        type="number"
                        step="0.01"
                        value={valor}
                        onChange={(e) => setPatch({ valor_previsto: Number(e.target.value) })}
                        className="h-8 text-right tabular-nums"
                      />
                    ) : (
                      <span className={`tabular-nums ${valor < 0 ? "text-destructive" : ""}`}>{fmt(valor)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <Input
                        value={memo}
                        onChange={(e) => setPatch({ memoria_calculo: e.target.value })}
                        className="h-8 text-xs"
                        placeholder="Ex.: 12 × R$ 5.000 (folha)"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">{memo || "—"}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {canEdit && isManual && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Excluir linha"
                        onClick={() => {
                          if (!confirm("Excluir esta linha?")) return;
                          deleteMut.mutate([r.id]);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Página {page + 1} de {pageCount} — exibindo {pageRows.length} de {filtered.length.toLocaleString("pt-BR")} linhas ({PAGE_SIZE}/página)
        </span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
          <Button size="sm" variant="outline" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>
            Próxima <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <NovaLinhaDialog
        open={openNova}
        onOpenChange={setOpenNova}
        empresaId={empresaId!}
        ano={ano}
        linhas={linhasQ.data ?? []}
        ccs={ccsQ.data ?? []}
        contas={contasQ.data ?? []}
        ciclos={ciclosQ.data ?? []}
        onSaved={() => qc.invalidateQueries({ queryKey: ["orc-linhas", empresaId, ano] })}
      />
      <CopiarAnoDialog
        open={openCopiar}
        onOpenChange={setOpenCopiar}
        empresaId={empresaId!}
        anoAtual={ano}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["orc-linhas", empresaId, ano] });
          qc.invalidateQueries({ queryKey: ["ciclos-orc", empresaId, ano] });
        }}
      />
      <NovoCicloDialog
        open={openCiclo}
        onOpenChange={setOpenCiclo}
        empresaId={empresaId!}
        ano={ano}
        onSaved={() => qc.invalidateQueries({ queryKey: ["ciclos-orc", empresaId, ano] })}
      />
    </div>
  );
}

// ───────────────────────── Dialogs ─────────────────────────

function NovaLinhaDialog({
  open, onOpenChange, empresaId, ano, linhas, ccs, contas, ciclos, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  empresaId: string; ano: number;
  linhas: any[]; ccs: any[]; contas: any[]; ciclos: any[];
  onSaved: () => void;
}) {
  const [linhaId, setLinhaId] = useState<string>("");
  const [ccId, setCcId] = useState<string>("");
  const [contaId, setContaId] = useState<string>("");
  const [cicloId, setCicloId] = useState<string>("");
  const [mes, setMes] = useState<string>("1");
  const [valor, setValor] = useState<string>("0");
  const [memo, setMemo] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!linhaId) { toast({ title: "Selecione a Linha DRE", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("orcamento_contrato_linha").insert({
        empresa_id: empresaId,
        dre_linha_id: linhaId,
        centro_custo_id: ccId || null,
        conta_contabil_id: contaId || null,
        ciclo_id: cicloId || null,
        competencia: `${ano}-${mes.padStart(2, "0")}-01`,
        valor_previsto: Number(valor) || 0,
        memoria_calculo: memo || null,
        origem: "manual",
        source: "manual",
        locked: false,
        orcamento_contrato_id: null,
      });
      if (error) throw error;
      toast({ title: "Linha criada" });
      onSaved();
      onOpenChange(false);
      setLinhaId(""); setCcId(""); setContaId(""); setCicloId(""); setMes("1"); setValor("0"); setMemo("");
    } catch (e: any) {
      toast({ title: "Erro ao criar", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova linha manual</DialogTitle>
          <DialogDescription>Adiciona uma linha orçamentária sem vínculo com contrato.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Linha DRE *</Label>
            <Select value={linhaId} onValueChange={setLinhaId}>
              <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {linhas.map((l) => <SelectItem key={l.id} value={l.id}>{l.codigo} — {l.descricao}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Centro de Custo</Label>
            <Select value={ccId} onValueChange={setCcId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {ccs.map((c) => <SelectItem key={c.id} value={c.id}>{c.codigo} — {c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Conta Contábil</Label>
            <Select value={contaId} onValueChange={setContaId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {contas.map((c) => <SelectItem key={c.id} value={c.id}>{c.conta_reduzida} — {c.descricao}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Ciclo</Label>
            <Select value={cicloId} onValueChange={setCicloId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {ciclos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Mês</Label>
            <Select value={mes} onValueChange={setMes}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MESES.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}/{ano}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Valor (R$)</Label>
            <Input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Memória de cálculo</Label>
            <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Ex.: 12 × R$ 5.000 (folha)" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>Criar linha</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopiarAnoDialog({
  open, onOpenChange, empresaId, anoAtual, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  empresaId: string; anoAtual: number; onSaved: () => void;
}) {
  const [anoOrigem, setAnoOrigem] = useState<number>(anoAtual - 1);
  const [anoDestino, setAnoDestino] = useState<number>(anoAtual);
  const [reajuste, setReajuste] = useState<string>("0");
  const [nome, setNome] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("orcamento_copiar_ano", {
        p_empresa_id: empresaId,
        p_ano_origem: anoOrigem,
        p_ano_destino: anoDestino,
        p_reajuste_pct: Number(reajuste) || 0,
        p_nome_ciclo: nome || null,
      });
      if (error) throw error;
      toast({ title: "Cópia concluída", description: `Ciclo ${anoDestino} criado a partir de ${anoOrigem}.` });
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Erro ao copiar", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Copiar orçamento de ano</DialogTitle>
          <DialogDescription>
            Cria um novo ciclo no ano destino, duplicando todas as linhas do ano origem como linhas manuais editáveis,
            com reajuste percentual opcional.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Ano origem</Label>
            <Input type="number" value={anoOrigem} onChange={(e) => setAnoOrigem(Number(e.target.value))} />
          </div>
          <div>
            <Label>Ano destino</Label>
            <Input type="number" value={anoDestino} onChange={(e) => setAnoDestino(Number(e.target.value))} />
          </div>
          <div>
            <Label>Reajuste (%)</Label>
            <Input type="number" step="0.01" value={reajuste} onChange={(e) => setReajuste(e.target.value)} />
          </div>
          <div>
            <Label>Nome do novo ciclo</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={`OBZ ${anoDestino} v1`} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>Copiar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NovoCicloDialog({
  open, onOpenChange, empresaId, ano, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  empresaId: string; ano: number; onSaved: () => void;
}) {
  const [nome, setNome] = useState<string>(`OBZ ${ano} v1`);
  const [anoLocal, setAnoLocal] = useState<number>(ano);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setAnoLocal(ano); setNome(`OBZ ${ano} v1`); }, [ano, open]);

  const submit = async () => {
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("orcamento_criar_ciclo", {
        p_empresa_id: empresaId, p_ano: anoLocal, p_nome: nome,
      });
      if (error) throw error;
      toast({ title: "Ciclo criado" });
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Erro ao criar ciclo", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo ciclo orçamentário</DialogTitle>
          <DialogDescription>Cria um ciclo (ex: OBZ 2027 v1) para organizar linhas do orçamento.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Ano</Label>
            <Input type="number" value={anoLocal} onChange={(e) => setAnoLocal(Number(e.target.value))} />
          </div>
          <div>
            <Label>Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>Criar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
