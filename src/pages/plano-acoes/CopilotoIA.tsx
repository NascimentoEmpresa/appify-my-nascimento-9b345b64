import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Loader2, RefreshCcw, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { usePermissoes } from "@/context/PermissoesContext";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useCopilotoChat, type Draft } from "@/hooks/useCopilotoChat";
import { useCopilotoAnalise } from "@/hooks/useCopilotoAnalise";
import { useComitesMap } from "@/hooks/useComitesMap";
import { PRIORIDADE_LABEL, PRIORIDADES } from "@/types/planoAcao";

import { AssistantPanel } from "./copiloto/AssistantPanel";
import { ContextoCard } from "./copiloto/ContextoCard";
import { SugestoesCard } from "./copiloto/SugestoesCard";
import { QualificacaoProblemaCard } from "./copiloto/QualificacaoProblemaCard";
import { GanttSimplificado } from "./copiloto/GanttSimplificado";
import { MembrosComiteCard } from "./copiloto/MembrosComiteCard";
import { AnaliseRiscoCard } from "./copiloto/AnaliseRiscoCard";
import { AcoesSimilaresDialog } from "./copiloto/AcoesSimilaresDialog";
import { useAcoesSimilares, type AcaoSimilar } from "@/hooks/useAcoesSimilares";

function PermissionDenied() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <Card className="p-8 text-center max-w-md">
        <Sparkles className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Acesso restrito</h2>
        <p className="text-sm text-muted-foreground mt-2">
          O Copiloto IA está disponível apenas para a Presidência e Administração.
        </p>
      </Card>
    </div>
  );
}

function DraftField({ label, value, onChange, type = "text", placeholder }: { label: string; value: string | undefined; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input value={value ?? ""} type={type} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="bg-background/50" />
    </div>
  );
}

export default function CopilotoIA() {
  const navigate = useNavigate();
  const { can, loading } = usePermissoes();
  const allowed = can("visualizar", undefined, "plano_acoes_copiloto");

  const { messages, draft, pronto, thinking, transcribing, error, send, transcribe, criar, reset, updateDraft } = useCopilotoChat();
  const analise = useCopilotoAnalise();
  const recorder = useAudioRecorder();
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const problemaRef = useRef<HTMLTextAreaElement | null>(null);
  const similares = useAcoesSimilares();
  const [similaresOpen, setSimilaresOpen] = useState(false);
  const [similaresList, setSimilaresList] = useState<AcaoSimilar[]>([]);

  const { data: comitesMap = {} } = useComitesMap();
  const comitesList = Object.keys(comitesMap).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const areasDoComite = (draft.comite && comitesMap[draft.comite]?.areas) || [];
  const areaAtual = areasDoComite.find((a: any) => a.nome === draft.area) || null;
  const setoresDaArea: string[] = areaAtual?.setores ?? [];

  useEffect(() => {
    if (!draft.comite) return;
    const info = comitesMap[draft.comite];
    if (!info) return;
    if (draft.area && !info.areasNomes.includes(draft.area)) {
      updateDraft({ area: "", setor: "" });
    }
  }, [draft.comite, comitesMap]);

  useEffect(() => {
    if (!draft.area || !areaAtual) return;
    const patch: Partial<Draft> = {};
    if (areaAtual.gestor && !draft.responsavel_nome) patch.responsavel_nome = areaAtual.gestor;
    if (draft.setor && !setoresDaArea.includes(draft.setor)) patch.setor = "";
    if (Object.keys(patch).length) updateDraft(patch as Draft);
  }, [draft.area, areaAtual]);

  useEffect(() => {
    if (error) toast({ title: "Copiloto IA", description: error, variant: "destructive" });
  }, [error]);

  useEffect(() => {
    if (analise.error) toast({ title: "Análise IA", description: analise.error, variant: "destructive" });
  }, [analise.error]);

  const handleAnalisar = async () => {
    await analise.run(draft, messages);
  };

  const handleUsarSugestao = (texto: string) => {
    if (!texto?.trim()) return;
    updateDraft({ problema: texto });
    toast({ title: "Problema atualizado", description: "Texto sugerido pela IA aplicado ao rascunho." });
  };

  const handleManterProblema = () => {
    toast({ title: "Mantido", description: "Texto original do problema preservado." });
  };

  const handleEditarProblema = () => {
    problemaRef.current?.focus();
  };

  if (loading) return <div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;
  if (!allowed) return <PermissionDenied />;

  const handleMic = async () => {
    if (recorder.isRecording) {
      const out = await recorder.stop();
      if (!out) return;
      const texto = await transcribe(out.base64, out.mime);
      if (texto) await send(texto);
    } else {
      try { await recorder.start(); } catch (e: any) {
        toast({ title: "Microfone", description: e?.message ?? "Permita o acesso ao microfone.", variant: "destructive" });
      }
    }
  };

  const handleSendText = async () => {
    if (!text.trim()) return;
    const t = text;
    setText("");
    await send(t);
  };

  const camposObrig = ["titulo", "acao", "prioridade_normalizada", "data_fim_planejado"] as const;
  const CAMPO_LABEL: Record<typeof camposObrig[number], string> = {
    titulo: "título",
    acao: "ação",
    prioridade_normalizada: "prioridade normalizada",
    data_fim_planejado: "data fim planejada",
  };
  const faltando = camposObrig.filter((c) => !(draft as any)[c]);
  const podeCriar = pronto && faltando.length === 0;

  const executarCriacao = async () => {
    setCreating(true);
    const id = await criar();
    setCreating(false);
    if (id) {
      toast({ title: "Ação criada", description: "Plano de ação registrado com sucesso." });
      setSimilaresOpen(false);
      reset();
      navigate(`/app/plano-acoes/${id}`);
    }
  };

  const handleCriar = async () => {
    setCreating(true);
    let encontrados: AcaoSimilar[] = [];
    try {
      encontrados = await similares.buscar(draft);
    } catch (e: any) {
      toast({ title: "Validação de duplicidade", description: e?.message ?? "Falha ao consultar ações similares.", variant: "destructive" });
    }
    setCreating(false);
    const relevantes = encontrados.filter((s) => s.nivel !== "baixa");
    if (relevantes.length === 0) {
      await executarCriacao();
      return;
    }
    setSimilaresList(encontrados);
    setSimilaresOpen(true);
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-8rem)] gap-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-xl bg-gradient-to-br from-primary to-primary/60 p-2.5 shadow-lg shadow-primary/20 shrink-0">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">Copiloto IA</h1>
            <p className="text-xs text-muted-foreground">Central executiva: voz, contexto, qualificação e cronograma. Acesso restrito à Presidência.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleAnalisar} disabled={analise.loading}>
            {analise.loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Atualizar análise
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { reset(); analise.reset(); }}>
            <RefreshCcw className="h-4 w-4 mr-1" /> Nova conversa
          </Button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
        {/* Coluna esquerda — Assistente */}
        <div className="lg:col-span-3 xl:col-span-3 flex flex-col min-h-0">
          <AssistantPanel
            messages={messages}
            text={text}
            setText={setText}
            onSend={handleSendText}
            onMic={handleMic}
            isRecording={recorder.isRecording}
            recLevel={recorder.level}
            thinking={thinking}
            transcribing={transcribing}
          />
        </div>

        {/* Coluna central — Inteligência da IA */}
        <div className="lg:col-span-5 xl:col-span-5 flex flex-col min-h-0">
          <ScrollArea className="flex-1 lg:max-h-[calc(100vh-12rem)]">
            <div className="space-y-4 pr-2">
              <ContextoCard contexto={analise.data?.contexto} loading={analise.loading} />
              <SugestoesCard sugestoes={analise.data?.sugestoes} loading={analise.loading} />
              <QualificacaoProblemaCard
                qualificacao={analise.data?.qualificacao_problema}
                loading={analise.loading}
                onUsarSugestao={handleUsarSugestao}
                onManter={handleManterProblema}
                onEditarManual={handleEditarProblema}
              />
              <GanttSimplificado etapas={analise.data?.gantt_etapas} loading={analise.loading} />
            </div>
          </ScrollArea>
        </div>

        {/* Coluna direita — Ação em rascunho + extras */}
        <div className="lg:col-span-4 xl:col-span-4 flex flex-col min-h-0">
          <ScrollArea className="flex-1 lg:max-h-[calc(100vh-12rem)]">
            <div className="space-y-4 pr-2">
              <Card className="flex flex-col border-primary/10 overflow-hidden">
                <div className="p-4 border-b bg-gradient-to-br from-primary/5 to-transparent">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-sm">Ação em rascunho</h2>
                    {pronto && <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400">Pronta</Badge>}
                  </div>
                  {faltando.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Faltando: {faltando.map((c) => CAMPO_LABEL[c]).join(", ")}
                    </p>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  <DraftField label="Título *" value={draft.titulo} onChange={(v) => updateDraft({ titulo: v })} placeholder="Curto e descritivo" />
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Ação *</Label>
                    <Textarea rows={3} value={draft.acao ?? ""} onChange={(e) => updateDraft({ acao: e.target.value })} placeholder="O que será feito" className="bg-background/50" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Problema</Label>
                    <Textarea ref={problemaRef} rows={2} value={draft.problema ?? ""} onChange={(e) => updateDraft({ problema: e.target.value })} className="bg-background/50" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Prioridade *</Label>
                      <Select value={draft.prioridade_normalizada ?? ""} onValueChange={(v) => updateDraft({ prioridade_normalizada: v as Draft["prioridade_normalizada"] })}>
                        <SelectTrigger className="bg-background/50"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {PRIORIDADES.map((p) => <SelectItem key={p} value={p}>{PRIORIDADE_LABEL[p]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <DraftField label="Data fim *" type="date" value={draft.data_fim_planejado} onChange={(v) => updateDraft({ data_fim_planejado: v })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Comitê</Label>
                      {comitesList.length > 0 ? (
                        <Select value={draft.comite || "__none"} onValueChange={(v) => updateDraft({ comite: v === "__none" ? "" : v })}>
                          <SelectTrigger className="bg-background/50"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">—</SelectItem>
                            {comitesList.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input value={draft.comite ?? ""} onChange={(e) => updateDraft({ comite: e.target.value })} className="bg-background/50" />
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Área</Label>
                      {areasDoComite.length > 0 ? (
                        <Select value={draft.area || "__none"} disabled={!draft.comite} onValueChange={(v) => updateDraft({ area: v === "__none" ? "" : v })}>
                          <SelectTrigger className="bg-background/50"><SelectValue placeholder={draft.comite ? "—" : "Escolha o comitê"} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">—</SelectItem>
                            {areasDoComite.map((a: any) => <SelectItem key={a.nome} value={a.nome}>{a.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input value={draft.area ?? ""} disabled={!draft.comite} onChange={(e) => updateDraft({ area: e.target.value })} placeholder={draft.comite ? "Digite a área" : "Escolha o comitê"} className="bg-background/50" />
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Setor</Label>
                    {setoresDaArea.length > 0 ? (
                      <Select value={draft.setor || "__none"} disabled={!draft.area} onValueChange={(v) => updateDraft({ setor: v === "__none" ? "" : v })}>
                        <SelectTrigger className="bg-background/50"><SelectValue placeholder={draft.area ? "—" : "Escolha a área"} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">—</SelectItem>
                          {setoresDaArea.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input value={draft.setor ?? ""} disabled={!draft.area} onChange={(e) => updateDraft({ setor: e.target.value })} placeholder={draft.area ? "Sem setores cadastrados" : "Escolha a área"} className="bg-background/50" />
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <DraftField label="Início planejado" type="date" value={draft.data_inicio_planejado} onChange={(v) => updateDraft({ data_inicio_planejado: v })} />
                    <DraftField label="Custo previsto" type="number" value={draft.custo_previsto?.toString()} onChange={(v) => updateDraft({ custo_previsto: v ? Number(v) : undefined })} />
                  </div>
                  <DraftField label="Responsável (nome)" value={draft.responsavel_nome} onChange={(v) => updateDraft({ responsavel_nome: v })} />
                </div>
                <div className="p-3 border-t bg-muted/30 flex gap-2">
                  <Button variant="outline" onClick={reset} className="flex-1"><X className="h-4 w-4 mr-1" /> Descartar</Button>
                  <Button onClick={handleCriar} disabled={!podeCriar || creating} className="flex-1 bg-gradient-to-r from-primary to-primary/80">
                    {creating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                    Confirmar e criar
                  </Button>
                </div>
              </Card>

              <MembrosComiteCard comiteSelecionado={draft.comite || undefined} />
              <AnaliseRiscoCard riscos={analise.data?.riscos} loading={analise.loading} />
            </div>
          </ScrollArea>
        </div>
      </div>

      <AcoesSimilaresDialog
        open={similaresOpen}
        onOpenChange={setSimilaresOpen}
        similares={similaresList}
        draft={draft}
        onAbrirExistente={(id) => { setSimilaresOpen(false); navigate(`/app/plano-acoes/${id}`); }}
        onCriarComplementar={() => { void executarCriacao(); }}
        onCriarMesmoAssim={() => { void executarCriacao(); }}
      />
    </div>
  );
}
