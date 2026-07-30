import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Download, Upload, Loader2, Save, Search } from "lucide-react";

type CC = {
  id: string;
  empresa_id: string;
  codigo: string;
  nome: string;
  gestor_user_id: string | null;
  ativo: boolean;
};
type Profile = { id: string; display_name: string | null; email: string | null; ativo: boolean };
type Empresa = { id: string; codigo: string; razao_social: string };

const PAGE_SIZE = 50;

export function GestoresCCPanel({ empresaId, podeGerenciar, empresa }: { empresaId: string; podeGerenciar: boolean; empresa?: Empresa }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<"todos" | "pendentes" | "definidos">("todos");
  const [dirty, setDirty] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const profilesQ = useQuery({
    queryKey: ["profiles-gestores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, email, ativo")
        .eq("ativo", true)
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });

  const ccsQ = useQuery({
    queryKey: ["centros-custo-gestor", empresaId, busca, status, page],
    enabled: !!empresaId,
    queryFn: async () => {
      let q = supabase
        .from("centros_custo")
        .select("id, empresa_id, codigo, nome, gestor_user_id, ativo", { count: "exact" })
        .eq("empresa_id", empresaId)
        .eq("ativo", true);
      if (status === "pendentes") q = q.is("gestor_user_id", null);
      if (status === "definidos") q = q.not("gestor_user_id", "is", null);
      if (busca.trim()) q = q.or(`codigo.ilike.%${busca}%,nome.ilike.%${busca}%`);
      q = q.order("codigo").range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as CC[], total: count ?? 0 };
    },
  });

  const profileMap = useMemo(() => {
    const m = new Map<string, Profile>();
    (profilesQ.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [profilesQ.data]);

  const emailMap = useMemo(() => {
    const m = new Map<string, Profile>();
    (profilesQ.data ?? []).forEach((p) => p.email && m.set(p.email.toLowerCase(), p));
    return m;
  }, [profilesQ.data]);

  const totalPages = Math.max(1, Math.ceil((ccsQ.data?.total ?? 0) / PAGE_SIZE));
  const pendentes = useMemo(() => (ccsQ.data?.rows ?? []).filter((c) => !c.gestor_user_id).length, [ccsQ.data]);

  const onSelectGestor = (ccId: string, val: string) => {
    setDirty((d) => ({ ...d, [ccId]: val === "__none__" ? null : val }));
  };

  const onSave = async (cc: CC) => {
    if (!(cc.id in dirty)) return;
    setSaving(cc.id);
    const novo = dirty[cc.id];
    const { error } = await supabase.from("centros_custo").update({ gestor_user_id: novo } as any).eq("id", cc.id);
    setSaving(null);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    setDirty((d) => {
      const n = { ...d };
      delete n[cc.id];
      return n;
    });
    qc.invalidateQueries({ queryKey: ["centros-custo-gestor", empresaId] });
    toast({ title: "Gestor atualizado", description: `${cc.codigo} — ${cc.nome}` });
  };

  const baixarModelo = async () => {
    if (!empresaId) return;
    const { data, error } = await supabase
      .from("centros_custo")
      .select("codigo, nome, gestor_user_id")
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .order("codigo");
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    const rows = (data ?? []).map((cc: any) => {
      const atual = cc.gestor_user_id ? profileMap.get(cc.gestor_user_id) : null;
      return {
        empresa_codigo: empresa?.codigo ?? "",
        cc_codigo: cc.codigo,
        cc_nome: cc.nome,
        gestor_email: "",
        gestor_atual: atual?.email ?? "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["empresa_codigo", "cc_codigo", "cc_nome", "gestor_email", "gestor_atual"],
    });
    ws["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 48 }, { wch: 32 }, { wch: 32 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gestores CC");
    XLSX.writeFile(wb, `gestores_cc_${empresa?.codigo ?? "empresa"}.xlsx`);
  };

  type ImportRow = {
    cc_codigo: string;
    cc_nome: string;
    gestor_email: string;
    gestor_atual_id: string | null;
    novo_user_id: string | null;
    cc_id: string | null;
    status: "ok" | "sem_alteracao" | "email_nao_encontrado" | "cc_nao_encontrado" | "limpar";
  };
  const [preview, setPreview] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);

  const onPickFile = async (f: File) => {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: null });

    const { data: ccs } = await supabase
      .from("centros_custo")
      .select("id, codigo, gestor_user_id")
      .eq("empresa_id", empresaId)
      .eq("ativo", true);
    const ccMap = new Map<string, { id: string; gestor_user_id: string | null }>();
    (ccs ?? []).forEach((c: any) => ccMap.set(String(c.codigo).trim(), { id: c.id, gestor_user_id: c.gestor_user_id }));

    const out: ImportRow[] = rows.map((r) => {
      const codigo = String(r.cc_codigo ?? "").trim();
      const email = String(r.gestor_email ?? "").trim().toLowerCase();
      const cc = ccMap.get(codigo);
      let novo: string | null = null;
      let st: ImportRow["status"];
      if (!cc) st = "cc_nao_encontrado";
      else if (!email) st = "limpar";
      else {
        const p = emailMap.get(email);
        if (!p) st = "email_nao_encontrado";
        else {
          novo = p.id;
          st = novo === cc.gestor_user_id ? "sem_alteracao" : "ok";
        }
      }
      return {
        cc_codigo: codigo,
        cc_nome: String(r.cc_nome ?? ""),
        gestor_email: email,
        gestor_atual_id: cc?.gestor_user_id ?? null,
        novo_user_id: novo,
        cc_id: cc?.id ?? null,
        status: st,
      };
    });
    setPreview(out);
    setImportOpen(true);
  };

  const aplicarImport = async () => {
    const aplicaveis = preview.filter((r) => r.cc_id && (r.status === "ok" || r.status === "limpar"));
    if (!aplicaveis.length) {
      toast({ title: "Nada a aplicar" });
      return;
    }
    setImporting(true);
    let ok = 0, fail = 0;
    for (const r of aplicaveis) {
      const { error } = await supabase
        .from("centros_custo")
        .update({ gestor_user_id: r.novo_user_id } as any)
        .eq("id", r.cc_id!);
      if (error) fail++;
      else ok++;
    }
    setImporting(false);
    setImportOpen(false);
    setPreview([]);
    if (fileRef.current) fileRef.current.value = "";
    qc.invalidateQueries({ queryKey: ["centros-custo-gestor", empresaId] });
    toast({ title: "Importação concluída", description: `${ok} aplicados, ${fail} erros.` });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Gestores de Centro de Custo</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Define o aprovador das requisições de compra por CC. Quando não houver gestor, a aprovação cai automaticamente para o diretor da empresa.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={baixarModelo} disabled={!empresaId}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Baixar modelo
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(f);
              }}
            />
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={!podeGerenciar || !empresaId}>
              <Upload className="h-3.5 w-3.5 mr-1.5" /> Importar planilha
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar por código ou nome"
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setPage(0); }}
            className="h-9 w-72 pl-8 text-xs"
          />
        </div>
        <Select value={status} onValueChange={(v: any) => { setStatus(v); setPage(0); }}>
          <SelectTrigger className="h-9 w-48 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="pendentes">Sem gestor</SelectItem>
            <SelectItem value="definidos">Com gestor</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline" className="ml-auto">
          {ccsQ.data?.total ?? 0} CCs • {pendentes} pendentes nesta página
        </Badge>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Código</TableHead>
              <TableHead>Centro de custo</TableHead>
              <TableHead className="w-[340px]">Gestor</TableHead>
              <TableHead className="w-32"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ccsQ.isLoading && (
              <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando…</TableCell></TableRow>
            )}
            {!ccsQ.isLoading && (ccsQ.data?.rows ?? []).length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-8">Nenhum CC encontrado.</TableCell></TableRow>
            )}
            {(ccsQ.data?.rows ?? []).map((cc) => {
              const current = cc.id in dirty ? dirty[cc.id] : cc.gestor_user_id;
              const isDirty = cc.id in dirty;
              return (
                <TableRow key={cc.id}>
                  <TableCell className="font-mono text-xs">{cc.codigo}</TableCell>
                  <TableCell className="text-xs">
                    <div className="font-medium">{cc.nome}</div>
                    {!cc.gestor_user_id && <Badge variant="outline" className="mt-1 border-amber-400 text-amber-700 bg-amber-50">Sem gestor — usa fallback diretor</Badge>}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={current ?? "__none__"}
                      onValueChange={(v) => onSelectGestor(cc.id, v)}
                      disabled={!podeGerenciar}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar gestor" /></SelectTrigger>
                      <SelectContent className="max-h-80">
                        <SelectItem value="__none__">— Sem gestor (usar fallback) —</SelectItem>
                        {(profilesQ.data ?? []).map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.display_name || p.email || p.id} {p.email ? `· ${p.email}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant={isDirty ? "default" : "outline"}
                      disabled={!isDirty || saving === cc.id}
                      onClick={() => onSave(cc)}
                    >
                      {saving === cc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Save className="h-3.5 w-3.5 mr-1.5" />Salvar</>}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Página {page + 1} de {totalPages}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>Anterior</Button>
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page + 1 >= totalPages}>Próxima</Button>
        </div>
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Pré-visualização da importação</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Código</TableHead>
                  <TableHead>CC</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-44">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.cc_codigo}</TableCell>
                    <TableCell className="text-xs">{r.cc_nome}</TableCell>
                    <TableCell className="text-xs">{r.gestor_email || <span className="text-muted-foreground">(vazio)</span>}</TableCell>
                    <TableCell>
                      {r.status === "ok" && <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">Atualizar</Badge>}
                      {r.status === "sem_alteracao" && <Badge variant="outline">Sem alteração</Badge>}
                      {r.status === "limpar" && <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50">Limpar gestor</Badge>}
                      {r.status === "email_nao_encontrado" && <Badge variant="destructive">Email não cadastrado</Badge>}
                      {r.status === "cc_nao_encontrado" && <Badge variant="destructive">CC não encontrado</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="text-xs text-muted-foreground">
            {preview.filter((r) => r.status === "ok").length} atualizações •{" "}
            {preview.filter((r) => r.status === "limpar").length} limpezas •{" "}
            {preview.filter((r) => r.status === "email_nao_encontrado" || r.status === "cc_nao_encontrado").length} ignorados
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>Cancelar</Button>
            <Button onClick={aplicarImport} disabled={importing}>
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Aplicar alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
