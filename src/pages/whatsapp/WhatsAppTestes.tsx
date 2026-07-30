import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Bot, ShieldAlert, Send, RotateCcw, Plug, Inbox, Settings, FlaskConical,
  MousePointerClick, AlertTriangle, CheckCircle2, Clock, Code2,
} from "lucide-react";
import { TESTE_TIPO_LABEL, type WaModo, type WaTesteDiagnostico, type WaTesteResposta } from "./types";

// Uma bolha da conversa simulada. `botoes` aparece quando o bot apresentaria o
// menu — dá para clicar e seguir o fluxo como o cliente faria no celular.
interface Bolha {
  autor: "cliente" | "bot";
  texto: string;
  nota?: string;
  tipo?: string;
  botoes?: Array<{ id: string; titulo: string }>;
}

export default function WhatsAppTestes() {
  const nav = useNavigate();
  const { toast } = useToast();
  const { data: access } = useAccessibleMenus("visualizar");
  const podeTestar = access?.codes.has("whatsapp_testes") ?? false;
  const podeConfig = access?.codes.has("whatsapp_chatbot") ?? false;

  const [bolhas, setBolhas] = useState<Bolha[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [ignorarHorario, setIgnorarHorario] = useState(false);
  const [diag, setDiag] = useState<WaTesteDiagnostico | null>(null);
  const [ultimoSystem, setUltimoSystem] = useState<string | null>(null);
  const [verSystem, setVerSystem] = useState(false);
  // Modo da conversa simulada: o webhook reconstrói do histórico; aqui a gente
  // guarda no estado e devolve a cada chamada, para o fluxo bater com o real.
  const [modo, setModo] = useState<WaModo>("menu");
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [bolhas]);

  // Histórico no formato que a função espera (só o que o bot "lembraria").
  const historico = bolhas
    .filter((b) => b.texto)
    .map((b) => ({ role: b.autor === "cliente" ? ("user" as const) : ("assistant" as const), content: b.texto }));

  const chamar = async (corpo: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("whatsapp-testar", {
      body: { ignorar_horario: ignorarHorario, historico, modo, ...corpo },
    });
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    const r = data as WaTesteResposta & { error?: string };
    if (r?.error) throw new Error(r.error);
    return r;
  };

  const enviar = async (mensagem?: string, replyId?: string) => {
    const msg = (mensagem ?? texto).trim();
    if ((!msg && !replyId) || enviando) return;
    setEnviando(true);
    if (msg) setBolhas((b) => [...b, { autor: "cliente", texto: msg }]);
    setTexto("");
    try {
      const r = await chamar({ mensagem: msg || "(opção do menu)", reply_id: replyId ?? null });
      setDiag(r.diagnostico);
      setUltimoSystem(r.system ?? null);
      if (r.modo) setModo(r.modo);
      setBolhas((b) => [...b, {
        autor: "bot",
        texto: r.resposta ?? "",
        nota: r.nota,
        tipo: r.tipo,
        botoes: r.botoes,
      }]);
    } catch (e) {
      toast({ title: "Falha ao simular", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setEnviando(false);
    }
  };

  const testarConexao = async () => {
    if (enviando) return;
    setEnviando(true);
    try {
      const r = await chamar({ acao: "ping" });
      setDiag(r.diagnostico);
      toast({
        title: r.ok ? "Conexão com a IA funcionando" : "A IA não respondeu",
        description: r.ok
          ? `${r.diagnostico.provedor} · ${r.diagnostico.modelo} · ${r.diagnostico.ms} ms`
          : r.diagnostico.erro ?? "erro desconhecido",
        variant: r.ok ? undefined : "destructive",
      });
    } catch (e) {
      toast({ title: "Falha no teste", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setEnviando(false);
    }
  };

  const reiniciar = () => { setBolhas([]); setDiag(null); setUltimoSystem(null); setModo("menu"); };

  if (!podeTestar) {
    return (
      <div>
        <PageHeader title="WhatsApp — Testes" module="Central de Serviços" breadcrumb={["WhatsApp", "Testes"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Acesso restrito. Peça a liberação de <b>WhatsApp — Testes</b> em Acesso por Usuário.
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="WhatsApp — Testes"
        subtitle="Converse com o bot exatamente como um cliente, sem enviar nada de verdade."
        module="Central de Serviços"
        breadcrumb={["WhatsApp", "Testes"]}
        actions={
          <div className="flex gap-2">
            {podeConfig && (
              <Button variant="outline" className="gap-1.5" onClick={() => nav("/app/whatsapp/chatbot")}>
                <Settings className="h-4 w-4" /> Chatbot
              </Button>
            )}
            <Button variant="outline" className="gap-1.5" onClick={() => nav("/app/whatsapp")}>
              <Inbox className="h-4 w-4" /> Caixa de Entrada
            </Button>
          </div>
        }
      />

      <div className="mb-3 flex items-center gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
        <FlaskConical className="h-4 w-4 shrink-0 text-info" />
        Ambiente de simulação: usa a configuração real do bot (persona, provedor, base de conhecimento, menu e
        horário), mas <b>não envia mensagem para ninguém</b> e <b>não grava na Caixa de Entrada</b>.
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Simulador */}
        <Card className="flex h-[calc(100vh-300px)] min-h-[420px] min-w-0 flex-col overflow-hidden p-0">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-success" />
              <p className="text-sm font-semibold">Conversa simulada</p>
              {bolhas.length === 0
                ? <Badge variant="outline" className="text-[10px]">primeiro contato</Badge>
                : <Badge variant="outline" className="text-[10px]">{modo === "ia" ? "atendimento por I.A" : "no menu"}</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox" className="h-3.5 w-3.5 accent-primary"
                  checked={ignorarHorario} onChange={(e) => setIgnorarHorario(e.target.checked)}
                />
                Ignorar horário
              </label>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={testarConexao} disabled={enviando}>
                <Plug className="h-3.5 w-3.5" /> Testar conexão
              </Button>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={reiniciar} disabled={!bolhas.length}>
                <RotateCcw className="h-3.5 w-3.5" /> Reiniciar
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-4">
            {bolhas.length === 0 && (
              <div className="mt-8 text-center text-xs text-muted-foreground">
                <p>Escreva como se fosse um cliente chegando no WhatsApp.</p>
                <p className="mt-1">Ex.: “Bom dia, tem vaga de recepcionista?”</p>
              </div>
            )}
            {bolhas.map((b, i) => {
              const saida = b.autor === "bot";
              return (
                <div key={i} className={`flex ${saida ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm shadow-sm ${saida ? "bg-success/90 text-success-foreground" : "bg-card"}`}>
                    {saida && b.tipo && (
                      <p className="mb-0.5 text-[10px] font-semibold uppercase opacity-80">
                        {TESTE_TIPO_LABEL[b.tipo as keyof typeof TESTE_TIPO_LABEL] ?? b.tipo}
                      </p>
                    )}
                    {b.texto && <p className="whitespace-pre-wrap break-words">{b.texto}</p>}
                    {b.botoes?.length ? (
                      <div className="mt-1.5 space-y-1 border-t border-current/15 pt-1.5">
                        {b.botoes.map((op) => (
                          <button
                            key={op.id}
                            onClick={() => enviar(op.titulo, op.id)}
                            disabled={enviando}
                            className="flex w-full items-center justify-center gap-1 rounded-md bg-success-foreground/15 px-2 py-1 text-xs font-medium hover:bg-success-foreground/25"
                          >
                            <MousePointerClick className="h-3 w-3 opacity-70" /> {op.titulo}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {b.nota && <p className="mt-1 text-[10px] italic opacity-80">{b.nota}</p>}
                  </div>
                </div>
              );
            })}
            {enviando && <p className="text-center text-[11px] text-muted-foreground">bot digitando…</p>}
            <div ref={fimRef} />
          </div>

          <div className="shrink-0 border-t border-border p-3">
            <div className="flex items-end gap-2">
              <Textarea
                rows={1} className="max-h-32 min-h-[40px] resize-none"
                placeholder="Mensagem do cliente…"
                value={texto} onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
              />
              <Button
                className="shrink-0 gap-1.5 bg-success text-success-foreground hover:bg-success/90"
                onClick={() => enviar()} disabled={!texto.trim() || enviando}
              >
                <Send className="h-4 w-4" /> {enviando ? "…" : "Enviar"}
              </Button>
            </div>
          </div>
        </Card>

        {/* Diagnóstico */}
        <div className="space-y-3">
          <Card className="space-y-2.5 p-4">
            <p className="text-sm font-bold">Diagnóstico</p>
            {!diag ? (
              <p className="text-xs text-muted-foreground">Envie uma mensagem ou clique em Testar conexão.</p>
            ) : (
              <>
                {diag.erro && (
                  <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/5 p-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-destructive">A IA não respondeu</p>
                      <p className="break-words text-[11px] text-muted-foreground">{diag.erro}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        O cliente receberia a mensagem de fallback. Confira o secret{" "}
                        <code className="rounded bg-muted px-1">{diag.secret_esperado}</code> e se o modelo
                        pertence ao provedor selecionado.
                      </p>
                    </div>
                  </div>
                )}
                {!diag.erro && (
                  <div className="flex items-center gap-1.5 text-xs text-success">
                    <CheckCircle2 className="h-4 w-4" /> IA respondeu em {diag.ms} ms
                  </div>
                )}

                <dl className="space-y-1 text-xs">
                  <Linha rotulo="Provedor" valor={diag.provedor} />
                  <Linha rotulo="Modelo" valor={diag.modelo} />
                  <Linha rotulo="Base de conhecimento" valor={`${diag.base_itens} ${diag.base_itens === 1 ? "item" : "itens"}`} />
                  <Linha rotulo="Menu de atendimento" valor={diag.menu_ativo ? "configurado" : "sem opções (IA direta)"} />
                  <Linha
                    rotulo="Horário"
                    valor={diag.atende_24h ? "24h, todos os dias" : diag.dentro_horario ? "dentro da janela" : "fora da janela"}
                  />
                </dl>

                {!diag.bot_ativo && (
                  <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/5 p-2.5 text-[11px] text-muted-foreground">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    O chatbot está <b>desligado</b> no momento. A simulação funciona mesmo assim, mas nenhum
                    cliente real receberia resposta automática até ligá-lo na tela do Chatbot.
                  </div>
                )}
                {diag.base_itens === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Sem base de conhecimento cadastrada, o bot não tem o que responder sobre vagas, prazos ou
                    procedimentos — ele foi instruído a não inventar.
                  </p>
                )}
              </>
            )}
          </Card>

          {ultimoSystem && (
            <Card className="space-y-2 p-4">
              <button
                className="flex w-full items-center gap-1.5 text-sm font-bold"
                onClick={() => setVerSystem((v) => !v)}
              >
                <Code2 className="h-4 w-4 text-muted-foreground" />
                Prompt enviado à IA
                <span className="ml-auto text-[11px] font-normal text-muted-foreground">
                  {verSystem ? "ocultar" : "ver"}
                </span>
              </button>
              {verSystem && (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-[10px] leading-relaxed">
                  {ultimoSystem}
                </pre>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{valor}</dd>
    </div>
  );
}
