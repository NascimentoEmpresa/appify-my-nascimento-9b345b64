import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  CLASSIFICACAO_ASSUNTO_LABEL, TRATATIVA_ASSUNTO_LABEL, nomeUsuario,
  type ClassificacaoAssunto, type TratativaAssunto, type Usuario,
} from "../types";

const VAZIO = {
  surgiu: true,
  classificacao: "" as ClassificacaoAssunto | "",
  tratativa: "" as TratativaAssunto | "",
  assuntoEstacionado: "",
  responsavel: "",
  dataPrevista: "",
  reuniaoFutura: false,
  observacoes: "",
};

export function AssuntoForaPautaModal({
  open, onOpenChange, usuarios, onSalvar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usuarios: Usuario[];
  onSalvar: (dados: {
    classificacao: ClassificacaoAssunto; tratativa: TratativaAssunto; assunto_estacionado: string | null;
    responsavel_tratativa_user_id: string | null; data_prevista: string | null; reuniao_futura_necessaria: boolean; observacoes: string | null;
  }) => Promise<boolean>;
}) {
  const [form, setForm] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const opcoesUsuarios = usuarios.map((u) => ({ value: u.id, label: u.display_name ?? "—" }));

  const precisaEstacionamento = form.tratativa === "estacionar";
  const valido = form.surgiu && form.classificacao && form.tratativa
    && (!precisaEstacionamento || (form.responsavel && form.dataPrevista));

  const salvar = async () => {
    if (!valido || !form.classificacao || !form.tratativa) return;
    setSalvando(true);
    const ok = await onSalvar({
      classificacao: form.classificacao,
      tratativa: form.tratativa,
      assunto_estacionado: form.assuntoEstacionado.trim() || null,
      responsavel_tratativa_user_id: form.responsavel || null,
      data_prevista: form.dataPrevista || null,
      reuniao_futura_necessaria: form.reuniaoFutura,
      observacoes: form.observacoes.trim() || null,
    });
    setSalvando(false);
    if (ok) { setForm(VAZIO); onOpenChange(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assunto fora da pauta</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Surgiu assunto fora da pauta?</Label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={form.surgiu ? "default" : "outline"} onClick={() => setForm((f) => ({ ...f, surgiu: true }))}>Sim</Button>
              <Button type="button" size="sm" variant={!form.surgiu ? "default" : "outline"} onClick={() => setForm((f) => ({ ...f, surgiu: false }))}>Não</Button>
            </div>
          </div>

          {form.surgiu && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Classificação *</Label>
                  <Select value={form.classificacao} onValueChange={(v) => setForm((f) => ({ ...f, classificacao: v as ClassificacaoAssunto }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CLASSIFICACAO_ASSUNTO_LABEL) as ClassificacaoAssunto[]).map((c) => (
                        <SelectItem key={c} value={c}>{CLASSIFICACAO_ASSUNTO_LABEL[c]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Tratativa *</Label>
                  <Select value={form.tratativa} onValueChange={(v) => setForm((f) => ({ ...f, tratativa: v as TratativaAssunto }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TRATATIVA_ASSUNTO_LABEL) as TratativaAssunto[]).map((t) => (
                        <SelectItem key={t} value={t}>{TRATATIVA_ASSUNTO_LABEL[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Assunto {precisaEstacionamento && "*"}</Label>
                <Textarea
                  value={form.assuntoEstacionado}
                  maxLength={250}
                  onChange={(e) => setForm((f) => ({ ...f, assuntoEstacionado: e.target.value }))}
                  placeholder="Digite um resumo do assunto"
                  className="min-h-14"
                />
                <p className="text-right text-xs text-muted-foreground">{form.assuntoEstacionado.length}/250</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Responsável pela tratativa {precisaEstacionamento && "*"}</Label>
                  <SearchableSelect value={form.responsavel} onChange={(v) => setForm((f) => ({ ...f, responsavel: v }))} options={opcoesUsuarios} placeholder="Selecione" />
                </div>
                <div className="space-y-1.5">
                  <Label>Data prevista {precisaEstacionamento && "*"}</Label>
                  <Input type="date" value={form.dataPrevista} onChange={(e) => setForm((f) => ({ ...f, dataPrevista: e.target.value }))} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Reunião futura necessária?</Label>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant={form.reuniaoFutura ? "default" : "outline"} onClick={() => setForm((f) => ({ ...f, reuniaoFutura: true }))}>Sim</Button>
                  <Button type="button" size="sm" variant={!form.reuniaoFutura ? "default" : "outline"} onClick={() => setForm((f) => ({ ...f, reuniaoFutura: false }))}>Não</Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Observações (opcional)</Label>
                <Textarea
                  value={form.observacoes}
                  maxLength={500}
                  onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
                  placeholder="Adicione informações adicionais sobre o assunto..."
                  className="min-h-16"
                />
                <p className="text-right text-xs text-muted-foreground">{form.observacoes.length}/500</p>
              </div>

              <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                <p className="mb-1 font-semibold text-foreground">Resumo</p>
                <p>Classificação: {form.classificacao ? CLASSIFICACAO_ASSUNTO_LABEL[form.classificacao] : "—"}</p>
                <p>Tratativa: {form.tratativa ? TRATATIVA_ASSUNTO_LABEL[form.tratativa] : "—"}</p>
                <p>Responsável: {form.responsavel ? nomeUsuario(usuarios, form.responsavel) ?? "—" : "—"}</p>
                <p>Data prevista: {form.dataPrevista || "—"}</p>
                <p>Reunião futura necessária: {form.reuniaoFutura ? "Sim" : "Não"}</p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={!valido || salvando}>{salvando ? "Salvando…" : "Salvar assunto"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
