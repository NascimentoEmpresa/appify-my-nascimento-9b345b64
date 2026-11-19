import { useState } from "react";
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Caixa } from "@/components/sst/PecasSst";
import { useImportarAsos } from "@/hooks/useAsoHistorico";
import { lerPlanilhaAsos, ROTULO_TIPO_ASO, type LeituraAsos, type ResultadoImportacaoAsos, type TipoAso } from "@/lib/sst/asoHistorico";

// =====================================================================
// Importar a "EXAMES CLINICOS PROTEGE NOVO.xlsm" (SIS-2026-0816). Lida no
// navegador; só as linhas vão ao banco. Primeiro SIMULA — quantos entram,
// quantos atualizam, quem não casou com um colaborador e quantos ativos
// têm o vencimento do periódico corrigido — depois grava. Reimportar não
// duplica: o que mudou na planilha atualiza; o que foi corrigido na tela fica.
// =====================================================================

export function ImportarAsosDialog({ onFechar }: { onFechar: () => void }) {
  const importar = useImportarAsos();
  const [leitura, setLeitura] = useState<LeituraAsos | null>(null);
  const [lendo, setLendo] = useState(false);
  const [simulacao, setSimulacao] = useState<ResultadoImportacaoAsos | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacaoAsos | null>(null);

  const ler = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setLendo(true);
    try {
      const l = lerPlanilhaAsos(await arquivo.arrayBuffer());
      if (l.linhas.length === 0) throw new Error("A planilha não tem nenhum ASO com nome.");
      setLeitura(l);
      setSimulacao(await importar.mutateAsync({ linhas: l.linhas, simular: true }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLendo(false);
    }
  };
  const gravar = () => leitura && importar.mutateAsync({ linhas: leitura.linhas, simular: false })
    .then(setResultado, (e) => toast.error((e as Error).message));

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar planilha de ASOs</DialogTitle>
          <DialogDescription>
            Escolha a planilha de exames clínicos (abas ADMISSIONAL, DEMISSIONAL, PERIÓDICO, TROCA DE FUNÇÃO e RETORNO).
            Antes de gravar, o sistema mostra o que vai acontecer. Pode importar de novo quando a planilha mudar.
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-4">
            <Caixa tom="ok" icone={<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}>
              <b>{resultado.novos.toLocaleString("pt-BR")}</b> ASO(s) importado(s), <b>{resultado.atualizados.toLocaleString("pt-BR")}</b> atualizado(s).
              {" "}O ASO Periódico já conta com eles: <b>{resultado.periodico.ativos_corrigidos.toLocaleString("pt-BR")}</b> colaborador(es) ativo(s) com o último ASO corrigido,
              {" "}<b>{resultado.periodico.deixam_de_vencer.toLocaleString("pt-BR")}</b> deixaram de estar vencidos.
            </Caixa>
            <SemVinculo r={resultado} />
            <div className="flex justify-end"><Button onClick={onFechar}>Fechar</Button></div>
          </div>
        ) : !leitura || !simulacao ? (
          <div className="space-y-2">
            <Label htmlFor="aso-planilha">Planilha (.xlsx / .xlsm)</Label>
            <Input id="aso-planilha" type="file" accept=".xlsx,.xlsm,.xls" disabled={lendo} onChange={(e) => ler(e.target.files?.[0])} />
            {lendo && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lendo e simulando… (planilha grande, pode levar alguns segundos)</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <Caixa tom="info" icone={<FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />}>
              <p className="font-semibold">Simulação — nada foi gravado ainda.</p>
              <ul className="mt-1 list-disc pl-4">
                {leitura.abas.map((a) => (
                  <li key={a.aba}>{a.aba}: {a.lidas.toLocaleString("pt-BR")} linha(s){a.canceladas > 0 && <> ({a.canceladas} cancelada(s) ficam de fora)</>}</li>
                ))}
              </ul>
              <p className="mt-2">
                Ao importar: <b>{simulacao.novos.toLocaleString("pt-BR")}</b> novo(s), <b>{simulacao.atualizados.toLocaleString("pt-BR")}</b> atualizado(s);
                {" "}<b>{simulacao.ligados.toLocaleString("pt-BR")}</b> ligado(s) a um colaborador, <b>{simulacao.sem_vinculo_total.toLocaleString("pt-BR")}</b> sem vínculo.
              </p>
              <p className="mt-1">
                Efeito no ASO Periódico: <b>{simulacao.periodico.ativos_corrigidos.toLocaleString("pt-BR")}</b> ativo(s) com o último ASO corrigido;
                {" "}<b>{simulacao.periodico.deixam_de_vencer.toLocaleString("pt-BR")}</b> deixam de estar vencidos
                {simulacao.periodico.saem_de_proximo > 0 && <> e {simulacao.periodico.saem_de_proximo} saem de "próximo do vencimento"</>}.
              </p>
            </Caixa>
            <SemVinculo r={simulacao} />
            {leitura.ignoradas.length > 0 && (
              <Caixa tom="aviso" icone={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}>
                <b>{leitura.ignoradas.length}</b> linha(s) não entram ({[...new Set(leitura.ignoradas.map((i) => i.motivo))].join("; ")}):{" "}
                {leitura.ignoradas.slice(0, 40).map((i) => `${i.nome} (${i.aba} ${i.linha})`).join("; ")}{leitura.ignoradas.length > 40 && "…"}
              </Caixa>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setLeitura(null); setSimulacao(null); }}>Escolher outro arquivo</Button>
              <Button onClick={gravar} disabled={importar.isPending || simulacao.novos + simulacao.atualizados === 0}>
                {importar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Importar {(simulacao.novos + simulacao.atualizados).toLocaleString("pt-BR")} linha(s)
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SemVinculo({ r }: { r: ResultadoImportacaoAsos }) {
  if (r.sem_vinculo_total === 0) return null;
  const porTipo = Object.entries(r.por_tipo) as [TipoAso, number][];
  return (
    <Caixa tom="aviso" icone={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}>
      <p>
        <b>{r.sem_vinculo_total.toLocaleString("pt-BR")} sem vínculo com colaborador</b> — entram no histórico, mas não mexem no vencimento até
        alguém escolher a pessoa na tela (filtro "Só sem vínculo"). Quase sempre é nome escrito diferente do cadastro, ou candidato que não foi admitido.
      </p>
      <p className="mt-1 text-xs">Lidas por tipo: {porTipo.map(([t, n]) => `${ROTULO_TIPO_ASO[t]} ${n.toLocaleString("pt-BR")}`).join(" · ")}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs font-medium">Ver os primeiros {r.sem_vinculo.length}</summary>
        <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-4 text-xs">
          {r.sem_vinculo.map((x) => (
            <li key={`${x.aba}-${x.linha}`}>{x.nome} ({x.aba}, linha {x.linha}{x.motivo === "homonimo" ? ", mais de um colaborador com esse nome" : ", nome não encontrado"})</li>
          ))}
        </ul>
      </details>
    </Caixa>
  );
}
