import { useState } from "react";
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useImportarAcidentes, type ResultadoImportacaoAcidentes } from "@/hooks/useAcidentes";
import { lerPlanilhaAcidentes, linhasParaImportar, type LeituraAcidentes } from "@/lib/sst/acidentes";

// =====================================================================
// Importar a planilha de acidentes que o SST usava (SIS-2026-0889). A
// leitura é no navegador; o arquivo não é enviado, só as linhas. Primeiro
// SIMULA (o banco casa nomes e contratos sem gravar), depois grava.
// Reimportar não duplica: a chave é data + nome.
// =====================================================================

export function ImportarAcidentesDialog({ onFechar }: { onFechar: () => void }) {
  const importar = useImportarAcidentes();
  const [leitura, setLeitura] = useState<LeituraAcidentes | null>(null);
  const [lendo, setLendo] = useState(false);
  const [simulacao, setSimulacao] = useState<ResultadoImportacaoAcidentes | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacaoAcidentes | null>(null);

  const ler = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setLendo(true);
    try {
      const l = lerPlanilhaAcidentes(await arquivo.arrayBuffer());
      if (l.linhas.length === 0) throw new Error("A planilha não tem nenhum acidente com nome e data.");
      setLeitura(l);
      setSimulacao(await importar.mutateAsync({ linhas: linhasParaImportar(l.linhas), simular: true }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLendo(false);
    }
  };

  const gravar = () => leitura && importar.mutateAsync({ linhas: linhasParaImportar(leitura.linhas), simular: false })
    .then(setResultado, (e) => toast.error((e as Error).message));
  const comAviso = leitura?.linhas.filter((l) => l.avisos.length > 0) ?? [];
  const recomecar = () => { setLeitura(null); setSimulacao(null); };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar planilha de acidentes</DialogTitle>
          <DialogDescription>
            Escolha a "PLANILHA DE ACIDENTES.xlsx". Antes de gravar, o sistema mostra o que vai acontecer com cada linha.
            Os acidentes antigos entram como concluídos. Pode importar de novo: o que já entrou não se repete.
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-4">
            <Caixa tom="ok" icone={<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}>
              <span className="font-semibold">{resultado.criados}</span> acidente(s) importado(s)
              {resultado.ja_existiam > 0 && <>, <span className="font-semibold">{resultado.ja_existiam}</span> já estavam no sistema</>}
              {resultado.em_aberto > 0 && <>, <span className="font-semibold">{resultado.em_aberto}</span> ficaram em aberto (CAT "SIM" sem número)</>}.
            </Caixa>
            <Detalhes r={resultado} />
            <div className="flex justify-end"><Button onClick={onFechar}>Fechar</Button></div>
          </div>
        ) : !leitura || !simulacao ? (
          <div className="space-y-2">
            <Label htmlFor="acid-planilha">Planilha (.xlsx)</Label>
            <Input id="acid-planilha" type="file" accept=".xlsx,.xls" disabled={lendo} onChange={(e) => ler(e.target.files?.[0])} />
            {lendo && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lendo e simulando…</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <Caixa tom="info" icone={<FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />}>
              <span className="font-semibold">Simulação — nada foi gravado ainda.</span> Aba "{leitura.aba}": {leitura.linhas.length} acidente(s) lido(s).
              {" "}Ao importar: <span className="font-semibold">{simulacao.criados}</span> novo(s)
              {simulacao.ja_existiam > 0 && <>, {simulacao.ja_existiam} já no sistema (não repetem)</>};
              {" "}<span className="font-semibold">{simulacao.ligados}</span> ligado(s) a um colaborador
              {simulacao.sem_vinculo.length > 0 && <>, <span className="font-semibold">{simulacao.sem_vinculo.length}</span> sem vínculo</>}
              {simulacao.em_aberto > 0 && <>; {simulacao.em_aberto} vão ficar em aberto (CAT "SIM" sem número)</>}.
            </Caixa>
            <Detalhes r={simulacao} />
            {leitura.ignoradas.length > 0 && (
              <Caixa tom="aviso" icone={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}>
                <span className="font-semibold">Linhas que não entram:</span>{" "}
                {leitura.ignoradas.map((l) => `${l.nome} (linha ${l.linha}: ${l.motivo})`).join("; ")}.
              </Caixa>
            )}
            {comAviso.length > 0 && (
              <Caixa tom="aviso" icone={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}>
                <span className="font-semibold">Ajustes feitos na leitura:</span>
                <ul className="mt-1 list-disc pl-4">
                  {comAviso.map((l) => <li key={l.linha}>{l.nome} (linha {l.linha}): {l.avisos.join("; ")}.</li>)}
                </ul>
              </Caixa>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={recomecar}>Escolher outro arquivo</Button>
              <Button onClick={gravar} disabled={importar.isPending || simulacao.criados === 0}>
                {importar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Importar {simulacao.criados} acidente(s)
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Detalhes({ r }: { r: ResultadoImportacaoAcidentes }) {
  return (
    <>
      {r.sem_vinculo.length > 0 && (
        <Caixa tom="aviso" icone={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}>
          <span className="font-semibold">Sem vínculo com colaborador</span> (entram mesmo assim; ligue pela tela, no filtro "Só sem vínculo"):{" "}
          {r.sem_vinculo.map((x) => `${x.nome} (linha ${x.linha}${x.motivo === "homonimo" ? ", mais de um colaborador com esse nome" : ", nome não encontrado"})`).join("; ")}.
        </Caixa>
      )}
      {r.contratos_sem_casar.length > 0 && (
        <Caixa tom="aviso" icone={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}>
          <span className="font-semibold">Contratos que não bateram com o cadastro</span> (fica o nome escrito na planilha): {r.contratos_sem_casar.join("; ")}.
        </Caixa>
      )}
      {r.erros.length > 0 && (
        <Caixa tom="erro" icone={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}>
          <span className="font-semibold">Linhas recusadas:</span>
          <ul className="mt-1 list-disc pl-4">{r.erros.map((x) => <li key={`${x.linha}-${x.nome}`}>{x.nome} (linha {x.linha}): {x.erro}</li>)}</ul>
        </Caixa>
      )}
    </>
  );
}

const TONS = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900",
  info: "border-sky-300 bg-sky-50 text-sky-900",
  aviso: "border-amber-300 bg-amber-50 text-amber-900",
  erro: "border-red-300 bg-red-50 text-red-900",
};
const Caixa = ({ tom, icone, children }: { tom: keyof typeof TONS; icone: React.ReactNode; children: React.ReactNode }) => (
  <div className={`flex gap-2 rounded-lg border p-3 text-sm ${TONS[tom]}`}>{icone}<div>{children}</div></div>
);
