// Etiquetas pessoais do dev ao lado do número do chamado (16/11/2026, mig
// 20261117170000). Cada dev vê só as dele; o botão de etiqueta abre um
// popover para colar/descolar, criar (nome + cor), renomear e apagar.
import { useState } from "react";
import { Check, Pencil, Tag, Trash2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { useChamadoEtiquetas } from "@/hooks/useChamadoEtiquetas";
import {
  CORES_ETIQUETA, MAX_NOME_ETIQUETA, corTextoSobre, validarEtiqueta, type Etiqueta,
} from "@/lib/chamados/etiquetas";

type Ctx = ReturnType<typeof useChamadoEtiquetas>;

export function ChipEtiqueta({ e }: { e: Etiqueta }) {
  return (
    <span className="inline-block max-w-[110px] truncate rounded px-1.5 py-px font-sans text-[9px] font-semibold leading-4"
      style={{ backgroundColor: e.cor, color: corTextoSobre(e.cor) }} title={e.nome}>
      {e.nome}
    </span>
  );
}

const erroAmigavel = (msg: string) =>
  /uq_chamado_etiqueta_usuario_nome|duplicate key/i.test(msg) ? "Você já tem uma etiqueta com esse nome." : msg;

export function EtiquetasChamado({ chamadoId, ctx }: { chamadoId: string; ctx: Ctx }) {
  const { toast } = useToast();
  const { etiquetas, porChamado, salvar, excluir, alternar } = ctx;
  const coladas = porChamado[chamadoId] ?? [];
  const idsColadas = new Set(coladas.map((e) => e.id));

  const [editando, setEditando] = useState<string | null>(null); // id em edição; null = criando
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState<string>(CORES_ETIQUETA[5]);

  const limpar = () => { setEditando(null); setNome(""); setCor(CORES_ETIQUETA[5]); };
  const falhou = (titulo: string) => (e: Error) =>
    toast({ title: titulo, description: erroAmigavel(e.message), variant: "destructive" });

  const enviar = () => {
    const erro = validarEtiqueta(nome, cor, etiquetas, editando ?? undefined);
    if (erro) { toast({ title: erro, variant: "destructive" }); return; }
    salvar.mutate({ id: editando ?? undefined, nome, cor }, {
      onSuccess: limpar,
      onError: falhou("Não foi possível salvar a etiqueta"),
    });
  };

  return (
    <div className="mt-0.5 flex max-w-[130px] flex-wrap items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      {coladas.map((e) => <ChipEtiqueta key={e.id} e={e} />)}
      <Popover onOpenChange={(aberto) => { if (!aberto) limpar(); }}>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Etiquetas do chamado" title="Minhas etiquetas neste chamado"
            className="rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground">
            <Tag className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-3 p-3">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Minhas etiquetas</p>
            {etiquetas.length === 0 && <p className="text-xs text-muted-foreground">Crie a primeira abaixo. Só você vê as suas.</p>}
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {etiquetas.map((e) => {
                const marcada = idsColadas.has(e.id);
                return (
                  <div key={e.id} className="group flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      disabled={alternar.isPending}
                      onClick={() => alternar.mutate({ etiqueta_id: e.id, chamado_id: chamadoId, marcar: !marcada },
                        { onError: falhou("Não foi possível alterar a etiqueta") })}>
                      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${marcada ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                        {marcada && <Check className="h-2.5 w-2.5" />}
                      </span>
                      <ChipEtiqueta e={e} />
                    </button>
                    <button type="button" aria-label={`Editar ${e.nome}`} className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                      onClick={() => { setEditando(e.id); setNome(e.nome); setCor(e.cor); }}>
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button type="button" aria-label={`Apagar ${e.nome}`} className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                      onClick={() => {
                        if (!window.confirm(`Apagar a etiqueta "${e.nome}"? Ela sai de todos os chamados.`)) return;
                        excluir.mutate(e.id, { onSuccess: () => { if (editando === e.id) limpar(); }, onError: falhou("Não foi possível apagar a etiqueta") });
                      }}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="space-y-2 border-t pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {editando ? "Editar etiqueta" : "Nova etiqueta"}
            </p>
            <Input value={nome} maxLength={MAX_NOME_ETIQUETA} placeholder="Nome (ex.: Aguardando teste)"
              className="h-8 text-xs" onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); enviar(); } }} />
            <div className="flex flex-wrap items-center gap-1">
              {CORES_ETIQUETA.map((c) => (
                <button key={c} type="button" aria-label={`Cor ${c}`} onClick={() => setCor(c)}
                  className={`h-5 w-5 rounded-full border-2 ${cor.toLowerCase() === c ? "border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: c }} />
              ))}
              <label className="relative h-5 w-5 cursor-pointer overflow-hidden rounded-full border border-dashed border-muted-foreground/60"
                title="Outra cor" style={{ backgroundColor: (CORES_ETIQUETA as readonly string[]).includes(cor.toLowerCase()) ? undefined : cor }}>
                <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
              </label>
            </div>
            <div className="flex items-center gap-1.5">
              {nome.trim() && <ChipEtiqueta e={{ id: "previa", nome: nome.trim(), cor }} />}
              <span className="flex-1" />
              {editando && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={limpar}><X className="h-3 w-3" /></Button>
              )}
              <Button size="sm" className="h-7 px-2 text-xs" disabled={salvar.isPending} onClick={enviar}>
                {editando ? "Salvar" : "Criar"}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
