import { useEffect, useState } from "react";
import { db } from "./db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, History } from "lucide-react";
import { nomeCampo, valorCampo, fmtDataHora } from "./dossie";
import type { Evento } from "./metricas";

// =====================================================================
// O histórico do procedimento.
//
// Sai de CANAL_DENUNCIA_EVENTO, que é escrita por gatilho: a aplicação tem
// SELECT e nada mais na tabela. É isso que o requisito "evitar exclusão ou
// alteração silenciosa" pede — e o motivo de não haver botão nenhum aqui.
//
// Desde a 20260914000002 a trilha cobre a ficha INTEIRA, não os quatro
// campos de antes. Um caso muito trabalhado gera dezenas de linhas, por isso
// a lista começa recolhida nas 12 mais recentes.
// =====================================================================

const PRIMEIRAS = 12;

export function HistoricoDenuncia({ denunciaId }: { denunciaId: string }) {
  const [itens, setItens] = useState<Evento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [tudo, setTudo] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await db.from("CANAL_DENUNCIA_EVENTO")
        .select("*").eq("denuncia_id", denunciaId).order("created_at", { ascending: false });
      if (!vivo) return;
      setItens((data ?? []) as Evento[]);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [denunciaId]);

  if (carregando) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!itens.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Nada registrado ainda — o histórico começa na primeira alteração da ficha.
      </p>
    );
  }

  const visiveis = tudo ? itens : itens.slice(0, PRIMEIRAS);

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {visiveis.map((e) => (
          <li key={e.id} className="rounded-md border p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs font-semibold">{nomeCampo(e.campo)}</span>
              {e.campo === "status" && (
                <Badge variant="outline" className="text-[10px]">situação</Badge>
              )}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-muted-foreground line-through decoration-muted-foreground/40">
                {valorCampo(e.campo, e.de)}
              </span>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="font-medium">{valorCampo(e.campo, e.para)}</span>
            </p>
            {e.justificativa && (
              <p className="mt-1 border-l-2 border-warning/50 pl-2 text-xs italic text-muted-foreground">
                {e.justificativa}
              </p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              {e.por_nome ?? "sistema"} · {fmtDataHora(e.created_at)}
            </p>
          </li>
        ))}
      </ul>

      {itens.length > PRIMEIRAS && (
        <Button variant="ghost" size="sm" onClick={() => setTudo((v) => !v)}>
          {tudo ? "Mostrar menos" : `Ver as ${itens.length - PRIMEIRAS} anteriores`}
        </Button>
      )}
    </div>
  );
}
