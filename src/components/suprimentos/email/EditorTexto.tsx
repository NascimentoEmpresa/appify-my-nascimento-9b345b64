import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, Link2, RemoveFormatting,
  Quote, Undo2, Redo2, Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Editor de texto do e-mail. contentEditable + execCommand: é o que todo
 * cliente de webmail ainda usa por baixo, e não puxa dependência nova. O HTML
 * sai como está; quem LÊ a mensagem depois (painel de leitura) mostra num
 * iframe com sandbox, então script colado aqui não roda em lugar nenhum.
 */
export interface EditorTextoRef {
  html: () => string;
  texto: () => string;
  definir: (html: string) => void;
  focar: () => void;
}

const CORES = ["#202124", "#d93025", "#1a73e8", "#188038", "#e37400", "#9334e6"];

export const EditorTexto = forwardRef<EditorTextoRef, {
  inicial: string;
  onChange?: () => void;
  onAtalhoEnviar?: () => void;
  className?: string;
}>(function EditorTexto({ inicial, onChange, onAtalhoEnviar, className }, ref) {
  const div = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (div.current) div.current.innerHTML = inicial;
    // só na montagem: depois o conteúdo é da pessoa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    html: () => div.current?.innerHTML ?? "",
    texto: () => div.current?.innerText ?? "",
    definir: (h: string) => { if (div.current) div.current.innerHTML = h; },
    focar: () => div.current?.focus(),
  }));

  const cmd = (comando: string, valor?: string) => {
    div.current?.focus();
    document.execCommand(comando, false, valor);
    onChange?.();
  };

  const botao = (titulo: string, icone: React.ReactNode, acao: () => void) => (
    <Button
      type="button" size="icon" variant="ghost" className="h-7 w-7" title={titulo}
      onMouseDown={(e) => { e.preventDefault(); acao(); }}
    >
      {icone}
    </Button>
  );

  return (
    <div className={className}>
      <div
        ref={div}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Corpo da mensagem"
        onInput={onChange}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); onAtalhoEnviar?.(); }
        }}
        className="min-h-[220px] flex-1 overflow-y-auto px-4 py-3 text-sm leading-relaxed outline-none [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
      />
      <div className="flex flex-wrap items-center gap-0.5 border-t px-2 py-1">
        {botao("Desfazer (Ctrl+Z)", <Undo2 className="h-4 w-4" />, () => cmd("undo"))}
        {botao("Refazer (Ctrl+Y)", <Redo2 className="h-4 w-4" />, () => cmd("redo"))}
        <span className="mx-1 h-5 w-px bg-border" />
        {botao("Negrito (Ctrl+B)", <Bold className="h-4 w-4" />, () => cmd("bold"))}
        {botao("Itálico (Ctrl+I)", <Italic className="h-4 w-4" />, () => cmd("italic"))}
        {botao("Sublinhado (Ctrl+U)", <Underline className="h-4 w-4" />, () => cmd("underline"))}
        {botao("Tachado", <Strikethrough className="h-4 w-4" />, () => cmd("strikeThrough"))}
        <span className="group relative">
          {botao("Cor do texto", <Palette className="h-4 w-4" />, () => undefined)}
          <span className="absolute bottom-full left-0 z-10 hidden gap-1 rounded-md border bg-popover p-1.5 shadow group-hover:flex">
            {CORES.map((c) => (
              <button
                key={c} type="button" title={c}
                className="h-5 w-5 rounded-full border"
                style={{ background: c }}
                onMouseDown={(e) => { e.preventDefault(); cmd("foreColor", c); }}
              />
            ))}
          </span>
        </span>
        <span className="mx-1 h-5 w-px bg-border" />
        {botao("Lista com marcadores", <List className="h-4 w-4" />, () => cmd("insertUnorderedList"))}
        {botao("Lista numerada", <ListOrdered className="h-4 w-4" />, () => cmd("insertOrderedList"))}
        {botao("Citação", <Quote className="h-4 w-4" />, () => cmd("formatBlock", "blockquote"))}
        {botao("Inserir link", <Link2 className="h-4 w-4" />, () => {
          const url = window.prompt("Endereço do link (https://…)");
          if (url && /^(https?:|mailto:)/i.test(url.trim())) cmd("createLink", url.trim());
        })}
        {botao("Remover formatação", <RemoveFormatting className="h-4 w-4" />, () => cmd("removeFormat"))}
      </div>
    </div>
  );
});
