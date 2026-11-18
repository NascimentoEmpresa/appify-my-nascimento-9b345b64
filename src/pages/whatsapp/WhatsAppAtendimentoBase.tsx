// SIS-2026-0929 — Atendimento dos supervisores: base de conhecimento aprovada,
// revisão das respostas da I.A, regras de dados e configuração do canal.
// /app/whatsapp/atendimento/base
//
// Acesso (menu whatsapp_atd_base, nasce pendente):
//   visualizar = ler base, regras, canal e respostas da I.A
//   alterar    = escrever procedimento (fica PENDENTE de aprovação) e revisar respostas
//   aprovar    = aprovar procedimento, mexer nas regras de dados e no canal
// A I.A só usa procedimento ativo E aprovado; mudar o texto derruba a aprovação
// (wa_atd_base_salvar). Categoria sensível não pode ser liberada (CHECK no banco).

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpenCheck, CheckCircle2, Lock, Pencil, Plus, ShieldAlert, ThumbsDown, ThumbsUp, MinusCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AVISO_ABERTURA_PADRAO, MSG_ENCAMINHADO_PADRAO, MSG_NEGADO_PADRAO } from "../../../supabase/functions/_shared/whatsapp-atendimento";

interface ItemBase {
  id: string; titulo: string; conteudo: string; assunto: string | null; area_responsavel: string | null;
  ativo: boolean; aprovado: boolean; aprovado_em: string | null; versao: number; updated_at: string;
}
interface Regra {
  categoria: string; nome: string; sensivel: boolean; proprio: boolean; encarregado: boolean; supervisor: boolean;
  palavras_chave: string[]; ativo: boolean; ordem: number;
}

const fmtData = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const erro = (e: any) => toast.error(e?.message ?? "Não deu certo.");

// ---------------------------------------------------------------------------
function AbaBase({ podeAlterar, podeAprovar }: { podeAlterar: boolean; podeAprovar: boolean }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Partial<ItemBase> | null>(null);
  const [filtro, setFiltro] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["wa-atd-base"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("WA_ATD_BASE")
        .select("id, titulo, conteudo, assunto, area_responsavel, ativo, aprovado, aprovado_em, versao, updated_at")
        .order("assunto").order("titulo").limit(500);
      if (error) throw error;
      return (data ?? []) as ItemBase[];
    },
  });
  const salvar = useMutation({
    mutationFn: async (b: Partial<ItemBase>) => {
      const { error } = await (supabase as any).rpc("wa_atd_base_salvar", {
        p_id: b.id ?? null, p_titulo: b.titulo ?? "", p_conteudo: b.conteudo ?? "", p_assunto: b.assunto ?? null,
        p_area: b.area_responsavel ?? null, p_ativo: b.ativo ?? true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(podeAprovar ? "Procedimento salvo e aprovado." : "Procedimento salvo — aguarda aprovação para a I.A usar.");
      setEdit(null); qc.invalidateQueries({ queryKey: ["wa-atd-base"] });
    },
    onError: erro,
  });
  const aprovar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("wa_atd_base_aprovar", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Aprovado: a I.A passa a usar."); qc.invalidateQueries({ queryKey: ["wa-atd-base"] }); },
    onError: erro,
  });
  const lista = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return (data ?? []).filter((b) => !f || `${b.titulo} ${b.assunto ?? ""} ${b.area_responsavel ?? ""} ${b.conteudo}`.toLowerCase().includes(f));
  }, [data, filtro]);

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Input placeholder="Buscar procedimento" className="h-8 w-64 text-xs" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <p className="text-[11px] text-muted-foreground">A I.A responde <b>somente</b> com o que está ativo e aprovado aqui. Não coloque dado pessoal de ninguém.</p>
        {podeAlterar && (
          <Button size="sm" className="ml-auto h-8" onClick={() => setEdit({ ativo: true })}><Plus className="mr-1 h-4 w-4" /> Novo procedimento</Button>
        )}
      </Card>
      {isLoading && <Card className="p-6 text-center text-sm text-muted-foreground">Carregando…</Card>}
      <div className="grid gap-3 md:grid-cols-2">
        {lista.map((b) => (
          <Card key={b.id} className={`p-4 ${!b.ativo ? "opacity-60" : ""}`}>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="font-semibold">{b.titulo}</p>
              {b.assunto && <Badge variant="outline" className="text-[10px]">{b.assunto}</Badge>}
              {b.aprovado
                ? <Badge className="bg-emerald-600 text-[10px]">aprovado</Badge>
                : <Badge variant="destructive" className="text-[10px]">pendente de aprovação</Badge>}
              {!b.ativo && <Badge variant="secondary" className="text-[10px]">inativo</Badge>}
            </div>
            <p className="line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">{b.conteudo}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Área: {b.area_responsavel ?? "—"} · v{b.versao} · atualizado {fmtData(b.updated_at)}{b.aprovado_em && ` · aprovado ${fmtData(b.aprovado_em)}`}
            </p>
            <div className="mt-2 flex gap-2">
              {podeAlterar && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEdit(b)}><Pencil className="mr-1 h-3 w-3" /> Editar</Button>}
              {podeAprovar && !b.aprovado && (
                <Button size="sm" className="h-7 text-xs" disabled={aprovar.isPending} onClick={() => aprovar.mutate(b.id)}><CheckCircle2 className="mr-1 h-3 w-3" /> Aprovar</Button>
              )}
            </div>
          </Card>
        ))}
        {!isLoading && !lista.length && <Card className="p-6 text-center text-sm text-muted-foreground md:col-span-2">Nenhum procedimento. Sem base aprovada a I.A encaminha tudo para a equipe.</Card>}
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{edit?.id ? "Editar procedimento" : "Novo procedimento"}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div><Label className="text-xs">Título (a pergunta que ele responde)</Label>
                <Input value={edit.titulo ?? ""} onChange={(e) => setEdit({ ...edit, titulo: e.target.value })} /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label className="text-xs">Assunto</Label>
                  <Input placeholder="ex.: escala, ponto, uniforme, atestado" value={edit.assunto ?? ""} onChange={(e) => setEdit({ ...edit, assunto: e.target.value })} /></div>
                <div><Label className="text-xs">Área responsável</Label>
                  <Input placeholder="ex.: RH, DP, SST, Operacional" value={edit.area_responsavel ?? ""} onChange={(e) => setEdit({ ...edit, area_responsavel: e.target.value })} /></div>
              </div>
              <div><Label className="text-xs">Procedimento aprovado (o que a I.A pode dizer)</Label>
                <Textarea rows={8} value={edit.conteudo ?? ""} onChange={(e) => setEdit({ ...edit, conteudo: e.target.value })} /></div>
              <div className="flex items-center gap-2"><Switch checked={edit.ativo ?? true} onCheckedChange={(v) => setEdit({ ...edit, ativo: v })} /><Label className="text-xs">Ativo</Label></div>
              {!podeAprovar && <p className="text-[11px] text-amber-700">Você não tem a permissão de aprovar: ao salvar, o procedimento fica pendente e a I.A não usa até alguém aprovar.</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button disabled={salvar.isPending} onClick={() => edit && salvar.mutate(edit)}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
function AbaRevisao({ podeAlterar }: { podeAlterar: boolean }) {
  const qc = useQueryClient();
  const [pendentes, setPendentes] = useState(true);
  const [coment, setComent] = useState<Record<string, string>>({});
  const { data, isLoading } = useQuery({
    queryKey: ["wa-atd-respostas", pendentes],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("wa_atd_respostas_ia", { p_so_pendentes: pendentes });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const revisar = useMutation({
    mutationFn: async (p: { mensagem: string; avaliacao: string }) => {
      const { error } = await (supabase as any).rpc("wa_atd_revisar", {
        p_mensagem: p.mensagem, p_avaliacao: p.avaliacao, p_comentario: coment[p.mensagem] ?? null, p_base: null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, p) => {
      toast.success(p.avaliacao === "correta" ? "Marcada como correta." : "Registrado. Corrija a base na aba Base aprovada.");
      qc.invalidateQueries({ queryKey: ["wa-atd-respostas"] });
    },
    onError: erro,
  });
  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Button size="sm" variant={pendentes ? "default" : "outline"} className="h-8 text-xs" onClick={() => setPendentes(true)}>Ainda não revisadas</Button>
        <Button size="sm" variant={!pendentes ? "default" : "outline"} className="h-8 text-xs" onClick={() => setPendentes(false)}>Todas (30 dias)</Button>
        <p className="ml-auto text-[11px] text-muted-foreground">Resposta incorreta ou incompleta = ajustar o procedimento na base (a I.A só repete o que está lá).</p>
      </Card>
      {isLoading && <Card className="p-6 text-center text-sm text-muted-foreground">Carregando…</Card>}
      {(data ?? []).map((r) => (
        <Card key={r.mensagem_id} className="space-y-2 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{r.protocolo}</span>
            {r.assunto && <Badge variant="outline" className="text-[10px]">{r.assunto}</Badge>}
            <span>{fmtData(r.criada_em)}</span>
            {r.avaliacao && <Badge variant={r.avaliacao === "correta" ? "secondary" : "destructive"} className="text-[10px]">{r.avaliacao}</Badge>}
          </div>
          <div className="rounded bg-secondary p-2"><b>Pergunta:</b> {r.pergunta ?? "—"}</div>
          <div className="rounded bg-sky-100 p-2 dark:bg-sky-900/40"><b>Resposta da I.A:</b> {r.resposta}</div>
          {podeAlterar && (
            <div className="flex flex-wrap items-center gap-2">
              <Input className="h-7 min-w-[220px] flex-1 text-xs" placeholder="Comentário (o que estava errado / faltando)"
                value={coment[r.mensagem_id] ?? r.comentario ?? ""} onChange={(e) => setComent({ ...coment, [r.mensagem_id]: e.target.value })} />
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => revisar.mutate({ mensagem: r.mensagem_id, avaliacao: "correta" })}><ThumbsUp className="mr-1 h-3 w-3" /> Correta</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => revisar.mutate({ mensagem: r.mensagem_id, avaliacao: "incompleta" })}><MinusCircle className="mr-1 h-3 w-3" /> Incompleta</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={() => revisar.mutate({ mensagem: r.mensagem_id, avaliacao: "incorreta" })}><ThumbsDown className="mr-1 h-3 w-3" /> Incorreta</Button>
            </div>
          )}
        </Card>
      ))}
      {!isLoading && !(data ?? []).length && <Card className="p-6 text-center text-sm text-muted-foreground">Nada para revisar.</Card>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function AbaRegras({ podeAprovar }: { podeAprovar: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["wa-atd-regras"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("WA_ATD_REGRA_DADO")
        .select("categoria, nome, sensivel, proprio, encarregado, supervisor, palavras_chave, ativo, ordem").order("ordem").limit(100);
      if (error) throw error;
      return (data ?? []) as Regra[];
    },
  });
  const salvar = useMutation({
    mutationFn: async (r: Regra) => {
      const { error } = await (supabase as any).rpc("wa_atd_regra_salvar", {
        p_categoria: r.categoria, p_nome: r.nome, p_sensivel: r.sensivel, p_proprio: r.proprio,
        p_encarregado: r.encarregado, p_supervisor: r.supervisor, p_palavras: r.palavras_chave, p_ativo: r.ativo,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Regra salva."); qc.invalidateQueries({ queryKey: ["wa-atd-regras"] }); },
    onError: erro,
  });
  const Chave = ({ r, campo }: { r: Regra; campo: "proprio" | "encarregado" | "supervisor" }) =>
    r.sensivel
      ? <Lock className="mx-auto h-3.5 w-3.5 text-muted-foreground" aria-label="Sensível: nunca automático" />
      : <Switch checked={r[campo]} disabled={!podeAprovar || salvar.isPending} onCheckedChange={(v) => salvar.mutate({ ...r, [campo]: v })} />;

  return (
    <div className="space-y-3">
      <Card className="p-3 text-xs text-muted-foreground">
        O bot só entrega dado de colaborador quando o número que pergunta é o <b>do próprio colaborador</b> ou o <b>do encarregado do contrato dele</b>
        (Organograma Operacional), conferido no cadastro atual a cada pedido. Categoria <b>sensível</b> nunca sai pelo WhatsApp — vai para uma pessoa.
        Número desconhecido ou com divergência cadastral não recebe nada e o pedido vai para validação humana. Toda consulta fica na Auditoria.
      </Card>
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Categoria</TableHead><TableHead>Sensível</TableHead>
            <TableHead className="text-center">Próprio colaborador</TableHead><TableHead className="text-center">Encarregado</TableHead>
            <TableHead className="text-center">Supervisor</TableHead><TableHead>Palavras que marcam o assunto</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((r) => (
              <TableRow key={r.categoria}>
                <TableCell className="text-xs"><div className="font-medium">{r.nome}</div><div className="font-mono text-muted-foreground">{r.categoria}</div></TableCell>
                <TableCell>{r.sensivel ? <Badge variant="destructive" className="text-[10px]">nunca automático</Badge> : <Badge variant="secondary" className="text-[10px]">cadastro</Badge>}</TableCell>
                <TableCell className="text-center"><Chave r={r} campo="proprio" /></TableCell>
                <TableCell className="text-center"><Chave r={r} campo="encarregado" /></TableCell>
                <TableCell className="text-center"><Chave r={r} campo="supervisor" /></TableCell>
                <TableCell className="max-w-[320px] text-[11px] text-muted-foreground">{(r.palavras_chave ?? []).join(", ") || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
function AbaCanal({ podeAprovar }: { podeAprovar: boolean }) {
  const qc = useQueryClient();
  const { data: canal } = useQuery({
    queryKey: ["wa-atd-canal-config"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("WA_CANAL")
        .select("phone_number_id, ativo, ia_ativa, provedor, modelo, persona, aviso_abertura, msg_encaminhado, msg_negado, encerrar_ia_apos_horas, retencao_dias, setores")
        .eq("codigo", "supervisores").maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (canal) setF({ ...canal, setores_txt: (canal.setores ?? []).join(", ") }); }, [canal]);
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("wa_atd_canal_salvar", {
        p_dados: {
          phone_number_id: f.phone_number_id ?? "", ativo: !!f.ativo, ia_ativa: !!f.ia_ativa,
          provedor: f.provedor ?? "", modelo: f.modelo ?? "", persona: f.persona ?? "",
          aviso_abertura: f.aviso_abertura ?? "", msg_encaminhado: f.msg_encaminhado ?? "", msg_negado: f.msg_negado ?? "",
          encerrar_ia_apos_horas: Number(f.encerrar_ia_apos_horas) || 12,
          retencao_dias: f.retencao_dias === "" || f.retencao_dias == null ? "" : String(f.retencao_dias),
          setores: String(f.setores_txt ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
        },
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Configuração do canal salva."); qc.invalidateQueries({ queryKey: ["wa-atd-canal-config"] }); },
    onError: erro,
  });
  if (!f) return <Card className="p-6 text-center text-sm text-muted-foreground">Carregando…</Card>;
  const dis = !podeAprovar;
  return (
    <Card className="space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-2"><Switch disabled={dis} checked={!!f.ativo} onCheckedChange={(v) => setF({ ...f, ativo: v })} /><Label className="text-xs">Canal ativo</Label></div>
        <div className="flex items-center gap-2"><Switch disabled={dis} checked={!!f.ia_ativa} onCheckedChange={(v) => setF({ ...f, ia_ativa: v })} /><Label className="text-xs">I.A responde (senão só protocolo + fila)</Label></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label className="text-xs">Identificador do número na Meta (phone_number_id)</Label>
          <Input disabled={dis} value={f.phone_number_id ?? ""} onChange={(e) => setF({ ...f, phone_number_id: e.target.value })} placeholder="só dígitos" /></div>
        <div><Label className="text-xs">Provedor de I.A (vazio = o do Chatbot)</Label>
          <Input disabled={dis} value={f.provedor ?? ""} onChange={(e) => setF({ ...f, provedor: e.target.value })} placeholder="anthropic | gemini | groq | openrouter" /></div>
        <div><Label className="text-xs">Modelo (vazio = o do Chatbot)</Label>
          <Input disabled={dis} value={f.modelo ?? ""} onChange={(e) => setF({ ...f, modelo: e.target.value })} /></div>
        <div><Label className="text-xs">Encerrar atendimento da I.A sem resposta após (horas)</Label>
          <Input disabled={dis} type="number" min={1} max={168} value={f.encerrar_ia_apos_horas ?? 12} onChange={(e) => setF({ ...f, encerrar_ia_apos_horas: e.target.value })} /></div>
        <div><Label className="text-xs">Retenção: descartar texto após (dias, mín. 30; vazio = guardar)</Label>
          <Input disabled={dis} type="number" min={30} value={f.retencao_dias ?? ""} onChange={(e) => setF({ ...f, retencao_dias: e.target.value })} /></div>
        <div><Label className="text-xs">Setores para encaminhar (separados por vírgula)</Label>
          <Input disabled={dis} value={f.setores_txt ?? ""} onChange={(e) => setF({ ...f, setores_txt: e.target.value })} /></div>
      </div>
      <div><Label className="text-xs">Mensagem de abertura (aviso de I.A e LGPD) — use {"{protocolo}"}</Label>
        <Textarea disabled={dis} rows={4} value={f.aviso_abertura ?? ""} placeholder={AVISO_ABERTURA_PADRAO} onChange={(e) => setF({ ...f, aviso_abertura: e.target.value })} /></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label className="text-xs">Mensagem ao passar para humano</Label>
          <Textarea disabled={dis} rows={3} value={f.msg_encaminhado ?? ""} placeholder={MSG_ENCAMINHADO_PADRAO} onChange={(e) => setF({ ...f, msg_encaminhado: e.target.value })} /></div>
        <div><Label className="text-xs">Mensagem quando a informação não pode ser dada</Label>
          <Textarea disabled={dis} rows={3} value={f.msg_negado ?? ""} placeholder={MSG_NEGADO_PADRAO} onChange={(e) => setF({ ...f, msg_negado: e.target.value })} /></div>
      </div>
      <div><Label className="text-xs">Persona (opcional — as regras de segurança são fixas no código)</Label>
        <Textarea disabled={dis} rows={3} value={f.persona ?? ""} onChange={(e) => setF({ ...f, persona: e.target.value })} /></div>
      <p className="text-[11px] text-muted-foreground">
        O número corporativo precisa estar cadastrado na mesma conta da Meta (WABA) do token do servidor e o webhook assinado para ele.
        Ver docs/sis-2026-0929-atendimento-whatsapp-ia.md.
      </p>
      {podeAprovar && <div className="flex justify-end"><Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>Salvar configuração</Button></div>}
    </Card>
  );
}

export default function WhatsAppAtendimentoBase() {
  const { data: podeVer, isLoading } = useScreenAccess("whatsapp_atd_base", "visualizar");
  const { data: podeAlterar } = useScreenAccess("whatsapp_atd_base", "alterar");
  const { data: podeAprovar } = useScreenAccess("whatsapp_atd_base", "aprovar");
  const cabecalho = (
    <PageHeader title="Atendimento dos Supervisores — Base e Regras" module="WhatsApp" breadcrumb={["WhatsApp", "Atendimento", "Base e Regras"]}
      subtitle="Procedimentos aprovados que a I.A pode usar, revisão das respostas, regras de dados e o canal." />
  );
  if (isLoading) return <div>{cabecalho}</div>;
  if (!podeVer) {
    return (
      <div>
        {cabecalho}
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Acesso restrito. Peça a liberação de <b>WhatsApp — Atendimento Supervisores (base e regras)</b>.
        </Card>
      </div>
    );
  }
  return (
    <div>
      {cabecalho}
      <Tabs defaultValue="base">
        <TabsList className="mb-3 flex-wrap">
          <TabsTrigger value="base"><BookOpenCheck className="mr-1 h-4 w-4" /> Base aprovada</TabsTrigger>
          <TabsTrigger value="revisao">Revisão das respostas</TabsTrigger>
          <TabsTrigger value="regras">Regras de dados</TabsTrigger>
          <TabsTrigger value="canal">Canal</TabsTrigger>
        </TabsList>
        <TabsContent value="base"><AbaBase podeAlterar={!!podeAlterar} podeAprovar={!!podeAprovar} /></TabsContent>
        <TabsContent value="revisao"><AbaRevisao podeAlterar={!!podeAlterar} /></TabsContent>
        <TabsContent value="regras"><AbaRegras podeAprovar={!!podeAprovar} /></TabsContent>
        <TabsContent value="canal"><AbaCanal podeAprovar={!!podeAprovar} /></TabsContent>
      </Tabs>
    </div>
  );
}
