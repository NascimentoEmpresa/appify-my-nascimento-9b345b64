import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BarChart3, FileText, FolderOpen, Lock, Trash2, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useCtrlImportar, useCtrlReunioes, useCtrlVinculos, type ReuniaoParaImportar } from "@/hooks/useReunioesEncarregados";
import { EXTENSOES_ACEITAS, LIMITE_LOTE, lerArquivo } from "@/lib/controladoria/leitorArquivos";
import { extrairFalas, lerCabecalho, lerVinculos, levantamento, separarReunioes } from "@/lib/controladoria/reunioes";
import { MENU_REUNIOES, dataBR } from "./comum";

// =====================================================================
// Reuniões com Encarregados › Importar (mig 20261006000005).
// 1) arquivos ou texto colado → 2) contexto do lote (supervisor, contrato,
// data para quem não tem cabeçalho, equipe, vínculos) → prévia de cada
// reunião com quantos registros a regra achou → importar. O arquivo é lido
// no navegador; só o texto e os registros sugeridos vão para o banco.
// =====================================================================

interface Fonte { nome: string; texto: string | null; erro: string | null }

export default function Importar({ aoImportar }: { aoImportar: () => void }) {
  const { data: reunioes = [] } = useCtrlReunioes();
  const { data: vinculosSalvos = [] } = useCtrlVinculos();
  const importar = useCtrlImportar();
  const input = useRef<HTMLInputElement>(null);
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [lendo, setLendo] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [tituloColado, setTituloColado] = useState("");
  const [textoColado, setTextoColado] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [contrato, setContrato] = useState("");
  const [dataPadrao, setDataPadrao] = useState("");
  const [equipe, setEquipe] = useState("");
  const [vinculosTexto, setVinculosTexto] = useState("");
  const [permitirPdf, setPermitirPdf] = useState(true);
  const [removidas, setRemovidas] = useState<Set<string>>(new Set());

  const equipes = useMemo(() => [...new Set(reunioes.map((r) => r.equipe).filter(Boolean) as string[])].sort(), [reunioes]);

  const adicionar = async (lista: FileList | File[]) => {
    const arquivos = Array.from(lista).slice(0, LIMITE_LOTE - fontes.length);
    if (Array.from(lista).length > arquivos.length) toast.warning(`Até ${LIMITE_LOTE} arquivos por vez — o resto ficou de fora.`);
    setLendo(true);
    const lidas = await Promise.all(arquivos.map(async (f): Promise<Fonte> => {
      try { return { nome: f.name, texto: await lerArquivo(f, permitirPdf), erro: null }; }
      catch (e) { return { nome: f.name, texto: null, erro: (e as Error).message }; }
    }));
    setFontes((x) => [...x, ...lidas]);
    setLendo(false);
  };

  // A prévia: uma linha por reunião (arquivo ou texto colado pode ter várias).
  const previa = useMemo(() => {
    const vinculos = [...vinculosSalvos, ...lerVinculos(vinculosTexto)];
    const blocos: { chave: string; nome: string | null; titulo: string; texto: string }[] = [];
    fontes.forEach((f, i) => f.texto && separarReunioes(f.texto).forEach((t, j, todos) =>
      blocos.push({ chave: `a${i}-${j}`, nome: f.nome, titulo: f.nome.replace(/\.[^.]+$/, "") + (todos.length > 1 ? ` (${j + 1})` : ""), texto: t })));
    if (textoColado.trim()) separarReunioes(textoColado).forEach((t, j, todos) =>
      blocos.push({ chave: `c${j}`, nome: null, titulo: (tituloColado.trim() || "Reunião colada") + (todos.length > 1 ? ` (${j + 1})` : ""), texto: t }));
    return blocos.map((b) => {
      const cab = lerCabecalho(b.texto);
      const falantes = [...new Set(extrairFalas(b.texto).map((f) => f.falante).filter(Boolean) as string[])];
      const registros = levantamento(b.texto, { supervisor, contrato, vinculos });
      const reuniao: ReuniaoParaImportar = {
        titulo: b.titulo, data_reuniao: cab.data ?? (dataPadrao || null), supervisor, contrato, equipe,
        participantes: cab.participantes.length ? cab.participantes : falantes, arquivo_nome: b.nome, texto: b.texto, registros,
      };
      return { chave: b.chave, reuniao };
    });
  }, [fontes, textoColado, tituloColado, supervisor, contrato, dataPadrao, equipe, vinculosTexto, vinculosSalvos]);

  const selecionadas = previa.filter((p) => !removidas.has(p.chave));
  const gerar = async () => {
    if (!selecionadas.length) return toast.error("Selecione arquivos ou cole o texto de uma reunião.");
    try {
      await importar.mutateAsync({ reunioes: selecionadas.map((p) => p.reuniao), vinculos: lerVinculos(vinculosTexto) });
      const n = selecionadas.reduce((s, p) => s + p.reuniao.registros.length, 0);
      toast.success(`${selecionadas.length} reunião(ões) importada(s), ${n} registro(s) para revisar.`);
      setFontes([]); setTextoColado(""); setTituloColado(""); setRemovidas(new Set()); setVinculosTexto("");
      aoImportar();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="space-y-6 p-5">
        <section>
          <h3 className="font-bold">1. Selecione os arquivos ou cole o texto</h3>
          <p className="text-xs text-muted-foreground">TXT, MD, DOCX, VTT e SRT: leitura no navegador · PDF com texto: leitor opcional</p>
          <div
            onDragOver={(e) => { e.preventDefault(); setArrastando(true); }} onDragLeave={() => setArrastando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastando(false); adicionar(e.dataTransfer.files); }}
            className={`mt-3 grid place-items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${arrastando ? "border-primary bg-primary/5" : "border-muted-foreground/25"}`}>
            <span className="grid h-10 w-10 place-items-center rounded-full bg-muted"><Upload className="h-5 w-5 text-primary" /></span>
            <p className="font-semibold">Arraste suas transcrições para cá</p>
            <p className="text-[11px] text-muted-foreground">Até {LIMITE_LOTE} arquivos por vez · 30 MB por arquivo</p>
            <Button size="sm" onClick={() => input.current?.click()} disabled={lendo}><FolderOpen className="mr-1.5 h-4 w-4" /> {lendo ? "Lendo…" : "Selecionar arquivos"}</Button>
            <input ref={input} type="file" multiple accept={EXTENSOES_ACEITAS.join(",")} className="hidden"
              onChange={(e) => { if (e.target.files) adicionar(e.target.files); e.target.value = ""; }} />
          </div>
          {fontes.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {fontes.map((f, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md border px-2 py-1">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{f.nome}</span>
                  {f.erro ? <span className="text-destructive">{f.erro}</span> : <span className="text-muted-foreground">{(f.texto?.length ?? 0).toLocaleString("pt-BR")} caracteres</span>}
                  <button type="button" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setFontes((x) => x.filter((_, j) => j !== i))} aria-label="Remover"><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 flex items-baseline justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Ou cole a transcrição</p>
            <p className="text-[11px] text-muted-foreground">Um cabeçalho "Reunião iniciada em…" por reunião</p>
          </div>
          <div className="mt-2 space-y-2">
            <div><Label className="text-xs">Título do texto colado (opcional)</Label><Input value={tituloColado} onChange={(e) => setTituloColado(e.target.value)} placeholder="Ex.: Reunião operacional — 28/09/2026" /></div>
            <div>
              <Label className="text-xs">Texto da reunião</Label>
              <Textarea rows={6} value={textoColado} onChange={(e) => setTextoColado(e.target.value)}
                placeholder={"Reunião iniciada em 2026-09-28 14:24 GMT-3\nParticipantes\nNome 1, Nome 2\nTranscrição\nNome 1: Relato da reunião…"} />
            </div>
          </div>
        </section>

        <section>
          <h3 className="font-bold">2. Confirme o contexto</h3>
          <p className="text-xs text-muted-foreground">Campos opcionais aplicados a todas as reuniões deste lote.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Supervisor</Label>
              <Input value={supervisor} onChange={(e) => setSupervisor(e.target.value)} placeholder="Ex.: Dickson" />
              <p className="mt-1 text-[11px] text-muted-foreground">As falas do supervisor não entram como reclamação.</p>
            </div>
            <div><Label className="text-xs">Contrato único, se houver</Label><Input value={contrato} onChange={(e) => setContrato(e.target.value)} placeholder="Deixe vazio para reuniões com vários contratos" /></div>
            <div><Label className="text-xs">Data para textos sem cabeçalho</Label><Input type="date" value={dataPadrao} onChange={(e) => setDataPadrao(e.target.value)} /></div>
            <div>
              <Label className="text-xs">Equipe da importação (opcional)</Label>
              <Input value={equipe} onChange={(e) => setEquipe(e.target.value)} placeholder="Ex.: Equipe Dickson" />
              {equipes.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {equipes.map((q) => <button key={q} type="button" onClick={() => setEquipe(q)} className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${equipe === q ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}>{q}</button>)}
                </div>
              )}
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Vínculos dos encarregados · Nome | Contrato | Nome na transcrição (opcional)</Label>
              <Textarea rows={3} value={vinculosTexto} onChange={(e) => setVinculosTexto(e.target.value)}
                placeholder={"Barbara Marques | FURG PORTARIA\nClaudio Rene | CÂMARA RIO GRANDE LIMPEZA | Claudio René Silva Bueno"} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Também aceita "Encarregado Nome - Contrato". Ficam salvos para as próximas importações{vinculosSalvos.length ? ` (${vinculosSalvos.length} já cadastrado(s) em Equipe e contratos)` : ""}. A lista não comprova presença; apenas liga os nomes encontrados.
              </p>
            </div>
            <label className="flex items-start gap-2 text-xs sm:col-span-2">
              <Checkbox checked={permitirPdf} onCheckedChange={(v) => setPermitirPdf(!!v)} className="mt-0.5" />
              <span><b>Permitir baixar o leitor de PDF</b> <span className="text-muted-foreground">quando eu importar um PDF. Só o código da biblioteca PDF.js é baixado (cdnjs); o arquivo da reunião é lido no navegador, sem envio. PDF escaneado sem texto não é suportado.</span></span>
            </label>
          </div>
        </section>

        {previa.length > 0 && (
          <section>
            <h3 className="font-bold">3. Confira antes de importar</h3>
            <div className="mt-2 overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/60 text-left text-muted-foreground">
                  <tr><th className="px-3 py-2 font-medium" /><th className="px-3 py-2 font-medium">Reunião</th><th className="px-3 py-2 font-medium">Data</th><th className="px-3 py-2 text-right font-medium">Participantes</th><th className="px-3 py-2 text-right font-medium">Dificuldades</th><th className="px-3 py-2 text-right font-medium">Dúvidas</th></tr>
                </thead>
                <tbody>
                  {previa.map((p) => {
                    const fora = removidas.has(p.chave);
                    const r = p.reuniao;
                    return (
                      <tr key={p.chave} className={`border-t ${fora ? "opacity-40" : ""}`}>
                        <td className="px-3 py-1.5"><Checkbox checked={!fora} onCheckedChange={(v) => setRemovidas((s) => { const n = new Set(s); v ? n.delete(p.chave) : n.add(p.chave); return n; })} /></td>
                        <td className="px-3 py-1.5 font-medium">{r.titulo}</td>
                        <td className={`px-3 py-1.5 ${r.data_reuniao ? "" : "text-amber-700"}`}>{r.data_reuniao ? dataBR(r.data_reuniao) : "sem data"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.participantes.length}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.registros.filter((x) => x.tipo === "dificuldade").length}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.registros.filter((x) => x.tipo === "duvida").length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {previa.some((p) => !removidas.has(p.chave) && p.reuniao.registros.length === 0) && (
              <p className="mt-1 text-[11px] text-amber-700">Reunião com 0 registros: o texto não tem falas no formato "Nome: fala" ou nenhuma fala cita dificuldade/dúvida com tema conhecido.</p>
            )}
          </section>
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{selecionadas.length} reunião(ões) selecionada(s)</span>
          <AcessoGate menu={MENU_REUNIOES} acao="incluir" fallback={<span className="text-xs text-muted-foreground">Sem a ação de incluir.</span>}>
            <Button onClick={gerar} disabled={importar.isPending || lendo || !selecionadas.length} className="bg-orange-500 hover:bg-orange-600">
              <BarChart3 className="mr-1.5 h-4 w-4" /> {importar.isPending ? "Importando…" : "Gerar dashboard"}
            </Button>
          </AcessoGate>
        </div>
      </Card>

      <Card className="h-fit space-y-4 p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Da transcrição à decisão</p>
        <h3 className="text-xl font-black leading-tight">Um painel que mostra de onde cada registro veio.</h3>
        <div className="h-1 w-10 rounded bg-orange-500" />
        {[
          ["01", "Importar", "Datas, participantes e falas são extraídos do texto. Informação não encontrada fica em aberto."],
          ["02", "Conferir o levantamento", "As regras sugerem tema e tipo de cada registro. Você corrige, valida ou exclui."],
          ["03", "Acompanhar e agir", "Filtre reuniões, crie ações com responsável e prazo e acompanhe no dashboard."],
        ].map(([n, t, d]) => (
          <div key={n} className="flex gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{n}</span>
            <div><p className="text-sm font-semibold">{t}</p><p className="text-xs text-muted-foreground">{d}</p></div>
          </div>
        ))}
        <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          Não há IA nem serviço externo de transcrição: a classificação é por regras e o texto fica só no ERP.
        </div>
        <div>
          <p className="text-sm font-semibold">Antes de importar</p>
          <p className="text-xs text-muted-foreground">Use as transcrições originais. Relatórios prontos, gráficos, imagens e apresentações não devem ser tratados como novas reuniões.</p>
        </div>
      </Card>
    </div>
  );
}
