import { AlertTriangle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useMaloteConfig } from "@/hooks/useMaloteConfig";

interface ExcecaoDiaBloqueadoFieldProps {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  justificativa: string;
  onJustificativaChange: (v: string) => void;
  disabled?: boolean;
  // SIS-2026-0250: true quando a data de pagamento pedida é mais cedo que
  // o prazo normal calculado pela regra 1.1 ("Prazo para inclusão e
  // aprovação pelo setor") — a partir daí a despesa só pode entrar
  // marcada como exceção, e o campo mostra o aviso abaixo pra deixar isso
  // explícito antes do usuário tentar enviar.
  foraDoPrazoInclusao?: boolean;
  // Data (YYYY-MM-DD) que o prazo normal calculado aponta hoje — só pra
  // exibir no aviso, não influencia a lógica.
  prazoNormal?: string | null;
}

// SIS-2026-0211 (complemento): marcar a despesa como Exceção permite data
// de pagamento em dia bloqueado, só pra ela — não libera o dia inteiro.
// SIS-2026-0250: também passou a ser obrigatória quando a inclusão acontece
// fora do horário da regra 1.1 — antes disso a despesa passava fora do
// prazo sem exigir a exceção. Justificativa fica obrigatória se a config
// "excecao_exigir_justificativa_solicitante" estiver ligada (Configurações
// → Inclusões de exceções).
export function ExcecaoDiaBloqueadoField({
  checked,
  onCheckedChange,
  justificativa,
  onJustificativaChange,
  disabled,
  foraDoPrazoInclusao,
  prazoNormal,
}: ExcecaoDiaBloqueadoFieldProps) {
  const { data: config } = useMaloteConfig();
  const exigirJustificativa = config?.excecao_exigir_justificativa_solicitante ?? true;
  const prazoNormalFmt = prazoNormal ? new Date(prazoNormal + "T00:00:00").toLocaleDateString("pt-BR") : null;

  return (
    <div className="space-y-2">
      {foraDoPrazoInclusao && !checked && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-amber-800/80 dark:text-amber-300/80">
            A data de pagamento escolhida é mais cedo que o prazo normal de inclusão (regra 1.1
            {prazoNormalFmt && <> — hoje o prazo normal é <span className="font-medium">{prazoNormalFmt}</span></>}
            ). Marque <span className="font-medium">"Lançar como exceção"</span> abaixo para continuar.
          </p>
        </div>
      )}
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <Checkbox checked={checked} onCheckedChange={(c) => onCheckedChange(c === true)} disabled={disabled} />
        <span>
          <span className="font-medium">Lançar como exceção</span>
          <br />
          <span className="text-xs text-muted-foreground">
            Permite escolher uma data de pagamento em dia bloqueado (feriado, recesso ou fim de semana) só pra esta
            despesa — o dia continua bloqueado pra todo o resto. Também obrigatório quando a inclusão acontece fora
            do prazo normal (regra 1.1).
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
