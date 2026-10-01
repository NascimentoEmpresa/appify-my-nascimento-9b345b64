import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { CheckCircle2, ChevronDown, ChevronUp, GraduationCap, Loader2, MonitorCog, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { moduloLabel } from "@/pages/chamados/types";

// =====================================================================
// CENTRAL DE SERVIÇOS › Treinamentos › "Treinamentos Sistemas" (30/09/2026)
//
// Chamado de sistemas que passou pela Presidência: aprovado o
// desenvolvimento, o dev ENVIA o treinamento a usuários e/ou setores
// inteiros (Chamados › tela do chamado ou Painel de Distribuição). É aqui
// que cada participante confirma que recebeu; com todos confirmados, a
// solicitação finaliza. Antes (mig 266/269) dev e solicitante confirmavam
// dentro do chamado — ver 20260930000273_chamado_treinamento_sistemas.sql.
//
// A lista vem de treinamentos_sistemas_meus (SECURITY DEFINER): quem
// recebeu pelo setor pode não enxergar o chamado em si, e não precisa.
// =====================================================================

export interface TreinamentoSistema {
  chamado_id: string; numero: string; assunto: string; descricao: string | null;
  modulo_sistema: string | null; modulo_sistema_outro: string | null;
  solicitante_nome: string | null; desenvolvedor_nome: string | null; enviado_por_nome: string | null;
  enviado_em: string | null; enviado_obs: string | null;
  origem: "usuario" | "setor"; setor: string | null;
  confirmado_em: string | null; confirmado_obs: string | null;
  participantes: number; confirmados: number;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/** Os treinamentos de sistemas que chegaram para mim (pendentes primeiro). */
export function useTreinamentosSistemas() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["chamado-validacoes", "treinamentos-sistemas-meus", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("treinamentos_sistemas_meus");
      if (error) throw error;
      return (data ?? []) as TreinamentoSistema[];
    },
  });
}

/** Rota própria, liberada a todo usuário logado (ROTAS_SEMPRE_LIBERADAS). */
export const ROTA_TREINAMENTOS_SISTEMAS = "/app/central-servicos/treinamentos-sistemas";

/**
 * A página (/app/central-servicos/treinamentos-sistemas). Quem também tem o
 * menu de Treinamentos vê as duas abas; quem não tem, só esta.
 */
export default function TreinamentosSistemasPagina() {
  const { data: access } = useAccessibleMenus("visualizar");
  const temVideos = !!access?.codes.has("central_servicos_treinamentos");
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-lg">
          <MonitorCog className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Treinamentos Sistemas</h1>
          <p className="text-sm text-muted-foreground">Confirme os treinamentos das novidades do ERP que você recebeu.</p>
        </div>
      </div>
      {temVideos && <AbasTreinamentos atual="sistemas" />}
      <TreinamentosSistemas />
    </div>
  );
}

/** As duas abas da Central de Serviços › Treinamentos (vídeos | sistemas). */
export function AbasTreinamentos({ atual }: { atual: "videos" | "sistemas" }) {
  const { data = [] } = useTreinamentosSistemas();
  const pendentes = data.filter((t) => !t.confirmado_em).length;
  const abas = [
    { k: "videos", rotulo: "Treinamentos", to: "/app/central-servicos/treinamentos" },
    { k: "sistemas", rotulo: "Treinamentos Sistemas", to: ROTA_TREINAMENTOS_SISTEMAS },
  ] as const;
  return (
    <div className="flex gap-1 border-b">
      {abas.map((a) => (
        <Link key={a.k} to={a.to}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            atual === a.k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          {a.rotulo}
          {a.k === "sistemas" && pendentes > 0 && (
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">{pendentes}</span>
          )}
        </Link>
      ))}
    </div>
  );
}

export function TreinamentosSistemas() {
  const q = useTreinamentosSistemas();
  const [filtro, setFiltro] = useState<"pendentes" | "confirmados">("pendentes");
  const lista = q.data ?? [];
  const pendentes = useMemo(() => lista.filter((t) => !t.confirmado_em), [lista]);
  const confirmados = useMemo(() => lista.filter((t) => !!t.confirmado_em), [lista]);
  const visiveis = filtro === "pendentes" ? pendentes : confirmados;

  if (q.isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…</div>;
  }
  if (q.isError) {
    return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Não deu para carregar os treinamentos de sistemas: {(q.error as Error).message}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-gradient-to-r from-primary/5 to-transparent p-4 text-sm text-muted-foreground">
        <p className="flex items-center gap-2 font-medium text-foreground"><MonitorCog className="h-4 w-4 text-primary" /> Treinamentos de sistemas</p>
        <p className="mt-1">
          Quando um desenvolvimento do ERP é aprovado pela Presidência, o desenvolvedor passa o treinamento a quem vai usar.
          Confirme aqui que você recebeu — a solicitação só é finalizada quando todos confirmam.
        </p>
      </div>

      <div className="flex gap-1 border-b pb-2">
        {([["pendentes", `Para confirmar (${pendentes.length})`], ["confirmados", `Confirmados (${confirmados.length})`]] as const).map(([k, r]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${filtro === k ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}>
            {r}
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
          <GraduationCap className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">{filtro === "pendentes" ? "Nenhum treinamento de sistemas para confirmar" : "Nenhum treinamento confirmado ainda"}</p>
          {filtro === "pendentes" && <p className="text-sm text-muted-foreground">Quando um desenvolvedor enviar um treinamento para você ou para o seu setor, ele aparece aqui.</p>}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visiveis.map((t) => <CardTreinoSistema key={t.chamado_id} t={t} />)}
        </div>
      )}
    </div>
  );
}

function CardTreinoSistema({ t }: { t: TreinamentoSistema }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [verDescricao, setVerDescricao] = useState(false);
  const modulo = t.modulo_sistema ? moduloLabel({ modulo_sistema: t.modulo_sistema, modulo_sistema_outro: t.modulo_sistema_outro } as never) : null;

  const confirmar = async () => {
    setEnviando(true);
    const { data, error } = await (supabase as any).rpc("chamado_treinamento_confirmar_recebimento", {
      p_chamado_id: t.chamado_id, p_observacao: obs.trim() || null,
    });
    setEnviando(false);
    if (error) { toast({ title: "Não deu para confirmar", description: error.message, variant: "destructive" }); return; }
    toast(data === "finalizado"
      ? { title: "Treinamento confirmado", description: "Você era o último — a solicitação foi finalizada." }
      : { title: "Treinamento confirmado", description: "Obrigado! Registrado no chamado." });
    setObs("");
    qc.invalidateQueries({ queryKey: ["chamado-validacoes"] });
    qc.invalidateQueries({ queryKey: ["chamado-validacao", t.chamado_id] });
    qc.invalidateQueries({ queryKey: ["presidencia-chamados-dev"] });
  };

  return (
    <div className={`flex flex-col gap-3 rounded-xl border bg-card p-4 ${t.confirmado_em ? "" : "border-primary/40"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold text-muted-foreground">#{t.numero}{modulo ? ` · ${modulo}` : ""}</p>
          <h3 className="font-semibold leading-tight">{t.assunto}</h3>
        </div>
        {t.confirmado_em && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold text-white"><CheckCircle2 className="h-3 w-3" /> Confirmado</span>
        )}
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Desenvolvido por <b className="text-foreground">{t.desenvolvedor_nome ?? "—"}</b>{t.solicitante_nome ? <> · pedido de {t.solicitante_nome}</> : null}</p>
        <p>Enviado {t.enviado_por_nome && t.enviado_por_nome !== t.desenvolvedor_nome ? <>por <b>{t.enviado_por_nome}</b> </> : null}em {fmt(t.enviado_em)}
          {" · "}{t.origem === "setor" ? <>você recebeu pelo setor <b>{t.setor}</b></> : "você foi indicado(a)"}</p>
        {t.enviado_obs && <p className="whitespace-pre-wrap rounded-md border-l-2 border-primary/40 bg-muted/40 px-2 py-1.5 text-foreground [overflow-wrap:anywhere]">{t.enviado_obs}</p>}
        {t.descricao && (
          <div>
            <button type="button" className="flex items-center gap-1 font-semibold text-primary" onClick={() => setVerDescricao((v) => !v)}>
              {verDescricao ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} O que foi desenvolvido
            </button>
            {verDescricao && <p className="mt-1 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{t.descricao}</p>}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><Users className="h-3 w-3" /> Participantes que confirmaram</span>
          <span className="tabular-nums">{t.confirmados} de {t.participantes}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${t.participantes ? (t.confirmados / t.participantes) * 100 : 0}%` }} />
        </div>
      </div>

      {t.confirmado_em ? (
        <p className="text-xs text-muted-foreground">
          Você confirmou em {fmt(t.confirmado_em)}
          {t.confirmado_obs && <span className="block text-foreground [overflow-wrap:anywhere]">{t.confirmado_obs}</span>}
        </p>
      ) : (
        <div className="mt-auto space-y-2">
          <Textarea rows={2} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)}
            placeholder="Comentário (opcional): ficou alguma dúvida? algo a ajustar?" />
          <Button className="w-full gap-2" disabled={enviando} onClick={confirmar}>
            <GraduationCap className="h-4 w-4" /> {enviando ? "Confirmando…" : "Confirmar que recebi o treinamento"}
          </Button>
        </div>
      )}
    </div>
  );
}
