import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { db } from "./db";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessagesSquare, Lock, Send, History, Loader2, User, ShieldCheck } from "lucide-react";
import {
  LABEL_SITUACAO, LABEL_RESULTADO, LABEL_GRAVIDADE, LABEL_TIPO_REGISTRO, TIPO_REGISTRO, rotulo,
} from "./vocabulario";

// =====================================================================
// CONVERSA E HISTÓRICO DO RELATO (lado do comitê)
//
// A conversa é o que destrava apuração: sem poder perguntar "em que dia
// foi?" e receber resposta, um relato sem nome morre no que veio escrito.
//
// Dois tipos de mensagem no MESMO fio, de propósito:
//   · pública  — o denunciante lê ao acompanhar o protocolo;
//   · interna  — nota de trabalho, nunca sai daqui (a RPC pública filtra
//                `interna = false`; não depende desta tela se comportar).
// Misturar os dois no mesmo fio é o que preserva o contexto: a nota que
// explica por que a pergunta foi feita fica ao lado da pergunta.
//
// O histórico é escrito por gatilho no banco, não pela aplicação — histórico
// que a tela pode editar não serve como histórico.
// =====================================================================

interface Mensagem {
  id: string; autor: "comite" | "denunciante";
  mensagem: string; interna: boolean;
  /** mensagem | nota | entrevista | manifestacao | providencia */
  tipo: string;
  lida_em: string | null; created_at: string;
}

interface Evento {
  id: string; campo: string; de: string | null; para: string | null; created_at: string;
}

const fmt = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

/** Traduz o valor cru do histórico conforme o campo que mudou. */
function valorDoEvento(campo: string, v: string | null) {
  if (!v) return "vazio";
  if (campo === "status") return rotulo(LABEL_SITUACAO, v);
  if (campo === "resultado") return rotulo(LABEL_RESULTADO, v);
  if (campo === "gravidade") return rotulo(LABEL_GRAVIDADE, v);
  return v;
}

const NOME_CAMPO: Record<string, string> = {
  status: "Situação", resultado: "Resultado",
  gravidade: "Gravidade", responsavel: "Responsável pela apuração",
};

export default function Conversa({ denunciaId, protocolo }: {
  denunciaId: string; protocolo: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [texto, setTexto] = useState("");
  const [interna, setInterna] = useState(false);
  /** Só vale para nota interna: mensagem ao denunciante é sempre "mensagem". */
  const [tipo, setTipo] = useState("nota");
  const [enviando, setEnviando] = useState(false);

  const { data: mensagens = [], isLoading } = useQuery({
    queryKey: ["denuncia-mensagens", denunciaId],
    queryFn: async () => {
      const { data, error } = await db.from("CANAL_DENUNCIA_MENSAGEM")
        .select("*").eq("denuncia_id", denunciaId).order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Mensagem[];
    },
  });

  const { data: eventos = [] } = useQuery({
    queryKey: ["denuncia-eventos", denunciaId],
    queryFn: async () => {
      const { data, error } = await db.from("CANAL_DENUNCIA_EVENTO")
        .select("*").eq("denuncia_id", denunciaId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Evento[];
    },
  });

  const enviar = async () => {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    // A policy exige autor='comite' e autor_user_id = auth.uid(): mandar o id
    // aqui não é redundância, é o que satisfaz o WITH CHECK.
    const { data: u } = await supabase.auth.getUser();
    const { error } = await db.from("CANAL_DENUNCIA_MENSAGEM").insert({
      denuncia_id: denunciaId, autor: "comite",
      autor_user_id: u.user?.id ?? null, mensagem: t, interna,
      tipo: interna ? tipo : "mensagem",
    });
    setEnviando(false);
    if (error) {
      toast({ title: "Não consegui enviar", description: error.message, variant: "destructive" });
      return;
    }
    setTexto("");
    qc.invalidateQueries({ queryKey: ["denuncia-mensagens", denunciaId] });
    toast({
      title: interna ? "Nota interna registrada" : "Mensagem enviada ao denunciante",
      description: `Protocolo ${protocolo}`,
    });
  };

  const publicas = mensagens.filter((m) => !m.interna);
  const aguardando = publicas.length > 0
    && publicas[publicas.length - 1].autor === "denunciante";

  return (
    <>
      <Card className="space-y-3 border-primary/20 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <MessagesSquare className="h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm font-bold">Conversa com o denunciante</p>
          {aguardando && (
            <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] font-bold text-warning">
              aguardando resposta do comitê
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Ele lê pelo acompanhamento do protocolo, com o e-mail e a senha dele. Nota interna fica só aqui.
        </p>

        <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-lg bg-muted/30 p-3">
          {isLoading && <p className="py-4 text-center text-xs text-muted-foreground">Carregando…</p>}
          {!isLoading && mensagens.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Nenhuma mensagem ainda. Use o campo abaixo para pedir um detalhe ao denunciante.
            </p>
          )}
          {mensagens.map((m) => (
            <div key={m.id} className={`flex ${m.autor === "comite" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-xl border px-3 py-2 text-sm ${
                m.interna
                  ? "border-warning/40 bg-warning/10"
                  : m.autor === "comite"
                    ? "border-primary/30 bg-primary/10"
                    : "border-border bg-background"}`}>
                <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {m.interna
                    ? <><Lock className="h-3 w-3" /> {rotulo(LABEL_TIPO_REGISTRO, m.tipo)}</>
                    : m.autor === "comite"
                      ? <><ShieldCheck className="h-3 w-3" /> Comitê</>
                      : <><User className="h-3 w-3" /> Denunciante</>}
                  <span className="font-normal normal-case">· {fmt(m.created_at)}</span>
                  {/* Só faz sentido para o que foi enviado ao denunciante. */}
                  {!m.interna && m.autor === "comite" && (
                    <span className="font-normal normal-case">
                      · {m.lida_em ? `lida em ${fmt(m.lida_em)}` : "não lida"}
                    </span>
                  )}
                </p>
                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.mensagem}</p>
              </div>
            </div>
          ))}
        </div>

        <Textarea
          rows={3} value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder={interna
            ? "Nota de trabalho — o denunciante nunca vê isto."
            : "Escreva ao denunciante. Ele lê ao acompanhar o protocolo."}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Alternância explícita em vez de caixinha: o risco aqui é mandar
              para fora uma nota que era interna, então o modo tem que estar
              visível o tempo todo. */}
          <div className="inline-flex rounded-lg bg-muted p-1">
            <button
              type="button" onClick={() => setInterna(false)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold ${!interna ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              Enviar ao denunciante
            </button>
            <button
              type="button" onClick={() => setInterna(true)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold ${interna ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              Nota interna
            </button>
          </div>

          {/* Que TIPO de registro interno é este. Sem isto, entrevista e
              manifestação ficariam indistinguíveis de um comentário no
              relatório do procedimento — e o Comitê pediu as duas nomeadas. */}
          {interna && (
            <select
              value={tipo} onChange={(e) => setTipo(e.target.value)}
              aria-label="Tipo do registro interno"
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              {TIPO_REGISTRO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}

          <Button size="sm" onClick={enviar} disabled={enviando || !texto.trim()}>
            {enviando
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Enviando…</>
              : <><Send className="mr-1.5 h-3.5 w-3.5" /> {interna ? "Registrar" : "Enviar"}</>}
          </Button>
        </div>
      </Card>

      <Card className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm font-bold">Histórico de alterações</p>
        </div>
        {eventos.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">
            Nenhuma alteração registrada ainda. Situação, resultado, gravidade e responsável entram aqui
            automaticamente.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {eventos.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="text-muted-foreground">{fmt(e.created_at)}</span>
                <b>{NOME_CAMPO[e.campo] ?? e.campo}:</b>
                <span className="text-muted-foreground">{valorDoEvento(e.campo, e.de)}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-semibold">{valorDoEvento(e.campo, e.para)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
