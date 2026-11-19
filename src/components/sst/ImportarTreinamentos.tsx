import { useState } from "react";
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Caixa } from "@/components/sst/PecasSst";
import { useImportarTrn } from "@/hooks/useTreinamentosNr";
import {
  lerPlanilhaCronograma, lerPlanilhaPlano, type LinhaCronograma, type LinhaPlano, type ResultadoImportacaoTrn,
} from "@/lib/sst/treinamentosNr";

// =====================================================================
// Importar as planilhas de treinamento do SST (SIS-2026-0816):
//   · plano — "Plano_Treinamentos_Empresas" (a matriz por contrato/função);
//   · cronograma — "CRONOGRAMA DE TREINAMENTOS" (as turmas presenciais).
// Lida no navegador, simula, depois grava. Reimportar não duplica, não
// desfaz correção feita na tela e nunca volta a data do último treinamento.
// =====================================================================

const TEXTO = {
  plano: { titulo: "Importar matriz de treinamentos obrigatórios", arquivo: "Plano_Treinamentos_Empresas (abas HAGG, SN, NH, CANAA)", item: "linha(s) da matriz" },
  cronograma: { titulo: "Importar cronograma de treinamentos", arquivo: "CRONOGRAMA DE TREINAMENTOS", item: "turma(s)" },
};

export function ImportarTreinamentosDialog({ tipo, onFechar }: { tipo: "plano" | "cronograma"; onFechar: () => void }) {
  const importar = useImportarTrn();
  const [linhas, setLinhas] = useState<(LinhaPlano | LinhaCronograma)[] | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [lendo, setLendo] = useState(false);
  const [simulacao, setSimulacao] = useState<ResultadoImportacaoTrn | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacaoTrn | null>(null);
  const t = TEXTO[tipo];

  const ler = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setLendo(true);
    try {
      const dados = await arquivo.arrayBuffer();
      const l = tipo === "plano" ? lerPlanilhaPlano(dados) : lerPlanilhaCronograma(dados);
      if (l.linhas.length === 0) throw new Error("Nenhuma linha com contrato encontrada.");
      setLinhas(l.linhas);
      setAvisos("avisos" in l ? l.avisos : []);
      setSimulacao(await importar.mutateAsync({ tipo, linhas: l.linhas, simular: true }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLendo(false);
    }
  };
  const gravar = () => linhas && importar.mutateAsync({ tipo, linhas, simular: false }).then(setResultado, (e) => toast.error((e as Error).message));

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.titulo}</DialogTitle>
          <DialogDescription>Escolha a planilha "{t.arquivo}". Antes de gravar, o sistema mostra o que vai acontecer.</DialogDescription>
        </DialogHeader>
        {resultado ? (
          <div className="space-y-4">
            <Caixa tom="ok" icone={<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}>
              <b>{resultado.novos}</b> {t.item} nova(s), <b>{resultado.atualizados}</b> atualizada(s).
            </Caixa>
            <SemCasar r={resultado} />
            <div className="flex justify-end"><Button onClick={onFechar}>Fechar</Button></div>
          </div>
        ) : !linhas || !simulacao ? (
          <div className="space-y-2">
            <Label htmlFor="trn-planilha">Planilha (.xlsx)</Label>
            <Input id="trn-planilha" type="file" accept=".xlsx,.xlsm,.xls" disabled={lendo} onChange={(e) => ler(e.target.files?.[0])} />
            {lendo && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lendo e simulando…</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <Caixa tom="info" icone={<FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />}>
              <b>Simulação — nada foi gravado ainda.</b> {simulacao.lidas} {t.item} lida(s): <b>{simulacao.novos}</b> nova(s),
              {" "}<b>{simulacao.atualizados}</b> atualizada(s){simulacao.recusadas > 0 && <>, {simulacao.recusadas} recusada(s)</>}.
            </Caixa>
            <SemCasar r={simulacao} />
            {avisos.length > 0 && (
              <Caixa tom="aviso" icone={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}>
                <ul className="list-disc pl-4">{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
              </Caixa>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setLinhas(null); setSimulacao(null); }}>Escolher outro arquivo</Button>
              <Button onClick={gravar} disabled={importar.isPending || simulacao.novos + simulacao.atualizados === 0}>
                {importar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Importar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SemCasar({ r }: { r: ResultadoImportacaoTrn }) {
  if (!r.contratos_sem_casar.length) return null;
  return (
    <Caixa tom="aviso" icone={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}>
      <b>{r.contratos_sem_casar.length} contrato(s) que não bateram com o cadastro</b> (entram com o nome escrito na planilha;
      dá para escolher o contrato depois, na edição): {r.contratos_sem_casar.join("; ")}.
    </Caixa>
  );
}
