// =====================================================================
// PRESIDÊNCIA › DESENVOLVIMENTO CHAMADOS (/app/presidencia/chamados-desenvolvimento)
//
// Chamados de sistemas que a coordenação marcou "Enviar à Presidência"
// (mig 20260930000266). Quando o dev conclui, o chamado cai aqui para a
// direção validar se o desenvolvimento está OK:
//   · Aprovar  → fica pendente de treinamento (dev e solicitante confirmam
//                na tela do chamado; quando os dois confirmam, finaliza)
//   · Devolver → volta para a fila do dev com o parecer da Presidência
//
// Liberação (Acesso por Usuário, módulo Presidência):
//   presidencia_chamados_dev          — ver a tela
//   presidencia_chamados_dev_validar  — aprovar/devolver
// A lista vem da RPC chamado_presidencia_listar (DEFINER): a Presidência vê
// o chamado sem precisar de acesso à gestão de chamados.
// =====================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CheckCircle2, Circle, Clock, Code2, Crown, GraduationCap, Search, ShieldAlert, ThumbsUp, Undo2, Flag,
} from "lucide-react";
import {
  StatCard, PrioridadeBadge, StatusBadge, fmtDataHora, moduloLabel,
} from "@/pages/chamados/types";
import { BotaoStatusChamado, SeloEtapaValidacao, useInvalidarValidacao } from "@/pages/chamados/StatusValidacao";
import type { EtapaValidacao, ValidacaoChamado } from "@/pages/chamados/validacaoPresidencia";

interface LinhaPresidencia {
  chamado_id: string;
  numero: string;
  assunto: string;
  descricao: string | null;
  prioridade: string;
  modulo_sistema: string | null;
  modulo_sistema_outro: string | null;
  status: string;
  solicitante_id: string | null;
  solicitante_nome: string | null;
  setor: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  chamado_criado_em: string;
  etapa: EtapaValidacao;
  enviado_por_nome: string | null;
  enviado_em: string;
  observacao_envio: string | null;
  desenvolvedor_id: string | null;
  desenvolvedor_nome: string | null;
  desenvolvimento_concluido_em: string | null;
  devolucoes: number;
  presidencia_por: string | null;
  presidencia_nome: string | null;
  presidencia_em: string | null;
  presidencia_aprovado: boolean | null;
  presidencia_parecer: string | null;
  treinamento_dev_em: string | null;
  treinamento_dev_obs: string | null;
  treinamento_solic_em: string | null;
  treinamento_solic_obs: string | null;
  finalizado_em: string | null;
}

type Aba = "validacao_presidencia" | "treinamento" | "finalizado" | "desenvolvimento" | "todos";

const ABAS: Array<{ value: Aba; label: string }> = [
  { value: "validacao_presidencia", label: "Aguardando validação" },
  { value: "treinamento", label: "Treinamento pendente" },
  { value: "finalizado", label: "Finalizados" },
  { value: "desenvolvimento", label: "Em desenvolvimento" },
  { value: "todos", label: "Todos" },
];

/** A linha da RPC no formato da tabela, para reaproveitar a linha do tempo do "Status". */
function paraValidacao(l: LinhaPresidencia): ValidacaoChamado {
  return {
    chamado_id: l.chamado_id, etapa: l.etapa, enviado_por: null, enviado_em: l.enviado_em,
    observacao_envio: l.observacao_envio, desenvolvedor_id: l.desenvolvedor_id,
    desenvolvimento_concluido_em: l.desenvolvimento_concluido_em, devolucoes: l.devolucoes,
    presidencia_por: l.presidencia_por, presidencia_em: l.presidencia_em,
    presidencia_aprovado: l.presidencia_aprovado, presidencia_parecer: l.presidencia_parecer,
    treinamento_dev_por: null, treinamento_dev_em: l.treinamento_dev_em, treinamento_dev_obs: l.treinamento_dev_obs,
    treinamento_solic_por: null, treinamento_solic_em: l.treinamento_solic_em, treinamento_solic_obs: l.treinamento_solic_obs,
    finalizado_em: l.finalizado_em, created_at: l.enviado_em, updated_at: l.enviado_em,
  };
}

export default function ChamadosDesenvolvimento() {
  const { toast } = useToast();
  const invalidar = useInvalidarValidacao();
  const { data: access, isLoading: carregandoAcesso } = useAccessibleMenus("visualizar");
  const podeVer = !!access && (access.codes.has("presidencia_chamados_dev") || access.codes.has("presidencia_chamados_dev_validar"));
  const podeValidar = !!access?.codes.has("presidencia_chamados_dev_validar");

  const [aba, setAba] = useState<Aba>("validacao_presidencia");
  const [busca, setBusca] = useState("");
  const [decisao, setDecisao] = useState<{ linha: LinhaPresidencia; aprovar: boolean } | null>(null);
  const [parecer, setParecer] = useState("");
  const [gravando, setGravando] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);

  const { data: linhas = [], isLoading, error } = useQuery({
    queryKey: ["presidencia-chamados-dev"],
    enabled: podeVer,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("chamado_presidencia_listar");
      if (error) throw error;
      return (data ?? []) as LinhaPresidencia[];
    },
  });

  const contagem = useMemo(() => {
    const c: Record<string, number> = { validacao_presidencia: 0, treinamento: 0, finalizado: 0, desenvolvimento: 0 };
    linhas.forEach((l) => { c[l.etapa] = (c[l.etapa] ?? 0) + 1; });
    return c;
  }, [linhas]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas
      .filter((l) => aba === "todos" || l.etapa === aba)
      // Em desenvolvimento: chamado reprovado/cancelado não vai chegar à Presidência.
      .filter((l) => aba !== "desenvolvimento" || (l.status !== "reprovado" && l.status !== "cancelado"))
      .filter((l) => !q || [l.numero, l.assunto, l.solicitante_nome, l.setor, l.desenvolvedor_nome, l.responsavel_nome]
        .some((x) => (x ?? "").toLowerCase().includes(q)));
  }, [linhas, aba, busca]);

  const nomes = useMemo(() => {
    const m: Record<string, string> = {};
    linhas.forEach((l) => {
      if (l.responsavel_id && l.responsavel_nome) m[l.responsavel_id] = l.responsavel_nome;
      if (l.desenvolvedor_id && l.desenvolvedor_nome) m[l.desenvolvedor_id] = l.desenvolvedor_nome;
      if (l.presidencia_por && l.presidencia_nome) m[l.presidencia_por] = l.presidencia_nome;
    });
    return m;
  }, [linhas]);
  const nomeDe = (id: string | null) => (id ? nomes[id] ?? "—" : "—");

  const decidir = async () => {
    if (!decisao) return;
    const texto = parecer.trim();
    if (!decisao.aprovar && texto.length < 5) {
      toast({ title: "Explique o que não está OK para o desenvolvedor ajustar.", variant: "destructive" });
      return;
    }
    setGravando(true);
    const { error } = await (supabase as any).rpc("chamado_presidencia_decidir", {
      p_chamado_id: decisao.linha.chamado_id, p_aprovado: decisao.aprovar, p_parecer: texto || null,
    });
    setGravando(false);
    if (error) { toast({ title: "Erro ao registrar a decisão", description: error.message, variant: "destructive" }); return; }
    toast(decisao.aprovar
      ? { title: `#${decisao.linha.numero} aprovado`, description: "Agora fica pendente de treinamento (dev e solicitante confirmam)." }
      : { title: `#${decisao.linha.numero} devolvido ao desenvolvimento`, description: "O chamado voltou para a fila do desenvolvedor com o seu parecer." });
    invalidar(decisao.linha.chamado_id);
    setDecisao(null); setParecer("");
  };

  if (carregandoAcesso) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;
  if (!podeVer) {
    return (
      <div>
        <PageHeader title="Desenvolvimento Chamados" module="Presidência" breadcrumb={["Presidência", "Desenvolvimento Chamados"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Acesso restrito. Peça a liberação de <b>Desenvolvimento Chamados</b> (módulo Presidência) em Acesso por Usuário.
        </Card>
      </div>
    );
  }

  const Check = ({ ok, titulo, quando }: { ok: boolean; titulo: string; quando: string | null }) => (
    <span className="flex items-center gap-1 text-[11px]">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />}
      <span className={ok ? "font-medium" : "text-muted-foreground"}>{titulo}</span>
      {quando && <span className="text-muted-foreground">· {fmtDataHora(quando)}</span>}
    </span>
  );

  return (
    <div>
      <PageHeader
        title="Desenvolvimento Chamados"
        subtitle="Chamados de sistemas enviados à Presidência: valide se o desenvolvimento está OK e acompanhe o treinamento."
        module="Presidência"
        breadcrumb={["Presidência", "Desenvolvimento Chamados"]}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Crown} tone="warning" label="Aguardando validação" value={contagem.validacao_presidencia} hint="Dev concluiu" />
        <StatCard icon={GraduationCap} tone="primary" label="Treinamento pendente" value={contagem.treinamento} hint="Dev e solicitante confirmam" />
        <StatCard icon={Flag} tone="success" label="Finalizados" value={contagem.finalizado} hint="Treinamento confirmado" />
        <StatCard icon={Code2} tone="info" label="Em desenvolvimento" value={contagem.desenvolvimento} hint="Ainda com o dev" />
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
            <TabsList className="h-auto flex-wrap">
              {ABAS.map((a) => (
                <TabsTrigger key={a.value} value={a.value} className="gap-1.5 text-xs">
                  {a.label}
                  {a.value !== "todos" && (contagem[a.value] ?? 0) > 0 && (
                    <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold">{contagem[a.value]}</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="h-9 pl-8 text-sm" placeholder="Nº, assunto, solicitante, dev…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </div>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive">Não foi possível carregar: {(error as Error).message}</p>
        ) : visiveis.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {aba === "validacao_presidencia" ? "Nenhum desenvolvimento aguardando a sua validação." : "Nada por aqui."}
          </p>
        ) : (
          <div className="space-y-3">
            {visiveis.map((l) => {
              const aberto = expandido === l.chamado_id;
              const v = paraValidacao(l);
              return (
                <div key={l.chamado_id} className={`rounded-lg border p-3 ${
                  l.etapa === "validacao_presidencia" ? "border-warning/40 bg-warning/5" : "border-border"
                }`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold">#{l.numero}</span>
                        <SeloEtapaValidacao v={v} />
                        <StatusBadge status={l.status} />
                        <PrioridadeBadge prioridade={l.prioridade} />
                        {l.devolucoes > 0 && (
                          <span className="text-[11px] text-muted-foreground">devolvido {l.devolucoes}x</span>
                        )}
                      </div>
                      <button type="button" className="mt-1 block text-left text-sm font-semibold hover:underline" onClick={() => setExpandido(aberto ? null : l.chamado_id)}>
                        {l.assunto}
                      </button>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Solicitante: <b>{l.solicitante_nome || "—"}</b>{l.setor ? ` (${l.setor})` : ""}
                        {" · "}Desenvolvedor: <b>{l.desenvolvedor_nome || l.responsavel_nome || "—"}</b>
                        {" · "}{moduloLabel(l)}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Aberto {fmtDataHora(l.chamado_criado_em)}</span>
                        {l.desenvolvimento_concluido_em && <span>Concluído pelo dev {fmtDataHora(l.desenvolvimento_concluido_em)}</span>}
                        {l.presidencia_em && l.presidencia_aprovado && <span>Aprovado por {l.presidencia_nome} {fmtDataHora(l.presidencia_em)}</span>}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <BotaoStatusChamado
                        chamado={{
                          id: l.chamado_id, numero: l.numero, assunto: l.assunto, status: l.status,
                          created_at: l.chamado_criado_em, updated_at: l.presidencia_em ?? l.enviado_em,
                          responsavel_id: l.responsavel_id, concluido_em: l.desenvolvimento_concluido_em,
                          motivo_reprovacao: null,
                        }}
                        validacao={v}
                        nomeDe={nomeDe}
                      />
                      {podeValidar && l.etapa === "validacao_presidencia" && (
                        <>
                          <Button size="sm" variant="outline" className="h-8 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => { setParecer(""); setDecisao({ linha: l, aprovar: false }); }}>
                            <Undo2 className="h-3.5 w-3.5" /> Devolver
                          </Button>
                          <Button size="sm" className="h-8 gap-1.5 bg-success text-success-foreground hover:bg-success/90"
                            onClick={() => { setParecer(""); setDecisao({ linha: l, aprovar: true }); }}>
                            <ThumbsUp className="h-3.5 w-3.5" /> Aprovar
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {(l.etapa === "treinamento" || l.etapa === "finalizado") && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-muted/40 px-2.5 py-1.5">
                      <span className="flex items-center gap-1 text-[11px] font-semibold"><GraduationCap className="h-3.5 w-3.5 text-primary" /> Treinamento:</span>
                      <Check ok={!!l.treinamento_dev_em} titulo="Desenvolvedor" quando={l.treinamento_dev_em} />
                      <Check ok={!!l.treinamento_solic_em} titulo="Solicitante" quando={l.treinamento_solic_em} />
                    </div>
                  )}

                  {l.etapa === "desenvolvimento" && l.presidencia_aprovado === false && l.presidencia_parecer && (
                    <p className="mt-2 rounded-md border-l-2 border-destructive/50 bg-destructive/5 px-2.5 py-1.5 text-xs [overflow-wrap:anywhere]">
                      <b>Devolvido:</b> {l.presidencia_parecer}
                    </p>
                  )}

                  {aberto && (
                    <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Descrição do chamado</p>
                        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{l.descricao || "—"}</p>
                      </div>
                      {l.observacao_envio && (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Observação da coordenação</p>
                          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{l.observacao_envio}</p>
                        </div>
                      )}
                      {l.presidencia_parecer && l.presidencia_aprovado && (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Parecer da Presidência</p>
                          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{l.presidencia_parecer}</p>
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Enviado à Presidência por {l.enviado_por_nome || "—"} em {fmtDataHora(l.enviado_em)}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={!!decisao} onOpenChange={(o) => { if (!o) setDecisao(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisao?.aprovar ? "Aprovar desenvolvimento" : "Devolver ao desenvolvimento"} · #{decisao?.linha.numero}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {decisao?.aprovar
              ? "O desenvolvimento está OK. O chamado fica pendente de treinamento: o desenvolvedor e o solicitante confirmam, cada um, que o treinamento foi dado."
              : "O chamado volta para a fila do desenvolvedor com o seu parecer. Quando ele concluir de novo, retorna para a sua validação."}
          </p>
          <Textarea
            rows={4} maxLength={2000} value={parecer} onChange={(e) => setParecer(e.target.value)}
            placeholder={decisao?.aprovar ? "Parecer (opcional)" : "O que não está OK? (obrigatório)"}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDecisao(null)}>Cancelar</Button>
            {decisao?.aprovar ? (
              <Button className="gap-1.5 bg-success text-success-foreground hover:bg-success/90" disabled={gravando} onClick={decidir}>
                <ThumbsUp className="h-4 w-4" /> {gravando ? "Aprovando…" : "Aprovar"}
              </Button>
            ) : (
              <Button variant="destructive" className="gap-1.5" disabled={gravando || parecer.trim().length < 5} onClick={decidir}>
                <Undo2 className="h-4 w-4" /> {gravando ? "Devolvendo…" : "Devolver"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
