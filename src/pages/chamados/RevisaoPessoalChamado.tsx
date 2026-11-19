// SIS-2026-0938 — Marcação pessoal de revisão (mig 20261119050000).
// Botão da lista (3 estados), card de Observação e selo do detalhe. Tudo lê e
// grava em "CHAMADO_SISTEMA_REVISAO", que a RLS restringe ao próprio usuário:
// o time de Sistemas não vê, nada vira mensagem no chat e o chamado não muda.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, History, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  dataHoraObservacao, LIMITE_OBSERVACAO, normalizarObservacao, ordenarHistorico, podeSalvarObservacao,
  proximoEstadoNaLista, visualRevisao,
  type EstadoRevisao, type EstadoRevisaoOuNada, type ObservacaoRevisao, type RevisaoChamado,
} from "./revisaoPessoal";

// Tabela nova ainda fora dos tipos gerados.
type Resp = { data: unknown; error: { message: string } | null };
interface Consulta extends PromiseLike<Resp> {
  select(c: string): Consulta;
  eq(c: string, v: unknown): Consulta;
  maybeSingle(): PromiseLike<Resp>;
  upsert(v: Record<string, unknown>, o?: Record<string, unknown>): Consulta;
  update(v: Record<string, unknown>): Consulta;
  delete(): Consulta;
}
const tabela = () => (supabase as unknown as { from(t: string): Consulta }).from("CHAMADO_SISTEMA_REVISAO");

const CHAVE = "chamados-revisao-pessoal";

/** Todas as MINHAS marcações, num mapa chamado_id → revisão. */
export function useRevisoesChamados() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [CHAVE, user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await tabela()
        .select("chamado_id, estado, observacao, marcado_em, revisado_em")
        .eq("user_id", user!.id);
      // Antes da migration entrar, a tela segue sem a marcação.
      if (error) return {} as Record<string, RevisaoChamado>;
      const m: Record<string, RevisaoChamado> = {};
      ((data ?? []) as RevisaoChamado[]).forEach((r) => { m[r.chamado_id] = r; });
      return m;
    },
  });
}

function useGravarRevisao() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return async (chamadoId: string, estado: EstadoRevisaoOuNada, observacao?: string | null) => {
    if (!user?.id) return false;
    const r = estado === null
      ? await tabela().delete().eq("chamado_id", chamadoId).eq("user_id", user.id)
      : await tabela().upsert(
          {
            chamado_id: chamadoId,
            user_id: user.id,
            estado,
            ...(observacao !== undefined ? { observacao: normalizarObservacao(observacao) } : {}),
          },
          { onConflict: "chamado_id,user_id" },
        );
    if (r.error) { toast.error(`Não foi possível salvar a revisão: ${r.error.message}`); return false; }
    qc.invalidateQueries({ queryKey: [CHAVE, user.id] });
    return true;
  };
}

/** Botão da coluna Ações: transparente (não marcado), amarelo (revisar), verde (revisado). */
export function BotaoRevisaoChamado({ chamadoId, revisao }: { chamadoId: string; revisao?: RevisaoChamado | null }) {
  const gravar = useGravarRevisao();
  const [salvando, setSalvando] = useState(false);
  const atual: EstadoRevisaoOuNada = revisao?.estado ?? null;
  const visual = visualRevisao(atual);

  const clicar = async () => {
    const prox = proximoEstadoNaLista(atual);
    // Desmarcar não apaga nada: o histórico de observações é à parte
    // (SIS-2026-0951) e continua lá se marcar de novo.
    setSalvando(true);
    await gravar(chamadoId, prox);
    setSalvando(false);
  };

  const cor = atual === "revisado"
    ? "border-success/40 bg-success/15 text-success hover:bg-success/25 hover:text-success"
    : atual === "revisar"
      ? "border-yellow-400 bg-yellow-400 text-yellow-950 hover:bg-yellow-300 hover:text-yellow-950"
      : "bg-transparent";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm" disabled={salvando} onClick={clicar}
          className={`h-8 gap-1.5 transition-transform active:scale-90 ${cor}`}>
          {atual === "revisado" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <History className="h-3.5 w-3.5" />}
          {visual.rotulo}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-xs">{visual.dica}</TooltipContent>
    </Tooltip>
  );
}

/** Selo verde em "Informações do chamado" quando a revisão foi finalizada. */
export function SeloRevisao({ revisao }: { revisao?: RevisaoChamado | null }) {
  if (!revisao) return null;
  if (revisao.estado === "revisado") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success"
        title="Sua marcação pessoal — só você vê">
        Revisado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-yellow-400 bg-yellow-100 px-2 py-0.5 text-[11px] font-semibold text-yellow-900"
      title="Sua marcação pessoal — só você vê">
      Revisar
    </span>
  );
}

// ---- Histórico de observações (SIS-2026-0951, mig 20261120190000) -------
const tabelaObs = () => (supabase as unknown as { from(t: string): ConsultaObs }).from("CHAMADO_SISTEMA_REVISAO_OBSERVACAO");
interface ConsultaObs extends PromiseLike<Resp> {
  select(c: string): ConsultaObs;
  eq(c: string, v: unknown): ConsultaObs;
  order(c: string, o?: { ascending?: boolean }): ConsultaObs;
  insert(v: Record<string, unknown>): ConsultaObs;
}
const CHAVE_OBS = "chamados-revisao-observacoes";

/** Minhas observações deste chamado, mais recente primeiro. RLS: só as minhas. */
function useObservacoesRevisao(chamadoId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [CHAVE_OBS, user?.id, chamadoId],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await tabelaObs()
        .select("id, chamado_id, texto, created_at")
        .eq("chamado_id", chamadoId)
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      // Antes da migration entrar, a tela segue sem o histórico.
      if (error) return [] as ObservacaoRevisao[];
      return ordenarHistorico((data ?? []) as ObservacaoRevisao[]);
    },
  });
}

/**
 * Card da coluna direita do detalhe: anotação privada, "Salvar observação"
 * (registro NOVO, nunca substitui), "Revisado" e o histórico. Nada aqui vai
 * para o chat nem mexe no chamado.
 */
export function CardObservacaoRevisao({ chamadoId, revisao }: { chamadoId: string; revisao?: RevisaoChamado | null }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const gravar = useGravarRevisao();
  const historico = useObservacoesRevisao(chamadoId);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  if (!revisao) return null;

  const salvarObservacao = async (aviso = true) => {
    const t = normalizarObservacao(texto);
    if (!t || !user?.id) return true;
    const { error } = await tabelaObs().insert({ chamado_id: chamadoId, user_id: user.id, texto: t });
    if (error) { toast.error(`Não foi possível salvar a observação: ${error.message}`); return false; }
    setTexto("");
    qc.invalidateQueries({ queryKey: [CHAVE_OBS, user.id, chamadoId] });
    if (aviso) toast.success("Observação salva no histórico.");
    return true;
  };

  const clicarSalvar = async () => {
    setSalvando(true);
    await salvarObservacao();
    setSalvando(false);
  };

  // "Revisado" não depende de observação; se houver texto digitado, ele vai
  // para o histórico junto, para não se perder.
  const marcar = async (estado: EstadoRevisao, aviso: string) => {
    setSalvando(true);
    const okObs = await salvarObservacao(false);
    const ok = okObs && await gravar(chamadoId, estado);
    setSalvando(false);
    if (ok) toast.success(aviso);
  };

  const lista = historico.data ?? [];

  return (
    <Card className={`space-y-2 p-4 ${revisao.estado === "revisado" ? "border-success/40" : "border-yellow-400/70"}`}>
      <p className="flex items-center gap-1.5 text-sm font-bold">
        <History className="h-4 w-4 text-primary" /> Observação
      </p>
      <p className="text-xs text-muted-foreground">Observação visível somente para o solicitante.</p>
      <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={LIMITE_OBSERVACAO}
        placeholder="Ex.: Ajuste validado com a Controladoria." className="text-sm" />
      <Button disabled={salvando || !podeSalvarObservacao(texto)} onClick={clicarSalvar}
        className="w-full gap-2 transition-transform active:scale-95">
        <Save className="h-4 w-4" /> Salvar observação
      </Button>
      {revisao.estado === "revisar" ? (
        <Button disabled={salvando} onClick={() => marcar("revisado", "Revisão finalizada.")}
          className="w-full gap-2 bg-success text-success-foreground hover:bg-success/90 transition-transform active:scale-95">
          <CheckCircle2 className="h-4 w-4" /> Revisado
        </Button>
      ) : (
        <p className="flex items-center gap-1.5 rounded bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success">
          <CheckCircle2 className="h-3.5 w-3.5" /> Revisado
          {revisao.revisado_em && ` em ${dataHoraObservacao(revisao.revisado_em)}`}
        </p>
      )}

      <div className="space-y-1.5 border-t pt-2">
        <p className="flex items-center gap-1.5 text-xs font-bold">
          <History className="h-3.5 w-3.5 text-primary" /> Histórico de observações
        </p>
        {historico.isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma observação salva ainda.</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {lista.map((o) => (
              <li key={o.id} className="space-y-0.5">
                <p className="text-[11px] text-muted-foreground">{dataHoraObservacao(o.created_at)}</p>
                <p className="whitespace-pre-wrap break-words rounded border bg-muted/40 px-2.5 py-1.5 text-xs">{o.texto}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
