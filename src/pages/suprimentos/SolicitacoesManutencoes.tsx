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
  useResponderSolicitacaoManutencao, useSolicitacoesManutencao,
  type SolicitacaoManutencao, type StatusSolicitacaoManutencao,
} from "@/hooks/useSolicitacoesManutencao";
import { Boxes, ExternalLink, Image, Search, Wrench } from "lucide-react";
import { toast } from "sonner";

const STATUS: Record<StatusSolicitacaoManutencao, string> = {
  aberta: "Aberta", peca_disponivel: "Peça disponível", compra_solicitada: "Compra interna solicitada",
  manutencao_autorizada: "Manutenção autorizada", manutencao_reprovada: "Manutenção não autorizada",
};

export default function SolicitacoesManutencoes() {
  const { data: solicitacoes = [], isLoading, error } = useSolicitacoesManutencao();
  const [busca, setBusca] = useState("");
  const [selecionada, setSelecionada] = useState<SolicitacaoManutencao | null>(null);
  const filtradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return solicitacoes.filter((s) => !termo || [s.maquinario, s.numero_serie, s.contrato?.nome, s.solicitante_nome, s.status]
      .filter(Boolean).join(" ").toLocaleLowerCase("pt-BR").includes(termo));
  }, [busca, solicitacoes]);
  const abertas = solicitacoes.filter((s) => s.status === "aberta").length;

  return <div className="space-y-6">
    <PageHeader title="Solicitações de manutenção" subtitle="Avalie peças e manutenções abertas pelos supervisores dos contratos."
      module="Suprimentos" breadcrumb={["Suprimentos", "Solicitações de manutenção"]} />
    <div className="flex flex-wrap items-center gap-3"><div className="relative min-w-[18rem] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar máquina, série, contrato ou solicitante" /></div><Badge variant="outline" className="gap-1"><Boxes className="h-3.5 w-3.5" /> {abertas} em aberto</Badge></div>
    <Card><CardContent className="p-0">
      {error ? <p className="p-8 text-center text-sm text-destructive">{(error as Error).message}</p> : isLoading ? <p className="p-8 text-center text-sm text-muted-foreground">Carregando...</p> : filtradas.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma solicitação encontrada.</p> : (
        <div className="divide-y">{filtradas.map((s) => <button key={s.id} type="button" onClick={() => setSelecionada(s)} className="flex w-full flex-col gap-2 p-4 text-left hover:bg-muted/40 sm:flex-row sm:items-center"><Wrench className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="font-medium">{s.maquinario} <span className="font-normal text-muted-foreground">· série {s.numero_serie}</span></p><p className="text-xs text-muted-foreground">{s.tipo === "peca" ? "Peças" : "Manutenção"} · {s.contrato?.nome ?? "Contrato"} · {s.solicitante_nome ?? "Supervisor"}</p></div><Badge variant={s.status === "aberta" ? "default" : "outline"}>{STATUS[s.status]}</Badge></button>)}</div>
      )}
    </CardContent></Card>
    <DialogResposta solicitacao={selecionada} onFechar={() => setSelecionada(null)} />
  </div>;
}

function DialogResposta({ solicitacao, onFechar }: { solicitacao: SolicitacaoManutencao | null; onFechar: () => void }) {
  const { data: anexos = [] } = useAnexosSolicitacaoManutencao(solicitacao?.id ?? null);
  const responder = useResponderSolicitacaoManutencao();
  const [decisao, setDecisao] = useState("");
  const [motivo, setMotivo] = useState("");
  if (!solicitacao) return null;
  const aberta = solicitacao.status === "aberta";
  const opcoes = solicitacao.tipo === "peca"
    ? [["peca_disponivel", "Peça disponível"], ["solicitar_compra", "Solicitar compra interna (Malote)"]]
    : [["autorizar_manutencao", "Autorizar manutenção"], ["reprovar_manutencao", "Não autorizar manutenção"]];
  const confirmar = async () => {
    if (!decisao) return toast.error("Selecione a decisão do Almoxarifado.");
    if (solicitacao.tipo === "manutencao" && !motivo.trim()) return toast.error("Informe o motivo da decisão.");
    await responder.mutateAsync({ id: solicitacao.id, decisao, motivo });
    onFechar();
  };
  return <Dialog open onOpenChange={(o) => !o && onFechar()}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{solicitacao.maquinario}</DialogTitle></DialogHeader>
    <div className="grid gap-3 text-sm sm:grid-cols-2"><Campo label="Contrato" valor={solicitacao.contrato?.nome ?? "—"} /><Campo label="Número de série" valor={solicitacao.numero_serie} /><Campo label="Solicitado por" valor={solicitacao.solicitante_nome ?? "Supervisor"} /><Campo label="Tipo" valor={solicitacao.tipo === "peca" ? "Solicitação de peças" : "Manutenção"} /></div>
    <div><Label>Descrição</Label><p className="mt-1 rounded-md bg-muted/50 p-3 text-sm whitespace-pre-wrap">{solicitacao.descricao || "Não informada."}</p></div>
    <div><Label>Foto da máquina</Label>{anexos.length ? <div className="mt-2 flex flex-wrap gap-2">{anexos.map((a) => <Button key={a.id} type="button" variant="outline" size="sm" onClick={() => abrirAnexoSolicitacaoManutencao(a.caminho).catch((e) => toast.error(e.message))}><Image className="mr-2 h-4 w-4" /> Abrir foto</Button>)}</div> : <p className="mt-1 text-sm text-muted-foreground">Sem foto anexada.</p>}</div>
    {!aberta ? <div className="space-y-2 rounded-lg border bg-muted/30 p-3"><Badge variant="outline">{STATUS[solicitacao.status]}</Badge><p className="text-sm">{solicitacao.decisao_motivo || "Resposta registrada sem observação."}</p>{solicitacao.malote_despesa_id && <Button asChild variant="link" className="h-auto px-0"><Link to={`/app/malote/solicitacao/${solicitacao.malote_despesa_id}`}><ExternalLink className="mr-1 h-3.5 w-3.5" /> Abrir compra no Malote</Link></Button>}</div> : <><div><Label>Decisão do Almoxarifado *</Label><Select value={decisao} onValueChange={setDecisao}><SelectTrigger><SelectValue placeholder="Selecione a decisão" /></SelectTrigger><SelectContent>{opcoes.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div><div><Label>Motivo {solicitacao.tipo === "manutencao" ? "*" : "(opcional)"}</Label><Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} placeholder="Registre a justificativa ou orientação para o supervisor." /></div></>}
    <DialogFooter>{aberta && <Button onClick={confirmar} disabled={responder.isPending}>{responder.isPending ? "Salvando..." : "Registrar decisão"}</Button>}<Button variant="outline" onClick={onFechar}>Fechar</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function Campo({ label, valor }: { label: string; valor: string }) { return <div><Label>{label}</Label><p className="mt-1 text-sm">{valor}</p></div>; }
