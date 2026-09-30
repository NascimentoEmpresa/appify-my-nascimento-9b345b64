import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMaloteConfig, useMaloteDiasBloqueados, MaloteConfig, MaloteDiaBloqueado } from "@/hooks/useMaloteConfig";

// SIS-2026-0211 (melhoria visual): antes o usuário só descobria que a data
// escolhida estava bloqueada depois de preencher tudo e tentar salvar (erro
// do trigger do banco). Agora o próprio calendário já desabilita os dias
// bloqueados — mesma regra do malote_dia_esta_bloqueado no banco, calculada
// aqui no client a partir dos mesmos dados (Dias Bloqueados + fim de
// semana), sem duplicar lógica de negócio nova.
function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYMD(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

// Extraída pra função pura (exportada só pra teste) — mesma regra de
// malote_dia_esta_bloqueado(data, classificacao_id) no banco, calculada
// aqui no client a partir dos mesmos dados. `agora` é injetável só pro
// teste não depender do relógio real.
export function diaEstaBloqueado(
  date: Date,
  config: Pick<MaloteConfig, "bloqueio_impedir_lancamento" | "bloqueio_fins_de_semana"> | undefined,
  diasPorData: Map<string, MaloteDiaBloqueado>,
  opts: { permitirDiasBloqueados?: boolean; classificacaoId?: string | null; agora?: Date } = {}
): boolean {
  // SIS-2026-0361 (complemento, achado do Iury na prática): piso absoluto
  // — data anterior a hoje nunca é permitida, nem marcando Exceção
  // (`permitirDiasBloqueados` é sobre pular dia bloqueado/fim de semana,
  // não sobre ir pro passado). Mesma regra do trigger malote_bloqueia_
  // dia_pagamento no banco.
  const hoje = opts.agora ?? new Date();
  hoje.setHours(0, 0, 0, 0);
  if (date < hoje) return true;
  if (opts.permitirDiasBloqueados) return false;
  if (!config?.bloqueio_impedir_lancamento) return false;
  const ymd = toYMD(date);
  const registro = diasPorData.get(ymd);
  if (registro) {
    if (registro.liberado) return false;
    // SIS-2026-0572: tipo "Folha" com classificações liberadas — mesma
    // regra de malote_dia_esta_bloqueado(data, classificacao_id) no banco.
    if (opts.classificacaoId && registro.classificacao_ids.includes(opts.classificacaoId)) return false;
    return true;
  }
  if (config.bloqueio_fins_de_semana) {
    const dow = date.getDay();
    if (dow === 0 || dow === 6) return true;
  }
  return false;
}

interface DiaPagamentoPickerProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  // SIS-2026-0211 (complemento): quando a despesa está marcada como
  // Exceção, ela pode ter data em dia bloqueado — o calendário para de
  // desabilitar essas datas só pra essa escolha.
  permitirDiasBloqueados?: boolean;
  // SIS-2026-0572: classificação da despesa (cabeçalho, não rateio) — um
  // dia bloqueado tipo "Folha" com essa classificação na lista de
  // liberadas deixa de contar como bloqueado só pra essa escolha. Sem
  // classificacaoId (ex. RatearClassificacao, fluxo de rateio), o dia
  // continua bloqueado por inteiro, mesmo padrão de antes.
  classificacaoId?: string | null;
}

export function DiaPagamentoPicker({
  value,
  onChange,
  disabled,
  placeholder = "Selecione a data...",
  permitirDiasBloqueados,
  classificacaoId,
}: DiaPagamentoPickerProps) {
  const { data: config } = useMaloteConfig();
  const { data: diasBloqueados = [] } = useMaloteDiasBloqueados();
  const [open, setOpen] = useState(false);

  const diasPorData = useMemo(() => new Map(diasBloqueados.map((d) => [d.data, d])), [diasBloqueados]);

  const selecionado = parseYMD(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn("w-full justify-start text-left font-normal", !value && "text-muted-foreground")}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          {selecionado ? selecionado.toLocaleDateString("pt-BR") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selecionado}
          onSelect={(date) => {
            if (date) onChange(toYMD(date));
            setOpen(false);
          }}
          disabled={(date) => diaEstaBloqueado(date, config, diasPorData, { permitirDiasBloqueados, classificacaoId })}
          initialFocus
        />
        <p className="px-2 pb-2 text-[11px] text-muted-foreground max-w-[224px]">
          Dias apagados estão bloqueados (feriado, recesso ou fim de semana) — cadastro em Configurações.
        </p>
      </PopoverContent>
    </Popover>
  );
}
