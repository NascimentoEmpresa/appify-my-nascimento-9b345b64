import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2, Trash2,
  PlayCircle, ThumbsUp, ThumbsDown, ListChecks, Upload, Link2, Database, ShieldCheck, Sparkles,
} from "lucide-react";
import { sha256OfFile, parseSpreadsheet, detectLayout, type LayoutFingerprint, type LayoutMatch } from "@/lib/integracao/parser";
import { BatchStepper } from "./BatchStepper";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXT = [".xlsx", ".xls", ".csv"];

interface BatchRecord {
  id: string;
  codigo: string;
  descricao: string | null;
  status: string;
  empresa_id: string;
  layout_id: string | null;
  total_linhas: number | null;
  linhas_validas: number | null;
  linhas_invalidas: number | null;
  observacoes: string | null;
  created_at: string;
}

interface BatchFile {
  id: string;
  nome_original: string;
  storage_path: string;
  hash_sha256: string;
  tamanho_bytes: number | null;
  sheet_name: string | null;
  layout_detectado_id: string | null;
  layout_score: number | null;
  metadata: any;
  created_at: string;
  materializado_em?: string | null;
  linhas_inseridas?: number | null;
}

interface ValidationResult {
  id: string;
  rule_codigo: string;
  severidade: "informativo" | "alerta" | "bloqueante";
  linha_origem: number | null;
  campo: string | null;
  mensagem: string;
  valor_recebido: string | null;
  resolvido: boolean;
  created_at: string;
}

interface LayoutMeta {
  id: string;
  codigo: string;
  nome: string;
  staging_tabela: string;
  destino_tabela: string;
}

export default function BatchDetalhe() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { user } = useAuth();
  const { empresaId, can } = usePermissoes();
  const { toast } = useToast();
  const podeGerenciar = can("alterar", undefined, "integracao");

  const [batch, setBatch] = useState<BatchRecord | null>(null);
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [layouts, setLayouts] = useState<Record<string, LayoutMeta>>({});
  const [fingerprints, setFingerprints] = useState<LayoutFingerprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const [editDesc, setEditDesc] = useState("");
  const [editObs, setEditObs] = useState("");
  const [validations, setValidations] = useState<ValidationResult[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<"all" | "bloqueante" | "alerta" | "informativo">("all");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [batchRes, filesRes, layoutsRes, fpRes, valRes] = await Promise.all([
      supabase.from("integration_batches").select("*").eq("id", id).maybeSingle(),
      supabase.from("integration_batch_files").select("*").eq("batch_id", id).order("created_at", { ascending: true }),
      supabase.from("integration_layouts").select("id, codigo, nome, staging_tabela, destino_tabela").eq("ativo", true),
      supabase.from("integration_layout_fingerprints").select("layout_id, arquivo_pattern, sheet_pattern, colunas_obrigatorias, peso"),
      supabase.from("integration_validation_results").select("*").eq("batch_id", id).order("linha_origem", { ascending: true }).limit(1000),
    ]);

    if (batchRes.error || !batchRes.data) {
      toast({ title: "Lote não encontrado", description: batchRes.error?.message ?? "", variant: "destructive" });
      setLoading(false);
      return;
    }
    setBatch(batchRes.data as BatchRecord);
    setEditDesc(batchRes.data.descricao ?? "");
    setEditObs(batchRes.data.observacoes ?? "");
    setFiles((filesRes.data ?? []) as BatchFile[]);
    const lmap: Record<string, LayoutMeta> = {};
    (layoutsRes.data ?? []).forEach((l: any) => { lmap[l.id] = l; });
    setLayouts(lmap);
    setFingerprints((fpRes.data ?? []) as LayoutFingerprint[]);
    setValidations((valRes.data ?? []) as ValidationResult[]);
    setLoading(false);
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const handleFiles = async (fileList: FileList | File[]) => {
    if (!batch || !user || !empresaId) return;
    const arr = Array.from(fileList);
    setUploading(true);
    for (const file of arr) {
      try {
        // Validations
        const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
        if (!ACCEPTED_EXT.includes(ext)) {
          toast({ title: "Formato não aceito", description: `${file.name}: apenas XLSX/XLS/CSV.`, variant: "destructive" });
          continue;
        }
        if (file.size > MAX_BYTES) {
          toast({ title: "Arquivo muito grande", description: `${file.name} excede 10 MB.`, variant: "destructive" });
          continue;
        }

        setProgress(`${file.name}: calculando hash...`);
        const hash = await sha256OfFile(file);

        // Dedupe within the batch
        if (files.some((f) => f.hash_sha256 === hash)) {
          toast({ title: "Arquivo duplicado", description: `${file.name} já consta neste lote (mesmo SHA-256).`, variant: "destructive" });
          continue;
        }

        setProgress(`${file.name}: enviando para storage...`);
        // Sanitize filename for Supabase Storage (no accents, spaces, or special chars)
        const safeName = file.name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-zA-Z0-9._-]+/g, "_")
          .replace(/_+/g, "_");
        const path = `${empresaId}/${batch.id}/${hash}-${safeName}`;
        const up = await supabase.storage.from("integration-uploads").upload(path, file, {
          upsert: false,
          contentType: file.type || undefined,
        });
        if (up.error && !String(up.error.message).toLowerCase().includes("already exists")) {
          throw up.error;
        }

        setProgress(`${file.name}: fazendo parse...`);
        const parsed = await parseSpreadsheet(file);
        const matches = detectLayout(parsed, fingerprints);
        const best: LayoutMatch | undefined = matches[0];

        // Sample profile (first 50 rows of best sheet, or first sheet)
        const sheet = parsed.sheets.find((s) => s.sheetName === (best?.sheet ?? parsed.sheets[0]?.sheetName)) ?? parsed.sheets[0];
        const sampleRows = sheet?.rows.slice(0, 50) ?? [];
        const totalRows = parsed.sheets.reduce((acc, s) => acc + s.totalRows, 0);

        setProgress(`${file.name}: registrando metadados...`);
        const insertPayload: any = {
          batch_id: batch.id,
          empresa_id: empresaId,
          nome_original: file.name,
          storage_path: path,
          hash_sha256: hash,
          tamanho_bytes: file.size,
          mime_type: file.type || undefined,
          sheet_name: sheet?.sheetName ?? undefined,
          layout_detectado_id: best?.layout_id ?? undefined,
          layout_score: best?.score ?? undefined,
          metadata: {
            sheets: parsed.sheets.map((s) => ({ name: s.sheetName, rows: s.totalRows, headers: s.headers })),
            matches: matches.slice(0, 5),
            sample: sampleRows.slice(0, 10),
            total_rows_arquivo: totalRows,
          },
        };
        const ins = await supabase.from("integration_batch_files").insert(insertPayload).select("id").single();
        if (ins.error) throw ins.error;

        toast({
          title: "Arquivo carregado",
          description: best
            ? `${file.name}: layout "${layouts[best.layout_id]?.nome ?? best.layout_id}" (score ${(best.score * 100).toFixed(0)}%).`
            : `${file.name}: layout não identificado, abra o arquivo para resolver.`,
        });
      } catch (err: any) {
        toast({ title: "Falha no upload", description: `${file.name}: ${err?.message ?? err}`, variant: "destructive" });
      }
    }
    setProgress("");
    setUploading(false);
    await load();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  const removeFile = async (f: BatchFile) => {
    if (!confirm(`Remover ${f.nome_original} deste lote?`)) return;
    await supabase.storage.from("integration-uploads").remove([f.storage_path]);
    const { error } = await supabase.from("integration_batch_files").delete().eq("id", f.id);
    if (error) {
      toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Arquivo removido" });
      await load();
    }
  };

  const saveBatch = async () => {
    if (!batch) return;
    const { error } = await supabase
      .from("integration_batches")
      .update({ descricao: editDesc, observacoes: editObs })
      .eq("id", batch.id);
    if (error) toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    else { toast({ title: "Lote atualizado" }); load(); }
  };

  const materializeFile = async (f: BatchFile) => {
    if (!f.layout_detectado_id) {
      toast({ title: "Sem layout", description: "Layout não foi identificado para este arquivo.", variant: "destructive" });
      return;
    }
    setBusyAction(f.id);
    try {
      setProgress(`Baixando ${f.nome_original}...`);
      const { data: blob, error: dlErr } = await supabase.storage.from("integration-uploads").download(f.storage_path);
      if (dlErr || !blob) throw new Error(dlErr?.message ?? "falha no download");

      setProgress(`Lendo planilha...`);
      const file = new File([blob], f.nome_original);
      const parsed = await parseSpreadsheet(file);
      const sheet = parsed.sheets.find((s) => s.sheetName === f.sheet_name) ?? parsed.sheets[0];
      if (!sheet) throw new Error("Aba não encontrada");

      setProgress(`Materializando ${sheet.rows.length} linhas...`);
      const { data, error } = await supabase.rpc("integration_materialize_staging", {
        p_batch_file_id: f.id,
        p_rows: sheet.rows as any,
      });
      if (error) throw error;
      const r = data as any;
      toast({
        title: "Materialização concluída",
        description: `Inseridas ${r?.inserted ?? 0} • Erros ${r?.errors ?? 0} • Total ${r?.total_processed ?? 0}`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Falha na materialização", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setProgress("");
      setBusyAction(null);
    }
  };

  const approveBatch = async () => {
    if (!batch) return;
    if (!confirm(`Aprovar lote ${batch.codigo}? Os dados em staging serão considerados válidos para promoção.`)) return;
    setBusyAction("approve");
    const { error } = await supabase.rpc("integration_approve_batch", { p_batch_id: batch.id });
    setBusyAction(null);
    if (error) toast({ title: "Não foi possível aprovar", description: error.message, variant: "destructive" });
    else { toast({ title: "Lote aprovado" }); load(); }
  };

  const rejectBatch = async () => {
    if (!batch) return;
    const motivo = prompt("Motivo da rejeição (opcional):") ?? null;
    setBusyAction("reject");
    const { error } = await supabase.rpc("integration_reject_batch", { p_batch_id: batch.id, p_motivo: motivo });
    setBusyAction(null);
    if (error) toast({ title: "Erro ao rejeitar", description: error.message, variant: "destructive" });
    else { toast({ title: "Lote rejeitado" }); load(); }
  };

  const promoteBatch = async () => {
    if (!batch) return;
    if (!confirm(`Promover lote ${batch.codigo} para as tabelas finais? Esta ação grava os registros com batch_id = ${batch.codigo}.`)) return;
    setBusyAction("promote");
    const { data, error } = await supabase.rpc("integration_promote_batch", { p_batch_id: batch.id });
    setBusyAction(null);
    if (error) toast({ title: "Falha na promoção", description: error.message, variant: "destructive" });
    else {
      const r = data as any;
      toast({ title: "Lote promovido", description: r?.detalhe ?? "ok" });
      load();
    }
  };

  const filteredValidations = filterSeverity === "all"
    ? validations
    : validations.filter((v) => v.severidade === filterSeverity);
  const counts = {
    bloqueante: validations.filter((v) => v.severidade === "bloqueante").length,
    alerta: validations.filter((v) => v.severidade === "alerta").length,
    informativo: validations.filter((v) => v.severidade === "informativo").length,
  };

  if (loading || !batch) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando lote...
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        module="Integração & Migração"
        breadcrumb={[<Link key="b" to="/app/integracao" className="hover:underline">Lotes</Link> as any, batch.codigo]}
        title={batch.codigo}
        subtitle={`Status: ${batch.status} • Criado em ${new Date(batch.created_at).toLocaleString("pt-BR")}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => nav("/app/integracao")}>
              <ArrowLeft className="h-4 w-4" /> Voltar
            </Button>
            {podeGerenciar && (batch.status === "validado_ok" || batch.status === "validado_com_erros") && (
              <>
                <Button
                  size="sm"
                  variant="default"
                  onClick={approveBatch}
                  disabled={busyAction === "approve" || counts.bloqueante > 0}
                  title={counts.bloqueante > 0 ? "Resolva os erros bloqueantes" : ""}
                >
                  <ThumbsUp className="h-4 w-4" /> Aprovar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={rejectBatch}
                  disabled={busyAction === "reject"}
                >
                  <ThumbsDown className="h-4 w-4" /> Rejeitar
                </Button>
              </>
            )}
            {podeGerenciar && batch.status === "aprovado" && (
              <Button
                size="sm"
                variant="default"
                onClick={promoteBatch}
                disabled={busyAction === "promote"}
              >
                {busyAction === "promote" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Promover para tabelas finais
              </Button>
            )}
            {podeGerenciar && (
              <Button asChild size="sm" variant="outline">
                <Link to="/app/integracao/aliases"><Link2 className="h-4 w-4" /> Aliases</Link>
              </Button>
            )}
          </div>
        }
      />

      {/* Stepper visual: fluxo de 3 etapas */}
      <BatchStepper
        status={batch.status}
        blockingErrors={counts.bloqueante}
        filesCount={files.length}
        materializedCount={files.filter((f) => !!f.materializado_em).length}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Esquerda: descrição/obs */}
        <Card className="p-4 lg:col-span-1">
          <h3 className="mb-3 text-sm font-semibold">Identificação</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Descrição</label>
              <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} disabled={!podeGerenciar} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Observações</label>
              <Textarea rows={4} value={editObs} onChange={(e) => setEditObs(e.target.value)} disabled={!podeGerenciar} />
            </div>
            {podeGerenciar && (
              <Button size="sm" onClick={saveBatch}>Salvar</Button>
            )}
          </div>
        </Card>

        {/* Direita: upload + arquivos */}
        <div className="space-y-4 lg:col-span-2">
          {podeGerenciar && (
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold">Upload de planilhas</h3>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                  dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/30"
                }`}
              >
                <UploadCloud className="mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Arraste arquivos XLSX/CSV aqui</p>
                <p className="text-xs text-muted-foreground">Máx. 10 MB por arquivo • SHA-256 evita duplicatas</p>
                <div className="mt-4">
                  <input
                    id="file-input"
                    type="file"
                    multiple
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => e.target.files && handleFiles(e.target.files)}
                  />
                  <label htmlFor="file-input">
                    <Button asChild size="sm" variant="outline" disabled={uploading}>
                      <span>{uploading ? "Processando..." : "Selecionar arquivos"}</span>
                    </Button>
                  </label>
                </div>
                {progress && <p className="mt-3 text-xs text-muted-foreground">{progress}</p>}
              </div>
            </Card>
          )}

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Arquivos do lote ({files.length})</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>Layout detectado</TableHead>
                    <TableHead>Aba</TableHead>
                    <TableHead className="text-right">Linhas</TableHead>
                    <TableHead className="text-right">Materializado</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Nenhum arquivo enviado ainda.
                      </TableCell>
                    </TableRow>
                  )}
                  {files.map((f) => {
                    const lay = f.layout_detectado_id ? layouts[f.layout_detectado_id] : null;
                    const totalRows = (f.metadata?.total_rows_arquivo as number | undefined) ?? null;
                    const isMaterialized = !!f.materializado_em;
                    return (
                      <TableRow key={f.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="text-sm font-medium">{f.nome_original}</p>
                              <p className="font-mono text-[10px] text-muted-foreground">{f.hash_sha256.slice(0, 12)}…</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {lay ? (
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              <div>
                                <p className="text-xs font-medium">{lay.nome}</p>
                                <p className="text-[10px] text-muted-foreground">
                                  Score {((f.layout_score ?? 0) * 100).toFixed(0)}% → {lay.staging_tabela}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
                              <AlertTriangle className="mr-1 h-3 w-3" /> Não identificado
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{f.sheet_name ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{totalRows ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {isMaterialized ? (
                            <span className="text-emerald-600">{f.linhas_inseridas ?? 0} linhas</span>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            {podeGerenciar && lay && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => materializeFile(f)}
                                disabled={busyAction === f.id}
                                title={isMaterialized ? "Re-materializar (limpa validações)" : "Validar e enviar para staging"}
                              >
                                {busyAction === f.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <PlayCircle className="h-4 w-4" />
                                )}
                                {isMaterialized ? "Re-materializar" : "Materializar"}
                              </Button>
                            )}
                            {podeGerenciar && (
                              <Button variant="ghost" size="sm" onClick={() => removeFile(f)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Validações */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ListChecks className="h-4 w-4" /> Validações ({validations.length})
              </h3>
              <div className="flex items-center gap-1 text-xs">
                <button
                  onClick={() => setFilterSeverity("all")}
                  className={`rounded px-2 py-1 ${filterSeverity === "all" ? "bg-muted font-medium" : "text-muted-foreground"}`}
                >Todas</button>
                <button
                  onClick={() => setFilterSeverity("bloqueante")}
                  className={`rounded px-2 py-1 ${filterSeverity === "bloqueante" ? "bg-destructive/15 text-destructive font-medium" : "text-muted-foreground"}`}
                >Bloqueante ({counts.bloqueante})</button>
                <button
                  onClick={() => setFilterSeverity("alerta")}
                  className={`rounded px-2 py-1 ${filterSeverity === "alerta" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 font-medium" : "text-muted-foreground"}`}
                >Alerta ({counts.alerta})</button>
                <button
                  onClick={() => setFilterSeverity("informativo")}
                  className={`rounded px-2 py-1 ${filterSeverity === "informativo" ? "bg-muted font-medium" : "text-muted-foreground"}`}
                >Info ({counts.informativo})</button>
              </div>
            </div>

            {filteredValidations.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {validations.length === 0
                  ? "Nenhuma validação registrada. Materialize um arquivo para gerar resultados."
                  : "Nenhum resultado para este filtro."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Severidade</TableHead>
                      <TableHead className="w-20">Linha</TableHead>
                      <TableHead className="w-40">Regra / Campo</TableHead>
                      <TableHead>Mensagem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredValidations.slice(0, 200).map((v) => (
                      <TableRow key={v.id}>
                        <TableCell>
                          <Badge
                            className={
                              v.severidade === "bloqueante"
                                ? "bg-destructive/15 text-destructive"
                                : v.severidade === "alerta"
                                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                  : "bg-muted text-muted-foreground"
                            }
                          >
                            {v.severidade}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">{v.linha_origem ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          <p className="font-medium">{v.rule_codigo}</p>
                          {v.campo && <p className="text-muted-foreground">{v.campo}</p>}
                        </TableCell>
                        <TableCell className="text-xs">{v.mensagem}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {filteredValidations.length > 200 && (
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    Mostrando 200 de {filteredValidations.length} resultados.
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

