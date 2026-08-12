import { useMemo, useState } from "react";
import { Building2, Check, FileText, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { ContratoOpcao } from "@/hooks/useAgendamentoVeiculos";

interface Props {
  contratos: ContratoOpcao[];
  carregando: boolean;
  selecionados: string[];
  destino: string;
  motivo: string;
  incluirInativos: boolean;
  onAlternar: (id: string) => void;
  onMudar: (v: { destino?: string; motivo?: string }) => void;
  onIncluirInativos: (v: boolean) => void;
}

/**
 * Passo 3 — a que a viagem atende.
 *
 * Vários contratos por reserva porque é assim que a frota roda: um carro sai
 * de Passo Fundo e passa em três unidades no mesmo dia. Guardar isso é o que
 * permite, depois, responder quanto a frota rodou para cada contrato.
 */
export function PassoContratos({
  contratos,
  carregando,
  selecionados,
  destino,
  motivo,
  incluirInativos,
  onAlternar,
  onMudar,
  onIncluirInativos,
}: Props) {
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return contratos;
    return contratos.filter(
      (c) =>
        c.nome.toLowerCase().includes(t) ||
        (c.empresa ?? "").toLowerCase().includes(t),
    );
  }, [contratos, busca]);

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h3 className="text-lg font-bold text-foreground">Contratos atendidos</h3>
        <p className="text-sm text-muted-foreground">
          Marque todos os contratos que esta viagem atende. Pelo menos um é obrigatório.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar contrato..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Inativo fica de fora por padrão: são 141 contra 58 ativos, e a lista
          do dia a dia afundaria. Mas contrato encerrado ainda recebe visita,
          então basta marcar aqui para eles aparecerem. */}
      <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={incluirInativos}
          onChange={(e) => onIncluirInativos(e.target.checked)}
        />
        <span className="text-sm font-medium">Contrato inativo?</span>
        <span className="text-xs text-muted-foreground">
          Mostrar também os contratos inativos
        </span>
      </label>

      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {carregando && <p className="py-6 text-center text-sm text-muted-foreground">Carregando contratos...</p>}
        {!carregando && filtrados.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {busca ? "Nenhum contrato encontrado." : "Nenhum contrato disponível."}
          </p>
        )}
        {filtrados.map((c, i) => {
          const marcado = selecionados.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onAlternar(c.id)}
              className={cn(
                "flex w-full animate-rise-in items-center gap-3 rounded-xl border p-3 text-left transition-all duration-200",
                marcado
                  ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                  : "border-border bg-card hover:border-primary/40 hover:bg-muted/40",
              )}
              style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all",
                  marcado ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
                )}
              >
                {marcado && <Check className="h-3 w-3 animate-check-pop" strokeWidth={3} />}
              </span>
              {c.administrativo
                ? <Building2 className={cn("h-4 w-4 shrink-0", marcado ? "text-primary" : "text-muted-foreground")} />
                : <FileText className={cn("h-4 w-4 shrink-0", marcado ? "text-primary" : "text-muted-foreground")} />}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">{c.nome}</span>
                  {/* Inativo continua agendável, mas sem o selo dava para
                      escolher um contrato morto sem perceber. */}
                  {!c.administrativo && !c.ativo && (
                    <span className="shrink-0 rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                      Inativo
                    </span>
                  )}
                </span>
                {c.administrativo
                  ? <span className="block truncate text-xs text-muted-foreground">Viagem administrativa, sem contrato específico</span>
                  : c.empresa && <span className="block truncate text-xs text-muted-foreground">{c.empresa}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="destino">Destino (opcional)</Label>
          <Input
            id="destino"
            placeholder="Ex.: Passo Fundo / RS"
            value={destino}
            onChange={(e) => onMudar({ destino: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="motivo">Motivo da viagem (opcional)</Label>
          <Textarea
            id="motivo"
            rows={2}
            placeholder="Ex.: visita técnica aos postos"
            value={motivo}
            onChange={(e) => onMudar({ motivo: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
