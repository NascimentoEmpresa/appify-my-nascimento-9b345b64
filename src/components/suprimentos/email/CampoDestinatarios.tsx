import { useMemo, useRef, useState } from "react";
import { X, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emailValido, filtrarSugestoes, separarEnderecos, type SugestaoEndereco,
} from "@/lib/suprimentos/fornecedorEmail";

/**
 * Campo Para/Cc/Cco no jeito do Gmail: cada endereço vira um chip; vírgula,
 * ponto e vírgula, Enter, Tab ou sair do campo confirmam o que foi digitado;
 * Backspace no campo vazio apaga o último chip; colar uma lista inteira
 * (do Excel, do Outlook) separa sozinho. Sugere os e-mails cadastrados dos
 * fornecedores (principal, financeiro, nota fiscal).
 */
export function CampoDestinatarios({
  rotulo, valor, onChange, sugestoes, autoFocus, extra,
}: {
  rotulo: string;
  valor: string[];
  onChange: (v: string[]) => void;
  sugestoes: SugestaoEndereco[];
  autoFocus?: boolean;
  extra?: React.ReactNode;
}) {
  const [texto, setTexto] = useState("");
  const [focado, setFocado] = useState(false);
  const [indice, setIndice] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const lista = useMemo(() => filtrarSugestoes(sugestoes, texto, valor), [sugestoes, texto, valor]);
  const nomePorEmail = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sugestoes) if (!m.has(s.email)) m.set(s.email, s.fornecedorNome);
    return m;
  }, [sugestoes]);

  const adicionar = (novos: string[]) => {
    const junto = [...valor];
    for (const e of novos) if (e && !junto.includes(e)) junto.push(e);
    onChange(junto);
    setTexto("");
    setIndice(0);
  };

  const confirmarTexto = () => {
    if (texto.trim()) adicionar(separarEnderecos(texto));
  };

  return (
    <div className="relative flex min-h-[40px] items-start gap-2 border-b px-4 py-1.5" onClick={() => inputRef.current?.focus()}>
      <span className="w-10 shrink-0 pt-1.5 text-sm text-muted-foreground">{rotulo}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {valor.map((e) => {
          const ok = emailValido(e);
          const nome = nomePorEmail.get(e);
          return (
            <span
              key={e}
              title={nome ? `${nome} — ${e}` : e}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                ok ? "bg-muted" : "border-destructive/60 bg-destructive/10 text-destructive",
              )}
            >
              {nome && <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />}
              <span className="truncate">{nome ? <><b className="font-medium">{nome}</b> &lt;{e}&gt;</> : e}</span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-foreground/10"
                onClick={(ev) => { ev.stopPropagation(); onChange(valor.filter((x) => x !== e)); }}
                aria-label={`Remover ${e}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setIndice(0); }}
          onFocus={() => setFocado(true)}
          onBlur={() => { setTimeout(() => setFocado(false), 150); confirmarTexto(); }}
          onPaste={(e) => {
            const colado = e.clipboardData.getData("text");
            if (/[,;\n\s]/.test(colado.trim())) { e.preventDefault(); adicionar(separarEnderecos(colado)); }
          }}
          onKeyDown={(e) => {
            if (lista.length && focado && texto) {
              if (e.key === "ArrowDown") { e.preventDefault(); setIndice((i) => (i + 1) % lista.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setIndice((i) => (i - 1 + lista.length) % lista.length); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); adicionar([lista[indice].email]); return; }
            }
            if (["Enter", ",", ";"].includes(e.key) || (e.key === "Tab" && texto.trim())) {
              if (texto.trim()) { e.preventDefault(); confirmarTexto(); }
              return;
            }
            if (e.key === "Backspace" && !texto && valor.length) onChange(valor.slice(0, -1));
          }}
          className="min-w-[10rem] flex-1 bg-transparent py-1 text-sm outline-none"
          aria-label={rotulo}
        />
      </div>
      {extra}

      {focado && texto && lista.length > 0 && (
        <div className="absolute left-14 right-4 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover shadow-lg">
          {lista.map((s, i) => (
            <button
              key={`${s.fornecedorId}-${s.email}`}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); adicionar([s.email]); }}
              onMouseEnter={() => setIndice(i)}
              className={cn("flex w-full items-center gap-3 px-3 py-2 text-left", i === indice && "bg-accent")}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {s.fornecedorNome.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{s.fornecedorNome}</span>
                <span className="block truncate text-xs text-muted-foreground">{s.email} · {s.rotulo}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
