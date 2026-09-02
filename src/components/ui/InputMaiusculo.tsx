import * as React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// SIS-2026-0280 (Iury): "tudo que o usuário escreva no malote fique
// maiúsculo para manter padrão" — wrapper fino em cima de Input/Textarea
// que força maiúsculo no PRÓPRIO valor digitado (não é text-transform de
// CSS, que só mudaria a exibição — o dado gravado no banco também vem
// maiúsculo). Uppercase não muda o comprimento da string, então o cursor
// não pula de posição — dispensa a lógica de reposicionar cursor que o
// CurrencyInput precisa.
//
// Uso: substitui <Input>/<Textarea> em campos de texto livre (nome,
// descrição, justificativa, dados de pagamento, etc.) — não usar em
// campos que precisam do valor exato como digitado (ex.: confirmação de
// exclusão comparada por igualdade) nem em number/date/month/time.
export const InputMaiusculo = React.forwardRef<HTMLInputElement, React.ComponentProps<typeof Input>>(
  ({ onChange, ...props }, ref) => (
    <Input
      ref={ref}
      onChange={(e) => {
        e.target.value = e.target.value.toUpperCase();
        onChange?.(e);
      }}
      {...props}
    />
  ),
);
InputMaiusculo.displayName = "InputMaiusculo";

export const TextareaMaiusculo = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<typeof Textarea>>(
  ({ onChange, ...props }, ref) => (
    <Textarea
      ref={ref}
      onChange={(e) => {
        e.target.value = e.target.value.toUpperCase();
        onChange?.(e);
      }}
      {...props}
    />
  ),
);
TextareaMaiusculo.displayName = "TextareaMaiusculo";
