import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tag, X, Loader2, Check, Info } from "lucide-react";
import { fmtTelefone, type WaContato } from "./types";

interface Props {
  contato: WaContato | null;
  aberto: boolean;
  onFechar: () => void;
}

// Etiqueta normalizada: sem espaço nas pontas e sem duplicar por caixa alta.
// "Fornecedor" e "fornecedor" viram a mesma coisa — senão o catálogo cresce
// com variações da mesma palavra e nenhum filtro fecha.
const normalizar = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, 30);

export function FichaContato({ contato, aberto, onFechar }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [nome, setNome] = useState("");
  const [etiquetas, setEtiquetas] = useState<string[]>([]);
  const [nova, setNova] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Recarrega os campos ao trocar de contato (o Sheet fica montado entre
  // aberturas; sem isso a ficha abriria com os dados do contato anterior).
  useEffect(() => {
    setNome((contato?.nome_manual ?? "").trim());
    setEtiquetas(contato?.etiquetas ?? []);
    setObservacao(contato?.observacao ?? "");
    setNova("");
    // Só id e `aberto` de propósito: reagir a cada campo faria o refetch da
    // lista de conversas (a cada 8s) descartar o que está sendo digitado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contato?.id, aberto]);

  // Etiquetas que já existem, para sugerir em vez de deixar cada um inventar
  // a sua. Só as usadas — não há cadastro de etiqueta para ninguém manter.
  const { data: catalogo = [] } = useQuery({
    queryKey: ["wa-etiquetas"],
    enabled: aberto,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("WA_CONTATO").select("etiquetas").limit(500);
      const todas = (data ?? []).flatMap((c: { etiquetas: string[] | null }) => c.etiquetas ?? []);
      return [...new Set(todas.map((e: string) => normalizar(e)).filter(Boolean))].sort() as string[];
    },
  });

  const sugestoes = useMemo(
    () => catalogo.filter((e) => !etiquetas.some((j) => j.toLowerCase() === e.toLowerCase())).slice(0, 12),
    [catalogo, etiquetas]);

  const adicionar = (bruta: string) => {
    const e = normalizar(bruta);
    if (!e) return;
    setNova("");
    if (etiquetas.some((j) => j.toLowerCase() === e.toLowerCase())) return;
    setEtiquetas((v) => [...v, e]);
  };

  const salvar = async () => {
    if (!contato || salvando) return;
    setSalvando(true);
    try {
      const { error } = await (supabase as any).from("WA_CONTATO").update({
        // Vazio volta a null: assim a tela cai no nome do WhatsApp de novo,
        // em vez de mostrar um nome em branco.
        nome_manual: nome.trim() || null,
        etiquetas,
        observacao: observacao.trim() || null,
      }).eq("id", contato.id);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["wa-conversas"] });
      qc.invalidateQueries({ queryKey: ["wa-etiquetas"] });
      toast({ title: "Ficha salva" });
      onFechar();
    } catch (e) {
      toast({ title: "Não deu para salvar", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" /> Ficha do contato
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex-1 space-y-5 overflow-y-auto pr-1">
          <div>
            <p className="text-sm font-semibold">{fmtTelefone(contato?.wa_id)}</p>
            <p className="text-[11px] text-muted-foreground">
              {(contato?.nome ?? "").trim()
                ? <>Nome no WhatsApp: <b>{contato?.nome}</b></>
                : "Ainda sem nome do WhatsApp — ele chega quando a pessoa responder."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ficha-nome">Nome na Caixa de Entrada</Label>
            <Input
              id="ficha-nome" value={nome} onChange={(e) => setNome(e.target.value)}
              placeholder={(contato?.nome ?? "").trim() || fmtTelefone(contato?.wa_id)}
            />
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Info className="mt-px h-3 w-3 shrink-0" />
              Fica numa coluna separada do nome do WhatsApp: um não apaga o outro.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Etiquetas</Label>
            <div className="flex flex-wrap gap-1.5">
              {etiquetas.map((e) => (
                <Badge key={e} variant="secondary" className="gap-1 pr-1">
                  {e}
                  <button
                    type="button" title={`Remover ${e}`}
                    onClick={() => setEtiquetas((v) => v.filter((j) => j !== e))}
                    className="rounded-full p-0.5 hover:bg-background/60"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {etiquetas.length === 0 && <p className="text-[11px] text-muted-foreground">Nenhuma etiqueta.</p>}
            </div>
            <Input
              value={nova} onChange={(e) => setNova(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(nova); } }}
              placeholder="Escreva e tecle Enter (ex.: Fornecedor)"
            />
            {sugestoes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                <span className="text-[11px] text-muted-foreground">Já usadas:</span>
                {sugestoes.map((e) => (
                  <button
                    key={e} type="button" onClick={() => adicionar(e)}
                    className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ficha-obs">Observação</Label>
            <Textarea
              id="ficha-obs" rows={5} value={observacao} onChange={(e) => setObservacao(e.target.value)}
              placeholder="O que o próximo atendente precisa saber antes de responder."
            />
          </div>
        </div>

        <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-border pt-3">
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button className="gap-1.5" onClick={salvar} disabled={!contato || salvando}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salvar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
