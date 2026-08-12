import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ShoppingCart, Paperclip, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  useDespesa,
  useSalvarDespesa,
  useCancelarDespesa,
  useEmpresasGrupo,
  useContratosAtivos,
  uploadAnexoMalote,
  registrarEventoDespesa,
  STATUS_LABEL,
  STATUS_FASE_SOLICITACAO,
  TipoSolicitacao,
} from "@/hooks/useMaloteDespesa";
import { AnexosField } from "./AnexosField";

const TIPO_LABEL: Record<TipoSolicitacao, string> = {
  administrativo: "Administrativo",
  contrato: "Contrato",
  dispensa_cotacao: "Dispensa de cotação",
};

async function abrirAnexo(path: string) {
  const { data, error } = await supabase.storage.from("malote-anexos").createSignedUrl(path, 60);
  if (error || !data) {
    toast.error("Não foi possível abrir o anexo.");
    return;
  }
  window.open(data.signedUrl, "_blank");
}

interface SolicitacaoModalProps {
  despesaId: string;
  onClose: () => void;
}

export function SolicitacaoModal({ despesaId, onClose }: SolicitacaoModalProps) {
  const { data, isLoading } = useDespesa(despesaId);
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const salvar = useSalvarDespesa();
  const cancelar = useCancelarDespesa();

  const [nome, setNome] = useState("");
  const [motivo, setMotivo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valorEstimado, setValorEstimado] = useState("");
  const [links, setLinks] = useState("");
  const [tipo, setTipo] = useState<TipoSolicitacao | "">("");
  const [empresaContratoId, setEmpresaContratoId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [arquivosExistentes, setArquivosExistentes] = useState<string[]>([]);
  const [arquivosNovos, setArquivosNovos] = useState<File[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  const contratosDaEmpresa = contratos.filter((c) => !empresaContratoId || c.empresa_id === empresaContratoId);

  useEffect(() => {
    if (!data?.despesa) return;
    const d = data.despesa;
    setNome(d.nome);
    setMotivo(d.motivo ?? "");
    setDescricao(d.descricao ?? "");
    setValorEstimado(String(d.valor_total ?? ""));
    setLinks(d.links ?? "");
    setTipo(d.tipo ?? "");
    if (d.tipo === "contrato") {
      setEmpresaContratoId(d.empresa_id);
      setContratoId(d.contrato_id ?? "");
    }
    setArquivosExistentes(d.arquivos ?? []);
  }, [data?.despesa]);

  const despesa = data?.despesa;
  const editavel = !!despesa && STATUS_FASE_SOLICITACAO.includes(despesa.status) && despesa.status !== "solicitacao_reprovada";
  const podeCancelar = !!despesa && STATUS_FASE_SOLICITACAO.includes(despesa.status) && despesa.status !== "solicitacao_reprovada";

  async function handleSalvar() {
    if (!despesa) return;
    if (!nome.trim()) return toast.error("Informe o nome da solicitação.");
    if (!motivo.trim()) return toast.error("Informe o motivo.");
    if (!descricao.trim()) return toast.error("Informe a descrição.");
    if (!valorEstimado || Number(valorEstimado) <= 0) return toast.error("Informe o valor estimado.");
    if (!tipo) return toast.error("Selecione o tipo.");
    if (tipo === "contrato" && !empresaContratoId) return toast.error("Selecione a empresa do contrato.");
    if (tipo === "contrato" && !contratoId) return toast.error("Selecione o contrato.");

    setSalvando(true);
    try {
      const novosPaths = arquivosNovos.length > 0 ? await Promise.all(arquivosNovos.map((f) => uploadAnexoMalote(f, despesa.id))) : [];
      await salvar.mutateAsync({
        id: despesa.id,
        empresa_id: tipo === "contrato" ? empresaContratoId : despesa.empresa_id,
        classificacao_id: despesa.classificacao_id,
        origem: "solicitacao",
        status: despesa.status,
        nome: nome.trim(),
        valor_total: Number(valorEstimado),
        motivo: motivo.trim(),
        descricao: descricao.trim(),
        links: links.trim() || null,
        tipo: tipo || null,
        contrato_id: tipo === "contrato" ? contratoId : null,
        arquivos: [...arquivosExistentes, ...novosPaths],
      });
      await registrarEventoDespesa(despesa.id, "edicao", "Solicitação editada e salva.");
      toast.success("Solicitação salva.");
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar solicitação.");
    } finally {
      setSalvando(false);
    }
  }

  async function handleCancelar() {
    if (!despesa) return;
    setCancelando(true);
    try {
      await cancelar.mutateAsync({ id: despesa.id });
      toast.success("Solicitação cancelada.");
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao cancelar solicitação.");
    } finally {
      setCancelando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        {isLoading || !despesa ? (
          <div className="py-10 text-center text-muted-foreground">Carregando...</div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-2">
                  <ShoppingCart className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <DialogTitle>Solicitação de Despesa / Compra / Manutenção</DialogTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">Preencha os dados para solicitar uma despesa, compra ou manutenção.</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] uppercase text-muted-foreground">ID da solicitação</p>
                  <p className="text-xs font-mono font-medium">{despesa.numero}</p>
                </div>
              </div>
            </DialogHeader>

            <div className={cn("space-y-4", !editavel && "opacity-70")}>
              {!editavel && (
                <p className="text-xs rounded-md bg-muted px-3 py-2 text-muted-foreground">
                  Status: <span className="font-medium">{STATUS_LABEL[despesa.status]}</span> — dados bloqueados, não podem ser alterados.
                </p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>
                    Nome da solicitação <span className="text-destructive">*</span>
                  </Label>
                  <Input value={nome} onChange={(e) => setNome(e.target.value)} disabled={!editavel} />
                </div>
                <div>
                  <Label>
                    Motivo <span className="text-destructive">*</span>
                  </Label>
                  <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={!editavel} />
                </div>
              </div>

              <div>
                <Label>
                  Descrição <span className="text-destructive">*</span>
                </Label>
                <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} disabled={!editavel} rows={3} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>
                    Valor estimado <span className="text-destructive">*</span>
                  </Label>
                  <Input type="number" step="0.01" value={valorEstimado} onChange={(e) => setValorEstimado(e.target.value)} disabled={!editavel} />
                </div>
                <div>
                  <Label>Link(s)</Label>
                  <Input value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://..." disabled={!editavel} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>
                    Tipo <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={tipo}
                    onValueChange={(v) => {
                      setTipo(v as TipoSolicitacao);
                      if (v !== "contrato") {
                        setEmpresaContratoId("");
                        setContratoId("");
                      }
                    }}
                    disabled={!editavel}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(TIPO_LABEL) as [TipoSolicitacao, string][]).map(([v, label]) => (
                        <SelectItem key={v} value={v}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Classificação de despesa</Label>
                  <Input value={despesa.classificacao?.nome ?? "—"} disabled className="bg-muted" />
                  <p className="text-xs text-muted-foreground mt-1">Definida ao criar a solicitação.</p>
                </div>
              </div>

              {tipo === "contrato" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>
                      Empresa <span className="text-destructive">*</span>
                    </Label>
                    <SearchableSelect
                      value={empresaContratoId}
                      onChange={(v) => {
                        setEmpresaContratoId(v);
                        setContratoId("");
                      }}
                      options={empresas.map((e) => ({ value: e.id, label: e.nome }))}
                      placeholder="Selecione a empresa..."
                      disabled={!editavel}
                    />
                  </div>
                  <div>
                    <Label>
                      Contrato <span className="text-destructive">*</span>
                    </Label>
                    <SearchableSelect
                      value={contratoId}
                      onChange={setContratoId}
                      options={contratosDaEmpresa.map((c) => ({ value: c.id, label: c.nome }))}
                      placeholder="Selecione o contrato..."
                      disabled={!editavel || !empresaContratoId}
                    />
                  </div>
                </div>
              )}

              <div>
                <Label>Arquivos anexados</Label>
                {arquivosExistentes.length > 0 && (
                  <ul className="space-y-1 mb-2">
                    {arquivosExistentes.map((path, i) => (
                      <li key={path} className="flex items-center justify-between rounded-md border border-border px-2 py-1 text-xs">
                        <button type="button" onClick={() => abrirAnexo(path)} className="flex items-center gap-1.5 truncate text-primary hover:underline">
                          <Paperclip className="h-3 w-3 shrink-0" /> {path.split("/").pop()}
                        </button>
                        {editavel && (
                          <button
                            type="button"
                            onClick={() => setArquivosExistentes((arr) => arr.filter((_, idx) => idx !== i))}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {editavel && <AnexosField arquivos={arquivosNovos} onChange={setArquivosNovos} />}
              </div>
            </div>

            <DialogFooter className="flex-row justify-between sm:justify-between items-center">
              {podeCancelar ? (
                <div>
                  <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10 gap-1.5" onClick={handleCancelar} disabled={cancelando}>
                    <Trash2 className="h-3.5 w-3.5" /> {cancelando ? "Cancelando..." : "Cancelar solicitação"}
                  </Button>
                  <p className="text-[11px] text-muted-foreground mt-1">Disponível para o solicitante ou aprovadores da classificação.</p>
                </div>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>
                  Fechar
                </Button>
                {editavel && (
                  <Button onClick={handleSalvar} disabled={salvando}>
                    {salvando ? "Salvando..." : "Salvar"}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
