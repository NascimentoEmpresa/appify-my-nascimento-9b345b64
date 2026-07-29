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
import { Bot, Send, Search, ShieldAlert, Settings, User, MessageCircle, Plus, X, MousePointerClick } from "lucide-react";
import {
  fmtHora, fmtTelefone, iniciais, type WaConversa, type WaContato, type WaMensagem,
} from "./types";

export default function WhatsAppInbox() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: access } = useAccessibleMenus("visualizar");
  const podeVer = access?.codes.has("whatsapp") ?? false;
  const podeConfig = access?.codes.has("whatsapp_chatbot") ?? false;

  const [selId, setSelId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [texto, setTexto] = useState("");
  const [botoes, setBotoes] = useState<string[]>([]); // títulos dos botões de resposta (0–3)
  const [enviando, setEnviando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

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

  const sel = useMemo(() => conversas.find((c) => c.id === selId) ?? null, [conversas, selId]);

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

  const enviar = async () => {
    if (!sel || !texto.trim() || enviando) return;
    setEnviando(true);
    const btns = botoes.map((t) => t.trim()).filter(Boolean).slice(0, 3);
    const { error } = await supabase.functions.invoke("whatsapp-enviar", {
      body: {
        conversa_id: sel.id,
        texto: texto.trim(),
        ...(btns.length ? { botoes: btns.map((titulo, i) => ({ id: `opt_${i + 1}`, titulo })) } : {}),
      },
    });
    setEnviando(false);
    if (error) { toast({ title: "Falha ao enviar", description: String(error.message ?? error), variant: "destructive" }); return; }
    setTexto("");
    setBotoes([]);
    qc.invalidateQueries({ queryKey: ["wa-mensagens", sel.id] });
    qc.invalidateQueries({ queryKey: ["wa-conversas"] });
  };

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return conversas;
    return conversas.filter((c) =>
      [c.contato?.nome, c.contato?.wa_id, c.ultima_mensagem_preview].some((v) => String(v ?? "").toLowerCase().includes(t)));
  }, [conversas, busca]);

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
        <div className="flex flex-col border-r border-border">
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
          <div className="flex min-w-0 flex-col">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <Avatar className="h-8 w-8"><AvatarFallback className="bg-success/15 text-[11px] text-success">{iniciais(sel.contato?.nome, sel.contato?.wa_id)}</AvatarFallback></Avatar>
                <div>
                  <p className="text-sm font-semibold">{sel.contato?.nome || fmtTelefone(sel.contato?.wa_id)}</p>
                  <p className="text-[11px] text-muted-foreground">{fmtTelefone(sel.contato?.wa_id)}</p>
                </div>
              </div>
              <Button
                variant="outline" size="sm"
                className={`gap-1.5 ${sel.bot_ativo ? "border-success/40 text-success" : "border-info/40 text-info"}`}
                onClick={alternarBot}
              >
                {sel.bot_ativo ? <><Bot className="h-4 w-4" /> Bot ativo</> : <><User className="h-4 w-4" /> Atendimento humano</>}
              </Button>
            </div>

            {/* Mensagens */}
            <div className="flex-1 space-y-2 overflow-y-auto bg-muted/30 p-4">
              {mensagens.map((m) => {
                const saida = m.direcao === "saida";
                return (
                  <div key={m.id} className={`flex ${saida ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm ${saida ? "bg-success/90 text-success-foreground" : "bg-card"}`}>
                      {m.origem === "bot" && <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase opacity-80"><Bot className="h-3 w-3" /> bot</p>}
                      {!saida && m.payload?.reply_id && (
                        <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase opacity-70"><MousePointerClick className="h-3 w-3" /> resposta</p>
                      )}
                      <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                      {m.payload?.botoes?.length ? (
                        <div className="mt-1.5 space-y-1 border-t border-current/15 pt-1.5">
                          {m.payload.botoes.map((b) => (
                            <div key={b.id} className={`flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${saida ? "bg-success-foreground/15" : "bg-muted"}`}>
                              <MousePointerClick className="h-3 w-3 opacity-70" /> {b.titulo}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <p className={`mt-0.5 text-right text-[10px] ${saida ? "opacity-80" : "text-muted-foreground"}`}>
                        {fmtHora(m.criada_em)}{saida && m.status ? ` · ${m.status}` : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
              {mensagens.length === 0 && <p className="text-center text-xs text-muted-foreground">Sem mensagens ainda.</p>}
              <div ref={fimRef} />
            </div>

            {/* Composer */}
            <div className="border-t border-border p-3">
              {/* Editor de botões de resposta (0–3). Cada um vira um botão que o
                  cliente pode tocar; a resposta volta na própria conversa. */}
              {botoes.length > 0 && (
                <div className="mb-2 space-y-1.5">
                  {botoes.map((b, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <MousePointerClick className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <Input
                        className="h-8 max-w-xs text-sm"
                        maxLength={20}
                        placeholder={`Botão ${i + 1} (até 20 caracteres)`}
                        value={b}
                        onChange={(e) => setBotoes((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                      <span className="w-10 text-[10px] text-muted-foreground">{b.length}/20</span>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" onClick={() => setBotoes((arr) => arr.filter((_, j) => j !== i))} title="Remover botão">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <Textarea
                  rows={1} className="max-h-32 min-h-[40px] resize-none"
                  placeholder="Digite uma mensagem…"
                  value={texto} onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                />
                <div className="flex flex-col gap-1">
                  {botoes.length < 3 && (
                    <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setBotoes((arr) => [...arr, ""])} title="Adicionar botão de resposta">
                      <Plus className="h-3.5 w-3.5" /> Botão
                    </Button>
                  )}
                  <Button className="gap-1.5 bg-success text-success-foreground hover:bg-success/90" onClick={enviar} disabled={!texto.trim() || enviando}>
                    <Send className="h-4 w-4" /> {enviando ? "…" : "Enviar"}
                  </Button>
                </div>
              </div>
            </div>
            {sel.bot_ativo && (
              <p className="border-t border-border/50 bg-warning/5 px-3 py-1 text-[11px] text-muted-foreground">
                O bot responde automaticamente. Ao enviar manualmente, considere desligar o bot para assumir o atendimento.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
