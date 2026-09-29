import { useEffect, useState } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus } from "lucide-react";
import {
  PlanoDocCanaa, ProtocoloDocCanaa, baixarArquivoDocCanaa, formatarBRL, labelCompetencia, parseValorBRL,
  useAlterarPlanoDocCanaa, useHistoricoDocCanaa, usePlanosDocCanaa, useSalvarPlanoDocCanaa,
  useEditarProtocoloDocCanaa,
} from "@/hooks/useDocCanaa";
import { supabase } from "@/integrations/supabase/client";
import { CamposProtocolo, ValoresProtocolo, validarProtocolo } from "./LancarDocumento";

const erroMsg = (e: unknown) => (e as { message?: string })?.message ?? "Erro inesperado.";

// ── Texto obrigatório (motivo de devolução / observação / exclusão) ───────
export function TextoDialog({
  open, titulo, descricao, rotulo, confirmar, obrigatorio = true, onOpenChange, onConfirmar,
}: {
  open: boolean;
  titulo: string;
  descricao?: string;
  rotulo: string;
  confirmar: string;
  obrigatorio?: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirmar: (texto: string) => Promise<void>;
}) {
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (open) setTexto(""); }, [open]);

  const enviar = async () => {
    if (obrigatorio && !texto.trim()) { toast.error(`Informe: ${rotulo.toLowerCase()}.`); return; }
    setSalvando(true);
    try { await onConfirmar(texto.trim()); onOpenChange(false); }
    catch (e) { toast.error(erroMsg(e)); }
    finally { setSalvando(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {descricao && <DialogDescription>{descricao}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-2">
          <Label>{rotulo}</Label>
          <Textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={enviar} disabled={salvando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{confirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Upload de comprovante (malote ou pagamento) ──────────────────────────
export function ComprovanteDialog({
  open, titulo, protocolo, comObs = false, onOpenChange, onEnviar,
}: {
  open: boolean;
  titulo: string;
  protocolo: ProtocoloDocCanaa | null;
  comObs?: boolean;
  onOpenChange: (o: boolean) => void;
  onEnviar: (arquivo: File, obs: string) => Promise<void>;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (open) { setArquivo(null); setObs(""); } }, [open]);

  const enviar = async () => {
    if (!arquivo) { toast.error("Selecione o comprovante."); return; }
    setSalvando(true);
    try { await onEnviar(arquivo, obs.trim()); onOpenChange(false); }
    catch (e) { toast.error(erroMsg(e)); }
    finally { setSalvando(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {protocolo && (
            <DialogDescription>
              #{protocolo.numero} · {protocolo.favorecido} · {formatarBRL(protocolo.valor)}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Arquivo</Label>
            <Input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </div>
          {comObs && (
            <div className="space-y-1.5">
              <Label>Observação (opcional)</Label>
              <Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={enviar} disabled={salvando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Histórico do protocolo ────────────────────────────────────────────────
export function HistoricoDialog({ protocolo, onOpenChange }: { protocolo: ProtocoloDocCanaa | null; onOpenChange: (o: boolean) => void }) {
  const { data: logs = [], isLoading } = useHistoricoDocCanaa(protocolo?.id ?? null);
  return (
    <Dialog open={!!protocolo} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Histórico do Protocolo #{protocolo?.numero}</DialogTitle>
          {protocolo && <DialogDescription>{protocolo.favorecido} · {protocolo.despesa} · {formatarBRL(protocolo.valor)}</DialogDescription>}
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Data/Hora</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Detalhes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-xs">{new Date(l.created_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="text-sm font-medium">{l.usuario_nome ?? "Sistema"}</TableCell>
                  <TableCell className="text-sm">{l.acao}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{l.detalhes ?? "—"}</TableCell>
                </TableRow>
              ))}
              {!isLoading && logs.length === 0 && (
                <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Nenhum evento registrado.</TableCell></TableRow>
              )}
              {isLoading && (
                <TableRow><TableCell colSpan={4} className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Alterar plano de aplicação ────────────────────────────────────────────
export function AlterarPlanoDialog({ protocolo, onOpenChange }: { protocolo: ProtocoloDocCanaa | null; onOpenChange: (o: boolean) => void }) {
  const { data: planos = [] } = usePlanosDocCanaa();
  const alterar = useAlterarPlanoDocCanaa();
  const [planoId, setPlanoId] = useState("");
  useEffect(() => { if (protocolo) setPlanoId(protocolo.plano_id); }, [protocolo]);

  const salvar = async () => {
    if (!protocolo) return;
    try {
      await alterar.mutateAsync({ id: protocolo.id, planoId });
      toast.success("Plano de aplicação alterado.");
      onOpenChange(false);
    } catch (e) { toast.error(erroMsg(e)); }
  };

  return (
    <Dialog open={!!protocolo} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Alterar Plano de Aplicação</DialogTitle>
          {protocolo && <DialogDescription>#{protocolo.numero} · {protocolo.favorecido}</DialogDescription>}
        </DialogHeader>
        <Select value={planoId} onValueChange={setPlanoId}>
          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>
            {planos.filter((p) => p.ativo || p.id === protocolo?.plano_id).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.nome}{p.limite_mensal !== null ? " (trava mensal)" : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={alterar.isPending || !planoId || planoId === protocolo?.plano_id}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Editar/corrigir protocolo ─────────────────────────────────────────────
export function EditarProtocoloDialog({ protocolo, onOpenChange }: { protocolo: ProtocoloDocCanaa | null; onOpenChange: (o: boolean) => void }) {
  const editar = useEditarProtocoloDocCanaa();
  const [valores, setValores] = useState<ValoresProtocolo | null>(null);

  useEffect(() => {
    if (protocolo) {
      setValores({
        arquivo: null,
        favorecido: protocolo.favorecido,
        despesa: protocolo.despesa,
        planoId: protocolo.plano_id,
        documento: protocolo.documento,
        valor: protocolo.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
        dataCompetencia: protocolo.data_competencia,
      });
    }
  }, [protocolo]);

  const salvar = async () => {
    if (!protocolo || !valores) return;
    const erro = validarProtocolo(valores, false);
    if (erro) { toast.error(erro); return; }
    try {
      await editar.mutateAsync({
        id: protocolo.id,
        arquivo: valores.arquivo,
        favorecido: valores.favorecido,
        despesa: valores.despesa,
        planoId: valores.planoId,
        documento: valores.documento,
        valor: parseValorBRL(valores.valor)!,
        dataCompetencia: valores.dataCompetencia,
      });
      toast.success("Protocolo atualizado.");
      onOpenChange(false);
    } catch (e) { toast.error(erroMsg(e)); }
  };

  return (
    <Dialog open={!!protocolo} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Editar Protocolo #{protocolo?.numero}</DialogTitle>
          <DialogDescription>Deixe o arquivo em branco para manter o documento atual ({protocolo?.doc_nome}).</DialogDescription>
        </DialogHeader>
        {valores && <CamposProtocolo valores={valores} onChange={setValores} arquivoObrigatorio={false} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={editar.isPending}>
            {editar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Exportar ZIP da competência (o /api/baixar_zip do legado) ─────────────
export function ExportarZipDialog({
  open, competencias, competenciaInicial, onOpenChange,
}: {
  open: boolean;
  competencias: string[];
  competenciaInicial: string;
  onOpenChange: (o: boolean) => void;
}) {
  const [comp, setComp] = useState(competenciaInicial);
  const [progresso, setProgresso] = useState<string | null>(null);
  useEffect(() => { if (open) setComp(competenciaInicial); }, [open, competenciaInicial]);

  const exportar = async () => {
    setProgresso("Buscando documentos…");
    try {
      const { data, error } = await (supabase as any)
        .from("DOC_CANAA_PROTOCOLO")
        .select("numero, despesa, doc_path, doc_nome, comprovante_malote_path, comprovante_malote_nome, comprovante_pagamento_path, comprovante_pagamento_nome")
        .eq("competencia", comp)
        .neq("status", "excluido")
        .order("numero");
      if (error) throw error;
      const rows = (data ?? []) as Array<Record<string, string | number | null>>;
      if (!rows.length) { toast.info("Nenhum documento nesta competência."); return; }

      const zip = new JSZip();
      const arquivos: Array<{ pasta: string; path: string; nome: string }> = [];
      for (const r of rows) {
        const pref = `${r.numero}_${String(r.despesa).replace(/[^\w-]+/g, "_")}`;
        arquivos.push({ pasta: "Documentos", path: r.doc_path as string, nome: `${pref}_${r.doc_nome}` });
        if (r.comprovante_malote_path) arquivos.push({ pasta: "Comprovantes Malote", path: r.comprovante_malote_path as string, nome: `${pref}_${r.comprovante_malote_nome}` });
        if (r.comprovante_pagamento_path) arquivos.push({ pasta: "Comprovantes Pagamento", path: r.comprovante_pagamento_path as string, nome: `${pref}_${r.comprovante_pagamento_nome}` });
      }

      let falhas = 0;
      for (let i = 0; i < arquivos.length; i++) {
        setProgresso(`Baixando ${i + 1} de ${arquivos.length}…`);
        try {
          const blob = await baixarArquivoDocCanaa(arquivos[i].path);
          zip.file(`${arquivos[i].pasta}/${arquivos[i].nome}`, blob);
        } catch { falhas++; }
      }

      setProgresso("Compactando…");
      const conteudo = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(conteudo);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ENVIO_CANAA_${comp.slice(5, 7)}_${comp.slice(0, 4)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      if (falhas) toast.warning(`${falhas} arquivo(s) não puderam ser baixados.`);
      else toast.success("ZIP gerado.");
      onOpenChange(false);
    } catch (e) {
      toast.error(erroMsg(e));
    } finally {
      setProgresso(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !progresso && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Exportar ZIP</DialogTitle>
          <DialogDescription>Documentos e comprovantes da competência selecionada.</DialogDescription>
        </DialogHeader>
        <Select value={comp} onValueChange={setComp}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {competencias.map((c) => <SelectItem key={c} value={c}>{labelCompetencia(c)}</SelectItem>)}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button onClick={exportar} disabled={!!progresso} className="w-full">
            {progresso ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{progresso}</> : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Configurar planos de aplicação e limites mensais ──────────────────────
export function ConfigOrcamentoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: planos = [] } = usePlanosDocCanaa();
  const salvar = useSalvarPlanoDocCanaa();
  const [edicao, setEdicao] = useState<Record<string, { limite: string; ativo: boolean }>>({});
  const [novoNome, setNovoNome] = useState("");
  const [novoLimite, setNovoLimite] = useState("");

  useEffect(() => {
    if (!open) return;
    const e: Record<string, { limite: string; ativo: boolean }> = {};
    for (const p of planos) {
      e[p.id] = { limite: p.limite_mensal === null ? "" : p.limite_mensal.toLocaleString("pt-BR", { minimumFractionDigits: 2 }), ativo: p.ativo };
    }
    setEdicao(e);
  }, [open, planos]);

  const salvarPlano = async (p: PlanoDocCanaa) => {
    const e = edicao[p.id];
    const limite = e.limite.trim() ? parseValorBRL(e.limite) : null;
    if (e.limite.trim() && limite === null) { toast.error("Limite inválido."); return; }
    try {
      await salvar.mutateAsync({ ...p, limite_mensal: limite, ativo: e.ativo });
      toast.success(`${p.nome} salvo.`);
    } catch (err) { toast.error(erroMsg(err)); }
  };

  const adicionar = async () => {
    if (!novoNome.trim()) return;
    const limite = novoLimite.trim() ? parseValorBRL(novoLimite) : null;
    if (novoLimite.trim() && limite === null) { toast.error("Limite inválido."); return; }
    try {
      await salvar.mutateAsync({ nome: novoNome, limite_mensal: limite, ordem: (planos[planos.length - 1]?.ordem ?? 0) + 10 });
      setNovoNome(""); setNovoLimite("");
      toast.success("Plano criado.");
    } catch (err) { toast.error(erroMsg(err)); }
  };

  const alterado = (p: PlanoDocCanaa) => {
    const e = edicao[p.id];
    if (!e) return false;
    const lim = e.limite.trim() ? parseValorBRL(e.limite) : null;
    return lim !== p.limite_mensal || e.ativo !== p.ativo;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Planos de Aplicação e Orçamento</DialogTitle>
          <DialogDescription>Limite em branco = sem trava mensal. Estourar o limite gera alerta, não bloqueia o lançamento.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plano</TableHead>
                <TableHead className="w-40">Limite mensal (R$)</TableHead>
                <TableHead className="w-20">Ativo</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {planos.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm font-medium">{p.nome}</TableCell>
                  <TableCell>
                    <Input
                      className="h-8" placeholder="sem trava"
                      value={edicao[p.id]?.limite ?? ""}
                      onChange={(e) => setEdicao((s) => ({ ...s, [p.id]: { ...s[p.id], limite: e.target.value } }))}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={edicao[p.id]?.ativo ?? p.ativo}
                      onCheckedChange={(v) => setEdicao((s) => ({ ...s, [p.id]: { ...s[p.id], ativo: v } }))}
                    />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" disabled={!alterado(p) || salvar.isPending} onClick={() => salvarPlano(p)}>Salvar</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <div className="flex-1 space-y-1">
            <Label>Novo plano</Label>
            <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex: SEGURANÇA" />
          </div>
          <div className="w-40 space-y-1">
            <Label>Limite (opcional)</Label>
            <Input value={novoLimite} onChange={(e) => setNovoLimite(e.target.value)} placeholder="sem trava" />
          </div>
          <Button onClick={adicionar} disabled={!novoNome.trim() || salvar.isPending} className="gap-1.5">
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
