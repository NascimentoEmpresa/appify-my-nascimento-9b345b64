// =====================================================================
// Validação da Presidência (mig 266) — peças de tela compartilhadas:
//   · useValidacaoChamado / useValidacoesChamados — leitura da tabela
//   · BotaoStatusChamado — botão "Status" que abre a linha do tempo
//   · CardTreinamento / ConfirmarTreinamento — treinamento, um papel por vez (mig 269)
//   · SeloEtapaValidacao — selo da etapa nas listas
// A lógica (etapas, quem confirma) mora em validacaoPresidencia.ts.
// =====================================================================
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, Circle, CircleDot, Crown, GraduationCap, ListChecks, XCircle } from "lucide-react";
import { fmtDataHora, type Chamado } from "./types";
import {
  ETAPAS_VALIDACAO, desenvolvedorDaValidacao, montarLinhaDoTempo, pendenciaTreinamento, resumoStatus,
  type ValidacaoChamado, type SituacaoPasso,
} from "./validacaoPresidencia";
import { useChamadoPerms } from "./useChamadoPerms";

// ---- Dados -------------------------------------------------------------

/** Validação de UM chamado (null = chamado não foi enviado à Presidência). */
export function useValidacaoChamado(chamadoId: string | undefined | null) {
  return useQuery({
    queryKey: ["chamado-validacao", chamadoId],
    enabled: !!chamadoId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("CHAMADO_SISTEMA_VALIDACAO").select("*").eq("chamado_id", chamadoId).maybeSingle();
      return (data ?? null) as ValidacaoChamado | null;
    },
  });
}

/** Validações de vários chamados, por id (para as listas). */
export function useValidacoesChamados(ids: string[]) {
  const chave = [...ids].sort().join(",");
  return useQuery({
    queryKey: ["chamado-validacoes", chave],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("CHAMADO_SISTEMA_VALIDACAO").select("*").in("chamado_id", ids);
      const m: Record<string, ValidacaoChamado> = {};
      ((data ?? []) as ValidacaoChamado[]).forEach((v) => { m[v.chamado_id] = v; });
      return m;
    },
  });
}

/** Invalida tudo que depende da validação — chame depois de qualquer RPC dela. */
export function useInvalidarValidacao() {
  const qc = useQueryClient();
  return (chamadoId?: string | null) => {
    if (chamadoId) qc.invalidateQueries({ queryKey: ["chamado-validacao", chamadoId] });
    qc.invalidateQueries({ queryKey: ["chamado-validacoes"] });
    qc.invalidateQueries({ queryKey: ["presidencia-chamados-dev"] });
    if (chamadoId) {
      qc.invalidateQueries({ queryKey: ["chamado", chamadoId] });
      qc.invalidateQueries({ queryKey: ["chamado-eventos", chamadoId] });
    }
  };
}

// ---- Selo da etapa -----------------------------------------------------

export function SeloEtapaValidacao({ v, compacto = false }: { v: ValidacaoChamado | null | undefined; compacto?: boolean }) {
  if (!v) return null;
  const e = ETAPAS_VALIDACAO[v.etapa];
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] font-semibold ${e.cls}`} title="Validação da Presidência">
      <Crown className="h-3 w-3" /> {compacto && v.etapa === "desenvolvimento" ? "Presidência" : e.label}
    </Badge>
  );
}

// ---- Botão + diálogo "Status" --------------------------------------------

const ICONE_SITUACAO: Record<SituacaoPasso, { icon: typeof Circle; cls: string }> = {
  feito:        { icon: CheckCircle2, cls: "text-success" },
  atual:        { icon: CircleDot,    cls: "text-primary" },
  pendente:     { icon: Circle,       cls: "text-muted-foreground/40" },
  interrompido: { icon: XCircle,      cls: "text-destructive" },
};

type ChamadoParaStatus = Pick<Chamado,
  "id" | "numero" | "assunto" | "status" | "created_at" | "updated_at" | "responsavel_id" | "concluido_em"
  | "motivo_reprovacao"> & Partial<Pick<Chamado, "motivo_cancelamento" | "cancelado_em">>;

export function BotaoStatusChamado({
  chamado, validacao, nomeDe, size = "sm", className = "",
}: {
  chamado: ChamadoParaStatus;
  /** Opcional: quando a tela já leu a validação (lista), evita outra consulta. */
  validacao?: ValidacaoChamado | null;
  nomeDe?: (id: string | null) => string;
  size?: "sm" | "default";
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const { data: lida } = useValidacaoChamado(validacao === undefined && aberto ? chamado.id : null);
  const v = validacao !== undefined ? validacao : lida;

  const passos = montarLinhaDoTempo(
    { ...chamado, motivo_cancelamento: chamado.motivo_cancelamento ?? null, cancelado_em: chamado.cancelado_em ?? null },
    v, nomeDe,
  );

  return (
    <>
      <Button
        type="button" variant="outline" size={size}
        className={`gap-1.5 ${size === "sm" ? "h-8" : ""} ${className}`}
        onClick={(e) => { e.stopPropagation(); setAberto(true); }}
      >
        <ListChecks className="h-3.5 w-3.5" /> Status
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              Status da solicitação <span className="font-mono text-sm text-muted-foreground">#{chamado.numero}</span>
            </DialogTitle>
          </DialogHeader>
          <p className="-mt-2 truncate text-sm text-muted-foreground" title={chamado.assunto}>{chamado.assunto}</p>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
            <span className="text-muted-foreground">Situação atual:</span>
            <span className="font-semibold">{resumoStatus(chamado, v)}</span>
            {v && <SeloEtapaValidacao v={v} compacto />}
            {v && v.devolucoes > 0 && (
              <span className="text-muted-foreground">· devolvido {v.devolucoes}x pela Presidência</span>
            )}
          </div>

          <ol className="relative mt-1 space-y-0">
            {passos.map((p, i) => {
              const ic = ICONE_SITUACAO[p.situacao];
              const ultimo = i === passos.length - 1;
              return (
                <li key={p.key} className="relative flex gap-3 pb-4">
                  {!ultimo && (
                    <span className={`absolute left-[9px] top-5 h-[calc(100%-12px)] w-px ${
                      p.situacao === "feito" ? "bg-success/50" : "bg-border"
                    }`} />
                  )}
                  <ic.icon className={`relative z-10 mt-0.5 h-[18px] w-[18px] shrink-0 bg-background ${ic.cls}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <p className={`text-sm font-semibold ${p.situacao === "pendente" ? "text-muted-foreground" : ""}`}>
                        {p.titulo}
                        {p.situacao === "atual" && (
                          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">agora</span>
                        )}
                      </p>
                      {p.quando && <span className="text-[11px] text-muted-foreground">{fmtDataHora(p.quando)}</span>}
                    </div>
                    {p.detalhe && (
                      <p className="whitespace-pre-wrap text-xs text-muted-foreground [overflow-wrap:anywhere]">{p.detalhe}</p>
                    )}
                    {p.itens && (
                      <ul className="mt-1.5 space-y-1">
                        {p.itens.map((it) => (
                          <li key={it.titulo} className="flex items-start gap-1.5 text-xs">
                            {it.feito
                              ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                              : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />}
                            <span className="min-w-0">
                              <span className={it.feito ? "font-medium" : "text-muted-foreground"}>{it.titulo}</span>
                              {it.quando && <span className="text-muted-foreground"> · {fmtDataHora(it.quando)}</span>}
                              {it.detalhe && <span className="block text-muted-foreground [overflow-wrap:anywhere]">{it.detalhe}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---- Card informativo da etapa (antes do treinamento) ----------------------

/**
 * Avisa, no chamado, que ele passa pela Presidência — e, se foi devolvido,
 * mostra o parecer da direção para o dev saber o que ajustar. Nas etapas de
 * treinamento/finalizado quem aparece é o CardTreinamento.
 */
export function CardValidacaoPresidencia({
  chamado, validacao, nomeDe = () => "—",
}: {
  chamado: Pick<Chamado, "status">;
  validacao: ValidacaoChamado | null | undefined;
  nomeDe?: (id: string | null) => string;
}) {
  if (!validacao || (validacao.etapa !== "desenvolvimento" && validacao.etapa !== "validacao_presidencia")) return null;
  if (chamado.status === "reprovado" || chamado.status === "cancelado") return null;
  const devolvido = validacao.etapa === "desenvolvimento" && validacao.presidencia_aprovado === false;

  return (
    <Card className={`space-y-2 p-4 ${devolvido ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5"}`}>
      <p className="flex items-center gap-1.5 text-sm font-bold">
        <Crown className={`h-4 w-4 ${devolvido ? "text-destructive" : "text-warning"}`} />
        {devolvido ? "Devolvido pela Presidência"
          : validacao.etapa === "validacao_presidencia" ? "Aguardando validação da Presidência"
          : "Passa pela Presidência"}
      </p>
      {devolvido ? (
        <>
          <p className="whitespace-pre-wrap rounded-md border-l-2 border-destructive/50 bg-background/60 px-2.5 py-2 text-xs [overflow-wrap:anywhere]">
            {validacao.presidencia_parecer}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {nomeDe(validacao.presidencia_por)} · {fmtDataHora(validacao.presidencia_em)}
            {validacao.devolucoes > 1 ? ` · ${validacao.devolucoes}ª devolução` : ""}.
            Ajuste e conclua de novo — volta para a validação.
          </p>
        </>
      ) : validacao.etapa === "validacao_presidencia" ? (
        <p className="text-xs text-muted-foreground">
          O desenvolvimento foi concluído{validacao.desenvolvedor_id ? <> por <b>{nomeDe(validacao.desenvolvedor_id)}</b></> : null}.
          A direção está conferindo se está OK; depois vem o treinamento.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Quando o chamado for concluído, ele vai para a validação da Presidência. Aprovado, o desenvolvedor e o
          solicitante confirmam o treinamento.
        </p>
      )}
      {validacao.observacao_envio && (
        <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">Obs. da coordenação: {validacao.observacao_envio}</p>
      )}
    </Card>
  );
}

// ---- Card de confirmação do treinamento -----------------------------------

/**
 * Confirmação de UM papel do treinamento (mig 269 — cada um confirma o seu):
 *   · "desenvolvedor": o dev que concluiu, ou a gestão de chamados por ele;
 *   · "solicitante": o próprio solicitante, no card da avaliação.
 */
export function ConfirmarTreinamento({
  chamadoId, papel, rotulo, onConfirmado,
}: {
  chamadoId: string;
  papel: "desenvolvedor" | "solicitante";
  rotulo?: string;
  onConfirmado?: (resultado: string) => void;
}) {
  const { toast } = useToast();
  const invalidar = useInvalidarValidacao();
  const qc = useQueryClient();
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);

  const confirmar = async () => {
    setEnviando(true);
    const { data, error } = await (supabase as any).rpc("chamado_treinamento_confirmar", {
      p_chamado_id: chamadoId, p_observacao: obs.trim() || null, p_papel: papel,
    });
    setEnviando(false);
    if (error) { toast({ title: "Erro ao confirmar o treinamento", description: error.message, variant: "destructive" }); return; }
    toast(data === "finalizado"
      ? { title: "Treinamento confirmado — solicitação finalizada" }
      : { title: "Treinamento confirmado", description: papel === "solicitante" ? "Agora avalie o atendimento." : "Falta a confirmação do solicitante." });
    setObs("");
    invalidar(chamadoId);
    qc.invalidateQueries({ queryKey: ["chamados-avaliacoes-pendentes"] });
    onConfirmado?.(data as string);
  };

  return (
    <div className="space-y-2">
      <Textarea
        rows={2} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)}
        placeholder="Observação (opcional): data, duração, quem participou…"
      />
      <Button className="w-full gap-2" disabled={enviando} onClick={confirmar}>
        <GraduationCap className="h-4 w-4" />
        {enviando ? "Confirmando…" : rotulo ?? (papel === "desenvolvedor" ? "Confirmar que dei o treinamento" : "Confirmar que recebi o treinamento")}
      </Button>
    </div>
  );
}

/**
 * Situação do treinamento (quem já confirmou). Com `papel`, mostra também o
 * botão desse papel para quem o deve: "desenvolvedor" na tela de execução
 * (dev ou gestão). Sem `papel` é só informativo — o solicitante confirma no
 * card da avaliação (AcompanharChamado), porque lá é "confirmar → avaliar".
 */
export function CardTreinamento({
  chamado, validacao, nomeDe = () => "—", papel,
}: {
  chamado: Pick<Chamado, "id" | "solicitante_id" | "responsavel_id">;
  validacao: ValidacaoChamado | null | undefined;
  nomeDe?: (id: string | null) => string;
  papel?: "desenvolvedor" | "solicitante";
}) {
  const { user } = useAuth();
  const { gestor } = useChamadoPerms();

  if (!validacao || (validacao.etapa !== "treinamento" && validacao.etapa !== "finalizado")) return null;

  const pend = pendenciaTreinamento(validacao, chamado, user?.id, { gestao: gestor });
  const deveConfirmar = papel === "desenvolvedor" ? pend.comoDev : papel === "solicitante" ? pend.comoSolicitante : false;
  const finalizado = validacao.etapa === "finalizado";
  const devId = desenvolvedorDaValidacao(validacao, chamado);
  const peloGestor = papel === "desenvolvedor" && deveConfirmar && devId !== user?.id;
  // Quem confirmou pelo dev não foi o próprio dev (gestão confirmando por ele).
  const devPorOutro = validacao.treinamento_dev_por && devId && validacao.treinamento_dev_por !== devId;

  const Linha = ({ titulo, em, obs: o }: { titulo: string; em: string | null; obs: string | null }) => (
    <div className="flex items-start gap-2 text-xs">
      {em ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />}
      <span className="min-w-0">
        <span className={em ? "font-medium" : "text-muted-foreground"}>{titulo}</span>
        {em && <span className="text-muted-foreground"> · {fmtDataHora(em)}</span>}
        {o && <span className="block text-muted-foreground [overflow-wrap:anywhere]">{o}</span>}
      </span>
    </div>
  );

  return (
    <Card className={`animate-rise-in space-y-3 p-4 ${
      finalizado ? "border-success/30 bg-success/5" : deveConfirmar ? "border-primary/40 bg-primary/5" : ""
    }`}>
      <p className="flex items-center gap-1.5 text-sm font-bold">
        <GraduationCap className={`h-4 w-4 ${finalizado ? "text-success" : "text-primary"}`} />
        {finalizado ? "Treinamento concluído" : "Treinamento pendente"}
      </p>
      {!finalizado && (
        <p className="text-xs text-muted-foreground">
          A Presidência aprovou o desenvolvimento
          {validacao.presidencia_por ? <> (<b>{nomeDe(validacao.presidencia_por)}</b>)</> : null}.
          Agora o desenvolvedor e o solicitante confirmam, cada um, que o treinamento foi dado.
        </p>
      )}
      <div className="space-y-1.5">
        <Linha
          titulo={devPorOutro ? `Desenvolvedor — confirmado por ${nomeDe(validacao.treinamento_dev_por)}` : "Desenvolvedor confirmou"}
          em={validacao.treinamento_dev_em} obs={validacao.treinamento_dev_obs}
        />
        <Linha titulo="Solicitante confirmou" em={validacao.treinamento_solic_em} obs={validacao.treinamento_solic_obs} />
      </div>
      {deveConfirmar && papel && (
        <ConfirmarTreinamento
          chamadoId={chamado.id} papel={papel}
          rotulo={peloGestor ? `Confirmar treinamento por ${nomeDe(devId)}` : undefined}
        />
      )}
      {!finalizado && !papel && pend.comoDev && (
        <p className="text-[11px] text-muted-foreground">A sua confirmação como desenvolvedor é feita na tela de execução do chamado.</p>
      )}
    </Card>
  );
}
