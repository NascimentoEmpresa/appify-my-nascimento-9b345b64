import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScanLine, X, Check, ClipboardList, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Campo de leitura de etiqueta, desenhado para a pistola de código de barras.
 *
 * A pistola se comporta como teclado: digita o código e manda Enter. Por isso
 * o campo mantém o foco sozinho e limpa a cada leitura — o operador bipa em
 * sequência sem tocar no mouse.
 *
 * Aceita VÁRIOS CÓDIGOS DE UMA VEZ, separados por quebra de linha, vírgula,
 * ponto-e-vírgula ou tabulação — igual ao legado (§6.3). Vale ao colar no
 * campo, ao confirmar um texto com separadores, e no modo "colar lista", que
 * abre uma caixa de texto para quem tem a relação pronta numa planilha.
 *
 * Código repetido é recusado sem perder o que já foi lido: num almoxarifado,
 * perder 19 leituras por causa da 20ª é inaceitável.
 */

const SEPARADORES = /[\n\r,;\t]+/;

/** Quebra um texto colado/digitado na lista de códigos normalizados. */
export function separarCodigos(texto: string): string[] {
  return texto
    .split(SEPARADORES)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function CampoBipagem({
  codigos, onChange, placeholder = "Bipe ou digite a etiqueta…",
  autoFoco = true, desabilitado = false, max,
}: {
  codigos: string[];
  onChange: (codigos: string[]) => void;
  placeholder?: string;
  autoFoco?: boolean;
  desabilitado?: boolean;
  /** Limite de leituras (ex.: a quantidade pedida daquele item). */
  max?: number;
}) {
  const [valor, setValor] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [modoLista, setModoLista] = useState(false);
  const [lista, setLista] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFoco && !desabilitado && !modoLista) ref.current?.focus();
  }, [autoFoco, desabilitado, modoLista]);

  const cheio = max != null && codigos.length >= max;

  /**
   * Acrescenta os códigos, ignorando repetidos e respeitando o limite.
   * Devolve o resumo para a mensagem — o operador precisa saber o que
   * entrou e o que não entrou, sem ter que conferir chip por chip.
   */
  const acrescentar = (novos: string[]) => {
    if (novos.length === 0) return;
    const atuais = new Set(codigos);
    const aceitos: string[] = [];
    let repetidos = 0;
    let excedentes = 0;

    for (const c of novos) {
      if (atuais.has(c)) { repetidos++; continue; }
      if (max != null && codigos.length + aceitos.length >= max) { excedentes++; continue; }
      atuais.add(c);
      aceitos.push(c);
    }

    if (aceitos.length > 0) onChange([...codigos, ...aceitos]);

    const partes: string[] = [];
    if (aceitos.length > 0 && novos.length > 1) partes.push(`${aceitos.length} lida(s)`);
    if (repetidos > 0) partes.push(`${repetidos} repetida(s)`);
    if (excedentes > 0) partes.push(`${excedentes} além do limite de ${max}`);
    setAviso(partes.length && (repetidos || excedentes) ? partes.join(" · ") : null);
  };

  const confirmar = () => {
    const novos = separarCodigos(valor);
    if (novos.length === 0) return;
    acrescentar(novos);
    setValor("");
  };

  const remover = (cod: string) => {
    setAviso(null);
    onChange(codigos.filter((c) => c !== cod));
    ref.current?.focus();
  };

  return (
    <div className="space-y-2">
      {modoLista ? (
        <>
          <Textarea
            autoFocus
            value={lista}
            onChange={(e) => setLista(e.target.value)}
            rows={5}
            placeholder={"Uma etiqueta por linha:\n0364400900012300000159 60\n0364400900012300000159 61\n…"}
            className="font-mono text-xs"
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button" size="sm"
              disabled={desabilitado || separarCodigos(lista).length === 0}
              onClick={() => { acrescentar(separarCodigos(lista)); setLista(""); setModoLista(false); }}
            >
              Adicionar {separarCodigos(lista).length > 0 && `(${separarCodigos(lista).length})`}
            </Button>
            <Button type="button" variant="ghost" size="sm"
                    onClick={() => { setLista(""); setModoLista(false); }}>
              <Keyboard className="mr-1.5 h-3.5 w-3.5" /> Voltar a bipar
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="relative">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={ref}
              value={valor}
              disabled={desabilitado || cheio}
              onChange={(e) => { setValor(e.target.value); setAviso(null); }}
              onKeyDown={(e) => {
                // A pistola manda Enter ao fim da leitura. preventDefault evita
                // que o Enter submeta o formulário/modal em volta.
                if (e.key === "Enter") { e.preventDefault(); confirmar(); }
              }}
              onPaste={(e) => {
                // O navegador achata quebras de linha num <input>, então o
                // texto colado é lido direto da área de transferência.
                const texto = e.clipboardData.getData("text");
                if (!SEPARADORES.test(texto)) return;   // colagem simples segue o fluxo normal
                e.preventDefault();
                acrescentar(separarCodigos(texto));
                setValor("");
              }}
              placeholder={placeholder}
              className={cn("pl-9 font-mono", aviso && "border-amber-400")}
              autoComplete="off"
              spellCheck={false}
            />
            {max != null && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                {codigos.length}/{max}
              </span>
            )}
          </div>

          {!desabilitado && (
            <Button type="button" variant="ghost" size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => setModoLista(true)}>
              <ClipboardList className="mr-1.5 h-3.5 w-3.5" /> Colar lista de etiquetas
            </Button>
          )}
        </>
      )}

      {aviso && <p className="text-xs text-amber-600">{aviso}</p>}

      {codigos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {codigos.map((c) => (
            <Badge key={c} variant="outline" className="gap-1 border-emerald-400/50 pr-1 font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
              <Check className="h-3 w-3" />
              {c}
              {!desabilitado && (
                <Button
                  type="button" variant="ghost" size="icon"
                  className="h-4 w-4 hover:bg-destructive/10"
                  onClick={() => remover(c)}
                  aria-label={`Remover ${c}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
