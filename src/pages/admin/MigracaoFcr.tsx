import { useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/integrations/supabase/env";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Upload,
  RefreshCw,
  PlayCircle,
  ScanLine,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
} from "lucide-react";

const ANON_KEY = SUPABASE_ANON_KEY;

type Empresa = { id: string; nome: string };

type Batch = {
  id: string;
  empresa_id: string | null;
  escopo_carga: string;
  arquivo_origem: string | null;
  storage_path: string | null;
  status: string;
  totais_excel: Record<string, unknown> | null;
  totais_promovidos: Record<string, unknown> | null;
  saldos_finais_reconciliacao: Record<string, unknown> | null;
  observacao: string | null;
  created_at: string;
  updated_at: string;
  linhas_lidas: number | null;
  linhas_inseridas: number | null;
  chunks_total: number | null;
  chunk_atual: number | null;
  ultimo_erro: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  criado: "bg-muted text-muted-foreground",
  parseando: "bg-amber-500/10 text-amber-600 border-amber-300",
  parse_ok: "bg-blue-500/10 text-blue-600 border-blue-300",
  reconciliando: "bg-amber-500/10 text-amber-600 border-amber-300",
  dry_run_ok: "bg-emerald-500/10 text-emerald-600 border-emerald-300",
  dry_run_divergente: "bg-destructive/10 text-destructive border-destructive/40",
  erro: "bg-destructive/10 text-destructive border-destructive/40",
};

export default function MigracaoFcr() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);

  // form de novo upload
  const [empresaId, setEmpresaId] = useState<string>("__CONSOLIDADO__");
  const [periodoInicio, setPeriodoInicio] = useState<string>("2026-01-01");
  const [periodoFim, setPeriodoFim] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [busyBatch, setBusyBatch] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadEmpresas() {
    const { data, error } = await supabase
      .from("empresas")
      .select("id, nome_fantasia, razao_social")
      .eq("ativa", true)
      .order("nome_fantasia");
    if (error) {
      toast.error(`Empresas: ${error.message}`);
      return;
    }
    setEmpresas(
      (data ?? []).map((e: { id: string; nome_fantasia: string | null; razao_social: string | null }) => ({
        id: e.id,
        nome: e.nome_fantasia || e.razao_social || e.id,
      })),
    );
  }

  async function loadBatches() {
    setLoading(true);
    const { data, error } = await supabase
      .from("fcr_batch")
      .select(
        "id, empresa_id, escopo_carga, arquivo_origem, storage_path, status, totais_excel, totais_promovidos, saldos_finais_reconciliacao, observacao, created_at, updated_at, linhas_lidas, linhas_inseridas, chunks_total, chunk_atual, ultimo_erro",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) toast.error(`Lotes: ${error.message}`);
    setBatches((data ?? []) as Batch[]);
    setLoading(false);
  }

  // Polling automático enquanto algum batch estiver "parseando"
  useEffect(() => {
    const hasRunning = batches.some((b) => b.status === "parseando");
    if (!hasRunning) return;
    const t = setInterval(() => loadBatches(), 2500);
    return () => clearInterval(t);
  }, [batches]);

  useEffect(() => {
    loadEmpresas();
    loadBatches();
  }, []);

  async function uploadXlsx(file: File) {
    if (!periodoInicio || !periodoFim) {
      toast.error("Informe Data Inicial e Data Final do período do Excel.");
      return;
    }
    if (periodoFim < periodoInicio) {
      toast.error("Data Final precisa ser ≥ Data Inicial.");
      return;
    }
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr || !sessionData.session?.access_token) {
      toast.error("Sessão expirada. Faça login novamente.");
      return;
    }
    const token = sessionData.session.access_token;

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `xlsx/${ts}__${safeName}`;

    setUploadPct(0);
    try {
      await new Promise<void>((resolve, reject) => {
        const up = new tus.Upload(file, {
          endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
          chunkSize: 6 * 1024 * 1024,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          headers: {
            authorization: `Bearer ${token}`,
            apikey: ANON_KEY,
            "x-upsert": "true",
          },
          metadata: {
            bucketName: "fcr-uploads",
            objectName: path,
            contentType:
              file.type ||
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            cacheControl: "3600",
          },
          onError: reject,
          onProgress: (sent, total) =>
            setUploadPct(Math.round((sent / total) * 100)),
          onSuccess: () => resolve(),
        });
        up.start();
      });

      toast.success(`Upload concluído (${(file.size / 1024 / 1024).toFixed(1)} MB). Registrando lote…`);

      const { data, error } = await supabase.functions.invoke("fcr-load", {
        body: {
          action: "register",
          storage_path: path,
          arquivo_origem: file.name,
          empresa_id: empresaId === "__CONSOLIDADO__" ? null : empresaId,
          periodo_inicio: periodoInicio,
          periodo_fim: periodoFim,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Lote criado: ${data?.batch_id ?? "ok"}`);
      await loadBatches();
    } catch (e) {
      toast.error(
        `Falha no upload: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setUploadPct(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function callAction(batchId: string, action: "parse" | "reconcile") {
    setBusyBatch((b) => ({ ...b, [batchId]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("fcr-load", {
        body: { action, batch_id: batchId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (action === "parse") {
        toast.success("Parse iniciado em background. Acompanhe o progresso na tabela.");
      } else {
        toast.success("Reconcile concluído.");
      }
      await loadBatches();
    } catch (e) {
      toast.error(
        `${action}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusyBatch((b) => ({ ...b, [batchId]: false }));
    }
  }

  function nomeEmpresa(id: string | null) {
    if (!id) return "Consolidado";
    return empresas.find((e) => e.id === id)?.nome ?? id.slice(0, 8);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Carga do Excel de Fluxo de Caixa Realizado
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-amber-300/40 bg-amber-500/5 p-3 text-sm">
            <strong>Modo dry-run.</strong> O arquivo é gravado nas tabelas{" "}
            <code>fcr_*</code> apenas para conferência. <strong>Não altera</strong>{" "}
            <code>mz_40_fato_fluxo_caixa_realizado</code> nem o Fluxo de Caixa
            Diário. A virada para produção é feita só no PR-4 após sua aprovação.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <Label>Empresa</Label>
              <Select value={empresaId} onValueChange={setEmpresaId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover z-50">
                  <SelectItem value="__CONSOLIDADO__">
                    Consolidado (todas as empresas)
                  </SelectItem>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Data inicial do Excel</Label>
              <Input
                type="date"
                value={periodoInicio}
                onChange={(e) => setPeriodoInicio(e.target.value)}
              />
            </div>
            <div>
              <Label>Data final do Excel</Label>
              <Input
                type="date"
                value={periodoFim}
                onChange={(e) => setPeriodoFim(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadXlsx(f);
              }}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadPct !== null}
            >
              <Upload className="h-4 w-4 mr-2" />
              {uploadPct !== null
                ? `Enviando… ${uploadPct}%`
                : "Selecionar arquivo .xlsx"}
            </Button>
            <Button variant="outline" onClick={loadBatches} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-2" /> Atualizar
            </Button>
          </div>
          {uploadPct !== null && (
            <Progress value={uploadPct} className="h-2" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lotes recentes</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2">Criado em</th>
                <th className="text-left">Empresa</th>
                <th className="text-left">Arquivo</th>
                <th className="text-left">Status</th>
                <th className="text-left">Reconciliação</th>
                <th className="text-left">Ações</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const recon = b.saldos_finais_reconciliacao as
                  | { diff_total?: number; ok?: boolean }
                  | null;
                return (
                  <tr key={b.id} className="border-b hover:bg-muted/30">
                    <td className="py-2 whitespace-nowrap">
                      {new Date(b.created_at).toLocaleString("pt-BR")}
                    </td>
                    <td>{nomeEmpresa(b.empresa_id)}</td>
                    <td className="font-mono text-xs max-w-[260px] truncate" title={b.arquivo_origem ?? ""}>
                      {b.arquivo_origem ?? "—"}
                    </td>
                    <td>
                      <Badge
                        variant="outline"
                        className={STATUS_COLORS[b.status] ?? ""}
                      >
                        {b.status}
                      </Badge>
                      {b.status === "parseando" && (
                        <div className="mt-1 space-y-1">
                          {b.chunks_total ? (
                            <Progress
                              value={Math.round(((b.chunk_atual ?? 0) / b.chunks_total) * 100)}
                              className="h-1.5 w-32"
                            />
                          ) : null}
                          <div className="text-[10px] text-muted-foreground font-mono">
                            chunk {b.chunk_atual ?? 0}/{b.chunks_total ?? "?"} • {b.linhas_inseridas ?? 0} linhas
                          </div>
                        </div>
                      )}
                      {b.ultimo_erro && b.status === "erro" && (
                        <div
                          className="text-xs text-destructive mt-1 max-w-xs truncate"
                          title={b.ultimo_erro}
                        >
                          {b.ultimo_erro}
                        </div>
                      )}
                      {b.observacao && (
                        <div
                          className="text-xs text-destructive mt-1 max-w-xs truncate"
                          title={b.observacao}
                        >
                          {b.observacao}
                        </div>
                      )}
                    </td>
                    <td className="text-xs">
                      {recon ? (
                        recon.ok ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="h-3 w-3" /> OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <AlertTriangle className="h-3 w-3" />
                            Δ {recon.diff_total?.toFixed?.(2) ?? "?"}
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="space-x-2 whitespace-nowrap py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!busyBatch[b.id]}
                        onClick={() => callAction(b.id, "parse")}
                      >
                        <ScanLine className="h-3.5 w-3.5 mr-1" /> Parse
                      </Button>
                      <Button
                        size="sm"
                        disabled={!!busyBatch[b.id]}
                        onClick={() => callAction(b.id, "reconcile")}
                      >
                        <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Reconcile
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {batches.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Nenhum lote ainda. Suba um Excel acima para começar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
