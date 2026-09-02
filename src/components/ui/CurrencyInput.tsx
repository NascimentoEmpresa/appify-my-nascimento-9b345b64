import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Converte valor armazenado ("1234.56") → string de dígitos inteiros ("123456")
function valueToDigits(v: string): string {
  if (!v) return "";
  const num = parseFloat(v.replace(/[^\d.]/g, ""));
  if (isNaN(num) || num === 0) return "";
  return Math.round(num * 100).toString();
}

function digitsToDisplay(digits: string): string {
  if (!digits) return "";
  const num = parseInt(digits, 10) / 100;
  return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface CurrencyInputProps {
  value: string;
  onChange: (stored: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function CurrencyInput({ value, onChange, className, placeholder = "0,00", disabled }: CurrencyInputProps) {
  const [digits, setDigits] = useState(() => valueToDigits(value));
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync quando o form carrega um valor externo (modo editar)
  useEffect(() => {
    setDigits(valueToDigits(value));
  }, [value]);

  const display = digitsToDisplay(digits);

  function commit(newDigits: string) {
    setDigits(newDigits);
    const num = newDigits ? parseInt(newDigits, 10) / 100 : 0;
    onChange(num > 0 ? String(num) : "");
    // Força cursor sempre no final após re-render
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) { const len = el.value.length; el.setSelectionRange(len, len); }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      commit(digits.slice(0, -1));
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      commit("");
      return;
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Extrai apenas dígitos do que o browser inseriu, remove zeros à esquerda
    const raw = e.target.value.replace(/\D/g, "").replace(/^0+/, "");
    commit(raw);
  }

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none select-none">
        R$
      </span>
      <Input
        ref={inputRef}
        value={display}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className={cn("pl-9 h-9", className)}
        placeholder={placeholder}
        inputMode="numeric"
        disabled={disabled}
      />
    </div>
  );
}
