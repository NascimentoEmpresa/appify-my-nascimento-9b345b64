// =====================================================================
// PEDIDOS DA GESTÃO (SIS-2026-0923, mig 20261116230000)
//
// · SolicitarAcaoGestaoDialog — a Presidência/Controladoria pede: mudar a
//   prioridade, alterar a ordem da fila, cancelar, reprovar a entrega
//   (revisão) ou pedir informações. Justificativa obrigatória (≥ 10).
//   Nada muda no chamado: o pedido vai para Sistemas.
// · ResponderAcaoGestaoDialog — Sistemas (Gestor de Sistemas ou Coordenar,
//   chamado_pode_decidir) aceita ou recusa. Aceito, a RPC aplica o efeito
//   pelos mesmos caminhos da tela de chamados.
// · CardAcoesGestaoChamado — o destaque nas telas Coordenar/Executar com os
//   pedidos pendentes; quem decide responde ali mesmo, o dev só vê.
// =====================================================================
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Landmark, XCircle } from "lucide-react";
import { PRIORIDADES, STATUS_CHAMADO, fmtDataHora } from "./types";
import {
  MIN_JUSTIFICATIVA, TIPOS_ACAO_GESTAO, detalheAcao, respostaObrigatoria, respostaValida,
  tiposAcaoPermitidos, validarPedidoAcao,
  type ChamadoGerencial, type TipoAcaoGestao,
} from "@/lib/chamados/painelGerencial";
import { rpcGerencial, useAcoesPendentesDoChamado, useInvalidarGerencial } from "./acoesGestaoApi";

type ChamadoPedido = Pick<ChamadoGerencial,
  "id" | "numero" | "assunto" | "status" | "prioridade" | "responsavel_id" | "responsavel_nome" | "posicao_dev">;

export function SolicitarAcaoGestaoDialog({
  chamado, tamanhoFila, onClose,
}: { chamado: ChamadoPedido | null; tamanhoFila: number; onClose: () => void }) {
  const { toast } = useToast();
  const invalidar = useInvalidarGerencial();
  const permitidos = chamado ? tiposAcaoPermitidos(chamado) : [];
  const [tipo, setTipo] = useState<TipoAcaoGestao>("informacoes");
  const [prioridade, setPrioridade] = useState("");
  const [posicao, setPosicao] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Cada chamado aberto no modal começa limpo, na primeira ação que se aplica.
  useEffect(() => {
    if (!chamado) return;
    setTipo(tiposAcaoPermitidos(chamado)[0] ?? "informacoes");
    setPrioridade("");
    setPosicao(chamado.posicao_dev ? String(chamado.posicao_dev) : "1");
    setJustificativa("");
  }, [chamado]);

  if (!chamado) return null;
  const info = TIPOS_ACAO_GESTAO[tipo];
  const pedido = {
    tipo, justificativa,
    prioridade: tipo === "prioridade" ? prioridade : null,
    posicao: tipo === "ordem_fila" ? Number(posicao) : null,
  };
  const problema = validarPedidoAcao(chamado, pedido, tamanhoFila);

  const enviar = async () => {
    if (problema || enviando) return;
    setEnviando(true);
    const { error } = await rpcGerencial("chamado_gestao_acao_solicitar", {
      p_chamado_id: chamado.id, p_tipo: tipo, p_justificativa: justificativa.trim(),
      p_prioridade: pedido.prioridade, p_posicao: pedido.posicao,
    });
    setEnviando(false);
    if (error) { toast({ title: "Não foi possível registrar o pedido", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Pedido enviado a Sistemas", description: "Nada muda no chamado até Sistemas analisar. Você recebe o aviso da resposta." });
    invalidar();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !enviando) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Solicitar ação sobre o chamado</DialogTitle>
          <DialogDescription>O setor de Sistemas analisa o pedido. Nenhuma ação é executada automaticamente.</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          <p className="font-semibold [overflow-wrap:anywhere]">#{chamado.numero} — {chamado.assunto}</p>
          <p className="mt-0.5 text-muted-foreground">
            Status: {STATUS_CHAMADO[chamado.status]?.label ?? chamado.status}
            {" · "}Responsável: {chamado.responsavel_nome ?? "sem responsável"}
            {" · "}Prioridade: {PRIORIDADES[chamado.prioridade]?.label ?? chamado.prioridade}
          </p>
          <p className="text-muted-foreground">
            Posição atual na fila: <b className="text-foreground">{chamado.posicao_dev ? `${chamado.posicao_dev}º de ${tamanhoFila}` : "não se aplica"}</b>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Qual ação deseja solicitar? *</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoAcaoGestao)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {permitidos.map((t) => <SelectItem key={t} value={t}>{TIPOS_ACAO_GESTAO[t].label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground" aria-live="polite">{info.explica}</p>
        </div>

        {tipo === "prioridade" && (
          <div className="space-y-1.5">
            <Label>Nova prioridade *</Label>
            <Select value={prioridade} onValueChange={setPrioridade}>
              <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORIDADES).filter(([k]) => k !== chamado.prioridade).map(([k, p]) => (
                  <SelectItem key={k} value={k}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {tipo === "ordem_fila" && (
          <div className="space-y-1.5">
            <Label htmlFor="acao-posicao">Nova posição na fila do responsável *</Label>
            <Input id="acao-posicao" type="number" min={1} max={tamanhoFila} value={posicao}
              onChange={(e) => setPosicao(e.target.value)} className="w-32" />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="acao-justificativa">Justificativa *</Label>
          <Textarea id="acao-justificativa" rows={4} maxLength={2000} value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)} placeholder={info.placeholder} />
          <p className="text-[11px] text-muted-foreground">
            Mínimo de {MIN_JUSTIFICATIVA} caracteres ({justificativa.trim().length}/{MIN_JUSTIFICATIVA}).
          </p>
        </div>

        {problema && justificativa.trim().length > 0 && (
          <p className="text-xs text-destructive">{problema}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button onClick={enviar} disabled={enviando || !!problema}>{enviando ? "Enviando…" : "Enviar solicitação"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface PedidoParaResponder {
  id: number;
  numero: string;
  assunto: string;
  tipo: TipoAcaoGestao;
  justificativa: string;
  valor_atual: string | null;
  valor_solicitado: string | null;
  solicitado_por_nome: string | null;
}

export function ResponderAcaoGestaoDialog({
  pedido, aceitar, onClose,
}: { pedido: PedidoParaResponder | null; aceitar: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const invalidar = useInvalidarGerencial();
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { setResposta(""); }, [pedido, aceitar]);

  if (!pedido) return null;
  const obrigatoria = respostaObrigatoria(pedido.tipo, aceitar);
  const ehInfo = pedido.tipo === "informacoes";
  const titulo = aceitar ? (ehInfo ? "Responder à gestão" : "Aceitar o pedido") : "Recusar o pedido";
  const efeito: Record<TipoAcaoGestao, string> = {
    prioridade: "A prioridade do chamado muda agora e o chat registra a mudança.",
    ordem_fila: "O chamado vai para a posição pedida na fila do responsável (ou a última, se a fila encolheu).",
    cancelamento: "O chamado é cancelado, sai da fila e o solicitante é avisado.",
    revisao: "O chamado volta ao desenvolvimento com o mesmo responsável (não conta como reabertura do solicitante).",
    informacoes: "A resposta fica registrada para a gestão; o chamado não muda.",
  };

  const enviar = async () => {
    if (enviando || (obrigatoria && !respostaValida(resposta))) return;
    setEnviando(true);
    const { error } = await rpcGerencial("chamado_gestao_acao_decidir", {
      p_acao_id: pedido.id, p_aceitar: aceitar, p_resposta: resposta.trim() || null,
    });
    setEnviando(false);
    if (error) { toast({ title: "Não deu certo", description: error.message, variant: "destructive" }); return; }
    toast({ title: aceitar ? (ehInfo ? "Resposta enviada" : "Pedido aceito e aplicado") : "Pedido recusado" });
    invalidar();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !enviando) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo} · #{pedido.numero}</DialogTitle>
          <DialogDescription>
            {TIPOS_ACAO_GESTAO[pedido.tipo].label} — {detalheAcao(pedido)}
            {pedido.solicitado_por_nome ? ` · pedido por ${pedido.solicitado_por_nome}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border-l-2 border-primary/50 bg-muted/40 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Justificativa</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{pedido.justificativa}</p>
        </div>
        {aceitar && <p className="text-xs text-muted-foreground">{efeito[pedido.tipo]}</p>}
        <Textarea rows={4} maxLength={2000} autoFocus value={resposta} onChange={(e) => setResposta(e.target.value)}
          placeholder={obrigatoria
            ? (aceitar ? "Resposta para a gestão (obrigatória)" : "Por que o pedido foi recusado? (obrigatório)")
            : "Comentário para a gestão (opcional)"} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button variant={aceitar ? "default" : "destructive"} onClick={enviar}
            disabled={enviando || (obrigatoria && !respostaValida(resposta))}>
            {enviando ? "Gravando…" : titulo}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Pedidos pendentes da gestão na tela do chamado (Coordenar/Executar). */
export function CardAcoesGestaoChamado({
  chamado, podeDecidir,
}: { chamado: { id: string; numero: string; assunto: string }; podeDecidir: boolean }) {
  const { data: pendentes = [] } = useAcoesPendentesDoChamado(chamado.id);
  const [respondendo, setRespondendo] = useState<{ pedido: PedidoParaResponder; aceitar: boolean } | null>(null);
  if (pendentes.length === 0) return null;

  return (
    <>
      <Card className="space-y-3 border-2 border-primary/60 bg-primary/5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Landmark className="h-5 w-5 text-primary" />
          <p className="text-sm font-extrabold uppercase tracking-wider text-primary">Pedido da gestão</p>
          <span className="rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            Aguardando Sistemas
          </span>
        </div>
        {pendentes.map((p) => {
          const paraResponder: PedidoParaResponder = { ...p, numero: chamado.numero, assunto: chamado.assunto };
          return (
            <div key={p.id} className="space-y-2 rounded-md border border-border bg-background/60 p-3">
              <p className="text-sm">
                <b>{p.solicitado_por_nome ?? "Gestão"}</b> pediu: <b>{TIPOS_ACAO_GESTAO[p.tipo]?.label ?? p.tipo}</b>
                {p.tipo === "prioridade" || p.tipo === "ordem_fila" ? <> ({detalheAcao(p)})</> : null}
                <span className="text-muted-foreground"> · {fmtDataHora(p.created_at)}</span>
              </p>
              <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{p.justificativa}</p>
              {podeDecidir && (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => setRespondendo({ pedido: paraResponder, aceitar: false })}>
                    <XCircle className="h-4 w-4" /> Recusar
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={() => setRespondendo({ pedido: paraResponder, aceitar: true })}>
                    <CheckCircle2 className="h-4 w-4" /> {p.tipo === "informacoes" ? "Responder" : "Aceitar"}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        {!podeDecidir && (
          <p className="text-xs text-muted-foreground">Quem decide é o Gestor de Sistemas. Até lá o chamado continua como está.</p>
        )}
      </Card>
      <ResponderAcaoGestaoDialog pedido={respondendo?.pedido ?? null} aceitar={respondendo?.aceitar ?? true}
        onClose={() => setRespondendo(null)} />
    </>
  );
}
