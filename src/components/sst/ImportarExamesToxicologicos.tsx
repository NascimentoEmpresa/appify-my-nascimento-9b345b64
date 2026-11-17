import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useImportarToxico, type ResultadoImportacao } from "@/hooks/useExamesToxicologicos";
import { lerPlanilhaToxicologico, linhasParaImportar, type LeituraToxico } from "@/lib/sst/exameToxicologico";

// =====================================================================
// Importar a planilha que o SST usava (SIS-2026-0887). A leitura é no
// navegador e mostra a prévia antes de gravar; o banco casa pelo CPF, só
// preenche o que está vazio e nunca troca uma validade por outra mais velha.
// O arquivo em si não é enviado: só as linhas lidas vão para o banco.
// =====================================================================

export function ImportarExamesToxicologicosDialog({ onFechar }: { onFechar: () => void }) {
  const importar = useImportarToxico();
  const [leitura, setLeitura] = useState<LeituraToxico | null>(null);
  const [responsaveis, setResponsaveis] = useState<Record<string, string>>({});
  const [lendo, setLendo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);

  const ler = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setLendo(true);
    try {
      const l = lerPlanilhaToxicologico(await arquivo.arrayBuffer());
      if (l.linhas.length === 0) throw new Error("Nenhuma aba com as colunas \"Nome do Colaborador\" e \"CPF\" foi encontrada.");
      setLeitura(l);
      setResponsaveis(Object.fromEntries(l.abas.map((a) => [a.nome, a.responsavel])));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLendo(false);
    }
  };

  const envio = leitura ? linhasParaImportar(leitura.linhas, responsaveis) : [];
  const semCpf = leitura?.linhas.filter((l) => !l.cpf) ?? [];
  const comAviso = leitura?.linhas.filter((l) => l.cpf && l.avisos.length > 0) ?? [];
  const confirmar = () => importar.mutateAsync(envio).then(setResultado, (e) => toast.error((e as Error).message));

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar planilha de exames toxicológicos</DialogTitle>
          <DialogDescription>
            Cada linha é ligada ao colaborador pelo CPF. Quem já está no controle só ganha o que estiver em branco, e a validade só é
            trocada por uma mais nova. Pode importar de novo sem medo de desfazer o que já foi digitado.
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <Resultado r={resultado} onFechar={onFechar} />
        ) : !leitura ? (
          <div className="space-y-2">
            <Label htmlFor="tox-planilha">Planilha (.xlsx)</Label>
            <Input id="tox-planilha" type="file" accept=".xlsx,.xls" disabled={lendo} onChange={(e) => ler(e.target.files?.[0])} />
            {lendo && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lendo…</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="font-semibold">{leitura.linhas.length}</span> linha(s) em {leitura.abas.length} aba(s):
              {" "}<span className="font-semibold">{envio.length}</span> com CPF para importar
              {semCpf.length > 0 && <>, <span className="font-semibold text-amber-800">{semCpf.length}</span> sem CPF</>}.
            </p>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Aba</TableHead>
                    <TableHead className="text-right">Linhas</TableHead>
                    <TableHead className="text-right">Não precisam</TableHead>
                    <TableHead className="min-w-56">Responsável pela cobrança</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leitura.abas.map((a) => (
                    <TableRow key={a.nome}>
                      <TableCell className="font-medium">{a.nome}</TableCell>
                      <TableCell className="text-right">{a.linhas}</TableCell>
                      <TableCell className="text-right">{a.naoPrecisam}</TableCell>
                      <TableCell>
                        <Input aria-label={`Responsável da aba ${a.nome}`} value={responsaveis[a.nome] ?? ""} placeholder="Vazio: superior no Organograma"
                          onChange={(e) => setResponsaveis((r) => ({ ...r, [a.nome]: e.target.value }))} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {semCpf.length > 0 && (
              <Aviso titulo="Sem CPF (não serão importados; inclua pela tela com Incluir colaborador)">
                {semCpf.map((l) => `${l.nome} (${l.aba}, linha ${l.linha})`).join("; ")}.
              </Aviso>
            )}
            {comAviso.length > 0 && (
              <Aviso titulo="Ajustes feitos na leitura">
                <ul className="mt-1 list-disc pl-4">
                  {comAviso.map((l) => <li key={`${l.aba}-${l.linha}`}>{l.nome} ({l.aba}, linha {l.linha}): {l.avisos.join("; ")}.</li>)}
                </ul>
              </Aviso>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setLeitura(null)}>Escolher outro arquivo</Button>
              <Button onClick={confirmar} disabled={importar.isPending || envio.length === 0}>
                {importar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Importar {envio.length} linha(s)
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Resultado({ r, onFechar }: { r: ResultadoImportacao; onFechar: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p><span className="font-semibold">{r.criados}</span> incluído(s), <span className="font-semibold">{r.atualizados}</span> completado(s),
          {" "}<span className="font-semibold">{r.sem_mudanca}</span> sem mudança.</p>
      </div>
      {r.nao_encontrados.length > 0 && (
        <Aviso titulo="CPF não encontrado no cadastro de colaboradores">
          {r.nao_encontrados.map((x) => `${x.nome} (${x.aba}, linha ${x.linha})`).join("; ")}.
        </Aviso>
      )}
      {r.erros.length > 0 && (
        <Aviso titulo="Linhas recusadas">
          <ul className="mt-1 list-disc pl-4">{r.erros.map((x) => <li key={`${x.aba}-${x.linha}`}>{x.nome} ({x.aba}, linha {x.linha}): {x.erro}</li>)}</ul>
        </Aviso>
      )}
      <div className="flex justify-end"><Button onClick={onFechar}>Fechar</Button></div>
    </div>
  );
}

const Aviso = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><span className="font-semibold">{titulo}:</span> {children}</div>
  </div>
);
