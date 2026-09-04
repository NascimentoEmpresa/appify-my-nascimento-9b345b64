import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Settings, Paperclip, FileDown, CheckCircle2, AlertTriangle, ListChecks, Trash2, Upload, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import {
  useContratosAtivosChecklist, useContratoDocs, useMarcacoes, useAtualizarMarcacao,
  useAnexos, useUploadAnexo, useExcluirAnexo, useEnvio, useMarcarBaixado,
  useResumoPendencias, STATUS_CICLO, STATUS_LABEL_CHECKLIST, StatusMarcacao, ContratoChecklist,
  BUCKET_CHECKLIST_ANEXOS,
} from "@/hooks/useChecklistFaturamento";
import { DocsPadraoModal } from "./checklist-faturamento/DocsPadraoModal";
import { ContratoConfigModal } from "./checklist-faturamento/ContratoConfigModal";

const MENU_CODIGO = "financeiro-checklist-faturamento";

const STATUS_CLASSE: Record<StatusMarcacao, string> = {
  pendente: "bg-muted text-muted-foreground border-border",
  a_conferir: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  ok: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  nao_aplicavel: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700",
};

// SIS-2026-0304 (achado testando com o usuário): <input type="month"> não
// deixava trocar a competência de forma confiável — trocado por 2 Selects
// explícitos (Mês/Ano), mesma robustez de qualquer outro Select do app.
const MESES = [
  { v: "01", l: "Janeiro" }, { v: "02", l: "Fevereiro" }, { v: "03", l: "Março" }, { v: "04", l: "Abril" },
  { v: "05", l: "Maio" }, { v: "06", l: "Junho" }, { v: "07", l: "Julho" }, { v: "08", l: "Agosto" },
  { v: "09", l: "Setembro" }, { v: "10", l: "Outubro" }, { v: "11", l: "Novembro" }, { v: "12", l: "Dezembro" },
];

function mesAtualISO() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

function anosDisponiveis() {
  const atual = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => String(atual - 4 + i));
}

function CelulaStatus({ value, onChange, disabled }: { value: StatusMarcacao; onChange: (v: StatusMarcacao) => void; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as StatusMarcacao)} disabled={disabled}>
      <SelectTrigger className={cn("h-7 w-[112px] text-[11px] px-2", STATUS_CLASSE[value])}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_CICLO.map((s) => (
          <SelectItem key={s} value={s} className="text-xs">{STATUS_LABEL_CHECKLIST[s]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LinhaDoc({
  contratoId, docId, nomeDoc, competenciaISO, statusAtual, selecionado, onToggleSelecionado,
}: {
  contratoId: string; docId: string; nomeDoc: string; competenciaISO: string; statusAtual: StatusMarcacao;
  selecionado: boolean; onToggleSelecionado: () => void;
}) {
  const atualizar = useAtualizarMarcacao();
  const { data: anexos = [] } = useAnexos(contratoId, competenciaISO);
  const anexosDoc = anexos.filter((a) => a.doc_id === docId);
  const upload = useUploadAnexo();
  const excluir = useExcluirAnexo();

  function mudarStatus(novo: StatusMarcacao) {
    atualizar.mutate({ contratoId, docId, competenciaISO, status: novo });
  }

  async function handleArquivo(file: File) {
    try {
      await upload.mutateAsync({ contratoId, docId, competenciaISO, arquivo: file });
      toast.success("Anexo enviado.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao enviar anexo.");
    }
  }

  // SIS-2026-0304 (achado testando): o bucket é privado — não tinha jeito
  // de abrir o anexo, só o nome aparecia. URL assinada, válida por 1 min.
  async function abrirAnexo(path: string) {
    const { data, error } = await supabase.storage.from(BUCKET_CHECKLIST_ANEXOS).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      toast.error("Erro ao abrir o arquivo.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex items-center gap-2 border-b pb-2 last:border-0 last:pb-0">
      <Checkbox checked={selecionado} onCheckedChange={onToggleSelecionado} />
      <span className="text-sm flex-1 min-w-0 truncate" title={nomeDoc}>{nomeDoc}</span>
      <CelulaStatus value={statusAtual} onChange={mudarStatus} disabled={atualizar.isPending} />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7 relative shrink-0">
            <Paperclip className="h-3.5 w-3.5" />
            {anexosDoc.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[9px] text-primary-foreground">
                {anexosDoc.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="end">
          <div className="space-y-1">
            {anexosDoc.length === 0 && <p className="text-xs text-muted-foreground px-1">Nenhum anexo.</p>}
            {anexosDoc.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-1 text-xs px-1">
                <button className="truncate text-left text-primary hover:underline" title={`Abrir ${a.nome_original}`} onClick={() => abrirAnexo(a.storage_path)}>
                  {a.nome_original}
                </button>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => abrirAnexo(a.storage_path)} title="Abrir">
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => excluir.mutate(a)} title="Excluir">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
            <label className="flex items-center justify-center gap-1.5 rounded-md border border-dashed p-1.5 text-xs text-primary cursor-pointer mt-1">
              <Upload className="h-3 w-3" /> Anexar arquivo
              <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && handleArquivo(e.target.files[0])} />
            </label>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function MatrizContrato({ contrato, competenciaISO }: { contrato: ContratoChecklist; competenciaISO: string }) {
  const { data: vinculos = [], isLoading } = useContratoDocs(contrato.id);
  const { data: marcacoes = [] } = useMarcacoes(contrato.id, competenciaISO);
  const { data: anexos = [] } = useAnexos(contrato.id, competenciaISO);
  const { data: envio } = useEnvio(contrato.id, competenciaISO);
  const marcarBaixado = useMarcarBaixado();
  const atualizar = useAtualizarMarcacao();
  const [baixando, setBaixando] = useState(false);
  const [aplicandoEmMassa, setAplicandoEmMassa] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  // Troca de contrato/competência não deve manter seleção da tela anterior.
  useEffect(() => setSelecionados(new Set()), [contrato.id, competenciaISO]);

  const statusPorDoc = useMemo(() => {
    const m = new Map<string, StatusMarcacao>();
    for (const marc of marcacoes) m.set(marc.doc_id, marc.status);
    return m;
  }, [marcacoes]);

  function toggleSelecionado(docId: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }

  function toggleSelecionarTodos() {
    setSelecionados((prev) => (prev.size === vinculos.length ? new Set() : new Set(vinculos.map((v) => v.doc_id))));
  }

  async function aplicarStatusEmMassa(status: StatusMarcacao) {
    setAplicandoEmMassa(true);
    try {
      for (const docId of selecionados) {
        await atualizar.mutateAsync({ contratoId: contrato.id, docId, competenciaISO, status });
      }
      toast.success(`${selecionados.size} documento(s) marcado(s) como "${STATUS_LABEL_CHECKLIST[status]}".`);
      setSelecionados(new Set());
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao atualizar em massa.");
    } finally {
      setAplicandoEmMassa(false);
    }
  }

  async function concluirEBaixar() {
    if (anexos.length === 0) {
      toast.error("Nenhum anexo pra baixar nesta competência ainda.");
      return;
    }
    setBaixando(true);
    try {
      const zip = new JSZip();
      const usados = new Set<string>();
      for (const a of anexos) {
        const { data: blob, error } = await supabase.storage.from(BUCKET_CHECKLIST_ANEXOS).download(a.storage_path);
        if (error || !blob) continue;
        let nome = a.nome_original;
        if (usados.has(nome)) {
          const partes = nome.split(".");
          const ext = partes.length > 1 ? "." + partes.pop() : "";
          nome = `${partes.join(".")}_${a.id.slice(0, 6)}${ext}`;
        }
        usados.add(nome);
        zip.file(nome, blob);
      }
      const pacote = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const url = URL.createObjectURL(pacote);
      const a = document.createElement("a");
      a.href = url;
      a.download = `checklist-${contrato.nome}-${competenciaISO}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);

      await marcarBaixado.mutateAsync({ contratoId: contrato.id, competenciaISO });
      toast.success("Pacote baixado — anexe no seu e-mail pra enviar ao contratante.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao gerar o pacote.");
    } finally {
      setBaixando(false);
    }
  }

  return (
    // SIS-2026-0304 (pedido do usuário): mesma altura fixa da lista de
    // contratos ao lado — cabeçalho (nome/botão) e barra de seleção ficam
    // fixos, só a lista de documentos rola por dentro.
    <Card className="lg:h-[75vh] flex flex-col">
      <CardContent className="p-4 flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between shrink-0">
          <div>
            <p className="text-sm font-semibold">{contrato.nome}</p>
            {envio && (
              <p className="text-xs text-muted-foreground">
                Baixado em {new Date(envio.baixado_em).toLocaleString("pt-BR")}
              </p>
            )}
          </div>
          <Button size="sm" onClick={concluirEBaixar} disabled={baixando}>
            <FileDown className="h-3.5 w-3.5 mr-1.5" /> {baixando ? "Gerando..." : "Concluir e baixar"}
          </Button>
        </div>

        {isLoading && <p className="text-xs text-muted-foreground shrink-0 mt-3">Carregando...</p>}
        {!isLoading && vinculos.length === 0 && (
          <p className="text-xs text-muted-foreground shrink-0 mt-3">Nenhum documento configurado pra este contrato — use "Configurar" na lista ao lado.</p>
        )}

        {vinculos.length > 0 && (
          <div className="flex items-center gap-2 pb-1 pt-3 shrink-0">
            <Checkbox checked={selecionados.size > 0 && selecionados.size === vinculos.length} onCheckedChange={toggleSelecionarTodos} />
            <span className="text-xs text-muted-foreground">
              {selecionados.size > 0 ? `${selecionados.size} selecionado(s)` : "Selecionar todos"}
            </span>
            {selecionados.size > 0 && (
              <Select onValueChange={(v) => aplicarStatusEmMassa(v as StatusMarcacao)} disabled={aplicandoEmMassa}>
                <SelectTrigger className="h-7 w-[220px] text-xs ml-2">
                  <SelectValue placeholder={aplicandoEmMassa ? "Aplicando..." : "Aplicar status aos selecionados"} />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_CICLO.map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">{STATUS_LABEL_CHECKLIST[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
          {vinculos.map((v) => (
            <LinhaDoc
              key={v.id}
              contratoId={contrato.id}
              docId={v.doc_id}
              nomeDoc={v.doc?.nome ?? ""}
              competenciaISO={competenciaISO}
              statusAtual={statusPorDoc.get(v.doc_id) ?? "pendente"}
              selecionado={selecionados.has(v.doc_id)}
              onToggleSelecionado={() => toggleSelecionado(v.doc_id)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ChecklistFaturamento() {
  const [competencia, setCompetencia] = useState(mesAtualISO());
  const [ano, mes] = competencia.split("-");
  const competenciaISO = `${competencia}-01`;
  const { data: contratos = [] } = useContratosAtivosChecklist();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: resumo } = useResumoPendencias(competenciaISO);
  const [contratoSelecionadoId, setContratoSelecionadoId] = useState<string | null>(null);
  const [openDocsPadrao, setOpenDocsPadrao] = useState(false);
  const [contratoConfigurar, setContratoConfigurar] = useState<ContratoChecklist | null>(null);

  const contratoSelecionado = contratos.find((c) => c.id === contratoSelecionadoId) ?? null;

  const kpis = useMemo(() => {
    let comPendencia = 0;
    let totalPendentes = 0;
    let totalOk = 0;
    for (const c of contratos) {
      const r = resumo?.get(c.id);
      if (!r) continue;
      if (r.pendentes > 0) comPendencia++;
      totalPendentes += r.pendentes;
      totalOk += r.ok;
    }
    return { comPendencia, totalPendentes, totalOk, totalContratos: contratos.length };
  }, [contratos, resumo]);

  return (
    <AcessoGate menu={MENU_CODIGO} acao="visualizar" fallback={<div className="p-6 text-sm text-muted-foreground">Sem acesso a esta tela.</div>}>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Checklist de Faturamento"
          subtitle="Acompanhe a entrega dos documentos exigidos por contrato, mês a mês."
          module="Financeiro"
          breadcrumb={["Financeiro", "Ferramentas", "Checklist de Faturamento"]}
          actions={
            <>
              {/* SIS-2026-0304 (pedido do usuário): filtro de competência não
                  precisa de um card próprio — fica sutil, junto dos outros
                  controles do cabeçalho da página. */}
              <div className="flex items-center gap-1.5">
                <Select value={mes} onValueChange={(v) => setCompetencia(`${ano}-${v}`)}>
                  <SelectTrigger className="h-9 w-36 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MESES.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={ano} onValueChange={(v) => setCompetencia(`${v}-${mes}`)}>
                  <SelectTrigger className="h-9 w-24 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {anosDisponiveis().map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <AcessoGate menu={MENU_CODIGO} acao="alterar">
                <Button variant="outline" onClick={() => setOpenDocsPadrao(true)}>
                  <Settings className="h-4 w-4 mr-2" /> Documentos-Padrão
                </Button>
              </AcessoGate>
            </>
          }
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile label="Contratos" valor={String(kpis.totalContratos)} icon={<ListChecks />} cor="slate" />
          <KpiTile label="Com Pendência" valor={String(kpis.comPendencia)} icon={<AlertTriangle />} cor="amber" valorClass="text-amber-600 dark:text-amber-400" />
          <KpiTile label="Documentos Pendentes" valor={String(kpis.totalPendentes)} icon={<AlertTriangle />} cor="red" valorClass="text-red-600 dark:text-red-400" />
          <KpiTile label="Documentos OK" valor={String(kpis.totalOk)} icon={<CheckCircle2 />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {/* SIS-2026-0304 (pedido do usuário): mesma mecânica de altura
              fixa + scroll interno do card da matriz ao lado, pra ficarem
              com a altura idêntica. */}
          <Card className="lg:col-span-1 lg:sticky lg:top-6 lg:h-[75vh] flex flex-col">
            <CardContent className="p-3 space-y-1 flex-1 min-h-0 overflow-y-auto">
              {contratos.map((c) => {
                const r = resumo?.get(c.id);
                const pendente = (r?.pendentes ?? 0) > 0;
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md px-2 py-2 cursor-pointer text-sm",
                      contratoSelecionadoId === c.id ? "bg-primary/10" : "hover:bg-muted/50",
                    )}
                    onClick={() => setContratoSelecionadoId(c.id)}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.nome}</p>
                      <p className="text-[11px] text-muted-foreground">{empresas.find((e) => e.id === c.empresa_id)?.nome ?? "—"}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {r && (pendente ? <Badge variant="destructive" className="text-[10px]">{r.pendentes} pend.</Badge> : <Badge className="text-[10px] bg-emerald-600 hover:bg-emerald-600">OK</Badge>)}
                      <AcessoGate menu={MENU_CODIGO} acao="alterar">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setContratoConfigurar(c); }}>
                          <Settings className="h-3 w-3" />
                        </Button>
                      </AcessoGate>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <div className="lg:col-span-2">
            {contratoSelecionado ? (
              <MatrizContrato contrato={contratoSelecionado} competenciaISO={competenciaISO} />
            ) : (
              <Card>
                <CardContent className="p-8 text-center text-sm text-muted-foreground">Selecione um contrato na lista ao lado.</CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      <DocsPadraoModal open={openDocsPadrao} onClose={() => setOpenDocsPadrao(false)} />
      <ContratoConfigModal open={!!contratoConfigurar} contrato={contratoConfigurar} onClose={() => setContratoConfigurar(null)} />
    </AcessoGate>
  );
}
