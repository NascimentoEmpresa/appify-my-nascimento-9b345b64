import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useContratosCatalogo } from "@/hooks/useSupCatalogo";
import {
  useCriarSolicitacaoManutencao, useSolicitacoesManutencao,
  type StatusSolicitacaoManutencao, type TipoSolicitacaoManutencao,
} from "@/hooks/useSolicitacoesManutencao";
import { Camera, ClipboardList, Send, Wrench } from "lucide-react";

const STATUS: Record<StatusSolicitacaoManutencao, string> = {
  aberta: "Aguardando Almoxarifado",
  peca_disponivel: "Peça disponível",
  compra_solicitada: "Compra interna solicitada",
  manutencao_autorizada: "Manutenção autorizada",
  manutencao_reprovada: "Manutenção não autorizada",
};

export default function SolicitarManutencaoEquipamento() {
  const { data: contratos = [] } = useContratosCatalogo();
  const { data: solicitacoes = [] } = useSolicitacoesManutencao();
  const criar = useCriarSolicitacaoManutencao();
  const [tipo, setTipo] = useState<TipoSolicitacaoManutencao>("peca");
  const [contratoId, setContratoId] = useState("");
  const [maquinario, setMaquinario] = useState("");
  const [numeroSerie, setNumeroSerie] = useState("");
  const [descricao, setDescricao] = useState("");
  const [foto, setFoto] = useState<File | null>(null);

  const minhas = useMemo(() => solicitacoes.slice(0, 8), [solicitacoes]);
  const enviar = async () => {
    if (!contratoId || !foto) return;
    await criar.mutateAsync({ tipo, contrato_id: contratoId, maquinario, numero_serie: numeroSerie, descricao, foto });
    setContratoId(""); setMaquinario(""); setNumeroSerie(""); setDescricao(""); setFoto(null);
    const campo = document.getElementById("foto-maquina") as HTMLInputElement | null;
    if (campo) campo.value = "";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Solicitar manutenção de equipamento"
        subtitle="Envie a necessidade do contrato para avaliação do Almoxarifado."
        module="Central de Serviços"
        breadcrumb={["Central de Serviços", "Solicitações", "Manutenção de equipamento"]}
      />

      <AcessoGate menu="central_servicos_solicitar_manutencao_equipamento" acao="incluir" fallback={
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Seu acesso permite acompanhar solicitações, mas não abrir uma nova.</CardContent></Card>
      }>
        <Card className="max-w-3xl">
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Wrench className="h-5 w-5" /> Nova solicitação</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Tipo de solicitação *</Label>
                <Select value={tipo} onValueChange={(v) => setTipo(v as TipoSolicitacaoManutencao)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="peca">Solicitação de peças para o Almoxarifado</SelectItem>
                    <SelectItem value="manutencao">Manutenção para autorizar ou não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Contrato *</Label>
                <Select value={contratoId} onValueChange={setContratoId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o contrato" /></SelectTrigger>
                  <SelectContent>{contratos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Maquinário *</Label>
                <Input value={maquinario} onChange={(e) => setMaquinario(e.target.value)} placeholder="Ex.: Roçadeira Stihl FS 220" />
              </div>
              <div>
                <Label>Número de série *</Label>
                <Input value={numeroSerie} onChange={(e) => setNumeroSerie(e.target.value)} placeholder="Digite o número de série" />
              </div>
            </div>
            <div>
              <Label>Descrição da necessidade</Label>
              <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={4}
                placeholder={tipo === "peca" ? "Informe qual peça é necessária e o defeito identificado." : "Descreva o reparo ou manutenção necessária."} />
            </div>
            <div>
              <Label htmlFor="foto-maquina">Foto da máquina *</Label>
              <Input id="foto-maquina" type="file" accept="image/jpeg,image/png,image/webp" className="mt-1"
                onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
              <p className="mt-1 text-xs text-muted-foreground">JPG, PNG ou WEBP, até 5 MB. {foto ? `Selecionada: ${foto.name}` : ""}</p>
            </div>
            <Button onClick={enviar} disabled={!contratoId || !maquinario.trim() || !numeroSerie.trim() || !foto || criar.isPending}>
              <Send className="mr-2 h-4 w-4" /> {criar.isPending ? "Enviando..." : "Enviar ao Almoxarifado"}
            </Button>
          </CardContent>
        </Card>
      </AcessoGate>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><ClipboardList className="h-5 w-5" /> Minhas solicitações recentes</CardTitle></CardHeader>
        <CardContent>
          {minhas.length === 0 ? <p className="py-5 text-sm text-muted-foreground">Você ainda não enviou solicitações.</p> : (
            <div className="space-y-3">
              {minhas.map((s) => <div key={s.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
                <Camera className="hidden h-4 w-4 text-muted-foreground sm:block" />
                <div className="min-w-0 flex-1"><p className="font-medium">{s.maquinario} <span className="font-normal text-muted-foreground">· série {s.numero_serie}</span></p><p className="text-xs text-muted-foreground">{s.contrato?.nome ?? "Contrato"} · {new Date(s.created_at).toLocaleDateString("pt-BR")}</p></div>
                <Badge variant="outline">{STATUS[s.status]}</Badge>
              </div>)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
