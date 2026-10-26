import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { erroDaFunction } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquareText, Plus, Trash2, Send, RefreshCw, Loader2, Power } from "lucide-react";

// =====================================================================
// CHATBOT › Mensagens prontas
//
// A biblioteca que o atendente abre digitando "/" na Caixa de Entrada
// (WA_TEMPLATE). Aqui se escreve o texto, se submete à Meta e se
// acompanha a revisão.
//
// Duas coisas que a tela precisa deixar claras, porque são a origem de
// quase toda confusão com WhatsApp:
//   1. Salvar aqui NÃO cria o template na Meta — é outro botão, e a Meta
//      leva de minutos a horas revisando.
//   2. Sem template aprovado a mensagem só alcança quem escreveu nas
//      últimas 24h. Fora dessa janela, a Meta simplesmente não entrega.
// =====================================================================

interface Linha {
  id: string;
  codigo: string;
  titulo: string;
  texto: string;
  variaveis: string[];
  template_nome: string | null;
  idioma: string;
  categoria: string;
  ativo: boolean;
  ordem: number;
}

/** O que a Meta devolve por mensagem (categoria = a que ELA deu; anterior = o reserva). */
interface StatusMeta { status: string; motivo?: string; categoria?: string; anterior?: { nome: string; status: string; categoria?: string } }

const STATUS: Record<string, { txt: string; cls: string; ajuda: string }> = {
  APPROVED:     { txt: "aprovada",    cls: "bg-success/15 text-success",              ajuda: "Pode ser enviada para qualquer contato." },
  PENDING:      { txt: "em revisão",  cls: "bg-warning/15 text-warning-foreground",   ajuda: "A Meta ainda está revisando. Só funciona dentro das 24h." },
  REJECTED:     { txt: "reprovada",   cls: "bg-destructive/15 text-destructive",      ajuda: "A Meta recusou o texto. Ajuste e submeta de novo com outro nome." },
  NAO_CRIADO:   { txt: "não enviada", cls: "bg-muted text-muted-foreground",          ajuda: "Ainda não foi submetida à Meta." },
  SEM_TEMPLATE: { txt: "só em 24h",   cls: "bg-muted text-muted-foreground",          ajuda: "Sem nome de template: só alcança quem escreveu nas últimas 24h." },
};

/** Sugere o código a partir do título — quem cadastra não deve pensar em slug. */
const sugereCodigo = (titulo: string) =>
  titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export function MensagensProntasCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [criando, setCriando] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [variaveis, setVariaveis] = useState("");
  const [categoria, setCategoria] = useState("UTILITY");
  const [salvando, setSalvando] = useState(false);
  const [submetendo, setSubmetendo] = useState<string | null>(null);

  const { data: linhas = [] } = useQuery({
    queryKey: ["wa-templates-admin"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("WA_TEMPLATE")
        .select("*").order("ordem").order("titulo");
      return ((data ?? []) as Linha[]).map((l) => ({ ...l, variaveis: l.variaveis ?? [] }));
    },
  });

  const { data: status = {}, isFetching: conferindo, refetch: reconferir } = useQuery({
    queryKey: ["wa-templates-status"],
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Record<string, StatusMeta>> => {
      const { data, error } = await supabase.functions.invoke("whatsapp-template-enviar", { body: { acao: "status" } });
      if (error) return {};
      const mapa: Record<string, StatusMeta> = {};
      ((data as any)?.templates ?? []).forEach((t: any) => { mapa[t.codigo] = { status: t.status, motivo: t.motivo, categoria: t.categoria, anterior: t.anterior }; });
      return mapa;
    },
  });

  const limpar = () => { setTitulo(""); setTexto(""); setVariaveis(""); setCategoria("UTILITY"); setCriando(false); };

  const salvar = async () => {
    const t = titulo.trim(), corpo = texto.trim();
    if (!t || !corpo || salvando) return;
    const codigo = sugereCodigo(t);
    if (!codigo) { toast({ title: "Dê um título com letras ou números", variant: "destructive" }); return; }
    const vars = variaveis.split(",").map((v) => v.trim()).filter(Boolean);
    // A Meta recusa corpo que começa ou termina em variável — barrar aqui
    // evita descobrir isso só na revisão, horas depois.
    if (/^\{\{\d+\}\}/.test(corpo) || /\{\{\d+\}\}\s*[.!?]?$/.test(corpo)) {
      toast({ title: "Texto inválido", description: "O texto não pode começar nem terminar com uma variável.", variant: "destructive" });
      return;
    }
    setSalvando(true);
    const { error } = await (supabase as any).from("WA_TEMPLATE").insert({
      codigo, titulo: t, texto: corpo, variaveis: vars,
      template_nome: codigo, categoria, ordem: 100,
    });
    setSalvando(false);
    if (error) {
      toast({ title: "Não deu para salvar", description: error.message, variant: "destructive" });
      return;
    }
    limpar();
    qc.invalidateQueries({ queryKey: ["wa-templates-admin"] });
    qc.invalidateQueries({ queryKey: ["wa-templates"] });
    toast({ title: "Mensagem salva", description: "Já aparece no menu da “/”. Para alcançar quem está fora das 24h, envie para aprovação da Meta." });
  };

  const submeter = async (l: Linha) => {
    setSubmetendo(l.codigo);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-template-enviar", {
        body: { acao: "criar_template", codigo: l.codigo },
      });
      if (error) throw new Error(await erroDaFunction(error));
      const r = data as { ja_existia?: boolean; status?: string };
      toast({
        title: r.ja_existia ? `Já estava na Meta (${r.status})` : "Enviada para aprovação",
        description: r.status === "APPROVED"
          ? "Aprovada — pode usar com qualquer contato."
          : "A revisão leva de alguns minutos a algumas horas.",
      });
      reconferir();
    } catch (e: any) {
      toast({ title: "A Meta recusou", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setSubmetendo(null);
    }
  };

  // "Enviar todas" (SIS-2026-0667): manda à Meta, uma a uma, toda mensagem
  // ligada que ainda não foi (ou foi reprovada). Antes eram N cliques.
  const pendentesMeta = linhas.filter((l) => l.ativo && l.template_nome
    && ["NAO_CRIADO", "REJECTED"].includes(status[l.codigo]?.status ?? "NAO_CRIADO"));
  const [enviandoTodas, setEnviandoTodas] = useState(false);
  const submeterTodas = async () => {
    if (!pendentesMeta.length) return;
    if (!confirm(`Enviar ${pendentesMeta.length} mensagem(ns) para aprovação da Meta?\n\nA Meta revisa cada uma — pode levar de algumas horas a alguns dias. Até aprovar, a mensagem só chega a quem escreveu nas últimas 24h.`)) return;
    setEnviandoTodas(true);
    const erros: string[] = [];
    let ok = 0;
    for (const l of pendentesMeta) {
      const { data, error } = await supabase.functions.invoke("whatsapp-template-enviar", { body: { acao: "criar_template", codigo: l.codigo } });
      if (error) erros.push(`${l.titulo}: ${await erroDaFunction(error)}`);
      else if (!(data as { ok?: boolean })?.ok) erros.push(`${l.titulo}: ${(data as { error?: string })?.error ?? "erro"}`);
      else ok++;
    }
    setEnviandoTodas(false);
    if (ok) toast({ title: `${ok} enviada(s) para aprovação`, description: "A Meta pode levar de algumas horas a alguns dias. Acompanhe pelo “Conferir status”." });
    if (erros.length) toast({ title: `${erros.length} não enviada(s)`, description: erros.join(" | "), variant: "destructive" });
    reconferir();
  };

  const alternar = async (l: Linha) => {
    const { error } = await (supabase as any).from("WA_TEMPLATE").update({ ativo: !l.ativo }).eq("id", l.id);
    if (error) { toast({ title: "Não deu para alterar", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["wa-templates-admin"] });
    qc.invalidateQueries({ queryKey: ["wa-templates"] });
  };

  const remover = async (l: Linha) => {
    if (!confirm(`Remover "${l.titulo}" da biblioteca?\n\nO template já aprovado continua existindo na Meta — some só daqui.`)) return;
    const { error } = await (supabase as any).from("WA_TEMPLATE").delete().eq("id", l.id);
    if (error) { toast({ title: "Não deu para remover", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["wa-templates-admin"] });
    qc.invalidateQueries({ queryKey: ["wa-templates"] });
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <MessageSquareText className="h-4 w-4 text-primary" /> Mensagens prontas
          </p>
          <p className="text-xs text-muted-foreground">
            O que o atendente vê ao digitar <b>/</b> na Caixa de Entrada. Salvar aqui já libera o uso
            dentro das 24h; para falar com quem <b>não</b> escreveu nesse período, a mensagem precisa
            estar aprovada na Meta — é o botão <b>Enviar para aprovação</b> de cada linha.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => reconferir()} disabled={conferindo}>
            {conferindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Conferir status
          </Button>
          {pendentesMeta.length > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={submeterTodas} disabled={enviandoTodas}
              title="Manda à Meta todas as mensagens ligadas que ainda não foram aprovadas">
              {enviandoTodas ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar todas para aprovação ({pendentesMeta.length})
            </Button>
          )}
        </div>
      </div>
      <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
        A Meta precisa aprovar cada mensagem — <b>pode levar alguns dias</b>. Até lá ela só chega a quem escreveu nas últimas 24h.
        Mensagem nova ou com texto alterado volta para a fila de aprovação.
      </p>

      <div className="space-y-1.5">
        {linhas.map((l) => {
          const st = STATUS[status[l.codigo]?.status ?? "NAO_CRIADO"] ?? STATUS.NAO_CRIADO;
          // Só é motivo de recusa se ela tiver sido recusada.
          //
          // A Meta manda `rejected_reason: "NONE"` para TODO template que não
          // foi rejeitado — inclusive o que acabou de entrar em PENDING. A tela
          // mostrava isso como "Motivo da recusa: NONE" em vermelho, e o
          // atendente que acabara de submeter lia que tinha sido recusado.
          const motivoBruto = status[l.codigo]?.motivo;
          const motivo = status[l.codigo]?.status === "REJECTED"
            && motivoBruto && motivoBruto.toUpperCase() !== "NONE"
            ? motivoBruto : null;
          return (
            <div key={l.id} className={`space-y-1 rounded border border-border/60 px-2.5 py-2 ${l.ativo ? "" : "opacity-60"}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{l.titulo}</span>
                <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">/{l.codigo}</code>
                <Badge variant="secondary" className={`text-[10px] ${st.cls}`} title={st.ajuda}>{st.txt}</Badge>
                {/* Marketing (14/10/2026): a Meta limita por pessoa (131049/130472) — explica o "não chega pra ninguém". */}
                {status[l.codigo]?.categoria === "MARKETING" && (
                  <Badge variant="secondary" className="bg-warning/15 text-[10px] text-warning-foreground"
                    title="A Meta classificou como marketing: ela limita quantas mensagens assim cada pessoa recebe (erro 131049). Reescreva como aviso de serviço (UTILITY).">
                    marketing na Meta
                  </Badge>
                )}
                {!l.ativo && <Badge variant="outline" className="text-[10px]">desligada</Badge>}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  {st.txt !== "aprovada" && l.template_nome && (
                    <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => submeter(l)} disabled={submetendo === l.codigo}>
                      {submetendo === l.codigo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Enviar para aprovação
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground" title={l.ativo ? "Desligar (some do menu)" : "Ligar"} onClick={() => alternar(l)}>
                    <Power className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => remover(l)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">{l.texto}</p>
              {l.variaveis.length > 0 && (
                <p className="text-[11px] text-muted-foreground">Pergunta antes de enviar: {l.variaveis.join(", ")}</p>
              )}
              {motivo && <p className="text-[11px] text-destructive">Motivo da recusa: {motivo}</p>}
              {/* Enquanto o novo não é aprovado, sai o reserva — e se ele é marketing, a Meta barra (131049). */}
              {status[l.codigo]?.anterior && status[l.codigo]?.status !== "APPROVED" && (
                <p className="text-[11px] text-warning-foreground">
                  Enquanto esta não é aprovada, sai a versão anterior (<code>{status[l.codigo]!.anterior!.nome}</code>
                  {status[l.codigo]!.anterior!.categoria ? `, ${status[l.codigo]!.anterior!.categoria === "MARKETING" ? "marketing" : status[l.codigo]!.anterior!.categoria!.toLowerCase()}` : ""})
                  {status[l.codigo]!.anterior!.categoria === "MARKETING" ? " — a Meta limita a entrega dela por pessoa, por isso parte não chega." : "."}
                </p>
              )}
            </div>
          );
        })}
        {linhas.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma mensagem cadastrada ainda.</p>}
      </div>

      {!criando ? (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCriando(true)}>
          <Plus className="h-4 w-4" /> Nova mensagem
        </Button>
      ) : (
        <div className="space-y-2 rounded border border-dashed border-border p-3">
          <div className="space-y-1">
            <Label htmlFor="tpl-titulo">Título</Label>
            <Input id="tpl-titulo" className="h-8 text-sm" placeholder="Ex.: Saudação — confirmar contato"
              value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            {titulo.trim() && <p className="text-[11px] text-muted-foreground">No menu vai aparecer como <code>/{sugereCodigo(titulo)}</code></p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="tpl-texto">Texto</Label>
            <Textarea id="tpl-texto" rows={4} className="text-sm" placeholder="O que o contato vai receber. Use {{1}}, {{2}}… para as partes que mudam."
              value={texto} onChange={(e) => setTexto(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tpl-vars">Variáveis (opcional)</Label>
            <Input id="tpl-vars" className="h-8 text-sm" placeholder="Nome de cada {{n}}, na ordem, separadas por vírgula: nome, cargo"
              value={variaveis} onChange={(e) => setVariaveis(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Categoria na Meta</Label>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="UTILITY">Utilidade — aviso sobre algo que a pessoa começou</SelectItem>
                <SelectItem value="MARKETING">Marketing — abordagem, convite, divulgação</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Pedir Utilidade num texto de abordagem é o caminho curto para a Meta reprovar.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={salvar} disabled={!titulo.trim() || !texto.trim() || salvando}>
              {salvando ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Salvando…</> : "Salvar"}
            </Button>
            <Button size="sm" variant="ghost" onClick={limpar} disabled={salvando}>Cancelar</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
