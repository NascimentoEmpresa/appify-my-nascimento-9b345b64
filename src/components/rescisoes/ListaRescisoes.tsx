import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { corDoStatus, fmtData } from "@/lib/demissao/solicitacao";
import { corStatusRescisao, pagamentoAtrasado, textoProgramadas, type LinhaRescisao } from "@/lib/demissao/rescisao";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A visão "planilha" do módulo Rescisões — a tabela que morava em
 * Solicitações de Demissão (19/10/2026), enquadrada em 8 grupos de colunas
 * (20/10/2026: as 20 colunas da planilha passavam da tela). O clique na
 * linha abre a ficha. O Excel exportado continua com as colunas da planilha.
 */

const EXIBIR_DE_CADA_VEZ = 200;

function DataCelula({ iso, sugerido }: { iso: string | null; sugerido?: boolean }) {
  if (!iso) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("whitespace-nowrap", sugerido && "italic text-muted-foreground")}
      title={sugerido ? "Sugerido pela solicitação / régua da planilha — grave na ficha para confirmar" : undefined}>
      {fmtData(iso)}
    </span>
  );
}

function MeioData({ meio, data, obs }: { meio: string | null; data: string | null; obs: string | null }) {
  if (!meio && !data) return obs ? <span className="text-xs" title={obs}>{obs}</span> : <span className="text-muted-foreground">—</span>;
  return (
    <span className="whitespace-nowrap text-xs" title={obs ?? undefined}>
      {meio ?? "—"}{data ? ` · ${fmtData(data)}` : ""}
    </span>
  );
}

export function ListaRescisoes({ linhas, onAbrir, hoje }: { linhas: LinhaRescisao[]; onAbrir: (l: LinhaRescisao) => void; hoje: string }) {
  const [exibir, setExibir] = useState(EXIBIR_DE_CADA_VEZ);
  useEffect(() => { setExibir(EXIBIR_DE_CADA_VEZ); }, [linhas.length]);

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[1000px] table-fixed text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[20%]">Funcionário</TableHead>
            <TableHead className="w-[16%]">Contrato</TableHead>
            <TableHead className="w-[15%]">Datas</TableHead>
            <TableHead className="w-[15%]">Desligamento</TableHead>
            <TableHead className="w-[11%]">Programadas</TableHead>
            <TableHead className="w-[11%]">Documentos</TableHead>
            <TableHead className="w-[12%]">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.slice(0, exibir).map((l) => {
            const atrasada = pagamentoAtrasado(l, hoje);
            return (
              <TableRow key={l.chave} className="cursor-pointer align-top" onClick={() => onAbrir(l)}>
                <TableCell>
                  <div className="font-medium leading-snug [overflow-wrap:anywhere]">{l.nome}</div>
                  {l.solicitacao ? (
                    <Badge variant="outline" className={cn("mt-0.5 text-[10px]", corDoStatus(l.solicitacao.status))}>
                      #{l.solicitacao.id} · {l.solicitacao.status}
                    </Badge>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">{l.origem === "manual" ? "lançada no sistema" : "importada da planilha"}</span>
                  )}
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {l.empresa ?? "—"} · mat. {l.matricula ?? "—"} · recebido <DataCelula iso={l.recebido} />
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  <div className="[overflow-wrap:anywhere]">{l.contrato ?? "—"}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    por <span className="text-foreground/80">{l.solicitadoPor ?? "—"}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                    <dt className="text-muted-foreground">Aviso</dt><dd><DataCelula iso={l.aviso} sugerido={l.sugerido.aviso} /></dd>
                    <dt className="text-muted-foreground">Últ. dia</dt><dd><DataCelula iso={l.ultimoDia} sugerido={l.sugerido.ultimoDia} /></dd>
                    <dt className="text-muted-foreground">Demissão</dt><dd><DataCelula iso={l.demissao} sugerido={l.sugerido.demissao} /></dd>
                    <dt className="font-medium text-muted-foreground">Pagto.</dt>
                    <dd className={cn("font-semibold", atrasada && "text-red-600")}>
                      <DataCelula iso={l.pagamento} sugerido={l.sugerido.pagamento} />
                      {atrasada && <AlertTriangle className="ml-1 inline h-3 w-3" />}
                    </dd>
                  </dl>
                </TableCell>
                <TableCell className="text-xs">
                  <div className={cn("leading-snug", l.sugerido.tipo && "italic text-muted-foreground")}>{l.tipo ?? "—"}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Homolog.: <span className="text-foreground/80">{l.homologacao ?? "—"}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    SST: {l.sstOk == null ? "—" : l.sstOk ? <span className="font-semibold text-emerald-700">OK</span> : <span className="text-amber-700">Não</span>}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {l.rescisaoProgramada && l.valesProgramados
                    ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Rescisão e vales OK</span>
                    : textoProgramadas(l) || <span className="text-muted-foreground">—</span>}
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Malote:{" "}
                    {l.maloteData ? <span className="text-foreground/80" title={l.maloteObs ?? undefined}>{fmtData(l.maloteData)}</span>
                      : l.maloteObs ? <span className="text-foreground/80">{l.maloteObs}</span> : "—"}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  <div className="text-[11px] text-muted-foreground">Envio</div>
                  <MeioData meio={l.envioMeio} data={l.envioData} obs={l.envioObs} />
                  <div className="mt-1 text-[11px] text-muted-foreground">Retorno</div>
                  <MeioData meio={l.retornoMeio} data={l.retornoData} obs={l.retornoObs} />
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn("whitespace-normal text-left", corStatusRescisao(l.statusRescisao))}>{l.statusRescisao}</Badge>
                  {l.observacao && (
                    <p className="mt-1 line-clamp-3 text-[11px] text-muted-foreground [overflow-wrap:anywhere]" title={l.observacao}>{l.observacao}</p>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {linhas.length > exibir && (
        <div className="mt-3 text-center">
          <Button variant="outline" onClick={() => setExibir((n) => n + EXIBIR_DE_CADA_VEZ)}>
            Mostrar mais ({linhas.length - exibir} restantes)
          </Button>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Datas e tipo em <i>itálico</i> são sugestão (da solicitação, ou pela régua da planilha: trabalhado = último dia + 7; pagamento = demissão + 5) — viram valor quando a ficha é salva.
        Pagamento em <span className="font-semibold text-red-600">vermelho</span>: vencido com a rescisão ainda por fazer.
      </p>
    </div>
  );
}
