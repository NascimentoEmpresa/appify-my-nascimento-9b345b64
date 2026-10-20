import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { Ban, Clock, Gavel, Mail, MailX, RefreshCw } from "lucide-react";

// SIS-2026-0653: cobrança automática a partir do Relatório de Serviços. A conta (quem recebe o quê e quando) é feita pela
// edge function `cobranca-automatica`; esta aba mostra a simulação, deixa o Financeiro ligar/desligar e ajustar a rotina,
// e lista o que já foi enviado. Faixa roxa/preta aparece aqui só como "Manual — Jurídico": nunca é enviada pela rotina.

const fmtMoney = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
const fmtDia = (iso: string | null) => (iso ? new Date(iso.length <= 10 ? iso + "T00:00:00" : iso).toLocaleDateString("pt-BR") : "—");
const fmtHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

type Decisao = "enviar" | "aguardar" | "judicial" | "manual" | "sem_destinatario";
type Modo = "desligado" | "simulacao" | "piloto" | "producao";

interface PlanoLinha {
  contrato_id: string;
  contrato: string;
  empresa: string;
  faixa: string;
  dias_max: number;
  qtd_notas: number;
  valor_total: number;
  decisao: Decisao;
  motivo: string;
  destinatarios: string[];
  ultimo_envio: string | null;
  proximo_envio: string | null;
  notas: { numero: string; data_emissao: string; competencia: string | null; valor: number }[];
}

interface Simulacao {
  ok: boolean;
  modo: Modo;
  janela_aberta: boolean;
  envio_configurado: boolean;
  gerado_em: string;
  contagem: Partial<Record<Decisao, number>>;
  planos: PlanoLinha[];
  error?: string;
}

interface Config {
  modo: Modo;
  email_piloto: string | null;
  cc_fixo: string[];
  assinatura_html: string;
  intervalo_dias: Record<string, number>;
  aviso_dias_antes: number;
  somente_dias_uteis: boolean;
  hora_inicio: number;
  hora_fim: number;
  limite_por_execucao: number;
}

const MODO_ROTULO: Record<Modo, string> = {
  desligado: "Desligado",
  simulacao: "Simulação (só mostra, não envia)",
  piloto: "Piloto (envia tudo para o e-mail de teste)",
  producao: "Produção (envia aos tomadores)",
};

const FAIXA_ROTULO: Record<string, string> = {
  aviso: "Aviso amigável", verde: "Verde", amarela: "Amarela", laranja: "Laranja", vermelha: "Vermelha", roxa: "Roxa", preta: "Preta",
};
const FAIXA_COR: Record<string, string> = {
  aviso: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  verde: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  amarela: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  laranja: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  vermelha: "bg-red-500/10 text-red-700 dark:text-red-300",
  roxa: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  preta: "bg-neutral-800/10 text-neutral-900 dark:bg-neutral-200/10 dark:text-neutral-200",
};

const DECISAO_INFO: Record<Decisao, { rotulo: string; classe: string }> = {
  enviar: { rotulo: "Vai enviar", classe: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  aguardar: { rotulo: "Aguardando prazo", classe: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  judicial: { rotulo: "Manual — Jurídico", classe: "bg-purple-500/10 text-purple-700 dark:text-purple-300" },
  manual: { rotulo: "Só manual", classe: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  sem_destinatario: { rotulo: "Sem e-mail", classe: "bg-red-500/10 text-red-700 dark:text-red-300" },
};

export default function AutomacaoTab() {
  const { can } = usePermissoes();
  const qc = useQueryClient();
  const podeAlterar = can("alterar", undefined, "cobrancas");
  const podeMarcarManual = podeAlterar || can("aprovar", undefined, "cobrancas");

  const [filtro, setFiltro] = useState<Decisao | "todas">("todas");
  const [previa, setPrevia] = useState<{ contrato: string; assunto: string; corpo: string; para: string[]; cc: string[] } | null>(null);
  const [aberto, setAberto] = useState<PlanoLinha | null>(null);
  const [configAberta, setConfigAberta] = useState(false);
  const [confirmarProducao, setConfirmarProducao] = useState(false);

  const { data: simulacao, isLoading, isFetching, error, refetch } = useQuery<Simulacao>({
    queryKey: ["cobranca-auto-simulacao"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("cobranca-automatica", { body: { acao: "simular" } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha ao simular a cobrança.");
      return data as Simulacao;
    },
  });

  const { data: config } = useQuery<Config>({
    queryKey: ["cobranca-auto-config"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("cobranca_auto_config").select("*").eq("id", 1).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: envios = [] } = useQuery<any[]>({
    queryKey: ["cobranca-auto-envios"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("cobranca_auto_envio")
        .select("id, contrato_nome, empresa_codigo, faixa, modo, status, qtd_notas, valor_total, destinatarios, cc, assunto, erro, criado_em")
        .order("criado_em", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const salvarConfig = useMutation({
    mutationFn: async (c: Partial<Config>) => {
      const { error } = await (supabase as any).from("cobranca_auto_config").update({ ...c, atualizado_em: new Date().toISOString() }).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cobranca-auto-config"] });
      qc.invalidateQueries({ queryKey: ["cobranca-auto-simulacao"] });
      toast.success("Configuração salva.");
    },
    onError: (e: any) => toast.error(`Não foi possível salvar: ${e.message ?? e}`),
  });

  const alternarManual = useMutation({
    mutationFn: async ({ contratoId, manual }: { contratoId: string; manual: boolean }) => {
      const t = (supabase as any).from("cobranca_auto_contrato_manual");
      const { error } = manual ? await t.upsert({ contrato_id: contratoId, motivo: "Marcado na tela de Cobranças" }) : await t.delete().eq("contrato_id", contratoId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cobranca-auto-simulacao"] });
      setAberto(null);
    },
    onError: (e: any) => toast.error(`Não foi possível alterar: ${e.message ?? e}`),
  });

  const abrirPrevia = async (p: PlanoLinha) => {
    const { data, error } = await supabase.functions.invoke("cobranca-automatica", { body: { acao: "previa", contrato_id: p.contrato_id } });
    if (error || !data?.ok) {
      toast.error(data?.error ?? "Não foi possível montar a prévia.");
      return;
    }
    setPrevia({ contrato: p.contrato, assunto: data.assunto, corpo: data.corpo, para: data.para, cc: data.cc });
  };

  const planos = simulacao?.planos ?? [];
  const visiveis = useMemo(() => (filtro === "todas" ? planos : planos.filter((p) => p.decisao === filtro)), [planos, filtro]);
  const n = (d: Decisao) => simulacao?.contagem?.[d] ?? 0;

  const mudarModo = (novo: Modo) => {
    if (novo === "producao") return setConfirmarProducao(true);
    salvarConfig.mutate({ modo: novo });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Modo da rotina</p>
            <Select value={config?.modo ?? "desligado"} onValueChange={(v) => mudarModo(v as Modo)} disabled={!podeAlterar || !config}>
              <SelectTrigger className="w-80"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(MODO_ROTULO) as Modo[]).map((m) => <SelectItem key={m} value={m}>{MODO_ROTULO[m]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>Janela de envio: {config ? `${config.somente_dias_uteis ? "dias úteis, " : ""}${config.hora_inicio}h às ${config.hora_fim}h (Brasília)` : "—"} · agora {simulacao ? (simulacao.janela_aberta ? "dentro" : "fora") : "—"} da janela</p>
            <p className={simulacao && !simulacao.envio_configurado ? "text-amber-600 dark:text-amber-400" : ""}>
              {simulacao ? (simulacao.envio_configurado ? "Conta de envio (SMTP) configurada." : "Conta de envio (SMTP) ainda não configurada: a rotina não consegue enviar.") : ""}
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Atualizar</Button>
            {podeAlterar && <Button variant="outline" size="sm" onClick={() => setConfigAberta(true)} disabled={!config}>Ajustar rotina</Button>}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiTile label="Vão enviar" valor={String(n("enviar"))} sub="na próxima rodada" icon={<Mail />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" onClick={() => setFiltro("enviar")} />
        <KpiTile label="Aguardando prazo" valor={String(n("aguardar"))} sub="já cobrados nesta faixa" icon={<Clock />} cor="slate" onClick={() => setFiltro("aguardar")} />
        <KpiTile label="Sem e-mail" valor={String(n("sem_destinatario"))} sub="cadastrar o e-mail do tomador" icon={<MailX />} cor="red" valorClass="text-red-600 dark:text-red-400" onClick={() => setFiltro("sem_destinatario")} />
        <KpiTile label="Manual — Jurídico" valor={String(n("judicial"))} sub="faixa roxa ou preta: fora do automático" icon={<Gavel />} cor="amber" onClick={() => setFiltro("judicial")} />
        <KpiTile label="Só manual" valor={String(n("manual"))} sub="marcados pelo Financeiro/Jurídico" icon={<Ban />} cor="amber" onClick={() => setFiltro("manual")} />
      </div>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold">Contratos na janela de cobrança {simulacao ? `· simulação de ${fmtHora(simulacao.gerado_em)}` : ""}</CardTitle>
          <Select value={filtro} onValueChange={(v) => setFiltro(v as Decisao | "todas")}>
            <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos</SelectItem>
              {(Object.keys(DECISAO_INFO) as Decisao[]).map((d) => <SelectItem key={d} value={d}>{DECISAO_INFO[d].rotulo}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[55vh] overflow-auto">
            <Table className="text-xs">
              <TableHeader className="sticky top-0 bg-muted/50">
                <TableRow>
                  <TableHead>Contrato</TableHead><TableHead>Empresa</TableHead><TableHead>Faixa</TableHead>
                  <TableHead className="text-right">Notas</TableHead><TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Dias</TableHead><TableHead>Situação</TableHead><TableHead>Último e-mail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Calculando...</TableCell></TableRow>}
                {error && <TableRow><TableCell colSpan={8} className="py-6 text-center text-red-600">{(error as Error).message}</TableCell></TableRow>}
                {!isLoading && !error && visiveis.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Nenhum contrato neste filtro.</TableCell></TableRow>}
                {visiveis.map((p) => (
                  <TableRow key={p.contrato_id} className="cursor-pointer hover:bg-muted/50" onClick={() => setAberto(p)}>
                    <TableCell className="max-w-[260px] truncate font-medium" title={p.contrato}>{p.contrato}</TableCell>
                    <TableCell>{p.empresa}</TableCell>
                    <TableCell><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${FAIXA_COR[p.faixa] ?? ""}`}>{FAIXA_ROTULO[p.faixa] ?? p.faixa}</span></TableCell>
                    <TableCell className="text-right">{p.qtd_notas}</TableCell>
                    <TableCell className="text-right">{fmtMoney(p.valor_total)}</TableCell>
                    <TableCell className="text-right">{p.dias_max}</TableCell>
                    <TableCell><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${DECISAO_INFO[p.decisao].classe}`}>{DECISAO_INFO[p.decisao].rotulo}</span></TableCell>
                    <TableCell className="text-muted-foreground">{fmtDia(p.ultimo_envio)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Envios automáticos (últimos 100)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[40vh] overflow-auto">
            <Table className="text-xs">
              <TableHeader className="sticky top-0 bg-muted/50">
                <TableRow><TableHead>Quando</TableHead><TableHead>Contrato</TableHead><TableHead>Faixa</TableHead><TableHead>Modo</TableHead><TableHead>Para</TableHead><TableHead>Resultado</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {envios.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Nenhum envio automático ainda.</TableCell></TableRow>}
                {envios.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{fmtHora(e.criado_em)}</TableCell>
                    <TableCell className="max-w-[240px] truncate" title={e.contrato_nome}>{e.contrato_nome}</TableCell>
                    <TableCell><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${FAIXA_COR[e.faixa] ?? ""}`}>{FAIXA_ROTULO[e.faixa] ?? e.faixa}</span></TableCell>
                    <TableCell>{e.modo === "piloto" ? <Badge variant="outline" className="text-[10px]">piloto</Badge> : "produção"}</TableCell>
                    <TableCell className="max-w-[240px] truncate" title={(e.destinatarios ?? []).join("; ")}>{(e.destinatarios ?? []).join("; ")}</TableCell>
                    <TableCell>{e.status === "enviado" ? <span className="text-emerald-600 dark:text-emerald-400">Enviado ({e.qtd_notas} nota(s), {fmtMoney(e.valor_total)})</span> : <span className="text-red-600" title={e.erro ?? ""}>Falhou</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detalhe do contrato */}
      <Dialog open={!!aberto} onOpenChange={(o) => !o && setAberto(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {aberto && (
            <>
              <DialogHeader>
                <DialogTitle>{aberto.contrato}</DialogTitle>
                <DialogDescription>{aberto.empresa} · {FAIXA_ROTULO[aberto.faixa]} · {aberto.dias_max} dias desde a emissão da nota mais antiga</DialogDescription>
              </DialogHeader>
              <p className={`rounded border p-2 text-sm ${aberto.decisao === "judicial" ? "border-purple-300 bg-purple-50 dark:bg-purple-950/30" : ""}`}>
                {aberto.decisao === "judicial" && <Gavel className="mr-1 inline h-4 w-4 text-purple-600" />}{aberto.motivo}
              </p>
              <p className="text-xs text-muted-foreground">Destinatários: {aberto.destinatarios.length ? aberto.destinatarios.join("; ") : "nenhum e-mail cadastrado"}</p>
              <Table className="text-xs">
                <TableHeader><TableRow><TableHead>Nota</TableHead><TableHead>Emissão</TableHead><TableHead>Competência</TableHead><TableHead className="text-right">Valor em aberto</TableHead></TableRow></TableHeader>
                <TableBody>
                  {aberto.notas.map((nt) => (
                    <TableRow key={nt.numero}><TableCell>{nt.numero}</TableCell><TableCell>{fmtDia(nt.data_emissao)}</TableCell><TableCell>{nt.competencia ? nt.competencia.slice(5, 7) + "/" + nt.competencia.slice(0, 4) : "—"}</TableCell><TableCell className="text-right">{fmtMoney(nt.valor)}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-wrap justify-end gap-2">
                {aberto.decisao !== "judicial" && <Button variant="outline" size="sm" onClick={() => abrirPrevia(aberto)}>Ver prévia do e-mail</Button>}
                {podeMarcarManual && aberto.decisao !== "judicial" && (
                  <Button variant={aberto.decisao === "manual" ? "default" : "outline"} size="sm" disabled={alternarManual.isPending}
                    onClick={() => alternarManual.mutate({ contratoId: aberto.contrato_id, manual: aberto.decisao !== "manual" })}>
                    {aberto.decisao === "manual" ? "Voltar ao automático" : "Passar para cobrança só manual"}
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Prévia do e-mail */}
      <Dialog open={!!previa} onOpenChange={(o) => !o && setPrevia(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {previa && (
            <>
              <DialogHeader>
                <DialogTitle>Prévia — {previa.contrato}</DialogTitle>
                <DialogDescription>Como o e-mail sairia hoje. Nada é enviado por aqui.</DialogDescription>
              </DialogHeader>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p><strong>Para:</strong> {previa.para.join("; ") || "—"}</p>
                <p><strong>Cópia:</strong> {previa.cc.join("; ") || "—"}</p>
                <p><strong>Assunto:</strong> {previa.assunto}</p>
              </div>
              {/* iframe sem permissões: o HTML do e-mail (nome de contrato, modelo) nunca executa script na tela */}
              <iframe title="Prévia do e-mail" sandbox="" srcDoc={previa.corpo} className="h-[50vh] w-full rounded border bg-white" />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Ajustes da rotina */}
      {config && <ConfigDialog aberto={configAberta} onClose={() => setConfigAberta(false)} config={config} salvando={salvarConfig.isPending} onSalvar={(c) => salvarConfig.mutate(c, { onSuccess: () => setConfigAberta(false) })} />}

      <AlertDialog open={confirmarProducao} onOpenChange={setConfirmarProducao}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ligar o envio automático em produção?</AlertDialogTitle>
            <AlertDialogDescription>
              A partir da próxima hora cheia, dentro da janela, os e-mails de cobrança das faixas do Financeiro serão enviados aos tomadores
              ({n("enviar")} contrato(s) na simulação de agora). Contratos na faixa roxa ou preta continuam fora e são do Jurídico.
              Confirme que o piloto foi validado com o Financeiro e o Jurídico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => salvarConfig.mutate({ modo: "producao" })}>Ligar em produção</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConfigDialog({ aberto, onClose, config, salvando, onSalvar }: { aberto: boolean; onClose: () => void; config: Config; salvando: boolean; onSalvar: (c: Partial<Config>) => void }) {
  const [emailPiloto, setEmailPiloto] = useState(config.email_piloto ?? "");
  const [cc, setCc] = useState(config.cc_fixo.join("; "));
  const [assinatura, setAssinatura] = useState(config.assinatura_html);
  const [intervalos, setIntervalos] = useState<Record<string, number>>(config.intervalo_dias);
  const [avisoAntes, setAvisoAntes] = useState(config.aviso_dias_antes);
  const [diasUteis, setDiasUteis] = useState(config.somente_dias_uteis);
  const [horaIni, setHoraIni] = useState(config.hora_inicio);
  const [horaFim, setHoraFim] = useState(config.hora_fim);
  const [limite, setLimite] = useState(config.limite_por_execucao);

  const salvar = () =>
    onSalvar({
      email_piloto: emailPiloto.trim() || null,
      cc_fixo: cc.split(/[;,\s]+/).map((e) => e.trim()).filter(Boolean),
      assinatura_html: assinatura,
      intervalo_dias: intervalos,
      aviso_dias_antes: avisoAntes,
      somente_dias_uteis: diasUteis,
      hora_inicio: horaIni,
      hora_fim: horaFim,
      limite_por_execucao: limite,
    });

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajustar a rotina automática</DialogTitle>
          <DialogDescription>Faixa roxa e preta não são configuráveis: ficam sempre fora do automático.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="space-y-1">
            <Label>E-mail do piloto (recebe tudo no modo piloto)</Label>
            <Input value={emailPiloto} onChange={(e) => setEmailPiloto(e.target.value)} placeholder="financeiro@..." />
          </div>
          <div className="space-y-1">
            <Label>Cópia fixa (separe por ;) — vai em todas as faixas, menos no aviso amigável</Label>
            <Input value={cc} onChange={(e) => setCc(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Dias entre reenvios na mesma faixa (0 = não repete)</Label>
            <div className="grid grid-cols-5 gap-2">
              {(["aviso", "verde", "amarela", "laranja", "vermelha"] as const).map((f) => (
                <div key={f} className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">{FAIXA_ROTULO[f]}</span>
                  <Input type="number" min={0} value={intervalos[f] ?? 0} onChange={(e) => setIntervalos({ ...intervalos, [f]: Math.max(0, Number(e.target.value) || 0) })} />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="space-y-1"><Label>Aviso (dias antes)</Label><Input type="number" min={0} max={30} value={avisoAntes} onChange={(e) => setAvisoAntes(Number(e.target.value) || 0)} /></div>
            <div className="space-y-1"><Label>Das (h)</Label><Input type="number" min={0} max={23} value={horaIni} onChange={(e) => setHoraIni(Number(e.target.value) || 0)} /></div>
            <div className="space-y-1"><Label>Até (h)</Label><Input type="number" min={1} max={24} value={horaFim} onChange={(e) => setHoraFim(Number(e.target.value) || 0)} /></div>
            <div className="space-y-1"><Label>Máx. por rodada</Label><Input type="number" min={1} max={200} value={limite} onChange={(e) => setLimite(Number(e.target.value) || 1)} /></div>
          </div>
          <div className="flex items-center gap-2"><Switch checked={diasUteis} onCheckedChange={setDiasUteis} /><Label>Enviar só em dias úteis (segunda a sexta)</Label></div>
          <div className="space-y-1">
            <Label>Assinatura (HTML, entra no fim de cada e-mail)</Label>
            <Textarea rows={5} value={assinatura} onChange={(e) => setAssinatura(e.target.value)} placeholder="<p>Financeiro — Grupo Nascimento</p>" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
