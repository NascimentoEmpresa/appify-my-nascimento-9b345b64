import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Send, Search, ShieldAlert, Settings, User, MessageCircle, MousePointerClick, FileText, Inbox, AlertTriangle, Loader2, Check, CheckCheck, Paperclip, X, SmilePlus } from "lucide-react";
import {
  fmtHora, fmtTelefone, iniciais, motivoFalha, MENU_TODAS, EMOJIS_REACAO,
  type WaConversa, type WaContato, type WaMensagem, type WaMidia, type WaPasta,
} from "./types";

// Pseudo-pastas da barra lateral. "todas" é a visão completa (exige a permissão
// whatsapp_todas); "sem_pasta" é a triagem — o que o bot ainda não direcionou.
const TODAS = "todas";
const SEM_PASTA = "sem_pasta";

export default function WhatsAppInbox() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: access } = useAccessibleMenus("visualizar");
  const podeVer = access?.codes.has("whatsapp") ?? false;
  const podeConfig = access?.codes.has("whatsapp_chatbot") ?? false;
  const podeTodas = access?.codes.has(MENU_TODAS) ?? false;

  const [selId, setSelId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [anexo, setAnexo] = useState<File | null>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);
  // Pasta aberta. Começa vazio e é resolvido assim que as pastas carregam: quem
  // tem "todas as conversas" abre nela; quem não tem, abre na primeira pasta
  // liberada — senão a tela abriria vazia sem explicar por quê.
  const [pastaSel, setPastaSel] = useState<string>("");
  const fimRef = useRef<HTMLDivElement>(null);

  // Catálogo de pastas, recortado pelo que a pessoa pode ver. A RLS já filtra as
  // CONVERSAS; aqui é só para não desenhar aba de pasta que ela não acessa.
  const { data: pastas = [] } = useQuery({
    queryKey: ["wa-pastas"],
    enabled: podeVer,
    queryFn: async () => {
      const { data } = await (supabase as any).from("WA_PASTA").select("*").eq("ativo", true).order("ordem");
      return (data ?? []) as WaPasta[];
    },
  });
  const pastasVisiveis = useMemo(
    () => pastas.filter((p) => podeTodas || (access?.codes.has(p.menu_codigo) ?? false)),
    [pastas, podeTodas, access]);

  // Conversas (com contato) — poll leve.
  const { data: conversas = [] } = useQuery({
    queryKey: ["wa-conversas"],
    enabled: podeVer,
    refetchInterval: 8000,
    queryFn: async () => {
      const { data: convs } = await (supabase as any).from("WA_CONVERSA")
        .select("*").order("ultima_mensagem_em", { ascending: false, nullsFirst: false });
      const lista = (convs ?? []) as WaConversa[];
      const ids = [...new Set(lista.map((c) => c.contato_id))];
      const mapa: Record<string, WaContato> = {};
      if (ids.length) {
        const { data: cts } = await (supabase as any).from("WA_CONTATO").select("*").in("id", ids);
        for (const c of cts ?? []) mapa[c.id] = c as WaContato;
      }
      return lista.map((c) => ({ ...c, contato: mapa[c.contato_id] ?? null }));
    },
  });

  // Resolve a pasta inicial uma única vez (o `!pastaSel` evita voltar para a
  // inicial a cada refetch das pastas).
  useEffect(() => {
    if (pastaSel) return;
    if (podeTodas) { setPastaSel(TODAS); return; }
    if (pastasVisiveis.length) setPastaSel(pastasVisiveis[0].codigo);
  }, [pastaSel, podeTodas, pastasVisiveis]);

  const sel = useMemo(() => conversas.find((c) => c.id === selId) ?? null, [conversas, selId]);

  // Conversas de cada pasta — a contagem das abas e a lista saem daqui.
  const daPasta = (codigo: string) =>
    codigo === TODAS ? conversas
      : codigo === SEM_PASTA ? conversas.filter((c) => !c.pasta_codigo)
        : conversas.filter((c) => c.pasta_codigo === codigo);

  // Abas: "Todas as conversas" e a triagem só para quem enxerga tudo.
  const abas = useMemo(() => [
    ...(podeTodas ? [{ codigo: TODAS, nome: "Todas as conversas" }, { codigo: SEM_PASTA, nome: "Sem pasta" }] : []),
    ...pastasVisiveis.map((p) => ({ codigo: p.codigo, nome: p.nome })),
  ], [podeTodas, pastasVisiveis]);

  // Mover a conversa de pasta à mão (o bot direciona sozinho, mas o atendente
  // precisa poder corrigir/encaminhar).
  const moverPara = async (codigo: string) => {
    if (!sel) return;
    const destino = codigo === SEM_PASTA ? null : codigo;
    const { error } = await (supabase as any).from("WA_CONVERSA").update({ pasta_codigo: destino }).eq("id", sel.id);
    if (error) { toast({ title: "Não deu para mover", description: error.message, variant: "destructive" }); return; }
    // Sem acesso ao destino a conversa sai de vista na hora (a RLS deixa de
    // devolvê-la) — fechar a thread evita um painel preso num registro sumido.
    const aindaVejo = podeTodas || pastasVisiveis.some((p) => p.codigo === destino);
    if (!aindaVejo) setSelId(null);
    qc.invalidateQueries({ queryKey: ["wa-conversas"] });
  };

  // Mensagens da conversa selecionada — poll mais rápido.
  const { data: mensagens = [] } = useQuery({
    queryKey: ["wa-mensagens", selId],
    enabled: podeVer && !!selId,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("WA_MENSAGEM")
        .select("*").eq("conversa_id", selId).order("criada_em", { ascending: true });
      return (data ?? []) as WaMensagem[];
    },
  });

  useEffect(() => { fimRef.current?.scrollIntoView({ block: "end" }); }, [mensagens.length, selId]);

  // Ao abrir a conversa, zera as não lidas.
  const abrir = async (c: WaConversa) => {
    setSelId(c.id);
    if (c.nao_lidas > 0) {
      await (supabase as any).from("WA_CONVERSA").update({ nao_lidas: 0 }).eq("id", c.id);
      qc.invalidateQueries({ queryKey: ["wa-conversas"] });
    }
  };

  const alternarBot = async () => {
    if (!sel) return;
    const { error } = await (supabase as any).from("WA_CONVERSA").update({ bot_ativo: !sel.bot_ativo }).eq("id", sel.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["wa-conversas"] });
  };

  // Reagir/desreagir. Clicar no emoji que já está marcado remove (a Meta usa
  // emoji vazio pra isso). Só vale pra mensagem que já tem wamid.
  const reagir = async (m: WaMensagem, emoji: string) => {
    if (!sel || !m.wa_message_id) return;
    const atual = m.payload?.reacoes?.nossa ?? null;
    const { error } = await supabase.functions.invoke("whatsapp-enviar", {
      body: { conversa_id: sel.id, reagir: { wa_message_id: m.wa_message_id, emoji: atual === emoji ? "" : emoji } },
    });
    if (error) { toast({ title: "Não deu para reagir", description: String(error.message ?? error), variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["wa-mensagens", sel.id] });
  };

  // Anexo pendente: escolhido/colado, ainda não enviado. Fica aqui e não no
  // envio direto pra dar tempo de conferir o print e escrever uma legenda.
  const anexar = (arquivo: File | null | undefined) => {
    if (!arquivo) return;
    const limite = arquivo.type.startsWith("image/") ? 5 : arquivo.type.startsWith("video/") || arquivo.type.startsWith("audio/") ? 16 : 100;
    if (arquivo.size > limite * 1024 * 1024) {
      toast({ title: "Arquivo grande demais", description: `O WhatsApp aceita até ${limite} MB para esse tipo.`, variant: "destructive" });
      return;
    }
    setAnexo(arquivo);
  };

  // Ctrl+V com print na área de transferência: o navegador entrega o PNG como
  // item de arquivo do evento de colar. Texto copiado segue colando normal.
  const aoColar = (e: React.ClipboardEvent) => {
    const arquivo = Array.from(e.clipboardData.files)[0];
    if (!arquivo) return;
    e.preventDefault();
    anexar(arquivo);
  };

  const enviar = async () => {
    if (!sel || enviando) return;
    if (!texto.trim() && !anexo) return;
    setEnviando(true);
    try {
      let midia: { storage_path: string; mime_type: string; filename: string } | undefined;
      if (anexo) {
        // Sobe direto pro bucket: base64 dentro do JSON estouraria o limite de
        // corpo da edge function num print grande.
        const nome = anexo.name || `colado-${Date.now()}.png`;
        const caminho = `saida/${sel.id}/${crypto.randomUUID()}-${nome}`.slice(0, 400);
        const { error: erroUp } = await supabase.storage.from("whatsapp-midia")
          .upload(caminho, anexo, { contentType: anexo.type || "application/octet-stream" });
        if (erroUp) throw new Error(`Falha ao subir o arquivo: ${erroUp.message}`);
        midia = { storage_path: caminho, mime_type: anexo.type || "application/octet-stream", filename: nome };
      }
      const { error } = await supabase.functions.invoke("whatsapp-enviar", {
        body: { conversa_id: sel.id, texto: texto.trim(), ...(midia ? { midia } : {}) },
      });
      if (error) throw new Error(String(error.message ?? error));
      setTexto("");
      setAnexo(null);
      qc.invalidateQueries({ queryKey: ["wa-mensagens", sel.id] });
      qc.invalidateQueries({ queryKey: ["wa-conversas"] });
    } catch (e: any) {
      toast({ title: "Falha ao enviar", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setEnviando(false);
    }
  };

  const filtradas = useMemo(() => {
    const base = pastaSel ? daPasta(pastaSel) : [];
    const t = busca.trim().toLowerCase();
    if (!t) return base;
    return base.filter((c) =>
      [c.contato?.nome, c.contato?.wa_id, c.ultima_mensagem_preview].some((v) => String(v ?? "").toLowerCase().includes(t)));
  }, [conversas, busca, pastaSel]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!podeVer) {
    return (
      <div>
        <PageHeader title="WhatsApp — Caixa de Entrada" module="Central de Serviços" breadcrumb={["WhatsApp"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Acesso restrito. Peça a liberação de <b>WhatsApp — Caixa de Entrada</b> em Acesso por Usuário.
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="WhatsApp — Caixa de Entrada"
        subtitle="Atenda conversas e acompanhe o chatbot."
        module="Central de Serviços"
        breadcrumb={["WhatsApp", "Caixa de Entrada"]}
        actions={podeConfig ? <Button variant="outline" className="gap-1.5" onClick={() => nav("/app/whatsapp/chatbot")}><Settings className="h-4 w-4" /> Chatbot</Button> : undefined}
      />

      <Card className="grid h-[calc(100vh-220px)] min-h-[480px] grid-cols-[320px_minmax(0,1fr)] overflow-hidden p-0">
        {/* Lista de conversas */}
        <div className="flex min-h-0 flex-col border-r border-border">
          {/* Pastas. A lista só mostra a pasta aberta — "Todas as conversas" é
              uma opção, não o padrão de todo mundo. */}
          <div className="flex flex-wrap gap-1 border-b border-border p-2">
            {abas.map((a) => {
              const n = daPasta(a.codigo).reduce((s, c) => s + (c.nao_lidas || 0), 0);
              const ativa = pastaSel === a.codigo;
              return (
                <button
                  key={a.codigo}
                  onClick={() => { setPastaSel(a.codigo); setSelId(null); }}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    ativa ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
                >
                  {a.codigo === TODAS && <Inbox className="h-3 w-3" />}
                  {a.nome}
                  {n > 0 && (
                    <span className={`rounded-full px-1 text-[10px] font-bold ${ativa ? "bg-primary-foreground/25" : "bg-success text-success-foreground"}`}>{n}</span>
                  )}
                </button>
              );
            })}
            {abas.length === 0 && (
              <p className="p-1 text-[11px] text-muted-foreground">
                Nenhuma pasta liberada para você. Peça acesso em Administração › Acesso por Usuário.
              </p>
            )}
          </div>
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="h-9 pl-8 text-sm" placeholder="Buscar conversa…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtradas.map((c) => (
              <button
                key={c.id}
                onClick={() => abrir(c)}
                className={`flex w-full items-center gap-2.5 border-b border-border/50 px-3 py-2.5 text-left hover:bg-muted/50 ${selId === c.id ? "bg-muted" : ""}`}
              >
                <Avatar className="h-9 w-9 shrink-0"><AvatarFallback className="bg-success/15 text-[11px] text-success">{iniciais(c.contato?.nome, c.contato?.wa_id)}</AvatarFallback></Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{c.contato?.nome || fmtTelefone(c.contato?.wa_id)}</p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{fmtHora(c.ultima_mensagem_em)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {c.ultima_direcao === "saida" ? "Você: " : ""}{c.ultima_mensagem_preview || "—"}
                    </p>
                    {!c.bot_ativo && <User className="h-3 w-3 shrink-0 text-info" />}
                    {c.nao_lidas > 0 && <Badge className="h-4 min-w-4 justify-center rounded-full bg-success px-1 text-[10px] text-success-foreground">{c.nao_lidas}</Badge>}
                  </div>
                </div>
              </button>
            ))}
            {filtradas.length === 0 && <p className="p-6 text-center text-xs text-muted-foreground">Nenhuma conversa.</p>}
          </div>
        </div>

        {/* Thread */}
        {!sel ? (
          <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessageCircle className="h-10 w-10 opacity-40" />
            <p className="text-sm">Selecione uma conversa</p>
          </div>
        ) : (
          // min-h-0: sem isso o item do grid cresce com o conteúdo, o composer
          // é empurrado para fora do Card (que tem overflow-hidden) e some da
          // tela assim que a conversa fica longa.
          <div className="flex min-h-0 min-w-0 flex-col">
            {/* Cabeçalho */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <Avatar className="h-8 w-8"><AvatarFallback className="bg-success/15 text-[11px] text-success">{iniciais(sel.contato?.nome, sel.contato?.wa_id)}</AvatarFallback></Avatar>
                <div>
                  <p className="text-sm font-semibold">{sel.contato?.nome || fmtTelefone(sel.contato?.wa_id)}</p>
                  <p className="text-[11px] text-muted-foreground">{fmtTelefone(sel.contato?.wa_id)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={sel.pasta_codigo ?? SEM_PASTA} onValueChange={moverPara}>
                  <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Pasta" /></SelectTrigger>
                  <SelectContent>
                    {podeTodas && <SelectItem value={SEM_PASTA}>Sem pasta</SelectItem>}
                    {pastasVisiveis.map((p) => <SelectItem key={p.codigo} value={p.codigo}>{p.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline" size="sm"
                  className={`gap-1.5 ${sel.bot_ativo ? "border-success/40 text-success" : "border-info/40 text-info"}`}
                  onClick={alternarBot}
                >
                  {sel.bot_ativo ? <><Bot className="h-4 w-4" /> Bot ativo</> : <><User className="h-4 w-4" /> Atendimento humano</>}
                </Button>
              </div>
            </div>

            {/* Mensagens */}
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-4">
              {mensagens.map((m) => {
                const saida = m.direcao === "saida";
                return (
                  <div key={m.id} className={`group flex items-center gap-1 ${saida ? "justify-end" : "justify-start"}`}>
                    {/* Seletor de reação: aparece no hover, do lado de fora da
                        bolha, para não empurrar o texto nem cobrir o conteúdo. */}
                    {saida && m.wa_message_id && <SeletorReacao onEscolher={(e) => reagir(m, e)} atual={m.payload?.reacoes?.nossa} />}
                    <div className={`relative max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm ${saida ? "bg-success/90 text-success-foreground" : "bg-card"}`}>
                      {m.origem === "bot" && <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase opacity-80"><Bot className="h-3 w-3" /> bot</p>}
                      {!saida && m.payload?.reply_id && (
                        <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase opacity-70"><MousePointerClick className="h-3 w-3" /> resposta</p>
                      )}
                      {m.payload?.midia && <div className="mb-1"><MidiaAnexo midia={m.payload.midia} /></div>}
                      {m.texto && !(m.payload?.midia && /^\[[a-z]+\]$/i.test(m.texto)) && (
                        <TextoComLinks texto={m.texto} />
                      )}
                      {m.payload?.botoes?.length ? (
                        <div className="mt-1.5 space-y-1 border-t border-current/15 pt-1.5">
                          {m.payload.botoes.map((b) => (
                            <div key={b.id} className={`flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${saida ? "bg-success-foreground/15" : "bg-muted"}`}>
                              <MousePointerClick className="h-3 w-3 opacity-70" /> {b.titulo}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {m.status === "erro" && motivoFalha(m.payload?.erro) && (
                        <p className="mt-1 flex items-start gap-1 rounded bg-destructive/15 px-1.5 py-1 text-[10px] leading-snug text-destructive-foreground/90">
                          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                          <span>{motivoFalha(m.payload?.erro)}</span>
                        </p>
                      )}
                      <p className={`mt-0.5 flex items-center justify-end gap-1 text-right text-[10px] ${saida ? "opacity-80" : "text-muted-foreground"}`}>
                        {fmtHora(m.criada_em)}
                        {saida && <TiqueStatus status={m.status} />}
                      </p>
                      {/* Chips das reações, "pendurados" na borda de baixo da
                          bolha como no WhatsApp. */}
                      {(m.payload?.reacoes?.deles || m.payload?.reacoes?.nossa) && (
                        <div className={`absolute -bottom-2.5 flex gap-0.5 ${saida ? "left-2" : "right-2"}`}>
                          {m.payload?.reacoes?.deles && (
                            <span className="rounded-full border border-border bg-card px-1 text-[11px] shadow-sm" title="Reação do contato">
                              {m.payload.reacoes.deles}
                            </span>
                          )}
                          {m.payload?.reacoes?.nossa && (
                            <span className="rounded-full border border-border bg-card px-1 text-[11px] shadow-sm" title="Sua reação">
                              {m.payload.reacoes.nossa}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {!saida && m.wa_message_id && <SeletorReacao onEscolher={(e) => reagir(m, e)} atual={m.payload?.reacoes?.nossa} />}
                  </div>
                );
              })}
              {mensagens.length === 0 && <p className="text-center text-xs text-muted-foreground">Sem mensagens ainda.</p>}
              <div ref={fimRef} />
            </div>

            {/* Composer. Menus de botões são configurados no Chatbot e enviados
                pelo bot; aqui o atendente escreve texto e pode anexar arquivo
                (clipe, arrastar ou Ctrl+V com print na área de transferência). */}
            <div
              className="shrink-0 border-t border-border p-3"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); anexar(e.dataTransfer.files?.[0]); }}
            >
              {anexo && <PreviaAnexo arquivo={anexo} onRemover={() => setAnexo(null)} />}
              <div className="flex items-end gap-2">
                <input
                  ref={inputArquivo} type="file" className="hidden"
                  onChange={(e) => { anexar(e.target.files?.[0]); e.target.value = ""; }}
                />
                <Button
                  variant="outline" size="icon" className="h-10 w-10 shrink-0"
                  title="Anexar arquivo (ou cole um print com Ctrl+V)"
                  onClick={() => inputArquivo.current?.click()} disabled={enviando}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Textarea
                  rows={1} className="max-h-32 min-h-[40px] resize-none"
                  placeholder={anexo ? "Legenda (opcional)…" : "Digite uma mensagem…"}
                  value={texto} onChange={(e) => setTexto(e.target.value)}
                  onPaste={aoColar}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                />
                <Button className="shrink-0 gap-1.5 bg-success text-success-foreground hover:bg-success/90" onClick={enviar} disabled={(!texto.trim() && !anexo) || enviando}>
                  {enviando
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</>
                    : <><Send className="h-4 w-4" /> Enviar</>}
                </Button>
              </div>
            </div>
            {sel.bot_ativo && (
              <p className="shrink-0 border-t border-border/50 bg-warning/5 px-3 py-1 text-[11px] text-muted-foreground">
                O bot responde automaticamente. Ao enviar manualmente, considere desligar o bot para assumir o atendimento.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// Seletor de reação. Fica invisível até passar o mouse na linha da mensagem
// (group-hover) para não poluir a conversa com seis emojis por bolha.
function SeletorReacao({ onEscolher, atual }: { onEscolher: (emoji: string) => void; atual?: string | null }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className={`rounded-full p-1 text-muted-foreground transition hover:bg-muted ${aberto ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        title="Reagir"
      >
        <SmilePlus className="h-4 w-4" />
      </button>
      {aberto && (
        <>
          {/* Camada de fora fecha ao clicar em qualquer lugar. */}
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute bottom-full z-20 mb-1 flex gap-0.5 rounded-full border border-border bg-popover p-1 shadow-md">
            {EMOJIS_REACAO.map((e) => (
              <button
                key={e} type="button"
                onClick={() => { onEscolher(e); setAberto(false); }}
                className={`rounded-full px-1 text-base leading-none transition hover:scale-125 ${atual === e ? "bg-muted" : ""}`}
                title={atual === e ? "Remover reação" : `Reagir com ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Prévia do que vai ser enviado. Print colado sem isso vira envio às cegas —
// a pessoa só descobriria o que mandou depois que o contato recebeu.
function PreviaAnexo({ arquivo, onRemover }: { arquivo: File; onRemover: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!arquivo.type.startsWith("image/")) { setUrl(null); return; }
    const u = URL.createObjectURL(arquivo);
    setUrl(u);
    return () => URL.revokeObjectURL(u); // sem isso o blob vaza a cada print colado
  }, [arquivo]);

  const kb = arquivo.size / 1024;
  const tamanho = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
  return (
    <div className="mb-2 flex items-center gap-3 rounded border border-border bg-muted/30 p-2">
      {url
        ? <img src={url} alt="" className="h-14 w-14 rounded object-cover" />
        : <FileText className="h-8 w-8 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{arquivo.name || "print colado"}</p>
        <p className="text-[11px] text-muted-foreground">{tamanho}</p>
      </div>
      <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" onClick={onRemover} title="Remover anexo">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

// Tiques de entrega, como no WhatsApp. Os estados vêm do webhook de status da
// Meta (sent/delivered/read), que já eram gravados — só não apareciam como
// ícone. "lida" só chega se o contato mantém a confirmação de leitura ligada;
// com ela desligada a mensagem para em "entregue" para sempre.
const TIQUES: Record<string, { icone: typeof Check; classe: string; titulo: string }> = {
  enviada:  { icone: Check,      classe: "opacity-70",     titulo: "Enviada — a Meta aceitou" },
  entregue: { icone: CheckCheck, classe: "opacity-70",     titulo: "Entregue no aparelho" },
  lida:     { icone: CheckCheck, classe: "text-info",      titulo: "Visualizada" },
  erro:     { icone: AlertTriangle, classe: "text-destructive", titulo: "Falhou — não foi entregue" },
};

function TiqueStatus({ status }: { status: string }) {
  const t = TIQUES[status];
  if (!t) return null;
  const Icone = t.icone;
  return (
    <span title={t.titulo} aria-label={t.titulo} className="inline-flex">
      <Icone className={`h-3.5 w-3.5 shrink-0 ${t.classe}`} />
    </span>
  );
}

// Texto da mensagem como o WhatsApp mostra: link clicável (convite de grupo,
// link de vaga — renderizar cru obrigava a copiar na mão) e *negrito*, que é
// como sai a assinatura do atendente. Link abre em aba nova, sem referrer.
const URL_NA_MENSAGEM = /(https?:\/\/[^\s<]+)/g;
const NEGRITO_WHATSAPP = /\*([^*\n]+)\*/g;

function ComNegrito({ trecho }: { trecho: string }) {
  const partes = trecho.split(NEGRITO_WHATSAPP);
  return <>{partes.map((p, i) => (i % 2 === 0 ? p : <strong key={i}>{p}</strong>))}</>;
}

function TextoComLinks({ texto }: { texto: string }) {
  const partes = texto.split(URL_NA_MENSAGEM);
  return (
    <p className="whitespace-pre-wrap break-words">
      {partes.map((parte, i) => {
        if (i % 2 === 0) return <ComNegrito key={i} trecho={parte} />;
        // Pontuação colada no fim ("...acesse https://x.com.") não é do link.
        const limpa = parte.replace(/[.,;:!?)\]}>'"]+$/, "");
        const sobra = parte.slice(limpa.length);
        return (
          <span key={i}>
            <a href={limpa} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
              {limpa}
            </a>
            {sobra}
          </span>
        );
      })}
    </p>
  );
}

// Anexo de mídia recebida: gera uma URL assinada do bucket privado e renderiza
// conforme o tipo (imagem/vídeo/áudio inline; documento e demais como download).
function MidiaAnexo({ midia }: { midia: WaMidia }) {
  const pronto = midia.status === "pronto" && !!midia.storage_path;
  const { data: url } = useQuery({
    queryKey: ["wa-midia", midia.storage_path],
    enabled: pronto,
    staleTime: 50 * 60 * 1000, // a URL assinada dura 1h; revalida bem antes
    queryFn: async () => {
      const { data } = await supabase.storage.from("whatsapp-midia").createSignedUrl(midia.storage_path!, 3600);
      return data?.signedUrl ?? null;
    },
  });

  if (midia.status === "baixando") return <p className="text-[11px] italic opacity-80">Recebendo arquivo…</p>;
  if (midia.status === "erro") return <p className="text-[11px] italic text-destructive">Falha ao baixar o arquivo.</p>;
  if (!url) return <p className="text-[11px] italic opacity-80">Carregando…</p>;

  const mime = midia.mime_type ?? "";
  if (midia.tipo === "image" || midia.tipo === "sticker" || mime.startsWith("image/")) {
    return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={midia.filename ?? "imagem"} className="max-h-60 max-w-full rounded-md" /></a>;
  }
  if (midia.tipo === "video" || mime.startsWith("video/")) {
    return <video src={url} controls className="max-h-60 max-w-full rounded-md" />;
  }
  if (midia.tipo === "audio" || mime.startsWith("audio/")) {
    return <audio src={url} controls className="w-full" />;
  }
  return (
    <a
      href={url} target="_blank" rel="noreferrer" download={midia.filename ?? undefined}
      className="flex items-center gap-2 rounded-md border border-current/25 px-2 py-1.5 text-xs hover:underline"
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate">{midia.filename ?? "documento"}</span>
    </a>
  );
}
