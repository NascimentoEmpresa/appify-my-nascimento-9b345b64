import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

// SIS-2026-0305 (achado do usuário testando): o <input list="datalist">
// nativo do browser (1ª versão) renderiza feio e sem estilo nenhum,
// vazando pra fora do modal. Combobox próprio: Input controlado + Popover
// com sugestões filtradas, mas SEM restringir o valor — texto livre é
// sempre aceito (a descrição do item nunca foi obrigada a bater com o
// catálogo, nem no legado).
export function ComboSugestao({
  value, onChange, options, placeholder, className,
}: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const filtradas = value.trim()
    ? options.filter((o) => o.toLowerCase().includes(value.trim().toLowerCase()))
    : options;

  return (
    <PopoverPrimitive.Root open={open && filtradas.length > 0}>
      <PopoverPrimitive.Anchor asChild>
        <Input
          value={value}
          placeholder={placeholder}
          className={className}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 100)}
        />
      </PopoverPrimitive.Anchor>
      {/* Largura fixa (não a do trigger, achado do usuário: `w-[--radix-popover-trigger-width]`
          não é sintaxe válida do Tailwind — precisa de var(...) dentro do
          colchete — então ficava sem largura nenhuma e crescia pro tamanho
          do texto mais longo, com scroll lateral feio). */}
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[360px] max-w-[90vw] overflow-hidden p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-64 overflow-y-auto overflow-x-hidden">
          {filtradas.slice(0, 30).map((op) => (
            <button
              key={op}
              type="button"
              className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(op); setOpen(false); }}
            >
              {op}
            </button>
          ))}
        </div>
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}
