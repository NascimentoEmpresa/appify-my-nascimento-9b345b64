/**
 * SIS-2026-0559 — bloco do topo da Implantação de Contratos.
 *
 * Os 11 itens do checklist que já existem na Capa de Edital / Grade de
 * Licitações sobem pra cá preenchidos, e o usuário só confirma. Confirmar grava
 * a resposta em `checklist_respostas` pela mesma mutation de sempre — não há
 * coluna nem tabela nova, e o item passa a contar no progresso geral.
 *
 * O 12º bloco é o Nome do contrato, que absorve o banner âmbar "O nome do
 * contrato está correto?" que ficava solto acima da barra de progresso.
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Building2, CalendarClock, CalendarDays, CheckCircle2, CircleDollarSign,
  Clock, FileSignature, FileText, Map as MapIcon, MapPin, Pencil, User, Users, X,
} from "lucide-react";
import {
  CAMPOS_ORIGEM, ROTULO_FONTE, valorFormatado,
  type CampoOrigem, type OrigemContrato,
} from "@/lib/implantacao/camposOrigem";
import type { Resposta } from "@/hooks/useImplantacao";

const ICONES: Record<number, typeof FileText> = {
  31: CalendarDays,
  49: CalendarClock,
  51: FileText,
  52: Clock,
  53: MapPin,
  54: FileSignature,
  55: Building2,
  56: User,
  58: MapIcon,
  61: CircleDollarSign,
  62: Users,
};

interface Props {
  contratoNome: string;
  origem: OrigemContrato | null;
  carregando: boolean;
  respostaMap: Record<number, Resposta>;
  onSalvar: (rowIndex: number, resposta: string) => Promise<unknown>;
  nomeConfirmado: boolean;
  onConfirmarNome: () => void;
  onEditarNome: () => void;
}

export function PainelOrigemContrato({
  contratoNome, origem, carregando, respostaMap,
  onSalvar, nomeConfirmado, onConfirmarNome, onEditarNome,
}: Props) {
  const [confirmandoTodos, setConfirmandoTodos] = useState(false);

  /** Campos com valor na origem e ainda sem resposta — os que o "Confirmar todos" pega. */
  const pendentes = useMemo(
    () =>
      CAMPOS_ORIGEM.filter(
        (c) => !!valorFormatado(c, origem) && !respostaMap[c.rowIndex]?.resposta
      ),
    [origem, respostaMap]
  );

  const confirmados = CAMPOS_ORIGEM.filter((c) => !!respostaMap[c.rowIndex]?.resposta).length;

  async function confirmarTodos() {
    setConfirmandoTodos(true);
    try {
      // Sequencial de propósito: a mutation lê a resposta atual pra empurrar no
      // histórico antes de gravar. Em paralelo, as leituras se atropelariam.
      for (const campo of pendentes) {
        await onSalvar(campo.rowIndex, valorFormatado(campo, origem));
      }
    } finally {
      setConfirmandoTodos(false);
    }
  }

  return (
    <section className="card-elevated space-y-3 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-sm font-bold">Dados do processo</h2>
          <p className="text-xs text-muted-foreground">
            Já preenchidos pela Capa de Edital e pela Grade de Licitações — confira e confirme.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {confirmados}/{CAMPOS_ORIGEM.length} confirmados
          </span>
          {pendentes.length > 0 && (
            <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={confirmandoTodos} onClick={confirmarTodos}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              {confirmandoTodos ? "Confirmando…" : `Confirmar todos (${pendentes.length})`}
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        <BlocoNome
          nome={contratoNome}
          confirmado={nomeConfirmado}
          onConfirmar={onConfirmarNome}
          onEditar={onEditarNome}
        />
        {CAMPOS_ORIGEM.map((campo) => (
          <BlocoOrigem
            key={campo.rowIndex}
            campo={campo}
            valorOrigem={valorFormatado(campo, origem)}
            respostaSalva={respostaMap[campo.rowIndex]?.resposta ?? ""}
            carregando={carregando}
            onSalvar={(v) => onSalvar(campo.rowIndex, v)}
          />
        ))}
      </div>
    </section>
  );
}

// ── Bloco de um campo ────────────────────────────────────────────────────────

function BlocoOrigem({
  campo, valorOrigem, respostaSalva, carregando, onSalvar,
}: {
  campo: CampoOrigem;
  valorOrigem: string;
  respostaSalva: string;
  carregando: boolean;
  onSalvar: (valor: string) => Promise<unknown>;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [salvando, setSalvando] = useState(false);

  const Icone = ICONES[campo.rowIndex] ?? FileText;
  const confirmado = !!respostaSalva;
  const temOrigem = !!valorOrigem;
  // Já confirmado, mas a Capa/Grade mudou depois (ou o valor foi editado à mão).
  const divergente = confirmado && temOrigem && respostaSalva !== valorOrigem;

  async function salvar(valor: string) {
    const limpo = valor.trim();
    if (!limpo) return;
    setSalvando(true);
    try {
      await onSalvar(limpo);
      setEditando(false);
    } finally {
      setSalvando(false);
    }
  }

  function abrirEdicao() {
    setRascunho(respostaSalva || valorOrigem);
    setEditando(true);
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5 transition-colors",
        confirmado ? "border-l-4 border-l-emerald-500" : "border-border"
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icone className={cn("mt-0.5 h-4 w-4 shrink-0", confirmado ? "text-emerald-600" : "text-muted-foreground")} />

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-muted-foreground">{campo.rotulo}</p>

          {editando ? (
            <div className="mt-1.5 flex gap-1.5">
              <Input
                autoFocus
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") salvar(rascunho);
                  if (e.key === "Escape") setEditando(false);
                }}
                className="h-7 text-xs"
              />
              <Button size="sm" className="h-7 px-2 text-[11px]" disabled={salvando || !rascunho.trim()} onClick={() => salvar(rascunho)}>
                {salvando ? "…" : "Salvar"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => setEditando(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <p
              className={cn(
                "break-words text-sm font-semibold leading-snug",
                !confirmado && !temOrigem && "font-normal italic text-muted-foreground"
              )}
            >
              {respostaSalva ||
                valorOrigem ||
                (carregando ? "carregando…" : `sem dado na ${ROTULO_FONTE[campo.fonte]}`)}
            </p>
          )}

          {divergente && !editando && (
            <button
              onClick={() => salvar(valorOrigem)}
              className="mt-1 text-left text-[10px] text-amber-600 hover:underline"
            >
              {ROTULO_FONTE[campo.fonte]} agora diz “{valorOrigem}” — usar este valor
            </button>
          )}
        </div>

        {!editando && (
          <div className="flex shrink-0 items-center gap-1">
            {confirmado ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : temOrigem ? (
              <Button
                size="sm"
                className="h-7 gap-1 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700"
                disabled={salvando}
                onClick={() => salvar(valorOrigem)}
              >
                <CheckCircle2 className="h-3 w-3" /> Confirmar
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={abrirEdicao}>
                Preencher
              </Button>
            )}
            {(confirmado || temOrigem) && (
              <Button size="sm" variant="ghost" className="h-7 px-1.5" title="Editar" onClick={abrirEdicao}>
                <Pencil className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Bloco do nome do contrato ────────────────────────────────────────────────

/**
 * O "confirmado" do nome mora em localStorage (comportamento que já existia no
 * banner âmbar) — não há `row_index` no checklist pra ele, então não há onde
 * gravar no banco. Some ao trocar de máquina; é o preço de não criar coluna.
 */
function BlocoNome({
  nome, confirmado, onConfirmar, onEditar,
}: {
  nome: string;
  confirmado: boolean;
  onConfirmar: () => void;
  onEditar: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5 transition-colors",
        confirmado ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-amber-400"
      )}
    >
      <div className="flex items-start gap-2.5">
        <FileText className={cn("mt-0.5 h-4 w-4 shrink-0", confirmado ? "text-emerald-600" : "text-amber-500")} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-muted-foreground">Nome do contrato</p>
          <p className="break-words text-sm font-semibold leading-snug">{nome}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {confirmado ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <Button size="sm" className="h-7 gap-1 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700" onClick={onConfirmar}>
              <CheckCircle2 className="h-3 w-3" /> Confirmar
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-1.5" title="Editar nome" onClick={onEditar}>
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
