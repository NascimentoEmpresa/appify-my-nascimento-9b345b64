import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  Upload, Plus, Filter, RotateCcw, ArrowDownLeft, ArrowUpRight,
  ArrowLeftRight, Banknote, Repeat, AlertCircle, MoreHorizontal,
  CheckCircle2, Wallet,
} from "lucide-react";

const fmtBRL = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d?: string) =>
  d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("pt-BR") : "—";
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

type Mov = {
  id: string;
  empresa_id: string;
  conta_bancaria_id: string;
  data_movimento: string;
  data_lancamento?: string;
  tipo: string; // C / D
  valor: number;
  descricao?: string;
  documento?: string;
  contraparte_nome?: string;
  origem?: string;
  status_conciliacao?: string;
  titulo_pagar_id?: string;
  titulo_receber_id?: string;
};

type TipoFiltro = "todos" | "entrada" | "saida" | "transferencia" | "recebimento" | "amortizacao" | "nao_conferidos";

const TIPO_LABEL: Record<string, { label: string; tone: string; icon: any }> = {
  entrada: { label: "Entrada", tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", icon: ArrowDownLeft },
  saida: { label: "Saída", tone: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300", icon: ArrowUpRight },
  transferencia: { label: "Transferência", tone: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300", icon: ArrowLeftRight },
  recebimento: { label: "Recebimento", tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", icon: Banknote },
  amortizacao: { label: "Amortização", tone: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", icon: Repeat },
};

function classificar(m: Mov): keyof typeof TIPO_LABEL {
  const desc = (m.descricao ?? "").toLowerCase();
  const orig = (m.origem ?? "").toLowerCase();
  if (orig.includes("transfer") || desc.includes("transferência") || desc.includes("transferencia")) return "transferencia";
  if (orig.includes("amort") || desc.includes("amortiz")) return "amortizacao";
  if (m.titulo_receber_id || orig.includes("receb")) return "recebimento";
  if (m.tipo === "C" || String(m.tipo).toLowerCase() === "credito") return "entrada";
  return "saida";
}

export default function ConciliacaoFluxoCaixa() {
  const qc = useQueryClient();
  const hoje = new Date();
  const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const [dataIni, setDataIni] = useState(isoDate(ini));
  const [dataFim, setDataFim] = useState(isoDate(hoje));
  const [empresaId, setEmpresaId] = useState<string>("");
  const [contaId, setContaId] = useState<string>("todas");
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>("todos");
  const [statusFiltro, setStatusFiltro] = useState<string>("todos");
  const [openImport, setOpenImport] = useState(false);

  const empresasQ = useQuery({
    queryKey: ["conc-empresas"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("empresas")
        .select("id, codigo, razao_social")
        .eq("ativa", true)
        .order("codigo");
      return (data ?? []) as Array<{ id: string; codigo: string; razao_social: string }>;
    },
  });

  useEffect(() => {
    if (!empresaId && empresasQ.data?.length) {
      setEmpresaId(empresasQ.data.find((e) => e.codigo === "HAGG")?.id ?? empresasQ.data[0].id);
    }
  }, [empresasQ.data, empresaId]);

  const contasQ = useQuery({
    queryKey: ["conc-contas", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("conta_bancaria")
        .select("id, banco_codigo, banco_nome, agencia, conta")
        .eq("empresa_id", empresaId)
        .eq("ativa", true);
      return (data ?? []) as Array<{ id: string; banco_codigo: string; banco_nome: string; agencia: string; conta: string }>;
    },
  });

  const movimentosQ = useQuery({
    queryKey: ["conc-movimentos", empresaId, dataIni, dataFim, contaId],
    enabled: !!empresaId,
    queryFn: async () => {
      let q = (supabase as any)
        .from("movimento_bancario")
        .select("id, empresa_id, conta_bancaria_id, data_movimento, data_lancamento, tipo, valor, descricao, documento, contraparte_nome, origem, status_conciliacao, titulo_pagar_id, titulo_receber_id")
        .eq("empresa_id", empresaId)
        .gte("data_movimento", dataIni)
        .lte("data_movimento", dataFim)
        .order("data_movimento", { ascending: false });
      if (contaId !== "todas") q = q.eq("conta_bancaria_id", contaId);
      const { data } = await q;
      return (data ?? []) as Mov[];
    },
  });

  const movs = movimentosQ.data ?? [];

  const enriched = useMemo(() =>
    movs.map((m) => ({ ...m, _cat: classificar(m), _signed: (m.tipo === "C" ? 1 : -1) * Math.abs(Number(m.valor || 0)) })),
    [movs]
  );

  const filtered = useMemo(() => {
    return enriched.filter((m) => {
      if (tipoFiltro !== "todos") {
        if (tipoFiltro === "nao_conferidos") {
          if ((m.status_conciliacao ?? "pendente") === "conciliado") return false;
        } else if (m._cat !== tipoFiltro) return false;
      }
      if (statusFiltro !== "todos" && (m.status_conciliacao ?? "pendente") !== statusFiltro) return false;
      return true;
    });
  }, [enriched, tipoFiltro, statusFiltro]);

  // KPIs
  const kpis = useMemo(() => {
    const out = { saldo: 0, entradas: 0, saidas: 0, transf: 0, receber: 0, amort: 0, ce: 0, cs: 0, ct: 0, cr: 0, ca: 0 };
    enriched.forEach((m) => {
      if (m._cat === "entrada") { out.entradas += Math.abs(m._signed); out.ce++; }
      else if (m._cat === "saida") { out.saidas += Math.abs(m._signed); out.cs++; }
      else if (m._cat === "transferencia") { out.transf += Math.abs(m._signed); out.ct++; }
      else if (m._cat === "recebimento") { out.receber += Math.abs(m._signed); out.cr++; }
      else if (m._cat === "amortizacao") { out.amort += Math.abs(m._signed); out.ca++; }
      out.saldo += m._signed;
    });
    return out;
  }, [enriched]);

  const counts = useMemo(() => {
    const c = { todos: enriched.length, entrada: 0, saida: 0, transferencia: 0, recebimento: 0, amortizacao: 0, nao_conferidos: 0 };
    enriched.forEach((m) => {
      (c as any)[m._cat]++;
      if ((m.status_conciliacao ?? "pendente") !== "conciliado") c.nao_conferidos++;
    });
    return c;
  }, [enriched]);

  const limpar = () => { setTipoFiltro("todos"); setStatusFiltro("todos"); setContaId("todas"); };

  return (
    <div className="space-y-5">
      <PageHeader
        module="Financeiro"
        breadcrumb={["Financeiro", "Fluxo de Caixa", "Conciliação Bancária"]}
        title="Conciliação Bancária — Fluxo de Caixa"
        subtitle="Controle diário de entradas, saídas, transferências, recebimentos e amortizações"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setOpenImport(true)}>
              <Upload className="mr-2 h-4 w-4" /> Importar Extrato
            </Button>
            <Button variant="outline">
              <Wallet className="mr-2 h-4 w-4" /> Exportar
            </Button>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Novo Lançamento
            </Button>
          </div>
        }
      />

      {/* KPIs Hero */}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          title="SALDO DO PERÍODO"
          value={fmtBRL(kpis.saldo)}
          accent="bg-amber-500"
          sub={kpis.saldo >= 0 ? "Positivo" : "Negativo"}
          tone={kpis.saldo >= 0 ? "text-emerald-600" : "text-red-600"}
          extra={`${enriched.length} lançamentos`}
        />
        <KpiCard title="ENTRADAS" value={fmtBRL(kpis.entradas)} accent="bg-emerald-500" extra={`${kpis.ce} lançamentos`} />
        <KpiCard title="SAÍDAS" value={fmtBRL(kpis.saidas)} accent="bg-red-500" extra={`${kpis.cs} lançamentos`} />
        <KpiCard title="TRANSFERÊNCIAS" value={fmtBRL(kpis.transf)} accent="bg-blue-500" extra={`${kpis.ct} lançamentos`} />
        <KpiCard title="A RECEBER" value={fmtBRL(kpis.receber)} accent="bg-violet-500" extra={`${kpis.cr} títulos`} />
        <KpiCard title="AMORTIZAÇÕES" value={fmtBRL(kpis.amort)} accent="bg-orange-500" extra={`${kpis.ca} lançamentos`} />
      </div>

      {/* Filtros */}
      <Card className="grid gap-3 p-4 md:grid-cols-2 lg:grid-cols-6">
        <div>
          <Label className="text-xs">Empresa</Label>
          <Select value={empresaId} onValueChange={setEmpresaId}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {(empresasQ.data ?? []).map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.codigo} — {e.razao_social}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Data Inicial</Label>
          <Input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Data Final</Label>
          <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Banco / Conta</Label>
          <Select value={contaId} onValueChange={setContaId}>
            <SelectTrigger><SelectValue placeholder="Todos os bancos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos os bancos</SelectItem>
              {(contasQ.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.banco_nome ?? c.banco_codigo} · Ag {c.agencia} · {c.conta}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status Conferência</Label>
          <Select value={statusFiltro} onValueChange={setStatusFiltro}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="conciliado">Conferido</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="divergente">Divergente</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <Button className="flex-1" onClick={() => qc.invalidateQueries({ queryKey: ["conc-movimentos"] })}>
            <Filter className="mr-2 h-4 w-4" /> Filtrar
          </Button>
          <Button variant="outline" onClick={limpar} title="Limpar filtros">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex flex-wrap gap-1 overflow-x-auto">
          {([
            ["todos", "Todos"],
            ["entrada", "Entradas"],
            ["saida", "Saídas"],
            ["transferencia", "Transferências"],
            ["recebimento", "Recebimentos"],
            ["amortizacao", "Amortizações"],
            ["nao_conferidos", "Não Conferidos"],
          ] as [TipoFiltro, string][]).map(([k, label]) => {
            const active = tipoFiltro === k;
            const n = (counts as any)[k] ?? 0;
            return (
              <button
                key={k}
                onClick={() => setTipoFiltro(k)}
                className={`relative px-4 py-2.5 text-sm font-medium transition ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label} <span className="ml-1 text-xs opacity-70">({n})</span>
                {active && <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-primary" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tabela */}
      <Card className="overflow-hidden">
        {movimentosQ.isLoading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground/60" />
            <p className="font-medium">Sem lançamentos no período</p>
            <p className="text-xs text-muted-foreground">
              Importe um extrato bancário ou crie um novo lançamento.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Data</th>
                  <th className="px-4 py-3 text-left">Competência</th>
                  <th className="px-4 py-3 text-left">Banco</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Histórico</th>
                  <th className="px-4 py-3 text-left">Origem</th>
                  <th className="px-4 py-3 text-left">Documento</th>
                  <th className="px-4 py-3 text-right">Valor (R$)</th>
                  <th className="px-4 py-3 text-center">Status Conf.</th>
                  <th className="px-4 py-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((m) => {
                  const cat = TIPO_LABEL[m._cat];
                  const Icon = cat.icon;
                  const conta = contasQ.data?.find((c) => c.id === m.conta_bancaria_id);
                  const status = m.status_conciliacao ?? "pendente";
                  return (
                    <tr key={m.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 whitespace-nowrap">{fmtDate(m.data_movimento)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {m.data_movimento ? new Date(m.data_movimento + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" }) : "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-[9px] font-bold text-primary">
                            {(conta?.banco_codigo ?? "?").slice(0, 3)}
                          </span>
                          {conta?.banco_nome ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium ${cat.tone}`}>
                          <Icon className="h-3 w-3" /> {cat.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs truncate" title={m.descricao}>{m.descricao ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{m.origem ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{m.documento ?? "—"}</td>
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${
                        m._signed >= 0 ? "text-emerald-600" : "text-red-600"
                      }`}>
                        {(m._signed >= 0 ? "" : "-")}{fmtNum(Math.abs(m._signed))}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge
                          variant={status === "conciliado" ? "default" : status === "divergente" ? "destructive" : "secondary"}
                          className="capitalize"
                        >
                          {status === "conciliado" ? "Conferido" : status === "divergente" ? "Divergente" : "Pendente"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted">
                          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <span>Mostrando {filtered.length} de {enriched.length} lançamentos</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-600" /> Conferência atualizada agora</span>
            </div>
          </div>
        )}
      </Card>

      <ImportarExtratoDialog
        open={openImport}
        onOpenChange={setOpenImport}
        empresaId={empresaId}
        contas={contasQ.data ?? []}
        onImported={() => qc.invalidateQueries({ queryKey: ["conc-movimentos"] })}
      />
    </div>
  );
}

function KpiCard({
  title, value, accent, sub, tone, extra,
}: { title: string; value: string; accent: string; sub?: string; tone?: string; extra?: string }) {
  return (
    <Card className="relative overflow-hidden p-4">
      <div className={`absolute left-0 top-0 h-full w-1 ${accent}`} />
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className={`text-xs font-medium ${tone ?? ""}`}>{sub}</p>}
      {extra && <p className="mt-1 text-[11px] text-muted-foreground">{extra}</p>}
    </Card>
  );
}

function ImportarExtratoDialog({
  open, onOpenChange, empresaId, contas, onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  empresaId: string;
  contas: Array<{ id: string; banco_codigo: string; banco_nome: string; agencia: string; conta: string }>;
  onImported: () => void;
}) {
  const [contaBancariaId, setContaBancariaId] = useState<string>("");
  const [formato, setFormato] = useState<"ofx" | "csv">("ofx");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previewLines, setPreviewLines] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && contas[0] && !contaBancariaId) setContaBancariaId(contas[0].id);
  }, [open, contas, contaBancariaId]);

  const handleFile = async (f: File | null) => {
    setArquivo(f);
    if (!f) { setPreviewLines([]); return; }
    const text = await f.text();
    setPreviewLines(text.split("\n").slice(0, 5));
    if (f.name.toLowerCase().endsWith(".ofx")) setFormato("ofx");
    else if (f.name.toLowerCase().endsWith(".csv")) setFormato("csv");
  };

  const parseCsv = (text: string) => {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const sep = lines[0].includes(";") ? ";" : ",";
    return lines.slice(1).map((line) => {
      const cols = line.split(sep).map((c) => c.replace(/^"|"$/g, "").trim());
      // Heurística: data, descrição, valor
      const data = cols[0];
      const desc = cols[1] ?? "";
      const valorStr = (cols[cols.length - 1] ?? "0").replace(/\./g, "").replace(",", ".");
      const valor = parseFloat(valorStr);
      const dataIso = data?.includes("/")
        ? data.split("/").reverse().join("-")
        : data;
      return { data_movimento: dataIso, descricao: desc, valor: Math.abs(valor), tipo: valor >= 0 ? "C" : "D" };
    }).filter((r) => r.data_movimento && !isNaN(r.valor));
  };

  const parseOfx = (text: string) => {
    const tx: any[] = [];
    const re = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const block = m[1];
      const get = (tag: string) => {
        const r = new RegExp(`<${tag}>([^<\r\n]*)`).exec(block);
        return r?.[1]?.trim();
      };
      const dt = get("DTPOSTED") ?? "";
      const dataIso = dt ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : "";
      // SIS-2026-0344: mesmo bug do ConciliacaoBancaria.tsx — bancos como o
      // Bradesco exportam TRNAMT em formato BR (vírgula decimal, "10000,00"),
      // e parseFloat direto trunca na vírgula ("0,06" virava 0).
      const trnamt = get("TRNAMT") ?? "0";
      const valor = trnamt.includes(",") ? parseFloat(trnamt.replace(/\./g, "").replace(",", ".")) : parseFloat(trnamt);
      tx.push({
        data_movimento: dataIso,
        descricao: get("MEMO") ?? get("NAME") ?? "",
        documento: get("FITID") ?? "",
        valor: Math.abs(valor),
        tipo: valor >= 0 ? "C" : "D",
      });
    }
    return tx;
  };

  const importar = async () => {
    if (!arquivo || !contaBancariaId || !empresaId) {
      toast({ title: "Selecione conta e arquivo", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      const text = await arquivo.text();
      const rows = formato === "ofx" ? parseOfx(text) : parseCsv(text);
      if (rows.length === 0) {
        toast({ title: "Nenhum lançamento detectado", description: "Verifique o formato do arquivo.", variant: "destructive" });
        setImporting(false);
        return;
      }
      const payload = rows.map((r) => ({
        empresa_id: empresaId,
        conta_bancaria_id: contaBancariaId,
        data_movimento: r.data_movimento,
        valor: r.valor,
        tipo: r.tipo,
        descricao: r.descricao,
        documento: r.documento,
        origem: `Importação ${formato.toUpperCase()}`,
        status_conciliacao: "pendente",
      }));
      // Insert em lotes de 100
      for (let i = 0; i < payload.length; i += 100) {
        const { error } = await (supabase as any).from("movimento_bancario").insert(payload.slice(i, i + 100));
        if (error) throw error;
      }
      toast({ title: "Extrato importado", description: `${rows.length} lançamentos adicionados.` });
      onImported();
      onOpenChange(false);
      setArquivo(null);
      setPreviewLines([]);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e: any) {
      toast({ title: "Erro na importação", description: e?.message ?? "Falha", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-4 w-4" /> Importar Extrato Bancário</DialogTitle>
          <DialogDescription>
            Suportamos arquivos <strong>OFX</strong> (extrato eletrônico) e <strong>CSV</strong> (data; descrição; valor).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Conta Bancária</Label>
              <Select value={contaBancariaId} onValueChange={setContaBancariaId}>
                <SelectTrigger><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
                <SelectContent>
                  {contas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.banco_nome ?? c.banco_codigo} · Ag {c.agencia} · {c.conta}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Formato</Label>
              <Select value={formato} onValueChange={(v: any) => setFormato(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ofx">OFX (Open Financial Exchange)</SelectItem>
                  <SelectItem value="csv">CSV (Excel/Sheets)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div
            onClick={() => fileRef.current?.click()}
            className="cursor-pointer rounded-lg border-2 border-dashed border-border bg-muted/30 p-8 text-center transition hover:border-primary/50 hover:bg-muted/50"
          >
            <Upload className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium">
              {arquivo ? arquivo.name : "Clique para selecionar o arquivo"}
            </p>
            <p className="text-xs text-muted-foreground">
              {arquivo ? `${(arquivo.size / 1024).toFixed(1)} KB` : "ou arraste o extrato aqui"}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".ofx,.csv,.txt"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {previewLines.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pré-visualização</p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-[11px] font-mono">{previewLines.join("\n")}</pre>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={importar} disabled={!arquivo || importing}>
            {importing ? "Importando…" : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
