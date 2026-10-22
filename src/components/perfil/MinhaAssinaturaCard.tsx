import { useState } from "react";
import { Loader2, PenLine, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QuadroAssinatura } from "@/components/assinatura/QuadroAssinatura";
import { TracoAssinatura } from "@/components/documentos/AssinarDocumento";
import { useAssinaturaPadrao, useSalvarAssinaturaPadrao } from "@/hooks/useDocumentosSolicitados";
import { problemaAssinaturaPessoal } from "@/lib/rh/documentosSolicitados";

/**
 * Minha assinatura (mig 20261022000500, 22/10/2026) — a assinatura PADRÃO
 * da conta ("USUARIO_ASSINATURA"), usada para assinar documentos e termos de
 * ciência de RH › Documentos sem desenhar de novo a cada vez. Também dá para
 * salvar na hora de assinar ("Salvar como minha assinatura padrão").
 * Quem é treinador e ainda não salvou uma vê a de Treinamentos como padrão.
 */
export function MinhaAssinaturaCard() {
  const padrao = useAssinaturaPadrao();
  const salvar = useSalvarAssinaturaPadrao();
  const [editando, setEditando] = useState(false);
  const [desenho, setDesenho] = useState<string | null>(null);
  const atual = padrao.data;
  const daConta = atual?.origem === "conta";

  const gravar = async () => {
    try {
      await salvar.mutateAsync({ tipo: "desenho", imagem: desenho, texto: null, fonte: null, tamanho: 1 });
      toast.success("Assinatura padrão salva.");
      setEditando(false); setDesenho(null);
    } catch (e) { toast.error((e as Error).message); }
  };
  const remover = async () => {
    try { await salvar.mutateAsync(null); toast.success("Assinatura padrão removida."); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><PenLine className="h-4 w-4" /> Minha assinatura</CardTitle>
        <CardDescription>
          Usada para assinar documentos e termos de ciência enviados pelo RH. Fica só com você — ninguém mais vê a sua assinatura padrão.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {padrao.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
        ) : editando ? (
          <>
            <QuadroAssinatura imagem={desenho} onChange={setDesenho} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setEditando(false); setDesenho(null); }}>Cancelar</Button>
              <Button onClick={gravar} disabled={!!problemaAssinaturaPessoal(desenho ? { tipo: "desenho", imagem: desenho } : null) || salvar.isPending}>
                {salvar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Salvar assinatura
              </Button>
            </div>
          </>
        ) : (
          <>
            {atual ? (
              <div className="rounded-lg border bg-white px-3 py-4">
                <TracoAssinatura a={atual} altura="64px" />
                {!daConta && <p className="mt-2 text-center text-xs text-slate-500">Sua assinatura de Treinamentos (ainda não salvou uma própria)</p>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Você ainda não tem assinatura padrão. Sem ela, é só desenhar na hora de assinar.</p>
            )}
            <div className="flex justify-end gap-2">
              {daConta && (
                <Button variant="ghost" className="text-red-600 hover:text-red-700" onClick={remover} disabled={salvar.isPending}>
                  <Trash2 className="mr-2 h-4 w-4" /> Remover
                </Button>
              )}
              <Button variant="outline" onClick={() => setEditando(true)}>
                <PenLine className="mr-2 h-4 w-4" /> {daConta ? "Desenhar outra" : "Desenhar minha assinatura"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
