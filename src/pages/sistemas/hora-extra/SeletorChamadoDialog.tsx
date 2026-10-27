import { useMemo, useState } from "react";
import { CalendarClock, Link2, Search, UserRound, Zap } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChamadosDisponiveisHoraExtra } from "@/hooks/useHoraExtra";
import { labelDe, MODULOS_ERP, PRIORIDADES, STATUS_CHAMADO, TIPOS } from "@/pages/chamados/types";
import type { ChamadoDisponivel } from "./types";

// 26/10/2026 (mig 20261026000070): "na hora de adicionar o chamado deixa ver
// mais informações como quem solicitou". Cada chamado mostra quem abriu,
// status, prioridade, módulo, tipo, abertura, prazo e o começo da descrição;
// a busca também acha pelo solicitante.
//
// 26/10/2026 (mig 20261026000840): quando NÃO existe chamado para vincular —
// ajuste emergencial direto em produção — a janela oferece "Emergencial, sem
// chamado". É a primeira opção da lista, antes da busca, porque é justamente
// quando a lista de chamados está vazia que ela é procurada.

const dataBR = (iso?: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("pt-BR") : null);

export default function SeletorChamadoDialog({
  aberto,
  aoFechar,
  colaboradorId,
  podeAprovar,
  concluidosDesde,
  ignorar = [],
  aoSelecionar,
  permiteSemChamado = false,
  aoSelecionarSemChamado,
}: {
  aberto: boolean;
  aoFechar: () => void;
  colaboradorId: string;
  podeAprovar: boolean;
  concluidosDesde?: string | null;
  ignorar?: string[];
  aoSelecionar: (chamado: ChamadoDisponivel) => void;
  /** Só na solicitação, e só enquanto nenhum chamado foi adicionado. */
  permiteSemChamado?: boolean;
  aoSelecionarSemChamado?: () => void;
}) {
  const [busca, setBusca] = useState("");
  const { data = [], isLoading } = useChamadosDisponiveisHoraExtra(colaboradorId, concluidosDesde);
  const itens = useMemo(
    () =>
      data.filter(
        (item) =>
          !ignorar.includes(item.id) &&
          `${item.numero} ${item.assunto} ${item.solicitante_nome ?? ""} ${item.setor ?? ""}`.toLowerCase().includes(busca.toLowerCase()),
      ),
    [data, busca, ignorar],
  );
  const escolher = (item: ChamadoDisponivel) => {
    if (!item.responsavel_id) {
      toast.error(
        `O chamado ${item.numero} ainda não foi designado. Designe pelo Painel de Distribuição antes de incluir na HE.`,
      );
      return;
    }
    if (item.responsavel_id !== colaboradorId) {
      const responsavel = item.responsavel_nome || "Usuário não identificado";
      toast.error(`O chamado ${item.numero} já foi designado a outro usuário: ${responsavel}`);
      return;
    }
    aoSelecionar(item);
    aoFechar();
    setBusca("");
  };
  const hoje = new Date().toISOString().slice(0, 10);
  const ofereceSemChamado = permiteSemChamado && !!aoSelecionarSemChamado;
  const escolherSemChamado = () => {
    aoSelecionarSemChamado?.();
    aoFechar();
    setBusca("");
  };
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Adicionar chamado</DialogTitle>
          <DialogDescription>
            Selecione um chamado em aberto já designado ao colaborador
            {ofereceSemChamado ? " — ou, se o ajuste é emergencial e não tem chamado, use a opção abaixo." : "."}
          </DialogDescription>
        </DialogHeader>
        {ofereceSemChamado && (
          <button
            type="button"
            onClick={escolherSemChamado}
            className={cn(
              "flex w-full items-start gap-3 rounded-lg border border-orange-300 bg-orange-50 p-3 text-left",
              "transition-colors hover:border-orange-400 hover:bg-orange-100",
            )}
          >
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange-100 text-orange-600">
              <Zap className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-[#07194b]">Emergencial, sem chamado</span>
              <span className="block text-xs text-slate-600">
                Ajuste em produção ou atendimento emergencial que não tem chamado aberto. A HE segue para
                aprovação como <b className="font-medium">Emergencial</b>, sem chamado vinculado, e a
                justificativa passa a ser o que o gestor vai avaliar.
              </span>
            </span>
          </button>
        )}
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por número, assunto, solicitante ou setor..."
            className="pl-9"
          />
        </div>
        <div className="max-h-[60vh] space-y-2 overflow-auto pr-1">
          {isLoading && <p className="p-8 text-center text-sm">Carregando...</p>}
          {!isLoading && !itens.length && (
            <p className="p-8 text-center text-sm text-slate-500">
              Nenhum chamado encontrado.
              {ofereceSemChamado ? " Se a HE é um ajuste emergencial, use a opção acima." : ""}
            </p>
          )}
          {!isLoading &&
            itens.map((item) => {
              const st = item.status ? STATUS_CHAMADO[item.status] : null;
              const pr = PRIORIDADES[item.prioridade];
              const atrasado = !!item.prazo_previsto && item.prazo_previsto < hoje;
              return (
                <div key={item.id} className="rounded-lg border p-3 transition-colors hover:border-blue-300 hover:bg-blue-50/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="flex items-center gap-1 font-semibold text-blue-700">
                          <Link2 className="h-3.5 w-3.5" />
                          {item.numero}
                        </span>
                        {st && <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", st.cls)}>{st.label}</span>}
                        {pr && <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", pr.cls)}>{pr.label}</span>}
                        {item.tipo_solicitacao && (
                          <span className="rounded-full border px-2 py-0.5 text-[11px] text-slate-600">{labelDe(TIPOS, item.tipo_solicitacao)}</span>
                        )}
                      </div>
                      <p className="mt-1 font-medium text-slate-900">{item.assunto}</p>
                      {item.descricao && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500" title={item.descricao}>{item.descricao}</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <UserRound className="h-3.5 w-3.5 text-slate-400" />
                          Solicitante: <b className="font-medium text-slate-800">{item.solicitante_nome || "—"}</b>
                          {item.setor ? <span className="text-slate-400"> · {item.setor}</span> : null}
                        </span>
                        {item.modulo_sistema && <span>Módulo: <b className="font-medium text-slate-800">{labelDe(MODULOS_ERP, item.modulo_sistema)}</b></span>}
                        {item.aberto_em && <span>Aberto em {dataBR(item.aberto_em)}</span>}
                        {item.prazo_previsto && (
                          <span className={cn("inline-flex items-center gap-1", atrasado && "font-semibold text-red-600")}>
                            <CalendarClock className="h-3.5 w-3.5" />
                            Prazo {dataBR(item.prazo_previsto)}{atrasado ? " (vencido)" : ""}
                          </span>
                        )}
                        {podeAprovar && (
                          <span>
                            Responsável: {item.responsavel_nome || <span className="text-amber-600">Não designado</span>}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => escolher(item)}>
                      Selecionar
                    </Button>
                  </div>
                </div>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
