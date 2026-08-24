import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2 } from "lucide-react";

// =====================================================================
// O menu da "/" na Caixa de Entrada.
//
// Digitar "/" no campo de mensagem abre a biblioteca (WA_TEMPLATE): o
// atendente filtra pelo que digitar depois da barra, anda com ↑/↓ e manda
// com Enter. Mensagem com variável abre um formulário antes de enviar —
// o resto vai direto.
//
// O status na Meta aparece em cada linha porque ele decide se a mensagem
// alcança quem está FORA da janela de 24h. Sem essa marca o atendente só
// descobre que o template não passou quando a mensagem não chega.
// =====================================================================

export interface WaTemplate {
  codigo: string;
  titulo: string;
  texto: string;
  variaveis: string[];
  template_nome: string | null;
}

/** Status de cada mensagem na Meta, por código. */
type StatusMeta = Record<string, { status: string; motivo?: string }>;

const ROTULO_STATUS: Record<string, { txt: string; cls: string }> = {
  APPROVED:     { txt: "aprovada",      cls: "bg-success/15 text-success" },
  PENDING:      { txt: "em revisão",    cls: "bg-warning/15 text-warning-foreground" },
  REJECTED:     { txt: "reprovada",     cls: "bg-destructive/15 text-destructive" },
  NAO_CRIADO:   { txt: "não enviada",   cls: "bg-muted text-muted-foreground" },
  SEM_TEMPLATE: { txt: "só em 24h",     cls: "bg-muted text-muted-foreground" },
};

/** A biblioteca inteira — carregada uma vez e reusada pelas conversas. */
export function useMensagensProntas(habilitado: boolean) {
  return useQuery({
    queryKey: ["wa-templates"],
    enabled: habilitado,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("WA_TEMPLATE")
        .select("codigo, titulo, texto, variaveis, template_nome")
        .eq("ativo", true).order("ordem").order("titulo");
      return ((data ?? []) as WaTemplate[]).map((t) => ({ ...t, variaveis: t.variaveis ?? [] }));
    },
  });
}

/** Status na Meta. Falha aqui não trava o menu: a marca some, o envio segue. */
export function useStatusNaMeta(habilitado: boolean) {
  return useQuery({
    queryKey: ["wa-templates-status"],
    enabled: habilitado,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<StatusMeta> => {
      const { data, error } = await supabase.functions.invoke("whatsapp-template-enviar", {
        body: { acao: "status" },
      });
      if (error) return {};
      const mapa: StatusMeta = {};
      ((data as any)?.templates ?? []).forEach((t: any) => {
        mapa[t.codigo] = { status: t.status, motivo: t.motivo };
      });
      return mapa;
    },
  });
}

export function MenuMensagens({ filtro, mensagens, status, onEscolher, onFechar, registrarNavegacao }: {
  filtro: string;
  mensagens: WaTemplate[];
  status: StatusMeta;
  onEscolher: (t: WaTemplate) => void;
  onFechar: () => void;
  // O textarea continua com o foco enquanto o menu está aberto, então é ele
  // quem recebe ↑/↓/Enter e repassa para cá.
  registrarNavegacao: (fn: (e: React.KeyboardEvent) => boolean) => void;
}) {
  const [ativo, setAtivo] = useState(0);

  const lista = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    if (!t) return mensagens;
    return mensagens.filter((m) =>
      [m.codigo, m.titulo, m.texto].some((v) => String(v ?? "").toLowerCase().includes(t)));
  }, [mensagens, filtro]);

  // Filtro novo, seleção do topo — senão o índice antigo aponta para outra
  // mensagem e o Enter manda a errada.
  useEffect(() => { setAtivo(0); }, [filtro]);

  useEffect(() => {
    registrarNavegacao((e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") { setAtivo((i) => Math.min(i + 1, lista.length - 1)); return true; }
      if (e.key === "ArrowUp")   { setAtivo((i) => Math.max(i - 1, 0)); return true; }
      if (e.key === "Enter" && lista[ativo]) { onEscolher(lista[ativo]); return true; }
      if (e.key === "Escape") { onFechar(); return true; }
      return false;
    });
  }, [lista, ativo, onEscolher, onFechar, registrarNavegacao]);

  return (
    <div className="mb-2 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
      {lista.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">
          Nenhuma mensagem com “{filtro}”. As mensagens prontas são cadastradas no Chatbot.
        </p>
      ) : lista.map((m, i) => {
        const st = ROTULO_STATUS[status[m.codigo]?.status ?? "NAO_CRIADO"] ?? ROTULO_STATUS.NAO_CRIADO;
        return (
          <button
            key={m.codigo}
            type="button"
            onMouseEnter={() => setAtivo(i)}
            onClick={() => onEscolher(m)}
            className={`flex w-full flex-col gap-0.5 border-b border-border/50 px-3 py-2 text-left last:border-b-0 ${
              i === ativo ? "bg-accent" : "hover:bg-accent/50"}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{m.titulo}</span>
              <code className="text-[11px] text-muted-foreground">/{m.codigo}</code>
              <Badge variant="secondary" className={`ml-auto text-[10px] ${st.cls}`}>{st.txt}</Badge>
            </div>
            <span className="line-clamp-2 text-xs text-muted-foreground">{m.texto}</span>
            {m.variaveis.length > 0 && (
              <span className="text-[11px] text-muted-foreground">
                pede: {m.variaveis.join(", ")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Formulário das variáveis. Só aparece para mensagem que tem {{n}} —
 * mensagem fixa vai direto, sem diálogo no meio do caminho.
 */
export function PreencherVariaveis({ mensagem, enviando, onCancelar, onConfirmar }: {
  mensagem: WaTemplate | null;
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: (valores: string[]) => void;
}) {
  const [valores, setValores] = useState<string[]>([]);
  const primeiro = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValores(new Array(mensagem?.variaveis.length ?? 0).fill(""));
    if (mensagem) setTimeout(() => primeiro.current?.focus(), 50);
  }, [mensagem]);

  if (!mensagem) return null;
  const completo = valores.length === mensagem.variaveis.length && valores.every((v) => v.trim());
  const previa = mensagem.texto.replace(/\{\{(\d+)\}\}/g, (_, n) => valores[Number(n) - 1]?.trim() || `{{${n}}}`);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onCancelar(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{mensagem.titulo}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {mensagem.variaveis.map((rotulo, i) => (
            <div key={rotulo + i} className="space-y-1">
              <Label htmlFor={`var-${i}`}>{rotulo}</Label>
              <Input
                id={`var-${i}`} ref={i === 0 ? primeiro : undefined}
                value={valores[i] ?? ""}
                onChange={(e) => setValores((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                onKeyDown={(e) => { if (e.key === "Enter" && completo) onConfirmar(valores); }}
              />
            </div>
          ))}
          <div className="rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap">{previa}</div>
          {!mensagem.template_nome && (
            <p className="flex gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
              Esta mensagem não tem template aprovado: só chega se o contato escreveu nas últimas 24h.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancelar} disabled={enviando}>Cancelar</Button>
          <Button onClick={() => onConfirmar(valores)} disabled={!completo || enviando}>
            {enviando ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Enviando…</> : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
