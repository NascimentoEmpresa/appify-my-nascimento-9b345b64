import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, ExternalLink } from "lucide-react";
import { type LinkSolicitacao } from "@/hooks/useMaloteDespesa";

// SIS-2026-0398: solicitação pode ter itens de fornecedores/kits diferentes,
// cada um com seu próprio link de compra — antes era um único campo de
// texto, virando uma sequência de URLs sem identificação de qual é de qual.
// Rótulo é texto livre (não vinculado ao cadastro de Fornecedor): na
// solicitação o fornecedor muitas vezes ainda não foi escolhido/cotado.
const LINHA_VAZIA: LinkSolicitacao = { rotulo: "", url: "" };

export function LinksSolicitacao({
  links,
  onChange,
  editavel = true,
}: {
  links: LinkSolicitacao[];
  onChange?: (links: LinkSolicitacao[]) => void;
  editavel?: boolean;
}) {
  const alterar = (i: number, patch: Partial<LinkSolicitacao>) =>
    onChange?.(links.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const remover = (i: number) => onChange?.(links.filter((_, j) => j !== i));
  const adicionar = () => onChange?.([...links, { ...LINHA_VAZIA }]);

  if (!editavel) {
    if (links.length === 0) return null;
    return (
      <div className="space-y-0.5">
        {links.map((l, i) => (
          <a
            key={l.id ?? i}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-start gap-1 text-xs text-primary hover:underline break-all"
          >
            <ExternalLink className="h-3 w-3 shrink-0 mt-0.5" />
            <span className="break-all">{l.rotulo?.trim() ? `${l.rotulo} — ${l.url}` : l.url}</span>
          </a>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {links.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Nenhum link ainda. Adicione o link de compra de cada fornecedor/kit, se houver.
        </p>
      ) : (
        <div className="space-y-2">
          {links.map((link, i) => (
            <div key={link.id ?? i} className="flex items-start gap-2 rounded-md border p-2">
              <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div>
                  <Label className="text-xs">Rótulo (opcional)</Label>
                  <Input
                    className="mt-1 h-9"
                    value={link.rotulo ?? ""}
                    onChange={(e) => alterar(i, { rotulo: e.target.value })}
                    placeholder="Ex.: Fornecedor X - Kit A"
                  />
                </div>
                <div>
                  <Label className="text-xs">Link</Label>
                  <Input
                    className="mt-1 h-9"
                    value={link.url}
                    onChange={(e) => alterar(i, { url: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-5 h-9 w-9 shrink-0"
                onClick={() => remover(i)}
                aria-label="Remover link"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" onClick={adicionar}>
        <Plus className="mr-2 h-4 w-4" /> Adicionar link
      </Button>
    </div>
  );
}
