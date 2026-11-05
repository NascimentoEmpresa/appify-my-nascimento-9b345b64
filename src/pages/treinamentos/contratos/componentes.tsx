import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  useSalvarTreinamento, useSolicitacoesDoContrato,
  type ArquivoContrato, type AvaliacaoContrato, type ParticipanteContrato, type SatisfacaoContrato,
  type TreinamentoContrato, type TreinamentoContratoInput,
} from "@/hooks/useTreinamentosContrato";
import {
  NOTA_MINIMA_PADRAO, calcularIndicadores, fmtDataBr, fmtHora, fmtNota, fmtPct, formatarCpf, horasEntre,
  lerAvaliacoes, lerSatisfacao, mediasPorPergunta, siglaEmpresa,
  type AvaliacaoLida, type ResultadoLeitura, type SatisfacaoLida,
} from "@/lib/treinamentos/contratoTreinamento";

export const MENU_TRN_CONTRATOS = "treinamentos_contratos";

export function Kpi({ icone: Icone, rotulo, valor, dica, cor }: { icone: any; rotulo: string; valor: string | number; dica?: string; cor: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-3">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", cor)}><Icone className="h-4 w-4" /></div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{rotulo}</p>
          <p className="text-xl font-semibold leading-tight">{valor}</p>
          {dica && <p className="truncate text-[11px] text-muted-foreground">{dica}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Formulário do treinamento ────────────────────────────────────────────
interface FormProps {
  aberto: boolean;
  onFechar: () => void;
  contrato: { empresa: number; filial: number; nome: string };
  editando?: TreinamentoContrato | null;
  onSalvo?: (id: number) => void;
}

const vazio = (c: FormProps["contrato"]): TreinamentoContratoInput => ({
  empresa: c.empresa, filial: c.filial, contrato_nome: c.nome, nome: "", tema: "", data: new Date().toISOString().slice(0, 10),
  horario_inicio: "", horario_fim: "", carga_horaria: null, responsavel: "", local: "", observacoes: "", solicitacao_id: null,
});

export function TreinamentoFormDialog({ aberto, onFechar, contrato, editando, onSalvo }: FormProps) {
  const salvar = useSalvarTreinamento();
  const [f, setF] = useState<TreinamentoContratoInput>(vazio(contrato));
  const sols = useSolicitacoesDoContrato(contrato.empresa, contrato.filial, aberto && !editando);

  useEffect(() => {
    if (!aberto) return;
    setF(editando ? { ...editando, horario_inicio: fmtHora(editando.horario_inicio), horario_fim: fmtHora(editando.horario_fim) } : vazio(contrato));
  }, [aberto, editando, contrato.empresa, contrato.filial, contrato.nome]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof TreinamentoContratoInput>(k: K, v: TreinamentoContratoInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const horasSugeridas = horasEntre(f.horario_inicio, f.horario_fim);

  const usarSolicitacao = (id: number) => {
    const s = (sols.data ?? []).find((x) => x.id === id);
    if (!s) return;
    setF((x) => ({
      ...x, solicitacao_id: s.id, nome: s.treinamento, tema: s.assuntos ?? x.tema, local: s.local_treinamento ?? x.local,
      data: s.data ?? x.data, horario_inicio: fmtHora(s.horario_inicio), horario_fim: fmtHora(s.horario_fim),
      responsavel: s.instrutor ?? x.responsavel, carga_horaria: horasEntre(s.horario_inicio, s.horario_fim) ?? x.carga_horaria,
    }));
  };

  const enviar = async () => {
    if (!f.nome.trim()) return toast.error("Informe o nome do treinamento.");
    if (!f.data) return toast.error("Informe a data.");
    if (f.horario_inicio && f.horario_fim && f.horario_fim <= f.horario_inicio) return toast.error("O horário de término tem que ser depois do início.");
    const limpo = (s: string | null) => (s?.trim() ? s.trim() : null);
    try {
      const id = await salvar.mutateAsync({
        ...f, nome: f.nome.trim(), tema: limpo(f.tema), responsavel: limpo(f.responsavel), local: limpo(f.local), observacoes: limpo(f.observacoes),
        horario_inicio: f.horario_inicio || null, horario_fim: f.horario_fim || null,
        carga_horaria: f.carga_horaria == null || Number.isNaN(Number(f.carga_horaria)) ? horasSugeridas : Number(f.carga_horaria),
      });
      toast.success(editando ? "Treinamento atualizado." : "Treinamento registrado.");
      onFechar();
      onSalvo?.(id);
    } catch (e: any) { toast.error(e?.message ?? "Não foi possível salvar."); }
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar treinamento" : "Registrar treinamento"}</DialogTitle>
          <DialogDescription>{siglaEmpresa(contrato.empresa)} · {contrato.nome}</DialogDescription>
        </DialogHeader>

        {!editando && (sols.data?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-sm">
            <p className="mb-2 font-medium text-indigo-900">Preencher a partir de uma solicitação do encarregado</p>
            <div className="flex flex-wrap gap-2">
              {sols.data!.map((s) => (
                <Button key={s.id} size="sm" variant={f.solicitacao_id === s.id ? "default" : "outline"} onClick={() => usarSolicitacao(s.id)}>
                  {s.protocolo} · {s.treinamento} {s.data ? `· ${fmtDataBr(s.data)}` : ""}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>Nome do treinamento *</Label><Input value={f.nome} onChange={(e) => set("nome", e.target.value)} placeholder="Ex.: NR-35 Trabalho em altura" /></div>
          <div className="sm:col-span-2"><Label>Tema</Label><Input value={f.tema ?? ""} onChange={(e) => set("tema", e.target.value)} placeholder="Assunto abordado" /></div>
          <div><Label>Data *</Label><Input type="date" value={f.data} onChange={(e) => set("data", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Início</Label><Input type="time" value={f.horario_inicio ?? ""} onChange={(e) => set("horario_inicio", e.target.value)} /></div>
            <div><Label>Término</Label><Input type="time" value={f.horario_fim ?? ""} onChange={(e) => set("horario_fim", e.target.value)} /></div>
          </div>
          <div>
            <Label>Carga horária (horas)</Label>
            <Input type="number" min={0} step={0.5} value={f.carga_horaria ?? ""} placeholder={horasSugeridas != null ? String(horasSugeridas) : ""}
              onChange={(e) => set("carga_horaria", e.target.value === "" ? null : Number(e.target.value))} />
            {f.carga_horaria == null && horasSugeridas != null && <p className="mt-1 text-[11px] text-muted-foreground">Em branco usa {horasSugeridas} h, pelos horários.</p>}
          </div>
          <div><Label>Responsável / instrutor</Label><Input value={f.responsavel ?? ""} onChange={(e) => set("responsavel", e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>Local</Label><Input value={f.local ?? ""} onChange={(e) => set("local", e.target.value)} placeholder="Sala, unidade, endereço" /></div>
          <div className="sm:col-span-2"><Label>Observações</Label><Textarea rows={3} value={f.observacoes ?? ""} onChange={(e) => set("observacoes", e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={enviar} disabled={salvar.isPending}>{salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Importar planilha (provinha ou satisfação) ───────────────────────────
export async function lerPlanilha(arquivo: File): Promise<Record<string, unknown>[]> {
  const buf = await arquivo.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const aba = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(aba, { defval: "", raw: true });
}

interface ImportarProps<T> {
  aberto: boolean;
  onFechar: () => void;
  tipo: "avaliacao" | "satisfacao";
  onConfirmar: (itens: T[]) => Promise<void>;
}

export function ImportarPlanilhaDialog<T extends AvaliacaoLida | SatisfacaoLida>({ aberto, onFechar, tipo, onConfirmar }: ImportarProps<T>) {
  const [linhas, setLinhas] = useState<Record<string, unknown>[] | null>(null);
  const [nomeArq, setNomeArq] = useState("");
  const [notaMin, setNotaMin] = useState(NOTA_MINIMA_PADRAO);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { if (!aberto) { setLinhas(null); setNomeArq(""); } }, [aberto]);

  const leitura = useMemo<ResultadoLeitura<any> | null>(() => {
    if (!linhas) return null;
    return tipo === "avaliacao" ? lerAvaliacoes(linhas, notaMin) : lerSatisfacao(linhas);
  }, [linhas, tipo, notaMin]);

  const escolher = async (f: File | undefined) => {
    if (!f) return;
    try { setLinhas(await lerPlanilha(f)); setNomeArq(f.name); }
    catch { toast.error("Não consegui ler a planilha. Use .xlsx, .xls ou .csv."); }
  };

  const confirmar = async () => {
    if (!leitura?.itens.length) return;
    setEnviando(true);
    try { await onConfirmar(leitura.itens as T[]); toast.success(`${leitura.itens.length} resposta(s) importada(s).`); onFechar(); }
    catch (e: any) { toast.error(e?.message ?? "Falha ao importar."); }
    finally { setEnviando(false); }
  };

  const c = leitura?.colunas;
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar planilha — {tipo === "avaliacao" ? "avaliações (provinha)" : "pesquisa de satisfação"}</DialogTitle>
          <DialogDescription>
            Aceita a planilha exportada do Google Forms ou do Excel (.xlsx, .xls, .csv). A primeira linha precisa ser o cabeçalho.
            {tipo === "avaliacao" ? ' Colunas usadas: "Nome", "CPF" (opcional) e "Pontuação"/"Nota" (aceita "8 / 10", "80%" ou "8,5").'
              : " Cada coluna vira uma pergunta; notas de 1 a 5 (ou Ótimo/Bom/Regular/Ruim) entram na média de satisfação (0 a 10)."}
          </DialogDescription>
        </DialogHeader>

        <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-4 hover:bg-muted/40">
          <FileSpreadsheet className="h-6 w-6 text-emerald-600" />
          <span className="text-sm">{nomeArq || "Clique para escolher a planilha"}</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { escolher(e.target.files?.[0]); e.target.value = ""; }} />
        </label>

        {tipo === "avaliacao" && (
          <div className="flex items-center gap-2 text-sm">
            <Label>Nota mínima para aprovação (0 a 10)</Label>
            <Input type="number" className="w-20" min={0} max={10} step={0.5} value={notaMin} onChange={(e) => setNotaMin(Number(e.target.value) || 0)} />
          </div>
        )}

        {leitura && (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              {c?.nome && <Badge variant="secondary">Nome: {c.nome}</Badge>}
              {c?.cpf && <Badge variant="secondary">CPF: {c.cpf}</Badge>}
              {tipo === "avaliacao" && c?.nota && <Badge variant="secondary">Nota: {c.nota}</Badge>}
              {c?.data && <Badge variant="secondary">Data: {c.data}</Badge>}
              {c?.comentario && <Badge variant="secondary">Comentário: {c.comentario}</Badge>}
              <Badge variant="outline">{c?.perguntas.length ?? 0} pergunta(s)</Badge>
            </div>
            {leitura.erros.length > 0 && (
              <div className="max-h-28 overflow-y-auto rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                {leitura.erros.map((e, i) => <p key={i}>• {e}</p>)}
              </div>
            )}
            <p className="font-medium">{leitura.itens.length} resposta(s) prontas para importar. Prévia:</p>
            <div className="max-h-64 overflow-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Linha</TableHead><TableHead>Nome</TableHead>{tipo === "avaliacao" && <TableHead>CPF</TableHead>}<TableHead>Nota</TableHead>{tipo === "avaliacao" && <TableHead>Resultado</TableHead>}</TableRow></TableHeader>
                <TableBody>
                  {leitura.itens.slice(0, 50).map((it: any) => (
                    <TableRow key={it.linha}>
                      <TableCell>{it.linha}</TableCell>
                      <TableCell>{it.nome ?? <span className="text-muted-foreground">anônimo</span>}</TableCell>
                      {tipo === "avaliacao" && <TableCell>{it.cpf ? formatarCpf(it.cpf) : "—"}</TableCell>}
                      <TableCell>{fmtNota(it.nota)}</TableCell>
                      {tipo === "avaliacao" && <TableCell>{it.aprovado == null ? "—" : it.aprovado ? "Aprovado" : "Reprovado"}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={confirmar} disabled={!leitura?.itens.length || enviando}>
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Relatório consolidado de um treinamento (HTML imprimível) ────────────
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function htmlRelatorioTreinamento(d: {
  t: TreinamentoContrato;
  participantes: ParticipanteContrato[];
  arquivos: ArquivoContrato[];
  avaliacoes: AvaliacaoContrato[];
  satisfacao: SatisfacaoContrato[];
  urls: Record<string, string>;
  geradoPor?: string;
}): string {
  const { t } = d;
  const ind = calcularIndicadores(d);
  const fotos = d.arquivos.filter((a) => a.tipo === "foto");
  const listas = d.arquivos.filter((a) => a.tipo === "lista_presenca");
  const perguntas = mediasPorPergunta(d.satisfacao.map((s) => s.respostas ?? {}));
  const comentarios = d.satisfacao.filter((s) => s.comentario).map((s) => s.comentario!);
  const avalPorCpf = new Map(d.avaliacoes.filter((a) => a.cpf).map((a) => [a.cpf, a]));
  const avalPorNome = new Map(d.avaliacoes.map((a) => [a.nome.trim().toUpperCase(), a]));
  const horario = [fmtHora(t.horario_inicio), fmtHora(t.horario_fim)].filter(Boolean).join(" às ");
  const linha = (r: string, v: unknown) => (v == null || v === "" ? "" : `<tr><th>${esc(r)}</th><td>${esc(v)}</td></tr>`);

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório — ${esc(t.nome)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:24px;font-size:12px}
  h1{font-size:20px;margin:0 0 2px} h2{font-size:14px;margin:22px 0 8px;padding-bottom:4px;border-bottom:2px solid #1e3a8a;color:#1e3a8a}
  .sub{color:#475569;margin-bottom:12px} table{width:100%;border-collapse:collapse}
  .dados th{width:170px;text-align:left;color:#475569;font-weight:600;padding:3px 6px;vertical-align:top} .dados td{padding:3px 6px}
  .lista th,.lista td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left} .lista th{background:#f1f5f9}
  .kpis{display:flex;gap:8px;flex-wrap:wrap} .kpi{border:1px solid #cbd5e1;border-radius:6px;padding:8px 12px;min-width:120px}
  .kpi b{display:block;font-size:18px} .kpi span{color:#475569;font-size:11px}
  .fotos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px} .fotos figure{margin:0;break-inside:avoid}
  .fotos img{width:100%;height:170px;object-fit:cover;border-radius:4px;border:1px solid #cbd5e1}
  figcaption{font-size:10px;color:#475569;margin-top:2px} .ok{color:#047857} .nok{color:#b91c1c} .muted{color:#64748b}
  .barra{position:fixed;top:0;left:0;right:0;background:#0f172a;padding:8px;text-align:center}
  .barra button{padding:6px 14px;background:#fff;border:0;border-radius:4px;cursor:pointer;font-weight:600}
  @media print{.barra{display:none} body{margin:12mm} h2{break-after:avoid}}
</style></head><body>
<div class="barra"><button onclick="window.print()">Imprimir / Salvar em PDF</button></div>
<div style="height:36px"></div>
<h1>${esc(t.nome)}</h1>
<div class="sub">${esc(siglaEmpresa(t.empresa))} · ${esc(t.contrato_nome)} · ${esc(fmtDataBr(t.data))}${horario ? ` · ${esc(horario)}` : ""}</div>

<h2>Dados do treinamento</h2>
<table class="dados">
  ${linha("Empresa", siglaEmpresa(t.empresa))}${linha("Contrato", t.contrato_nome)}${linha("Tema", t.tema)}
  ${linha("Data", fmtDataBr(t.data))}${linha("Horário", horario)}
  ${linha("Carga horária", t.carga_horaria != null ? `${String(t.carga_horaria).replace(".", ",")} h` : "")}
  ${linha("Responsável", t.responsavel)}${linha("Local", t.local)}${linha("Observações", t.observacoes)}
</table>

<h2>Resumo</h2>
<div class="kpis">
  <div class="kpi"><b>${ind.participantes}</b><span>Participantes</span></div>
  <div class="kpi"><b>${ind.presentes} (${esc(fmtPct(ind.taxaPresenca))})</b><span>Presentes</span></div>
  <div class="kpi"><b>${esc(fmtNota(ind.notaMedia))}</b><span>Nota média da avaliação</span></div>
  <div class="kpi"><b>${esc(fmtPct(ind.taxaAprovacao))}</b><span>Aprovação (${ind.aprovados}/${ind.avaliacoes})</span></div>
  <div class="kpi"><b>${esc(fmtNota(ind.satisfacaoMedia))}</b><span>Satisfação média (0–10) · ${ind.respostasSatisfacao} resp.</span></div>
</div>

<h2>Participantes e presença</h2>
${d.participantes.length ? `<table class="lista"><thead><tr><th>#</th><th>Nome</th><th>CPF</th><th>Cargo</th><th>Presença</th><th>Nota</th></tr></thead><tbody>
${d.participantes.map((p, i) => {
  const a = (p.cpf && avalPorCpf.get(p.cpf)) || avalPorNome.get(p.nome.trim().toUpperCase());
  return `<tr><td>${i + 1}</td><td>${esc(p.nome)}</td><td>${esc(p.cpf ? formatarCpf(p.cpf) : "")}</td><td>${esc(p.cargo)}</td>
  <td class="${p.presente ? "ok" : "nok"}">${p.presente ? "Presente" : "Ausente"}</td><td>${a ? esc(fmtNota(a.nota)) : "—"}</td></tr>`;
}).join("")}</tbody></table>` : `<p class="muted">Nenhum participante lançado.</p>`}
<p class="muted">Lista de presença assinada: ${listas.length ? listas.map((l) => esc(l.nome_arquivo ?? "arquivo")).join(", ") : "não anexada"}.</p>

<h2>Avaliação (provinha)</h2>
${d.avaliacoes.length ? `<table class="lista"><thead><tr><th>Nome</th><th>CPF</th><th>Acertos</th><th>Nota</th><th>Resultado</th></tr></thead><tbody>
${d.avaliacoes.map((a) => `<tr><td>${esc(a.nome)}</td><td>${esc(a.cpf ? formatarCpf(a.cpf) : "")}</td><td>${a.acertos != null && a.total != null ? `${a.acertos}/${a.total}` : "—"}</td>
<td>${esc(fmtNota(a.nota))}</td><td class="${a.aprovado ? "ok" : a.aprovado === false ? "nok" : ""}">${a.aprovado == null ? "—" : a.aprovado ? "Aprovado" : "Reprovado"}</td></tr>`).join("")}
</tbody></table>` : `<p class="muted">Nenhuma avaliação lançada.</p>`}

<h2>Pesquisa de satisfação</h2>
${d.satisfacao.length ? `${perguntas.length ? `<table class="lista"><thead><tr><th>Pergunta</th><th>Média (0–10)</th><th>Respostas</th></tr></thead><tbody>
${perguntas.map((p) => `<tr><td>${esc(p.pergunta)}</td><td>${esc(fmtNota(p.media))}</td><td>${p.n}</td></tr>`).join("")}</tbody></table>` : ""}
${comentarios.length ? `<p><b>Comentários:</b></p><ul>${comentarios.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}`
  : `<p class="muted">Nenhuma resposta lançada.</p>`}

<h2>Fotos da equipe</h2>
${fotos.length ? `<div class="fotos">${fotos.map((f) => `<figure><img src="${esc(d.urls[f.storage_path] ?? "")}" alt="">
<figcaption>${esc(fmtDataBr(f.data_foto))}${f.legenda ? ` · ${esc(f.legenda)}` : ""}</figcaption></figure>`).join("")}</div>` : `<p class="muted">Nenhuma foto anexada.</p>`}

<p class="muted" style="margin-top:24px">Gerado em ${esc(new Date().toLocaleString("pt-BR"))}${d.geradoPor ? ` por ${esc(d.geradoPor)}` : ""} · ERP Grupo Nascimento</p>
</body></html>`;
}

export function abrirHtml(html: string) {
  const w = window.open("", "_blank");
  if (!w) { toast.error("O navegador bloqueou a janela. Libere pop-ups para este site."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
