import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  ContratoSolicitacaoAjuste,
  NovoItemSolicitacaoAjuste,
  SETORES_SOLICITACAO_AJUSTE,
  useCriarSolicitacaoAjuste,
  useItensSolicitacaoAjuste,
  useSolicitacaoAtivaPorCompetencia,
  useTiposSolicitacaoAjuste,
  useUploadDocPedidoSolicitacaoAjuste,
} from "@/hooks/useSolicitacaoAjuste";
import { ComboSugestao } from "./ComboSugestao";

// SIS-2026-0305: espelha aju_nova_solicitacao/aju_verificar_reabertura do
// legado (main.py:2910-3050) — a checagem de reabertura acontece aqui (pré-
// checagem client-side pra guiar a UI) e de novo no RPC (validação real).
// Se já existe uma solicitação ativa "Enviada" pro mesmo contrato+competência,
// o modal troca pro modo reabertura: arquiva a antiga e permite importar
// itens específicos dela pra nova.

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contratos: ContratoSolicitacaoAjuste[];
}

export function NovaSolicitacaoModal({ open, onOpenChange, contratos }: Props) {
  const [contratoId, setContratoId] = useState<string | null>(null);
  const [competencia, setCompetencia] = useState(""); // yyyy-mm
  const [quemRecebeu, setQuemRecebeu] = useState("");
  const [dataRecebimento, setDataRecebimento] = useState("");
  const [prazoResposta, setPrazoResposta] = useState("");
  const [itens, setItens] = useState<NovoItemSolicitacaoAjuste[]>([{ descricao: "", setor: "RH" }]);
  const [itensImportar, setItensImportar] = useState<Set<string>>(new Set());
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);

  const competenciaISO = competencia ? `${competencia}-01` : null;
  const { data: solAtiva } = useSolicitacaoAtivaPorCompetencia(contratoId, competenciaISO);
  const emReabertura = solAtiva?.status === "enviado";
  const bloqueadoOutraAtiva = !!solAtiva && solAtiva.status !== "enviado";

  const { data: itensAnteriores = [] } = useItensSolicitacaoAjuste(emReabertura ? solAtiva!.id : null);
  const { data: tipos = [] } = useTiposSolicitacaoAjuste();
  const criar = useCriarSolicitacaoAjuste();
  const uploadDoc = useUploadDocPedidoSolicitacaoAjuste();

  // SIS-2026-0305 (achado do usuário testando): contrato encerrado continua
  // aparecendo (pode ser preciso reabrir uma sol de competência antiga),
  // só fica visualmente reduzido — mesmo padrão do ContratosERP.tsx.
  const opcoesContrato = useMemo(
    () => [...contratos]
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "ativo" ? -1 : 1))
      .map((c) => ({ value: c.id, label: c.nome, muted: c.status !== "ativo" })),
    [contratos],
  );
  const opcoesTipo = useMemo(() => tipos.filter((t) => t.ativo).map((t) => ({ value: t.nome, label: t.nome })), [tipos]);

  function resetar() {
    setContratoId(null);
    setCompetencia("");
    setQuemRecebeu("");
    setDataRecebimento("");
    setPrazoResposta("");
    setItens([{ descricao: "", setor: "RH" }]);
    setItensImportar(new Set());
    setArquivo(null);
  }

  function toggleImportar(id: string) {
    setItensImportar((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  async function handleSalvar() {
    if (!contratoId || !competenciaISO) {
      toast.error("Selecione o contrato e a competência.");
      return;
    }
    const itensValidos = itens.filter((i) => i.descricao.trim());
    if (itensValidos.length === 0 && itensImportar.size === 0) {
      toast.error("Adicione ao menos 1 item.");
      return;
    }
    setEnviando(true);
    try {
      let docPedidoPath: string | null = null;
      let docPedidoNome: string | null = null;
      if (arquivo) {
        const up = await uploadDoc.mutateAsync(arquivo);
        docPedidoPath = up.path;
        docPedidoNome = up.nome;
      }
      await criar.mutateAsync({
        contratoId,
        competencia: competenciaISO,
        quemRecebeu: quemRecebeu.trim() || null,
        dataRecebimento: dataRecebimento || null,
        prazoResposta: prazoResposta || null,
        docPedidoPath,
        docPedidoNome,
        itens: itensValidos,
        itensImportarIds: emReabertura ? Array.from(itensImportar) : undefined,
      });
      toast.success(emReabertura ? "Solicitação reaberta." : "Solicitação criada.");
      resetar();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar solicitação.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetar(); onOpenChange(v); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{emReabertura ? "Reabrir Solicitação" : "Nova Solicitação"}</DialogTitle>
          {emReabertura && (
            <DialogDescription>
              Já existe uma solicitação enviada para este contrato e competência (iteração {solAtiva!.iteracao}). Ela será
              arquivada e uma nova será criada — marque abaixo os itens que quer reaproveitar.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <Label>Contrato *</Label>
              <SearchableSelect value={contratoId} onChange={setContratoId} options={opcoesContrato} placeholder="Selecione o contrato" />
            </div>
            <div>
              <Label>Competência *</Label>
              <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
            </div>
          </div>

          {bloqueadoOutraAtiva && (
            <p className="rounded border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
              Já existe uma solicitação em conferência para este contrato e competência — conclua-a antes de criar outra.
            </p>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Quem recebeu</Label>
              <Input value={quemRecebeu} onChange={(e) => setQuemRecebeu(e.target.value)} placeholder="Nome" />
            </div>
            <div>
              <Label>Data de recebimento</Label>
              <Input type="date" value={dataRecebimento} onChange={(e) => setDataRecebimento(e.target.value)} />
            </div>
            <div>
              <Label>Prazo de resposta</Label>
              <Input type="date" value={prazoResposta} onChange={(e) => setPrazoResposta(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Documento do pedido</Label>
            <Input type="file" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </div>

          {emReabertura && itensAnteriores.length > 0 && (
            <div>
              <Label>Itens da solicitação anterior (opcional, reaproveitar)</Label>
              <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded border p-2">
                {itensAnteriores.map((item) => (
                  <label key={item.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={itensImportar.has(item.id)} onCheckedChange={() => toggleImportar(item.id)} />
                    {item.descricao}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label>Itens novos</Label>
            <div className="mt-1 space-y-2">
              {itens.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select
                    value={item.setor}
                    onValueChange={(v) => setItens((atual) => atual.map((it, i) => (i === idx ? { ...it, setor: v } : it)))}
                  >
                    <SelectTrigger className="w-[150px] shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SETORES_SOLICITACAO_AJUSTE.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="min-w-0 flex-1">
                    {/* Sugestão livre (catálogo SOLICITACAO_AJUSTE_TIPO) — a
                        descrição continua texto livre, igual ao legado. */}
                    <ComboSugestao
                      value={item.descricao}
                      onChange={(v) => setItens((atual) => atual.map((it, i) => (i === idx ? { ...it, descricao: v } : it)))}
                      options={opcoesTipo.map((t) => t.label)}
                      placeholder="Descrição do documento"
                    />
                  </div>
                  <Button
                    variant="ghost" size="icon" type="button"
                    onClick={() => setItens((atual) => atual.filter((_, i) => i !== idx))}
                    disabled={itens.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" type="button" className="gap-1.5" onClick={() => setItens((atual) => [...atual, { descricao: "", setor: "RH" }])}>
                <Plus className="h-4 w-4" /> Adicionar item
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={enviando || bloqueadoOutraAtiva}>
            {enviando ? "Salvando..." : emReabertura ? "Reabrir" : "Criar solicitação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
