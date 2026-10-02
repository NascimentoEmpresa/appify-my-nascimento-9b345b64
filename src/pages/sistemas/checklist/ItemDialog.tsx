import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { useSalvarChecklist, type CamposChecklist } from "@/hooks/useChecklistModulos";
import { AREA_PADRAO, ETAPAS, opcaoDe, type ChecklistItem, type Status4, type UsuarioCat } from "@/lib/sistemas/checklistModulos";
import { CLASSE_TOM, PONTO_TOM, fmtDataHora } from "./ui";

// Preencher o checklist de uma TELA (submódulo) ou do MÓDULO. No módulo, a
// etapa deixada vazia é calculada pelas telas (o diálogo mostra o que sairia)
// e entram também a Área e os dados do módulo. Status vazio = "pendente de
// preenchimento"; clicar de novo no marcado desmarca.

const SEM = "__sem";

export interface AlvoItem {
  moduloId: string; moduloNome: string; moduloCodigo?: string; menuId: string | null; telaNome?: string; rota?: string;
  item: ChecklistItem | null;
  /** Só no módulo: o status que as telas dão para cada etapa (o que vale se ficar vazio). */
  calculado?: Status4;
}

export function ItemDialog({ alvo, usuarios, onFechar }: { alvo: AlvoItem | null; usuarios: UsuarioCat[]; onFechar: () => void }) {
  const salvar = useSalvarChecklist();
  const [f, setF] = useState<CamposChecklist>({});
  const ehModulo = !alvo?.menuId;

  useEffect(() => {
    const i = alvo?.item;
    setF({
      status_dev: i?.status_dev ?? null, status_implantacao: i?.status_implantacao ?? null,
      status_treinamento: i?.status_treinamento ?? null, status_validacao: i?.status_validacao ?? null,
      responsavel_id: i?.responsavel_id ?? null, usuario_chave_id: i?.usuario_chave_id ?? null,
      previsao_entrega: i?.previsao_entrega ?? null, data_implantacao: i?.data_implantacao ?? null,
      data_treinamento: i?.data_treinamento ?? null, data_validacao: i?.data_validacao ?? null,
      observacoes: i?.observacoes ?? null, area: i?.area ?? null,
    });
  }, [alvo]);

  if (!alvo) return null;
  const opcoesUsuario = [{ value: SEM, label: "— Ninguém —" }, ...usuarios.map((u) => ({ value: u.id, label: u.nome, hint: u.email ?? undefined }))];
  const mudar = (p: CamposChecklist) => setF((x) => ({ ...x, ...p }));
  const areaPadrao = AREA_PADRAO[alvo.moduloCodigo ?? ""] ?? alvo.moduloNome;

  const gravar = async () => {
    const campos: CamposChecklist = { ...f, observacoes: f.observacoes?.trim() || null };
    if (ehModulo) campos.area = f.area?.trim() || null; else delete campos.area;
    for (const k of ["previsao_entrega", "data_implantacao", "data_treinamento", "data_validacao"] as const) {
      if (!campos[k]) campos[k] = null;
    }
    await salvar.mutateAsync({ id: alvo.item?.id ?? null, moduloId: alvo.moduloId, menuId: alvo.menuId, campos });
    onFechar();
  };

  const dataDaEtapa: Record<string, keyof CamposChecklist> = {
    status_implantacao: "data_implantacao", status_treinamento: "data_treinamento", status_validacao: "data_validacao",
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !salvar.isPending && onFechar()}>
      {/* Sem z-index próprio: o z-[1100] era para ficar acima da gaveta
          (ModuloSheet, removida em 02/10/2026) e jogava a lista do
          Responsável/Usuário-chave (Popover, z-50) para TRÁS da janela. */}
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ehModulo ? `Status do módulo · ${alvo.moduloNome}` : alvo.telaNome}</DialogTitle>
          <DialogDescription>
            {ehModulo
              ? "Marque o status do módulo. Etapa deixada em branco é calculada pelas telas (submódulos) dele."
              : <>{alvo.moduloNome}{alvo.rota ? <> · <span className="font-mono text-[11px]">{alvo.rota}</span></> : null}</>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {ETAPAS.map((e) => {
            const atual = f[e.campo] as string | null | undefined;
            const campoData = dataDaEtapa[e.campo];
            const calc = ehModulo ? (alvo.calculado?.[e.campo] ?? null) : null;
            return (
              <div key={e.chave} className="rounded-xl border border-border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold">{e.titulo}{!e.noPercentual && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(não entra no %)</span>}</p>
                  {!atual && (
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {ehModulo ? <>Em branco · pelas telas: <b>{opcaoDe(e.chave, calc)?.rotulo ?? "pendente"}</b></> : "Pendente de preenchimento"}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {e.opcoes.map((o) => {
                    const marcado = atual === o.valor;
                    return (
                      <button key={o.valor} type="button"
                        onClick={() => mudar({ [e.campo]: marcado ? null : o.valor } as CamposChecklist)}
                        className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition",
                          marcado ? CLASSE_TOM[o.tom] + " ring-2 ring-primary/40 ring-offset-1" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", marcado ? PONTO_TOM[o.tom] : "bg-slate-300")} />
                        {o.rotulo}
                      </button>
                    );
                  })}
                </div>
                {campoData && (
                  <div className="mt-2 flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Data</Label>
                    <Input type="date" className="h-8 w-40" value={(f[campoData] as string | null) ?? ""} onChange={(ev) => mudar({ [campoData]: ev.target.value || null } as CamposChecklist)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {ehModulo && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Área</Label>
              <Input value={f.area ?? ""} onChange={(e) => mudar({ area: e.target.value })} placeholder={`Padrão: ${areaPadrao}`} maxLength={60} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Responsável (Sistemas)</Label>
            <SearchableSelect value={f.responsavel_id ?? SEM} onChange={(v) => mudar({ responsavel_id: v === SEM ? null : v })}
              options={opcoesUsuario} placeholder="Escolha" searchPlaceholder="Buscar pessoa…" />
          </div>
          <div className="space-y-1.5">
            <Label>Usuário-chave (valida)</Label>
            <SearchableSelect value={f.usuario_chave_id ?? SEM} onChange={(v) => mudar({ usuario_chave_id: v === SEM ? null : v })}
              options={opcoesUsuario} placeholder="Escolha" searchPlaceholder="Buscar pessoa…" />
          </div>
          <div className="space-y-1.5">
            <Label>Previsão de entrega</Label>
            <Input type="date" value={f.previsao_entrega ?? ""} onChange={(e) => mudar({ previsao_entrega: e.target.value || null })} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Observações</Label>
          <Textarea rows={3} value={f.observacoes ?? ""} onChange={(e) => mudar({ observacoes: e.target.value })}
            placeholder="Pendências, combinados com o setor, o que falta para validar…" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">
            {alvo.item ? <>Última atualização: {alvo.item.atualizado_por ?? "—"} · {fmtDataHora(alvo.item.atualizado_em)}</> : "Ainda não preenchido."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar} disabled={salvar.isPending}>Cancelar</Button>
            <Button onClick={gravar} disabled={salvar.isPending} className="gap-1.5">
              {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
