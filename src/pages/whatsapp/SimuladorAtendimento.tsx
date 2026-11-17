// SIS-2026-0929 — Simulador do atendimento dos supervisores (WhatsApp › Testes).
//
// Conversa "de mentira" com o canal corporativo dos supervisores: escolhe-se
// QUEM está escrevendo (um colaborador do cadastro, um número desconhecido ou
// um número com divergência), e a Edge whatsapp-testar (acao "atendimento")
// roda o MESMO fluxo do webhook (_shared/whatsapp-atendimento-fluxo.ts) com a
// I.A, a base e as regras reais — sem enviar nada nem gravar protocolo.
// Do lado aparece o que aconteceria nos bastidores: identificação, assunto
// sensível, consulta autorizada/negada, ida para a fila e o resumo.
//
// Acesso: whatsapp_testes + whatsapp_atd_base (visualizar). A identidade
// simulada é montada no servidor; cada simulação fica no log de acessos.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Bot, Code2, FlaskConical, Image as ImageIcon, RotateCcw, Search, Send, ShieldAlert, ShieldCheck, Undo2, User,
} from "lucide-react";
import { STATUS_ROTULO, STATUS_COR, PAPEL_ROTULO, type StatusAtendimento } from "@/lib/whatsapp/atendimentoSupervisores";

type Quem = "empregado" | "desconhecido" | "divergente";
interface Pessoa { id: number; nome: string; cargo: string | null; contrato: string | null; papel: string }
interface Evento { tipo: string; detalhe: string }
interface Bolha { autor: "pessoa" | "bot" | "bastidor"; texto: string; eventos?: Evento[] }
interface Resposta {
  respostas: string[];
  trilha: { protocolo: string | null; status_final: string; eventos: Evento[]; system: string | null;
            ia: { provedor: string; modelo: string; ms: number; erro: string | null; bruto: string | null } | null };
  diagnostico: { canal_ativo_de_verdade: boolean; ia_ativa_de_verdade: boolean; numero_configurado: boolean; base_itens: number; usou_pendentes: boolean };
  error?: string;
}

const ROTEIROS = [
  "Oi, bom dia",
  "Qual é a minha escala?",
  "Qual o meu cargo e posto?",
  "Quanto vou receber de salário?",
  "Onde eu entrego o atestado?",
  "Qual a escala do colaborador Fulano?",
  "Quero trocar minha folga de sábado",
  "Quero falar com um atendente",
  "Era só isso, obrigado!",
];

const COR_EVENTO: Record<string, string> = {
  encaminhado: "text-amber-700 dark:text-amber-300",
  consulta: "text-sky-700 dark:text-sky-300",
  sensivel: "text-rose-700 dark:text-rose-300",
  bloqueado: "text-rose-700 dark:text-rose-300",
  resolvido: "text-emerald-700 dark:text-emerald-300",
};

export default function SimuladorAtendimento() {
  const [quem, setQuem] = useState<Quem>("empregado");
  const [termo, setTermo] = useState("");
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [pessoa, setPessoa] = useState<Pessoa | null>(null);
  const [usarPendentes, setUsarPendentes] = useState(false);

  const [bolhas, setBolhas] = useState<Bolha[]>([]);
  const [historico, setHistorico] = useState<Array<{ direcao: "entrada" | "saida"; origem: "contato" | "bot"; texto: string }>>([]);
  const [status, setStatus] = useState<StatusAtendimento>("ia");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [ultima, setUltima] = useState<Resposta | null>(null);
  const [verPrompt, setVerPrompt] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [bolhas]);

  const novoProtocolo = () => { setBolhas([]); setHistorico([]); setStatus("ia"); setUltima(null); };

  const buscar = async () => {
    if (termo.trim().length < 3) { toast.error("Digite ao menos 3 letras do nome (ou a matrícula)."); return; }
    const { data, error } = await (supabase as any).rpc("wa_atd_simular_pessoas", { p_termo: termo.trim() });
    if (error) { toast.error(error.message); return; }
    setPessoas((data ?? []) as Pessoa[]);
    if (!(data ?? []).length) toast.message("Ninguém ativo com esse nome/matrícula.");
  };

  const enviar = async (msg: string | null, tipo: "text" | "image" = "text") => {
    const m = (msg ?? "").trim();
    if (enviando || (tipo === "text" && !m)) return;
    if (quem === "empregado" && !pessoa) { toast.error("Escolha o colaborador que está escrevendo."); return; }
    if (status === "concluido") { toast.message("Protocolo concluído: comece um novo protocolo."); return; }
    setEnviando(true);
    setTexto("");
    const textoPessoa = tipo === "text" ? m : "[foto enviada]";
    setBolhas((b) => [...b, { autor: "pessoa", texto: textoPessoa }]);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-testar", {
        body: {
          acao: "atendimento", quem, empregado_id: pessoa?.id ?? null, mensagem: m, tipo,
          historico, status, primeira: historico.length === 0, usar_pendentes: usarPendentes,
        },
      });
      if (error) throw new Error(String((error as { message?: string }).message ?? error));
      const r = data as Resposta;
      if (r?.error) throw new Error(r.error);
      setUltima(r);
      const novas: Bolha[] = r.respostas.map((t) => ({ autor: "bot", texto: t }));
      setBolhas((b) => [...b, ...novas, { autor: "bastidor", texto: "", eventos: r.trilha.eventos }]);
      setHistorico((h) => [
        ...h,
        { direcao: "entrada", origem: "contato", texto: tipo === "text" ? m : "[image]" },
        ...r.respostas.map((t) => ({ direcao: "saida" as const, origem: "bot" as const, texto: t })),
      ]);
      const st = r.trilha.status_final;
      if (st === "ia" || st === "aguardando_humano" || st === "em_atendimento_humano" || st === "concluido") setStatus(st);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBolhas((b) => b.slice(0, -1));
    } finally {
      setEnviando(false);
    }
  };

  const trocarQuem = (q: Quem) => { setQuem(q); novoProtocolo(); };
  const escolher = (p: Pessoa) => { setPessoa(p); setPessoas([]); novoProtocolo(); };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
        <FlaskConical className="h-4 w-4 shrink-0 text-info" />
        Simula o canal dos supervisores com a I.A <b>ligada</b>, a base e as regras reais — <b>não envia nada</b> e <b>não grava protocolo</b>.
        Os dados de cadastro mostrados vêm do cadastro real e a simulação fica no log de acessos.
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Conversa */}
        <Card className="flex h-[calc(100vh-330px)] min-h-[440px] min-w-0 flex-col overflow-hidden p-0">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
            <Bot className="h-4 w-4 text-success" />
            <p className="text-sm font-semibold">Atendimento simulado</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COR[status]}`}>{STATUS_ROTULO[status]}</span>
            <div className="ml-auto flex gap-1.5">
              {status !== "ia" && status !== "concluido" && (
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setStatus("ia")}>
                  <Undo2 className="h-3.5 w-3.5" /> Devolver à I.A
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={novoProtocolo}>
                <RotateCcw className="h-3.5 w-3.5" /> Novo protocolo
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 px-4 py-3">
            {bolhas.length === 0 && (
              <p className="pt-10 text-center text-xs text-muted-foreground">
                Escolha quem está escrevendo ao lado e mande a primeira mensagem — como se fosse pelo WhatsApp.
              </p>
            )}
            {bolhas.map((b, i) => b.autor === "bastidor" ? (
              <div key={i} className="mx-auto max-w-[95%] rounded-md border border-dashed bg-background/70 px-3 py-1.5 text-[11px]">
                <p className="mb-0.5 font-semibold text-muted-foreground">Bastidores</p>
                {(b.eventos ?? []).map((e, j) => (
                  <p key={j} className={COR_EVENTO[e.tipo] ?? "text-muted-foreground"}>• {e.detalhe}</p>
                ))}
              </div>
            ) : (
              <div key={i} className={`flex ${b.autor === "pessoa" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm shadow-sm ${
                  b.autor === "pessoa" ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-background"}`}>
                  {b.texto}
                </div>
              </div>
            ))}
            {enviando && <p className="text-xs text-muted-foreground">a I.A está respondendo…</p>}
            <div ref={fimRef} />
          </div>

          <div className="shrink-0 space-y-2 border-t border-border p-3">
            <div className="flex flex-wrap gap-1.5">
              {ROTEIROS.map((r) => (
                <button key={r} type="button" disabled={enviando}
                  className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
                  onClick={() => enviar(r)}>{r}</button>
              ))}
            </div>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); enviar(texto); }}>
              <Textarea rows={1} className="min-h-[38px] resize-none text-sm" placeholder="Escreva como a pessoa escreveria…"
                value={texto} onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(texto); } }} />
              <Button type="button" variant="outline" size="icon" title="Simular envio de foto/arquivo" disabled={enviando} onClick={() => enviar(null, "image")}>
                <ImageIcon className="h-4 w-4" />
              </Button>
              <Button type="submit" size="icon" disabled={enviando || !texto.trim()}><Send className="h-4 w-4" /></Button>
            </form>
          </div>
        </Card>

        {/* Lateral */}
        <div className="space-y-3">
          <Card className="space-y-2 p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><User className="h-4 w-4" /> Quem está escrevendo</p>
            <div className="flex flex-wrap gap-1.5">
              {([["empregado", "Colaborador do cadastro"], ["desconhecido", "Número desconhecido"], ["divergente", "Divergência cadastral"]] as const).map(([q, r]) => (
                <Button key={q} size="sm" variant={quem === q ? "default" : "outline"} className="h-7 text-xs" onClick={() => trocarQuem(q)}>{r}</Button>
              ))}
            </div>
            {quem === "empregado" && (
              <>
                <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); buscar(); }}>
                  <Input className="h-8 text-xs" placeholder="Nome ou matrícula" value={termo} onChange={(e) => setTermo(e.target.value)} />
                  <Button type="submit" size="sm" className="h-8"><Search className="h-3.5 w-3.5" /></Button>
                </form>
                {pessoas.length > 0 && (
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {pessoas.map((p) => (
                      <button key={p.id} type="button" onClick={() => escolher(p)}
                        className="w-full rounded border px-2 py-1 text-left text-xs hover:bg-muted">
                        <span className="font-medium">{p.nome}</span>
                        <span className="block text-muted-foreground">{p.cargo ?? "—"} · {p.contrato ?? "—"} · {PAPEL_ROTULO[p.papel] ?? p.papel}</span>
                      </button>
                    ))}
                  </div>
                )}
                {pessoa && (
                  <div className="rounded-md bg-muted px-2 py-1.5 text-xs">
                    <span className="font-semibold">{pessoa.nome}</span>
                    <Badge variant="outline" className="ml-1 text-[10px]">{PAPEL_ROTULO[pessoa.papel] ?? pessoa.papel}</Badge>
                    <span className="block text-muted-foreground">{pessoa.contrato ?? "—"}</span>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Encarregado/supervisor vêm do Organograma Operacional. Para testar consulta de outra pessoa, escolha um encarregado e pergunte por alguém do contrato dele.
                </p>
              </>
            )}
          </Card>

          <Card className="space-y-2 p-3 text-xs">
            <div className="flex items-center gap-2">
              <Switch checked={usarPendentes} onCheckedChange={setUsarPendentes} />
              <Label className="text-xs">Incluir procedimentos ainda não aprovados</Label>
            </div>
            <p className="text-[11px] text-muted-foreground">Para testar um texto da base antes de aprovar. No atendimento real a I.A só usa os aprovados.</p>
          </Card>

          {ultima && (
            <Card className="space-y-1.5 p-3 text-xs">
              <p className="flex items-center gap-1.5 font-semibold"><ShieldCheck className="h-4 w-4" /> Diagnóstico</p>
              <p>I.A: {ultima.trilha.ia ? `${ultima.trilha.ia.provedor} · ${ultima.trilha.ia.modelo || "(modelo padrão)"} · ${ultima.trilha.ia.ms} ms` : "não chamada nesta mensagem"}</p>
              {ultima.trilha.ia?.erro && <p className="text-destructive">Erro da I.A: {ultima.trilha.ia.erro}</p>}
              <p>Procedimentos no contexto: {ultima.diagnostico.base_itens}{ultima.diagnostico.usou_pendentes ? " (incluindo pendentes)" : ""}</p>
              <p className="flex items-center gap-1">
                {!ultima.diagnostico.canal_ativo_de_verdade || !ultima.diagnostico.ia_ativa_de_verdade || !ultima.diagnostico.numero_configurado
                  ? <ShieldAlert className="h-3.5 w-3.5 text-amber-600" /> : <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />}
                Canal de verdade: {ultima.diagnostico.canal_ativo_de_verdade ? "ativo" : "desligado"} · I.A {ultima.diagnostico.ia_ativa_de_verdade ? "ligada" : "desligada"} · número {ultima.diagnostico.numero_configurado ? "configurado" : "não configurado"}
              </p>
              {ultima.trilha.ia?.bruto && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Resposta crua da I.A (com marcas internas)</summary>
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-muted p-2 text-[11px]">{ultima.trilha.ia.bruto}</pre>
                </details>
              )}
              {ultima.trilha.system && (
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-1 text-xs" onClick={() => setVerPrompt((v) => !v)}>
                  <Code2 className="h-3.5 w-3.5" /> {verPrompt ? "Esconder" : "Ver"} instruções enviadas à I.A
                </Button>
              )}
              {verPrompt && ultima.trilha.system && (
                <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px]">{ultima.trilha.system}</pre>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
