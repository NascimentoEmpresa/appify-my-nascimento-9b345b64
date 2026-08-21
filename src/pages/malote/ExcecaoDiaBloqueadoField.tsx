import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useMaloteConfig } from "@/hooks/useMaloteConfig";

interface ExcecaoDiaBloqueadoFieldProps {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  justificativa: string;
  onJustificativaChange: (v: string) => void;
  disabled?: boolean;
}

// SIS-2026-0211 (complemento): marcar a despesa como Exceção permite data
// de pagamento em dia bloqueado, só pra ela — não libera o dia inteiro.
// Justificativa fica obrigatória se a config "excecao_exigir_justificativa_
// solicitante" estiver ligada (Configurações → Inclusões de exceções).
export function ExcecaoDiaBloqueadoField({
  checked,
  onCheckedChange,
  justificativa,
  onJustificativaChange,
  disabled,
}: ExcecaoDiaBloqueadoFieldProps) {
  const { data: config } = useMaloteConfig();
  const exigirJustificativa = config?.excecao_exigir_justificativa_solicitante ?? true;

  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <Checkbox checked={checked} onCheckedChange={(c) => onCheckedChange(c === true)} disabled={disabled} />
        <span>
          <span className="font-medium">Lançar como exceção</span>
          <br />
          <span className="text-xs text-muted-foreground">
            Permite escolher uma data de pagamento em dia bloqueado (feriado, recesso ou fim de semana) só pra esta
            despesa — o dia continua bloqueado pra todo o resto.
          </span>
        </span>
      </label>
      {checked && (
        <div>
          <Label className="text-xs">
            Justificativa da exceção {exigirJustificativa && <span className="text-destructive">*</span>}
          </Label>
          <textarea
            value={justificativa}
            onChange={(e) => onJustificativaChange(e.target.value.slice(0, 500))}
            placeholder="Descreva o motivo de lançar em dia bloqueado..."
            className="w-full min-h-16 rounded-md border border-input bg-background p-2 text-sm"
            maxLength={500}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}
