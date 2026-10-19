// REUNIÕES DE IMPLANTAÇÃO LIGADAS AO CONTRATO — SIS-2026-0599.
//
// Pedido da Helena, trazido pelo Yuri na conversa do chamado: "puxar e
// vincular as informações das reuniões de implantação dos contratos do
// sistema que já existe".
//
// O vínculo é ESCOLHIDO, não adivinhado. As reuniões não guardam contrato
// nenhum: o que as amarra hoje é o nome do contrato escrito no título
// ("REUNIÃO DE IMPLANTAÇÃO DE CONTRATO - IRGA") e `tipo_reuniao` está como
// 'outro' em todas as 7 que existem. Casar por texto acertaria em algumas e
// erraria calado nas outras — por isso a tela só SUGERE (selo "parece deste
// contrato") e quem decide é quem está olhando.
import { useState } from "react";
import { CalendarDays, Link2, Unlink, FileCheck2, Users, ListChecks, Sparkles, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EstadoVazio } from "@/components/suprimentos/dashboard/PainelBase";
import {
  useReunioesDaBase, useReunioesDisponiveis, useVincularReuniao, useDesvincularReuniao, num,
} from "@/hooks/useImplantacaoBase";

const data = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/** Painel do hub: o que já foi vinculado, com o resumo do que aconteceu. */
export function PainelReunioes({ contratoId, podeEditar }: { contratoId: string; podeEditar: boolean }) {
  const [abrindo, setAbrindo] = useState(false);
  const { data: reunioes = [], isLoading } = useReunioesDaBase(contratoId);
  const desvincular = useDesvincularReuniao();

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {reunioes.length ? `${num(reunioes.length)} reunião(ões) vinculada(s)` : "Nenhuma reunião vinculada"}
        </p>
        {podeEditar && (
          <Button size="sm" variant="outline" onClick={() => setAbrindo(true)}>
            <Link2 className="mr-1.5 h-4 w-4" /> Vincular reunião
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-32" />
      ) : !reunioes.length ? (
        <EstadoVazio texto="As reuniões de implantação deste contrato aparecem aqui depois de vinculadas." altura={140} />
      ) : (
        <div className="space-y-2">
          {reunioes.map((r) => (
            <div key={r.vinculo_id} className="rounded-lg border bg-slate-50/60 px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{r.titulo ?? "Sem título"}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {data(r.data_hora)}</span>
                    {r.numero && <span>{r.numero}</span>}
                    {r.etapa && <span className="capitalize">{r.etapa}</span>}
                  </p>
                  {r.observacao && <p className="mt-1 text-xs italic text-slate-500">{r.observacao}</p>}
                </div>
                {podeEditar && (
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Desvincular"
                    onClick={() => desvincular.mutate(r.vinculo_id)}
                  >
                    <Unlink className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Selo icone={<ListChecks className="h-3 w-3" />} texto={`${num(r.qt_pauta)} pauta(s)`} />
                <Selo icone={<FileCheck2 className="h-3 w-3" />} texto={`${num(r.qt_decisoes)} decisão(ões)`} />
                <Selo
                  icone={<ListChecks className="h-3 w-3" />}
                  texto={`${num(r.qt_acoes)} ação(ões)`}
                  alerta={r.qt_acoes_pendentes > 0}
                  sufixo={r.qt_acoes_pendentes ? `${num(r.qt_acoes_pendentes)} pendente(s)` : undefined}
                />
                <Selo icone={<Users className="h-3 w-3" />} texto={`${num(r.qt_participantes)} convidado(s)`} />
                {r.tem_ata && <Selo icone={<FileCheck2 className="h-3 w-3" />} texto="Ata em PDF" ok />}
              </div>
            </div>
          ))}
        </div>
      )}

      <DialogVincular contratoId={contratoId} aberto={abrindo} aoFechar={() => setAbrindo(false)} />
    </>
  );
}

function Selo({ icone, texto, ok, alerta, sufixo }: { icone: React.ReactNode; texto: string; ok?: boolean; alerta?: boolean; sufixo?: string }) {
  const tom = ok
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : alerta
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-slate-200 bg-white text-slate-600";
  return (
    <Badge variant="outline" className={`gap-1 text-[11px] font-medium ${tom}`}>
      {icone} {texto}{sufixo ? ` · ${sufixo}` : ""}
    </Badge>
  );
}

export function DialogVincular({
  contratoId, aberto, aoFechar,
}: {
  contratoId: string;
  aberto: boolean;
  aoFechar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const { data: candidatas = [], isLoading } = useReunioesDisponiveis(aberto ? contratoId : null, busca);
  const vincular = useVincularReuniao();

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Vincular reunião de implantação</DialogTitle>
          <DialogDescription>
            As reuniões não guardam contrato, então o vínculo é seu. O selo "parece deste contrato" é só um palpite
            pelo título — confira antes de vincular.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por título ou número da reunião..." className="pl-8" />
        </div>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {isLoading ? (
            <Skeleton className="h-32" />
          ) : !candidatas.length ? (
            <EstadoVazio texto="Nenhuma reunião disponível para vincular." altura={120} />
          ) : (
            candidatas.map((c) => (
              <div key={c.reuniao_id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-slate-800">
                    {c.titulo ?? "Sem título"}
                    {c.sugerida && (
                      <Badge variant="outline" className="shrink-0 gap-1 border-blue-200 bg-blue-50 text-[10px] text-blue-700">
                        <Sparkles className="h-3 w-3" /> parece deste contrato
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">{c.numero} · {data(c.data_hora)}</p>
                </div>
                <Button
                  size="sm" variant="outline" className="shrink-0"
                  disabled={vincular.isPending}
                  onClick={() => vincular.mutate({ contratoId, reuniaoId: c.reuniao_id })}
                >
                  <Link2 className="mr-1.5 h-4 w-4" /> Vincular
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={aoFechar}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
