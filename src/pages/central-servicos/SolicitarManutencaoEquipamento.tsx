import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
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
  useCriarSolicitacaoManutencao, useEncerrarSolicitacaoManutencao,
  useEquipamentosManutencao, useSolicitacoesManutencao,
  type TipoSolicitacaoManutencao,
} from "@/hooks/useSolicitacoesManutencao";
import { ACCEPT_ANEXO_MANUTENCAO } from "@/lib/suprimentos/anexoManutencao";
import { STATUS_MANUTENCAO } from "@/lib/suprimentos/manutencaoQr";
import { Camera, CheckCircle2, ClipboardList, Send, Wrench } from "lucide-react";

export default function SolicitarManutencaoEquipamento() {
  const { pathname } = useLocation();
  const encarregados = pathname.startsWith("/app/encarregados/");
  const menu = encarregados ? "encarregados_solicitar_manutencao_equipamento" : "central_servicos_solicitar_manutencao_equipamento";
  const { data: contratos = [] } = useContratosCatalogo();
  const { data: solicitacoes = [] } = useSolicitacoesManutencao();
  const criar = useCriarSolicitacaoManutencao();
  const encerrar = useEncerrarSolicitacaoManutencao();
  const [tipo, setTipo] = useState<TipoSolicitacaoManutencao>("peca");
  const [contratoId, setContratoId] = useState("");
  const [patrimonioId, setPatrimonioId] = useState("");
  const [maquinario, setMaquinario] = useState("");
  const [numeroSerie, setNumeroSerie] = useState("");
  const [placaPatrimonial, setPlacaPatrimonial] = useState("");
  const [descricao, setDescricao] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [orcamento, setOrcamento] = useState<File | null>(null);
  const { data: equipamentos = [], isLoading: carregandoEquipamentos } = useEquipamentosManutencao(contratoId || null, tipo === "manutencao");
  const minhas = useMemo(() => solicitacoes.slice(0, 8), [solicitacoes]);

  function mudarTipo(novo: TipoSolicitacaoManutencao) {
    setTipo(novo); setPatrimonioId(""); setMaquinario(""); setNumeroSerie(""); setPlacaPatrimonial("");
  }
  function selecionarEquipamento(id: string) {
    const bem = equipamentos.find((item) => item.id === id);
    setPatrimonioId(id); setMaquinario(bem?.nome ?? ""); setNumeroSerie(bem?.numero_serie ?? "");
    setPlacaPatrimonial(bem?.placa_patrimonial ?? "");
  }
  async function enviar() {
    if (!contratoId || !foto) return;
    await criar.mutateAsync({ tipo, contrato_id: contratoId, patrimonio_id: patrimonioId || null,
      maquinario, numero_serie: numeroSerie, placa_patrimonial: placaPatrimonial || null,
      descricao, foto, orcamento });
    setContratoId(""); setPatrimonioId(""); setMaquinario(""); setNumeroSerie(""); setPlacaPatrimonial("");
    setDescricao(""); setFoto(null); setOrcamento(null);
    ["foto-maquina", "orcamento-manutencao"].forEach((id) => {
      const campo = document.getElementById(id) as HTMLInputElement | null; if (campo) campo.value = "";
    });
  }
  const formularioValido = !!contratoId && !!foto && (tipo === "peca"
    ? !!maquinario.trim() && !!numeroSerie.trim() : !!patrimonioId);

  return <div className="space-y-6">
    <PageHeader title="Solicitar manutenção de equipamento"
      subtitle="Abra o atendimento e acompanhe orçamento, autorização, conserto e retirada."
      module={encarregados ? "Encarregados" : "Central de Serviços"}
      breadcrumb={[encarregados ? "Encarregados" : "Central de Serviços", "Suprimentos", "Manutenção de equipamento"]} />

    <AcessoGate menu={menu} acao="incluir" fallback={<Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Seu acesso permite acompanhar solicitações, mas não abrir uma nova.</CardContent></Card>}>
      <Card className="max-w-3xl"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Wrench className="h-5 w-5" /> Nova solicitação</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>Tipo de solicitação *</Label><Select value={tipo} onValueChange={(v) => mudarTipo(v as TipoSolicitacaoManutencao)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="peca">Solicitação de peças para o Almoxarifado</SelectItem>
              <SelectItem value="manutencao">Manutenção externa por QR</SelectItem>
            </SelectContent></Select></div>
            <div><Label>Contrato *</Label><Select value={contratoId} onValueChange={(v) => { setContratoId(v); setPatrimonioId(""); }}><SelectTrigger><SelectValue placeholder="Selecione o contrato" /></SelectTrigger><SelectContent>{contratos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent></Select></div>
            {tipo === "manutencao" ? <>
              <div className="sm:col-span-2"><Label>Máquina cadastrada *</Label><Select value={patrimonioId} onValueChange={selecionarEquipamento} disabled={!contratoId || carregandoEquipamentos}><SelectTrigger><SelectValue placeholder={carregandoEquipamentos ? "Carregando..." : "Selecione a máquina"} /></SelectTrigger><SelectContent>{equipamentos.map((b) => <SelectItem key={b.id} value={b.id}>{b.nome} · patrimônio {b.placa_patrimonial}</SelectItem>)}</SelectContent></Select>
                {contratoId && !carregandoEquipamentos && equipamentos.length === 0 && <p className="mt-1 text-xs text-amber-700">Não há máquina ativa com número de série e placa patrimonial nesse contrato.</p>}</div>
              <div><Label>Número de série</Label><Input value={numeroSerie} readOnly /></div>
              <div><Label>Placa patrimonial</Label><Input value={placaPatrimonial} readOnly /></div>
            </> : <>
              <div><Label>Maquinário *</Label><Input value={maquinario} onChange={(e) => setMaquinario(e.target.value)} placeholder="Ex.: Roçadeira Stihl FS 220" /></div>
              <div><Label>Número de série *</Label><Input value={numeroSerie} onChange={(e) => setNumeroSerie(e.target.value)} /></div>
            </>}
          </div>
          <div><Label>Descrição da necessidade</Label><Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={4} placeholder="Descreva o defeito e o serviço necessário." /></div>
          <div><Label htmlFor="foto-maquina">Foto do equipamento *</Label><Input id="foto-maquina" type="file" accept={ACCEPT_ANEXO_MANUTENCAO.foto_equipamento} className="mt-1" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} /><p className="mt-1 text-xs text-muted-foreground">JPG, PNG ou WEBP, até 5 MB.</p></div>
          <div><Label htmlFor="orcamento-manutencao">Orçamento (opcional)</Label><Input id="orcamento-manutencao" type="file" accept={ACCEPT_ANEXO_MANUTENCAO.orcamento} className="mt-1" onChange={(e) => setOrcamento(e.target.files?.[0] ?? null)} /><p className="mt-1 text-xs text-muted-foreground">JPG, PNG, WEBP ou PDF, até 5 MB. A prestadora também pode anexar pelo QR.</p></div>
          <Button onClick={enviar} disabled={!formularioValido || criar.isPending}><Send className="mr-2 h-4 w-4" />{criar.isPending ? "Enviando..." : "Enviar solicitação"}</Button>
        </CardContent></Card>
    </AcessoGate>

    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><ClipboardList className="h-5 w-5" /> Minhas solicitações recentes</CardTitle></CardHeader><CardContent>
      {minhas.length === 0 ? <p className="py-5 text-sm text-muted-foreground">Você ainda não enviou solicitações.</p> : <div className="space-y-3">{minhas.map((s) => <div key={s.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
        <Camera className="hidden h-4 w-4 text-muted-foreground sm:block" /><div className="min-w-0 flex-1"><p className="font-medium">{s.maquinario} <span className="font-normal text-muted-foreground">· série {s.numero_serie}</span></p><p className="text-xs text-muted-foreground">{s.contrato?.nome ?? "Contrato"}{s.placa_patrimonial ? ` · patrimônio ${s.placa_patrimonial}` : ""}</p></div><Badge variant="outline">{STATUS_MANUTENCAO[s.status]}</Badge>
        {s.status === "pronta_retirada" && <Button size="sm" onClick={() => encerrar.mutate(s.id)} disabled={encerrar.isPending}><CheckCircle2 className="mr-1 h-4 w-4" />Confirmar retirada</Button>}
      </div>)}</div>}
    </CardContent></Card>
  </div>;
}
