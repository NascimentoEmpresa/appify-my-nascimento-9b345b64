import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle, Bus, Building, Check, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Coffee, GraduationCap, Loader2, Plug, Plus, Send,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { useEnviarTreinamento, useOpcoesTreinamento, useSolicitacoesTreinamento } from "@/hooks/useSolicitacoesTreinamento";
import {
  CHECKLIST, DECLARACAO, ETAPAS, FORM_VAZIO, MODALIDADES, RECURSOS, STATUS_SOL_TREINAMENTO, VOLTAGENS, errosEtapa, formDaSolicitacao,
  paraEnvio, precisaLocal, primeiraEtapaComErro, progressoChecklist, rotuloStatus, secoesFicha,
  type FormTreinamento, type SolicitacaoTreinamento,
} from "@/lib/treinamentos/solicitacaoTreinamento";
import { DetalheSolicitacaoTreinamento } from "@/components/treinamentos/DetalheSolicitacaoTreinamento";

// =====================================================================
// ENCARREGADOS › SOLICITAR TREINAMENTO (mig 20261026000010, 26/10/2026)
//
// Chamado: "facilitar e padronizar as solicitações feitas pelos
// encarregados, garantindo que o setor de Treinamentos receba todas as
// informações necessárias de forma clara e completa [...] e que o
// encarregado confirme as informações antes do envio". O formulário segue
// o modelo do chamado: 5 etapas (Identificação, Necessidade, Participantes,
// Estrutura com o checklist do local, Confirmação com a declaração).
//
// Abaixo, as solicitações do encarregado com o status; clicar abre a ficha,
// a conversa com Treinamentos e, se Treinamentos devolveu para ajuste, o
// "Corrigir e reenviar". ?s=<id> abre direto (link da notificação).
// Regras das etapas em src/lib/treinamentos/solicitacaoTreinamento.ts — as
// mesmas que o banco confere (trn_sol_validar).
// =====================================================================

const hojeIso = () => new Date().toLocaleDateString("sv-SE");

export default function SolicitarTreinamento() {
  const [params, setParams] = useSearchParams();
  const opcoes = useOpcoesTreinamento();
  const minhas = useSolicitacoesTreinamento({ minhas: true });
  const enviar = useEnviarTreinamento();
  const [aberto, setAberto] = useState(false);
  const [etapa, setEtapa] = useState(1);
  const [f, setF] = useState<FormTreinamento>(FORM_VAZIO);
  const [tentou, setTentou] = useState(false);
  const [reenviarId, setReenviarId] = useState<number | null>(null);
  const [detalhe, setDetalhe] = useState<number | null>(null);
  const set = (p: Partial<FormTreinamento>) => setF((x) => ({ ...x, ...p }));

  const lista = useMemo(() => minhas.data ?? [], [minhas.data]);
  // Sem nenhuma solicitação ainda, o formulário já começa aberto.
  useEffect(() => { if (minhas.data && minhas.data.length === 0 && !params.get("s")) setAberto(true); }, [minhas.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const s = Number(params.get("s")); if (s) setDetalhe(s); }, [params]);
  // Contrato: começa no do encarregado (Hierarquia de Postos), se for um só.
  useEffect(() => {
    const meus = (opcoes.data?.contratos ?? []).filter((c) => c.meu);
    if (aberto && !f.contrato && !reenviarId && meus.length === 1) set({ contrato: `${meus[0].empresa}__${meus[0].filial}`, contrato_nome: meus[0].nome });
  }, [aberto, opcoes.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const erros = errosEtapa(f, etapa);
  const avancar = () => {
    setTentou(true);
    if (erros.length) return;
    setTentou(false);
    setEtapa((e) => Math.min(5, e + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const voltar = () => { setTentou(false); setEtapa((e) => Math.max(1, e - 1)); };
  const irPara = (n: number) => {
    // Só pula para frente se as etapas no caminho estiverem completas.
    const travada = primeiraEtapaComErro(f);
    if (n > etapa && travada != null && travada < n) { setEtapa(travada); setTentou(true); return; }
    setTentou(false); setEtapa(n);
  };
  const recomecar = () => { setF(FORM_VAZIO); setEtapa(1); setTentou(false); setReenviarId(null); };

  const confirmarEnvio = async () => {
    setTentou(true);
    if (errosEtapa(f, 5).length) return;
    try {
      const r = await enviar.mutateAsync({ dados: paraEnvio(f), reenviarId });
      toast.success(reenviarId ? "Solicitação corrigida e reenviada a Treinamentos." : `Solicitação ${r.protocolo ?? ""} enviada a Treinamentos.`);
      recomecar(); setAberto(false); setDetalhe(r.id);
    } catch (e) { toast.error((e as Error).message); }
  };

  const corrigir = (s: SolicitacaoTreinamento) => {
    setDetalhe(null); setF(formDaSolicitacao(s)); setReenviarId(s.id); setEtapa(1); setTentou(false); setAberto(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const fecharDetalhe = () => { setDetalhe(null); if (params.get("s")) { params.delete("s"); setParams(params, { replace: true }); } };
  const solDetalhe = lista.find((s) => s.id === detalhe) ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-1 py-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><GraduationCap className="h-6 w-6 text-primary" /> Solicitar Treinamento</h1>
          <p className="text-sm text-muted-foreground">Peça um treinamento ao setor de Treinamentos com todas as informações para a organização.</p>
        </div>
        {!aberto && <Button onClick={() => { recomecar(); setAberto(true); }}><Plus className="mr-1.5 h-4 w-4" /> Nova solicitação</Button>}
      </div>

      {aberto && (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <ClipboardList className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">{reenviarId ? "Corrigir solicitação de treinamento" : "Nova Solicitação de Treinamento"}</h2>
              <p className="text-xs text-muted-foreground">Preencha as informações para análise e organização do treinamento.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setAberto(false); recomecar(); }}>Fechar</Button>
          </div>

          {/* Etapas */}
          <ol className="mt-5 grid grid-cols-5 gap-1 border-b pb-4">
            {ETAPAS.map((e) => {
              const feita = e.n < etapa;
              const atual = e.n === etapa;
              return (
                <li key={e.n}>
                  <button type="button" onClick={() => irPara(e.n)} className="flex w-full flex-col items-center gap-1">
                    <span className={cn("flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition",
                      atual ? "bg-slate-900 text-white" : feita ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>
                      {feita ? <Check className="h-4 w-4" /> : e.n}
                    </span>
                    <span className={cn("text-center text-[11px]", atual ? "font-semibold text-foreground" : "text-muted-foreground")}>{e.titulo}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          {reenviarId && (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Treinamentos devolveu para ajuste: <b>{lista.find((s) => s.id === reenviarId)?.devolucao_motivo}</b>
            </p>
          )}

          <div className="mt-4 space-y-4">
            <h3 className="font-semibold">{etapa}. {ETAPAS[etapa - 1].subtitulo}</h3>
            {etapa === 1 && <Etapa1 f={f} set={set} opcoes={opcoes.data} carregando={opcoes.isLoading} />}
            {etapa === 2 && <Etapa2 f={f} set={set} />}
            {etapa === 3 && <Etapa3 f={f} set={set} />}
            {etapa === 4 && <Etapa4 f={f} set={set} />}
            {etapa === 5 && <Etapa5 f={f} set={set} nome={opcoes.data?.eu.nome ?? null} />}

            {tentou && erros.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {erros.map((e) => <div key={e}>• {e}</div>)}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" className="rounded-full" onClick={voltar} disabled={etapa === 1}><ChevronLeft className="mr-1 h-4 w-4" /> Voltar</Button>
              {etapa < 5 ? (
                <Button className="rounded-full bg-slate-900 hover:bg-slate-800" onClick={avancar}>Próxima etapa <ChevronRight className="ml-1 h-4 w-4" /></Button>
              ) : (
                <Button className="rounded-full" onClick={confirmarEnvio} disabled={enviar.isPending || !f.confirmado}>
                  {enviar.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                  {reenviarId ? "Reenviar a Treinamentos" : "Enviar a Treinamentos"}
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Minhas solicitações */}
      <Card className="p-4">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><ClipboardCheck className="h-4 w-4" /> Minhas solicitações de treinamento</h2>
        {minhas.isLoading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
          : minhas.error ? <p className="text-sm text-red-600">{(minhas.error as Error).message}</p>
          : lista.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma solicitação ainda.</p>
          : (
            <ul className="divide-y">
              {lista.map((s) => (
                <li key={s.id}>
                  <button onClick={() => setDetalhe(s.id)} className="flex w-full flex-wrap items-center gap-3 py-2.5 text-left hover:bg-muted/30">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.treinamento}</div>
                      <div className="text-xs text-muted-foreground">{s.protocolo} · {s.contrato_nome} · {s.qtd_participantes} participante(s)
                        {s.data_confirmada ? ` · confirmado para ${new Date(`${s.data_confirmada}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}</div>
                    </div>
                    {s.urgencia === "prioritario" && <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Prioritário</Badge>}
                    <Badge variant="outline" className={cn("font-semibold", s.status === "pendente" && s.devolucao_motivo ? "border-orange-300 bg-orange-100 text-orange-800" : STATUS_SOL_TREINAMENTO[s.status].cor)}>
                      {rotuloStatus(s)}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
      </Card>

      <DetalheSolicitacaoTreinamento solicitacao={solDetalhe} lado="encarregado" onFechar={fecharDetalhe} onCorrigir={corrigir} />
    </div>
  );
}

// ── Peças do formulário ─────────────────────────────────────────────────────
type PropsEtapa = { f: FormTreinamento; set: (p: Partial<FormTreinamento>) => void };

function Campo({ rotulo, obrig, dica, children }: { rotulo: string; obrig?: boolean; dica?: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-foreground/80">{rotulo}{obrig && <span className="text-red-500"> *</span>}</label>
      {children}
      {dica && <p className="mt-1 text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

function Opcoes<T extends string | boolean>({ valor, opcoes, onChange, nome }: { valor: T | null | ""; opcoes: { v: T; r: string }[]; onChange: (v: T) => void; nome: string }) {
  return (
    <div role="radiogroup" aria-label={nome} className="flex flex-wrap gap-2">
      {opcoes.map((o) => {
        const sel = valor === o.v;
        return (
          <button key={String(o.v)} type="button" role="radio" aria-checked={sel} onClick={() => onChange(o.v)}
            className={cn("inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition",
              sel ? "border-slate-900 bg-slate-900 text-white" : "hover:border-slate-400")}>
            <span className={cn("h-3.5 w-3.5 rounded-full border-2", sel ? "border-white bg-white/30" : "border-slate-300")} />{o.r}
          </button>
        );
      })}
    </div>
  );
}
const SIM_NAO: { v: boolean; r: string }[] = [{ v: true, r: "Sim" }, { v: false, r: "Não" }];

function Etapa1({ f, set, opcoes, carregando }: PropsEtapa & { opcoes?: { eu: { nome: string | null }; contratos: { empresa: number; filial: number; nome: string; meu: boolean }[] }; carregando: boolean }) {
  return (
    <div className="space-y-4">
      <Campo rotulo="Nome do solicitante" obrig dica="Vem do seu cadastro — quem envia é o responsável pelas informações.">
        <Input className="rounded-full" value={opcoes?.eu.nome ?? (carregando ? "Carregando…" : "")} disabled />
      </Campo>
      <Campo rotulo="Contrato / Unidade" obrig dica="Os contratos em que você é o responsável aparecem primeiro.">
        <SearchableSelect value={f.contrato} placeholder={carregando ? "Carregando contratos…" : "Selecione o contrato"} searchPlaceholder="Buscar contrato…"
          triggerClassName="rounded-full"
          options={(opcoes?.contratos ?? []).map((c) => ({ value: `${c.empresa}__${c.filial}`, label: c.nome, hint: c.meu ? "seu contrato" : undefined }))}
          onChange={(v) => set({ contrato: v, contrato_nome: opcoes?.contratos.find((c) => `${c.empresa}__${c.filial}` === v)?.nome ?? "" })} />
      </Campo>
    </div>
  );
}

function Etapa2({ f, set }: PropsEtapa) {
  return (
    <div className="space-y-4">
      <Campo rotulo="Qual treinamento está solicitando?" obrig>
        <Input className="rounded-full" value={f.treinamento} maxLength={200} placeholder="Ex.: NR-35, Integração, Uso de EPIs" onChange={(e) => set({ treinamento: e.target.value })} />
      </Campo>
      <Campo rotulo="Por que esse treinamento é necessário?" obrig>
        <Textarea rows={3} value={f.motivo} placeholder="Ex.: Colaboradores precisam de orientação para executar uma nova atividade com segurança." onChange={(e) => set({ motivo: e.target.value })} />
      </Campo>
      <Campo rotulo="O que você espera que os colaboradores aprendam?">
        <Textarea rows={2} value={f.objetivo} placeholder="Ex.: Realizar corretamente os procedimentos e evitar acidentes." onChange={(e) => set({ objetivo: e.target.value })} />
      </Campo>
      <Campo rotulo="Quais assuntos precisam ser abordados?" obrig>
        <Textarea rows={3} value={f.assuntos} placeholder="Descreva os procedimentos, dificuldades e situações práticas que precisam ser explicados." onChange={(e) => set({ assuntos: e.target.value })} />
      </Campo>
    </div>
  );
}

function Etapa3({ f, set }: PropsEtapa) {
  return (
    <div className="space-y-4">
      <Campo rotulo="Quantidade de colaboradores" obrig>
        <Input className="rounded-full" type="number" min={1} max={5000} inputMode="numeric" value={f.qtd_participantes} placeholder="Ex.: 25"
          onChange={(e) => set({ qtd_participantes: e.target.value.replace(/\D/g, "") })} />
      </Campo>
      <Campo rotulo="Qual equipe participará?">
        <Input className="rounded-full" value={f.equipe} placeholder="Ex.: Equipe de coleta de resíduos" onChange={(e) => set({ equipe: e.target.value })} />
      </Campo>
      <Campo rotulo="Turnos de trabalho dos participantes" dica="O setor de Treinamentos poderá avaliar a necessidade de dividir os participantes em turmas.">
        <Input className="rounded-full" value={f.turnos} placeholder="Ex.: manhã e tarde" onChange={(e) => set({ turnos: e.target.value })} />
      </Campo>
    </div>
  );
}

function Etapa4({ f, set }: PropsEtapa) {
  const local = precisaLocal(f);
  const prog = progressoChecklist(f);
  const alternarRecurso = (v: string) => set({ recursos: f.recursos.includes(v) ? f.recursos.filter((x) => x !== v) : [...f.recursos, v] });
  const icone: Record<string, typeof Building> = {
    "1. Estrutura do local": Building, "2. Equipamentos e infraestrutura": Plug, "3. Espaço para café": Coffee, "4. Transporte e deslocamento": Bus,
  };
  let ultimaSecao = "";
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" /> Atenção — Leia antes de preencher</p>
        <p className="mt-1">É fundamental que todas as respostas sejam <b>verificadas e confirmadas antes do envio da solicitação</b>.
          O setor de Treinamentos utilizará as informações para elaborar o ofício e organizar a estrutura, os equipamentos e a logística do treinamento.</p>
        <p className="mt-1"><b>O encarregado é responsável pela veracidade das informações prestadas.</b> Dados incorretos ou incompletos poderão comprometer o planejamento e a realização das atividades.</p>
      </div>

      <Campo rotulo="Modalidade desejada" obrig>
        <Opcoes nome="Modalidade" valor={f.modalidade} opcoes={MODALIDADES} onChange={(v) => set({ modalidade: v })} />
      </Campo>
      {local && (
        <Campo rotulo="Local do treinamento" obrig dica="Local e endereço completo (ex.: sede ou o próprio contrato).">
          <Input className="rounded-full" value={f.local_treinamento} placeholder="Ex.: Campus Centro — Av. Paulo Gama, 110 — Porto Alegre" onChange={(e) => set({ local_treinamento: e.target.value })} />
        </Campo>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Data prevista" obrig>
          <Input className="rounded-full" type="date" min={hojeIso()} value={f.data_preferencial} onChange={(e) => set({ data_preferencial: e.target.value })} />
        </Campo>
        <Campo rotulo="Horário de início" obrig>
          <Input className="rounded-full" type="time" value={f.horario_inicio} onChange={(e) => set({ horario_inicio: e.target.value })} />
        </Campo>
        <Campo rotulo="Horário de término" obrig>
          <Input className="rounded-full" type="time" value={f.horario_fim} onChange={(e) => set({ horario_fim: e.target.value })} />
        </Campo>
      </div>
      <Campo rotulo="Prazo ou urgência" obrig>
        <Opcoes nome="Urgência" valor={f.urgencia} onChange={(v) => set({ urgencia: v })}
          opcoes={[{ v: "programavel", r: "Programável" }, { v: "prioritario", r: "Prioritário — justificar nas observações" }]} />
      </Campo>
      <Campo rotulo="Recursos necessários">
        <div className="grid gap-2 sm:grid-cols-2">
          {RECURSOS.map((r) => (
            <label key={r.v} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40">
              <Checkbox checked={f.recursos.includes(r.v)} onCheckedChange={() => alternarRecurso(r.v)} /> {r.r}
            </label>
          ))}
        </div>
      </Campo>

      {local && (
        <div className="rounded-lg border">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Checklist do local</span>
            <Badge variant="secondary">{prog.respondidas} de {prog.total} respostas</Badge>
          </div>
          <div className="h-1 bg-muted"><div className="h-1 bg-emerald-500 transition-all" style={{ width: `${(prog.respondidas / prog.total) * 100}%` }} /></div>
          <div className="space-y-4 p-3">
            {CHECKLIST.map((c) => {
              const I = icone[c.secao] ?? Building;
              const titulo = c.secao !== ultimaSecao ? c.secao : null;
              ultimaSecao = c.secao;
              return (
                <div key={String(c.campo)} className="space-y-1.5">
                  {titulo && <p className="flex items-center gap-1.5 border-t pt-3 text-sm font-semibold first:border-t-0 first:pt-0"><I className="h-4 w-4" /> {titulo}</p>}
                  <p className="text-sm">{c.pergunta} <span className="text-red-500">*</span></p>
                  <Opcoes nome={c.pergunta} valor={f[c.campo] as boolean | null} opcoes={SIM_NAO} onChange={(v) => set({ [c.campo]: v } as Partial<FormTreinamento>)} />
                  {c.campo === "tem_sala" && (
                    <div className="pt-2">
                      <p className="mb-1.5 text-sm">Qual é a voltagem das tomadas disponíveis? <span className="text-red-500">*</span></p>
                      <Opcoes nome="Voltagem" valor={f.voltagem} opcoes={VOLTAGENS} onChange={(v) => set({ voltagem: v })} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Campo rotulo="Observações adicionais" obrig={f.urgencia === "prioritario"}>
        <Textarea rows={3} value={f.observacoes} placeholder="Restrições operacionais, urgência, outras necessidades e informações para a elaboração do ofício."
          onChange={(e) => set({ observacoes: e.target.value })} />
      </Campo>
    </div>
  );
}

function Etapa5({ f, set, nome }: PropsEtapa & { nome: string | null }) {
  const ficha = secoesFicha({ ...f, qtd_participantes: Number(f.qtd_participantes) || 0, voltagem: f.voltagem || null, solicitante_nome: nome });
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="text-xs text-muted-foreground">Resumo da solicitação</p>
        <p className="mb-2 text-lg font-semibold">{f.treinamento || "Tema não informado"}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {ficha.map((sec) => (
            <div key={sec.titulo}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{sec.titulo}</p>
              <dl className="space-y-0.5 text-sm">
                {sec.itens.map(([r, v]) => <div key={r}><dt className="inline text-muted-foreground">{r}: </dt><dd className="inline whitespace-pre-wrap">{v}</dd></div>)}
              </dl>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border p-4">
        <p className="font-semibold">Confirmação de responsabilidade</p>
        <p className="mt-1 text-sm text-muted-foreground">{DECLARACAO}</p>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox checked={f.confirmado} onCheckedChange={(v) => set({ confirmado: v === true })} /> Confirmo a veracidade das informações fornecidas.
        </label>
      </div>
    </div>
  );
}
