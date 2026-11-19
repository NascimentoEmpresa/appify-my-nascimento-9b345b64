import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  abrirAnexoSolicitacaoManutencao, useAnexosSolicitacaoManutencao,
  useHistoricoSolicitacaoManutencao, useResponderSolicitacaoManutencao,
  useSolicitacoesManutencao, type SolicitacaoManutencao,
} from "@/hooks/useSolicitacoesManutencao";
import { manutencaoEmAberto, STATUS_MANUTENCAO } from "@/lib/suprimentos/manutencaoQr";
import { Boxes, ExternalLink, FileText, Image, Search, Wrench } from "lucide-react";
import { toast } from "sonner";

export default function SolicitacoesManutencoes() {
  const { data: solicitacoes = [], isLoading, error } = useSolicitacoesManutencao();
  const [busca, setBusca] = useState("");
  const [selecionada, setSelecionada] = useState<SolicitacaoManutencao | null>(null);
  const filtradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return solicitacoes.filter((s) => !termo || [s.maquinario, s.numero_serie, s.placa_patrimonial,
      s.contrato?.nome, s.solicitante_nome, STATUS_MANUTENCAO[s.status]]
      .filter(Boolean).join(" ").toLocaleLowerCase("pt-BR").includes(termo));
  }, [busca, solicitacoes]);
  const abertas = solicitacoes.filter((s) => s.tipo === "peca" ? s.status === "aberta" : manutencaoEmAberto(s.status)).length;
  return <div className="space-y-6">
    <PageHeader title="Solicitações de manutenção" subtitle="Autorize orçamentos e acompanhe a execução pela prestadora."
      module="Suprimentos" breadcrumb={["Suprimentos", "Solicitações de manutenção"]} />
    <div className="flex flex-wrap items-center gap-3"><div className="relative min-w-[18rem] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar máquina, série, patrimônio, contrato ou solicitante" /></div><Badge variant="outline" className="gap-1"><Boxes className="h-3.5 w-3.5" />{abertas} em aberto</Badge></div>
    <Card><CardContent className="p-0">{error ? <p className="p-8 text-center text-sm text-destructive">{(error as Error).message}</p> : isLoading ? <p className="p-8 text-center text-sm text-muted-foreground">Carregando...</p> : filtradas.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma solicitação encontrada.</p> : <div className="divide-y">{filtradas.map((s) => <button key={s.id} type="button" onClick={() => setSelecionada(s)} className="flex w-full flex-col gap-2 p-4 text-left hover:bg-muted/40 sm:flex-row sm:items-center"><Wrench className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="font-medium">{s.maquinario} <span className="font-normal text-muted-foreground">· série {s.numero_serie}</span></p><p className="text-xs text-muted-foreground">{s.tipo === "peca" ? "Peças" : "Manutenção"} · {s.contrato?.nome ?? "Contrato"}{s.placa_patrimonial ? ` · patrimônio ${s.placa_patrimonial}` : ""} · {s.solicitante_nome ?? "Solicitante"}</p></div><Badge variant={(s.status === "aberta" || s.status === "aguardando_autorizacao") ? "default" : "outline"}>{STATUS_MANUTENCAO[s.status]}</Badge></button>)}</div>}</CardContent></Card>
    <DialogResposta solicitacao={selecionada} onFechar={() => setSelecionada(null)} />
  </div>;
}

function DialogResposta({ solicitacao, onFechar }: { solicitacao: SolicitacaoManutencao | null; onFechar: () => void }) {
  const { data: anexos = [] } = useAnexosSolicitacaoManutencao(solicitacao?.id ?? null);
  const { data: historico = [] } = useHistoricoSolicitacaoManutencao(solicitacao?.id ?? null);
  const responder = useResponderSolicitacaoManutencao();
  const [decisao, setDecisao] = useState(""); const [motivo, setMotivo] = useState("");
  if (!solicitacao) return null;
  const aguardaDecisao = solicitacao.tipo === "peca" ? solicitacao.status === "aberta" : solicitacao.status === "aguardando_autorizacao";
  const fotos = anexos.filter((a) => a.categoria !== "orcamento");
  const orcamentos = anexos.filter((a) => a.categoria === "orcamento");
  const abrir = (caminho: string) => abrirAnexoSolicitacaoManutencao(caminho).catch((e) => toast.error(e.message));
  const opcoes = solicitacao.tipo === "peca"
    ? [["peca_disponivel", "Peça disponível"], ["solicitar_compra", "Solicitar compra interna (Malote)"]]
    : [["autorizar_manutencao", "Autorizar manutenção"], ["reprovar_manutencao", "Não autorizar orçamento"]];
  async function confirmar() {
    if (!decisao) return toast.error("Selecione a decisão.");
    if (solicitacao.tipo === "manutencao" && !motivo.trim()) return toast.error("Informe o motivo da decisão.");
    await responder.mutateAsync({ id: solicitacao.id, decisao, motivo }); onFechar();
  }
  return <Dialog open onOpenChange={(o) => !o && onFechar()}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{solicitacao.maquinario}</DialogTitle></DialogHeader>
    <div className="grid gap-3 text-sm sm:grid-cols-2"><Campo label="Contrato" valor={solicitacao.contrato?.nome ?? "—"} /><Campo label="Número de série" valor={solicitacao.numero_serie} /><Campo label="Placa patrimonial" valor={solicitacao.placa_patrimonial ?? "—"} /><Campo label="Solicitado por" valor={solicitacao.solicitante_nome ?? "Solicitante"} />{solicitacao.prestadora_empresa && <><Campo label="Prestadora" valor={solicitacao.prestadora_empresa} /><Campo label="Responsável" valor={solicitacao.prestadora_responsavel ?? "—"} /></>}</div>
    <div><Label>Descrição</Label><p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{solicitacao.descricao || "Não informada."}</p></div>
    <div className="grid gap-3 sm:grid-cols-2"><Anexos label="Foto do equipamento" itens={fotos} abrir={abrir} /><Anexos label="Orçamento" itens={orcamentos} abrir={abrir} /></div>
    {aguardaDecisao ? <><div><Label>Decisão *</Label><Select value={decisao} onValueChange={setDecisao}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{opcoes.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div><div><Label>Motivo {solicitacao.tipo === "manutencao" ? "*" : "(opcional)"}</Label><Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} /></div></> : <div className="space-y-2 rounded-lg border bg-muted/30 p-3"><Badge variant="outline">{STATUS_MANUTENCAO[solicitacao.status]}</Badge><p className="text-sm">{solicitacao.decisao_motivo || "Sem observação."}</p>{solicitacao.malote_despesa_id && <Button asChild variant="link" className="h-auto px-0"><Link to={`/app/malote/solicitacao/${solicitacao.malote_despesa_id}`}><ExternalLink className="mr-1 h-3.5 w-3.5" />Abrir compra no Malote</Link></Button>}</div>}
    {historico.length > 0 && <div><Label>Linha do tempo</Label><div className="mt-2 space-y-2 border-l pl-4">{historico.map((h) => <div key={h.id}><p className="text-sm font-medium">{STATUS_MANUTENCAO[h.status]}</p><p className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString("pt-BR")} · {h.autor_nome || h.origem}</p></div>)}</div></div>}
    <DialogFooter>{aguardaDecisao && <Button onClick={confirmar} disabled={responder.isPending}>{responder.isPending ? "Salvando..." : "Registrar decisão"}</Button>}<Button variant="outline" onClick={onFechar}>Fechar</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function Anexos({ label, itens, abrir }: { label: string; itens: { id: string; caminho: string; tipo_mime: string | null }[]; abrir: (c: string) => void }) {
  return <div><Label>{label}</Label>{itens.length ? <div className="mt-2 flex flex-wrap gap-2">{itens.map((a) => <Button key={a.id} type="button" variant="outline" size="sm" onClick={() => abrir(a.caminho)}>{a.tipo_mime === "application/pdf" ? <FileText className="mr-2 h-4 w-4" /> : <Image className="mr-2 h-4 w-4" />}Abrir</Button>)}</div> : <p className="mt-1 text-sm text-muted-foreground">Nenhum anexo.</p>}</div>;
}
function Campo({ label, valor }: { label: string; valor: string }) { return <div><Label>{label}</Label><p className="mt-1 text-sm">{valor}</p></div>; }
