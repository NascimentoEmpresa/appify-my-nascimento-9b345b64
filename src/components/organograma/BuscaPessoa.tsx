import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { buscarPessoas, type PessoaBusca } from "@/lib/organograma/pessoas";

// Busca por nome no cadastro. A lista fica DENTRO do fluxo (não flutua em
// portal) porque o componente também abre no modal do Colaboradores, que tem
// z-index próprio e rolagem interna: dropdown flutuante ficava atrás ou cortado.
export function BuscaPessoa({ soNaArvore = false, placeholder, onEscolher, ocultarId, autoFocus }: {
  /** Só quem já está no organograma (para escolher superior). */
  soNaArvore?: boolean;
  placeholder?: string;
  onEscolher: (p: PessoaBusca) => void;
  /** Não oferecer a própria pessoa como superior dela. */
  ocultarId?: string | null;
  autoFocus?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [termo, setTermo] = useState("");

  // Só busca quando a pessoa para de digitar (nada de uma requisição por tecla).
  useEffect(() => {
    const t = window.setTimeout(() => setTermo(texto.trim()), 300);
    return () => window.clearTimeout(t);
  }, [texto]);

  const q = useQuery({
    queryKey: ["organograma-busca", termo, soNaArvore],
    queryFn: () => buscarPessoas(termo, soNaArvore),
    enabled: termo.length >= 2,
    staleTime: 60_000,
  });
  const lista = (q.data ?? []).filter((p) => !ocultarId || p.no_id !== ocultarId);

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus={autoFocus} className="pl-8" placeholder={placeholder ?? "Digite o nome…"} value={texto} onChange={(e) => setTexto(e.target.value)} />
      </div>
      {termo.length >= 2 && (
        <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border bg-background p-1">
          {q.isLoading && <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…</p>}
          {q.isError && <p className="p-2 text-xs text-destructive">{(q.error as Error).message}</p>}
          {!q.isLoading && !q.isError && !lista.length && <p className="p-2 text-xs text-muted-foreground">Ninguém encontrado com esse nome.</p>}
          {lista.map((p) => (
            <button key={`${p.empregado_id ?? ""}-${p.user_id ?? ""}`} type="button"
              onClick={() => { onEscolher(p); setTexto(""); setTermo(""); }}
              className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted">
              <span className="block truncate text-sm font-semibold">{p.nome}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {[p.cargo, p.contrato ?? p.setor].filter(Boolean).join(" · ") || "Usuário sem cadastro de colaborador"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
