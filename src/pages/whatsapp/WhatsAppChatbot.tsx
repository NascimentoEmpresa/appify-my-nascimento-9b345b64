import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Bot, ShieldAlert, Plus, Trash2, Save, Power, Inbox, Info } from "lucide-react";
import { MODELOS, DIAS, type WaBotConfig, type WaConhecimento } from "./types";

const WEBHOOK_URL = "https://fwmzeaztjxrxxzxzxmgc.supabase.co/functions/v1/whatsapp-webhook";
const SECRETS = ["WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "ANTHROPIC_API_KEY"];

export default function WhatsAppChatbot() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: access } = useAccessibleMenus("visualizar");
  const podeEditar = access?.codes.has("whatsapp_chatbot") ?? false;

  const [cfg, setCfg] = useState<WaBotConfig | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [novoConteudo, setNovoConteudo] = useState("");

  const { data: configDb } = useQuery({
    queryKey: ["wa-bot-config"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("WA_BOT_CONFIG").select("*").limit(1).maybeSingle();
      return (data ?? null) as WaBotConfig | null;
    },
  });
  useEffect(() => { if (configDb && !cfg) setCfg(configDb); }, [configDb]); // eslint-disable-line

  const { data: base = [] } = useQuery({
    queryKey: ["wa-bot-conhecimento"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("WA_BOT_CONHECIMENTO").select("*").order("ordem");
      return (data ?? []) as WaConhecimento[];
    },
  });

  const set = <K extends keyof WaBotConfig>(k: K, v: WaBotConfig[K]) => setCfg((c) => (c ? { ...c, [k]: v } : c));

  const salvar = async () => {
    if (!cfg || salvando) return;
    setSalvando(true);
    const { error } = await (supabase as any).from("WA_BOT_CONFIG").update({
      ativo: cfg.ativo, persona: cfg.persona, saudacao: cfg.saudacao || null, fallback: cfg.fallback,
      horario_inicio: cfg.horario_inicio, horario_fim: cfg.horario_fim, dias_semana: cfg.dias_semana,
      fora_horario_msg: cfg.fora_horario_msg, modelo: cfg.modelo, max_tokens: cfg.max_tokens,
    }).eq("id", true);
    setSalvando(false);
    if (error) { toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Configuração salva" });
    qc.invalidateQueries({ queryKey: ["wa-bot-config"] });
  };

  const alternarAtivo = async () => {
    if (!cfg) return;
    const novo = !cfg.ativo;
    set("ativo", novo);
    const { error } = await (supabase as any).from("WA_BOT_CONFIG").update({ ativo: novo }).eq("id", true);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); set("ativo", !novo); return; }
    qc.invalidateQueries({ queryKey: ["wa-bot-config"] });
  };

  const addConhecimento = async () => {
    if (!novoTitulo.trim() || !novoConteudo.trim()) return;
    const { error } = await (supabase as any).from("WA_BOT_CONHECIMENTO").insert({
      titulo: novoTitulo.trim(), conteudo: novoConteudo.trim(), ordem: base.length + 1,
    });
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    setNovoTitulo(""); setNovoConteudo("");
    qc.invalidateQueries({ queryKey: ["wa-bot-conhecimento"] });
  };

  const removerConhecimento = async (id: string) => {
    await (supabase as any).from("WA_BOT_CONHECIMENTO").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["wa-bot-conhecimento"] });
  };

  const toggleDia = (d: number) => {
    if (!cfg) return;
    const tem = cfg.dias_semana.includes(d);
    set("dias_semana", tem ? cfg.dias_semana.filter((x) => x !== d) : [...cfg.dias_semana, d].sort());
  };

  if (!podeEditar) {
    return (
      <div>
        <PageHeader title="WhatsApp — Chatbot" module="Central de Serviços" breadcrumb={["WhatsApp", "Chatbot"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Acesso restrito. Peça a liberação de <b>WhatsApp — Chatbot</b> em Acesso por Usuário.
        </Card>
      </div>
    );
  }
  if (!cfg) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div>
      <PageHeader
        title="WhatsApp — Chatbot"
        subtitle="Configure a persona da IA, os horários e a base de conhecimento."
        module="Central de Serviços"
        breadcrumb={["WhatsApp", "Chatbot"]}
        actions={<Button variant="outline" className="gap-1.5" onClick={() => nav("/app/whatsapp")}><Inbox className="h-4 w-4" /> Caixa de Entrada</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {/* Estado do bot */}
          <Card className={`flex items-center justify-between gap-3 p-4 ${cfg.ativo ? "border-success/30 bg-success/5" : ""}`}>
            <div className="flex items-center gap-2.5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${cfg.ativo ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}><Bot className="h-5 w-5" /></div>
              <div>
                <p className="text-sm font-bold">Chatbot {cfg.ativo ? "ativo" : "desligado"}</p>
                <p className="text-xs text-muted-foreground">{cfg.ativo ? "Responde automaticamente dentro do horário." : "Nenhuma resposta automática será enviada."}</p>
              </div>
            </div>
            <Button variant={cfg.ativo ? "outline" : "default"} className="gap-1.5" onClick={alternarAtivo}>
              <Power className="h-4 w-4" /> {cfg.ativo ? "Desligar" : "Ligar"}
            </Button>
          </Card>

          {/* Persona e mensagens */}
          <Card className="space-y-4 p-4">
            <p className="text-sm font-bold">Comportamento da IA</p>
            <div>
              <Label className="mb-1.5 block text-xs font-semibold">Persona / instruções do sistema</Label>
              <Textarea rows={5} value={cfg.persona} onChange={(e) => set("persona", e.target.value)} />
              <p className="mt-1 text-[11px] text-muted-foreground">Define o tom e as regras. A base de conhecimento abaixo é injetada junto.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-xs font-semibold">Mensagem de fallback</Label>
                <Textarea rows={2} value={cfg.fallback} onChange={(e) => set("fallback", e.target.value)} placeholder="Quando a IA não conseguir responder" />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-semibold">Saudação (opcional)</Label>
                <Textarea rows={2} value={cfg.saudacao ?? ""} onChange={(e) => set("saudacao", e.target.value)} placeholder="Primeira resposta a um contato novo" />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-xs font-semibold">Modelo</Label>
                <Select value={cfg.modelo} onValueChange={(v) => set("modelo", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODELOS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-semibold">Máx. de tokens por resposta</Label>
                <Input type="number" min={128} max={4096} value={cfg.max_tokens} onChange={(e) => set("max_tokens", Number(e.target.value) || 1024)} />
              </div>
            </div>
          </Card>

          {/* Horário */}
          <Card className="space-y-3 p-4">
            <p className="text-sm font-bold">Horário de atendimento do bot</p>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <Label className="mb-1.5 block text-xs font-semibold">Início</Label>
                <Input type="time" className="w-32" value={cfg.horario_inicio?.slice(0, 5)} onChange={(e) => set("horario_inicio", e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-semibold">Fim</Label>
                <Input type="time" className="w-32" value={cfg.horario_fim?.slice(0, 5)} onChange={(e) => set("horario_fim", e.target.value)} />
              </div>
              <div className="min-w-0">
                <Label className="mb-1.5 block text-xs font-semibold">Dias</Label>
                <div className="flex flex-wrap gap-1">
                  {DIAS.map((d) => (
                    <button key={d.v} type="button" onClick={() => toggleDia(d.v)}
                      className={`rounded-md border px-2 py-1 text-xs ${cfg.dias_semana.includes(d.v) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                      {d.l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs font-semibold">Mensagem fora do horário</Label>
              <Textarea rows={2} value={cfg.fora_horario_msg} onChange={(e) => set("fora_horario_msg", e.target.value)} />
            </div>
          </Card>

          {/* Base de conhecimento */}
          <Card className="space-y-3 p-4">
            <p className="text-sm font-bold">Base de conhecimento <span className="font-normal text-muted-foreground">({base.length})</span></p>
            <p className="text-xs text-muted-foreground">Blocos de FAQ/contexto que a IA usa para responder (preços, procedimentos, políticas…).</p>
            <div className="space-y-2">
              {base.map((k) => (
                <div key={k.id} className="flex items-start gap-2 rounded border border-border/60 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{k.titulo}</p>
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">{k.conteudo}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => removerConhecimento(k.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              {base.length === 0 && <p className="text-xs text-muted-foreground">Nenhum item ainda.</p>}
            </div>
            <div className="space-y-2 rounded border border-dashed border-border p-2.5">
              <Input placeholder="Título (ex.: Horário de funcionamento)" value={novoTitulo} onChange={(e) => setNovoTitulo(e.target.value)} />
              <Textarea rows={2} placeholder="Conteúdo…" value={novoConteudo} onChange={(e) => setNovoConteudo(e.target.value)} />
              <Button size="sm" className="gap-1.5" onClick={addConhecimento} disabled={!novoTitulo.trim() || !novoConteudo.trim()}><Plus className="h-4 w-4" /> Adicionar</Button>
            </div>
          </Card>

          <div className="flex justify-end">
            <Button className="gap-1.5" onClick={salvar} disabled={salvando}><Save className="h-4 w-4" /> {salvando ? "Salvando…" : "Salvar configuração"}</Button>
          </div>
        </div>

        {/* Setup lateral */}
        <div className="space-y-4">
          <Card className="space-y-2 p-4">
            <p className="flex items-center gap-1.5 text-sm font-bold"><Info className="h-4 w-4 text-info" /> Integração com a Meta</p>
            <p className="text-xs text-muted-foreground">No app do WhatsApp na Meta (Cloud API), configure o webhook:</p>
            <div>
              <Label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">Callback URL</Label>
              <code className="block break-all rounded bg-muted px-2 py-1.5 text-[11px]">{WEBHOOK_URL}</code>
            </div>
            <p className="text-xs text-muted-foreground">O <b>Verify token</b> deve ser igual ao secret <code>WHATSAPP_VERIFY_TOKEN</code>. Inscreva o campo <code>messages</code>.</p>
            <div>
              <Label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">Secrets (Supabase → Edge Functions)</Label>
              <ul className="space-y-0.5">
                {SECRETS.map((s) => <li key={s} className="flex items-center gap-1.5 text-[11px]"><code className="rounded bg-muted px-1.5">{s}</code></li>)}
              </ul>
            </div>
            <p className="text-[11px] text-muted-foreground">As Edge Functions <code>whatsapp-webhook</code> e <code>whatsapp-enviar</code> precisam estar deployadas.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
