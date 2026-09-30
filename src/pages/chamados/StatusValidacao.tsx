// =====================================================================
// Validação da Presidência (mig 266) — peças de tela compartilhadas:
//   · useValidacaoChamado / useValidacoesChamados — leitura da tabela
//   · BotaoStatusChamado — botão "Status" que abre a linha do tempo
//   · CardTreinamento / EnviarTreinamentoDialog — o dev envia o treinamento a
//     usuários/setores; cada um confirma em Treinamentos Sistemas (mig 269)
//   · SeloEtapaValidacao — selo da etapa nas listas
// A lógica (etapas, quem confirma) mora em validacaoPresidencia.ts.
// =====================================================================
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Building2, CheckCircle2, Circle, CircleDot, Crown, GraduationCap, ListChecks, Send, Users, XCircle } from "lucide-react";
import { fmtDataHora, type Chamado } from "./types";
import {
  ETAPAS_VALIDACAO, desenvolvedorDaValidacao, montarLinhaDoTempo, podeEnviarTreinamento, resumoParticipantes, resumoStatus,
  type DestinatarioTreinamento, type ValidacaoChamado, type SituacaoPasso,
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
  const { data: dests } = useDestinatariosTreinamento(aberto && v?.treinamento_dev_em ? chamado.id : null);

  const passos = montarLinhaDoTempo(
    { ...chamado, motivo_cancelamento: chamado.motivo_cancelamento ?? null, cancelado_em: chamado.cancelado_em ?? null },
    v, nomeDe, dests ? resumoParticipantes(dests) : null,
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

// ---- Treinamento: envio pelo dev e andamento dos participantes (mig 269) ---

/** Participantes do treinamento de um chamado (vazio enquanto não enviado). */
export function useDestinatariosTreinamento(chamadoId: string | undefined | null) {
  return useQuery({
    queryKey: ["chamado-validacoes", "destinatarios", chamadoId],
    enabled: !!chamadoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHAMADO_TREINAMENTO_DESTINATARIO").select("*").eq("chamado_id", chamadoId);
      if (error) throw error;
      return (data ?? []) as DestinatarioTreinamento[];
    },
  });
}

interface UsuarioAtivo { id: string; display_name: string; setor: string | null }

/** Logins ativos com o setor do cadastro — a base da escolha de participantes. */
export function useUsuariosAtivos(enabled = true) {
  return useQuery({
    queryKey: ["chamados-usuarios-setor"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("listar_usuarios_ativos");
      if (error) throw error;
      return (data ?? []) as UsuarioAtivo[];
    },
  });
}

const normSetor = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase().replace(/\s+/g, " ");

/**
 * "Enviar treinamento": o dev (ou a gestão, por ele) escolhe quem recebe —
 * usuários a dedo e/ou setores inteiros. Setor inteiro = quem tem login
 * ativo com aquele Setor_ERP AGORA; a lista é gravada no envio (quem entrar
 * no setor depois não é incluído). Cada um confirma em Central de Serviços ›
 * Treinamentos › Treinamentos Sistemas.
 */
export function EnviarTreinamentoDialog({
  chamado, aberto, onFechar, peloDev,
}: {
  chamado: { id: string; numero: string; assunto?: string | null };
  aberto: boolean;
  onFechar: () => void;
  /** Nome do dev quando quem envia é a gestão, por ele. */
  peloDev?: string | null;
}) {
  const { toast } = useToast();
  const invalidar = useInvalidarValidacao();
  const { data: usuarios = [], isLoading } = useUsuariosAtivos(aberto);
  const [setores, setSetores] = useState<Set<string>>(new Set());
  const [pessoas, setPessoas] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Setores com gente ativa, com a contagem (o que "setor inteiro" alcança).
  const listaSetores = useMemo(() => {
    const m = new Map<string, { rotulo: string; n: number }>();
    usuarios.forEach((u) => {
      const k = normSetor(u.setor);
      if (!k || k === "PADRAO") return;
      const cur = m.get(k);
      m.set(k, { rotulo: cur?.rotulo ?? (u.setor ?? "").trim(), n: (cur?.n ?? 0) + 1 });
    });
    return [...m.entries()].map(([k, v]) => ({ chave: k, ...v })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  }, [usuarios]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return t ? usuarios.filter((u) => `${u.display_name} ${u.setor ?? ""}`.toLowerCase().includes(t)) : usuarios;
  }, [usuarios, busca]);

  // Quantas pessoas o envio alcança (união de setores + a dedo).
  const alcance = useMemo(() => {
    const ids = new Set(pessoas);
    usuarios.forEach((u) => { if (setores.has(normSetor(u.setor))) ids.add(u.id); });
    return ids.size;
  }, [usuarios, setores, pessoas]);

  const alterna = (set: Set<string>, setar: (s: Set<string>) => void, k: string) => {
    const n = new Set(set);
    if (n.has(k)) n.delete(k); else n.add(k);
    setar(n);
  };

  const enviar = async () => {
    if (!alcance) { toast({ title: "Escolha ao menos um setor ou uma pessoa", variant: "destructive" }); return; }
    setEnviando(true);
    const { data, error } = await (supabase as any).rpc("chamado_treinamento_enviar", {
      p_chamado_id: chamado.id,
      p_usuarios: [...pessoas],
      p_setores: listaSetores.filter((s) => setores.has(s.chave)).map((s) => s.rotulo),
      p_observacao: obs.trim() || null,
    });
    setEnviando(false);
    if (error) { toast({ title: "Não deu para enviar o treinamento", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Treinamento enviado para ${data} pessoa(s)`, description: "Cada uma confirma em Central de Serviços › Treinamentos › Treinamentos Sistemas." });
    setSetores(new Set()); setPessoas(new Set()); setObs(""); setBusca("");
    invalidar(chamado.id);
    onFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><GraduationCap className="h-5 w-5 text-primary" /> Enviar treinamento · #{chamado.numero}</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-sm text-muted-foreground">
          {chamado.assunto ? <><b>{chamado.assunto}</b>. </> : null}
          Escolha quem recebe o treinamento — setores inteiros e/ou pessoas. Cada um confirma em
          <b> Central de Serviços › Treinamentos › Treinamentos Sistemas</b>; com todos confirmados, a solicitação finaliza.
          {peloDev ? <> Você está enviando <b>pelo desenvolvedor {peloDev}</b>.</> : null}
        </p>

        {isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Carregando usuários…</p> : (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold"><Building2 className="h-3.5 w-3.5" /> Setor inteiro</p>
              <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border p-1.5">
                {listaSetores.map((s) => (
                  <label key={s.chave} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted">
                    <Checkbox checked={setores.has(s.chave)} onCheckedChange={() => alterna(setores, setSetores, s.chave)} />
                    <span className="flex-1">{s.rotulo}</span>
                    <span className="text-muted-foreground">{s.n}</span>
                  </label>
                ))}
                {!listaSetores.length && <p className="p-2 text-xs text-muted-foreground">Nenhum setor com pessoas ativas.</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold"><Users className="h-3.5 w-3.5" /> Pessoas</p>
              <Input className="h-8 text-xs" placeholder="Buscar por nome ou setor…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-md border p-1.5">
                {filtrados.map((u) => {
                  const peloSetor = setores.has(normSetor(u.setor));
                  return (
                    <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted">
                      <Checkbox checked={pessoas.has(u.id) || peloSetor} disabled={peloSetor} onCheckedChange={() => alterna(pessoas, setPessoas, u.id)} />
                      <span className="min-w-0 flex-1 truncate">{u.display_name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{u.setor || "sem setor"}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <Textarea rows={2} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)}
          placeholder="Observação (opcional): como foi o treinamento, data, link do vídeo, material…" />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{alcance} pessoa(s) vão receber</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button className="gap-1.5" disabled={enviando || !alcance} onClick={enviar}>
              <Send className="h-4 w-4" /> {enviando ? "Enviando…" : `Enviar para ${alcance} pessoa(s)`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Treinamento no chamado: antes do envio, o botão "Enviar treinamento" para o
 * dev (ou a gestão); depois, quem recebeu e quem já confirmou. Ninguém
 * confirma aqui — a confirmação é de cada participante, em Treinamentos
 * Sistemas (mig 269, 30/09/2026).
 */
export function CardTreinamento({
  chamado, validacao, nomeDe = () => "—",
}: {
  chamado: Pick<Chamado, "id" | "numero" | "assunto" | "solicitante_id" | "responsavel_id">;
  validacao: ValidacaoChamado | null | undefined;
  nomeDe?: (id: string | null) => string;
}) {
  const { user } = useAuth();
  const { gestor } = useChamadoPerms();
  const [enviarAberto, setEnviarAberto] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const emTreino = !!validacao && (validacao.etapa === "treinamento" || validacao.etapa === "finalizado");
  const { data: destinatarios = [] } = useDestinatariosTreinamento(emTreino && validacao?.treinamento_dev_em ? chamado.id : null);

  if (!validacao || !emTreino) return null;

  const finalizado = validacao.etapa === "finalizado";
  const enviado = !!validacao.treinamento_dev_em;
  const podeEnviar = podeEnviarTreinamento(validacao, chamado, user?.id, { gestao: gestor });
  const devId = desenvolvedorDaValidacao(validacao, chamado);
  const { total, confirmados } = resumoParticipantes(destinatarios);
  const meu = destinatarios.find((d) => d.user_id === user?.id);
  const ordenados = [...destinatarios].sort((a, b) =>
    Number(!!a.confirmado_em) - Number(!!b.confirmado_em) || nomeDe(a.user_id).localeCompare(nomeDe(b.user_id), "pt-BR"));
  const visiveis = verTodos ? ordenados : ordenados.slice(0, 8);

  return (
    <Card className={`animate-rise-in space-y-3 p-4 ${
      finalizado ? "border-success/30 bg-success/5" : podeEnviar || (meu && !meu.confirmado_em) ? "border-primary/40 bg-primary/5" : ""
    }`}>
      <p className="flex items-center gap-1.5 text-sm font-bold">
        <GraduationCap className={`h-4 w-4 ${finalizado ? "text-success" : "text-primary"}`} />
        {finalizado ? "Treinamento concluído" : enviado ? "Treinamento em andamento" : "Treinamento pendente"}
      </p>

      {!enviado && (
        <p className="text-xs text-muted-foreground">
          A Presidência aprovou o desenvolvimento{validacao.presidencia_por ? <> (<b>{nomeDe(validacao.presidencia_por)}</b>)</> : null}.
          {" "}Falta <b>{nomeDe(devId)}</b> enviar o treinamento, escolhendo quem vai recebê-lo.
        </p>
      )}
      {podeEnviar && (
        <Button className="w-full gap-2" onClick={() => setEnviarAberto(true)}>
          <Send className="h-4 w-4" /> {devId === user?.id ? "Enviar treinamento" : `Enviar treinamento por ${nomeDe(devId)}`}
        </Button>
      )}

      {enviado && (
        <>
          <p className="text-xs text-muted-foreground">
            Enviado por <b>{nomeDe(validacao.treinamento_dev_por)}</b> · {fmtDataHora(validacao.treinamento_dev_em)}
            {validacao.treinamento_dev_obs && <span className="block [overflow-wrap:anywhere]">{validacao.treinamento_dev_obs}</span>}
          </p>
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-muted-foreground"><span>Confirmaram</span><span className="tabular-nums">{confirmados} de {total}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${total ? (confirmados / total) * 100 : 0}%` }} />
            </div>
          </div>
          <div className="space-y-1">
            {visiveis.map((d) => (
              <div key={d.user_id} className="flex items-start gap-2 text-xs">
                {d.confirmado_em ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />}
                <span className="min-w-0">
                  <span className={d.confirmado_em ? "font-medium" : "text-muted-foreground"}>{nomeDe(d.user_id)}</span>
                  {d.setor && <span className="text-muted-foreground"> · {d.setor}</span>}
                  {d.confirmado_em && <span className="text-muted-foreground"> · {fmtDataHora(d.confirmado_em)}</span>}
                  {d.confirmado_obs && <span className="block text-muted-foreground [overflow-wrap:anywhere]">{d.confirmado_obs}</span>}
                </span>
              </div>
            ))}
            {ordenados.length > 8 && (
              <button type="button" className="text-[11px] font-semibold text-primary" onClick={() => setVerTodos((v) => !v)}>
                {verTodos ? "Mostrar menos" : `Ver todos (${ordenados.length})`}
              </button>
            )}
          </div>
          {meu && !meu.confirmado_em && (
            <Button asChild variant="outline" className="w-full gap-2">
              <Link to="/app/central-servicos/treinamentos-sistemas"><GraduationCap className="h-4 w-4" /> Confirmar em Treinamentos Sistemas</Link>
            </Button>
          )}
        </>
      )}

      {enviarAberto && (
        <EnviarTreinamentoDialog chamado={chamado} aberto onFechar={() => setEnviarAberto(false)}
          peloDev={devId !== user?.id ? nomeDe(devId) : null} />
      )}
    </Card>
  );
}
