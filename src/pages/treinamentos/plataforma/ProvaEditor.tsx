import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PROVA_PADRAO, ROTULO_GABARITO, ROTULO_TIPO_PERGUNTA,
  type ModoGabarito, type PerguntaQuiz, type ProvaConfig, type TipoPergunta,
} from "./tipos";

// =====================================================================
// TREINAMENTOS — Prova da aula (editor). 22/09/2026.
//
// "Provas ... após ver o vídeo possa responder e pontuar, podendo repetir
// 3x, deixa bem configurável e customizável" (Pablo). O banco de perguntas
// é TRN_AULA.quiz (formato estendido: tipo, corretas, pontos, explicação) e
// a configuração é TRN_AULA.prova_config — quem corrige, conta tentativa e
// decide o gabarito é o banco (trn_prova_*, migration 205); aqui só se edita.
// =====================================================================

export const novaPergunta = (tipo: TipoPergunta = "unica"): PerguntaQuiz => ({
  id: crypto.randomUUID(), enunciado: "", tipo, pontos: 1, explicacao: "",
  ...(tipo === "vf" ? { opcoes: ["Verdadeiro", "Falso"], correta: 0 } : { opcoes: ["", ""], correta: 0 }),
  ...(tipo === "multipla" ? { corretas: [] } : {}),
});

/** Erro da prova para o toast, ou null se está tudo certo. */
export function erroDaProva(quiz: PerguntaQuiz[], cfg: ProvaConfig): string | null {
  if (!quiz.length) return "A prova precisa de pelo menos uma pergunta.";
  for (const [i, p] of quiz.entries()) {
    const n = `Pergunta ${i + 1}`;
    if (!p.enunciado.trim()) return `${n} sem enunciado.`;
    if (p.opcoes.filter((o) => o.trim()).length < 2 || p.opcoes.some((o) => !o.trim())) return `${n}: preencha as opções (mínimo 2, nenhuma vazia).`;
    if ((p.tipo ?? "unica") === "multipla") {
      if (!p.corretas?.length) return `${n}: marque ao menos uma opção correta.`;
    } else if (p.opcoes[p.correta] == null) return `${n}: marque a opção correta.`;
    if (!(Number(p.pontos ?? 1) > 0)) return `${n}: a pontuação precisa ser maior que zero.`;
  }
  if (cfg.sortear != null && (cfg.sortear < 1 || cfg.sortear > quiz.length)) return `Sortear: escolha de 1 a ${quiz.length} perguntas.`;
  return null;
}

/** Limpa o que vai pro banco (trim, campos que não se aplicam ao tipo). */
export function quizParaSalvar(quiz: PerguntaQuiz[]): PerguntaQuiz[] {
  return quiz.map((p) => {
    const tipo = p.tipo ?? "unica";
    const corretas = [...(p.corretas ?? [])].sort((a, b) => a - b);
    return {
      id: p.id, enunciado: p.enunciado.trim(), tipo, opcoes: p.opcoes.map((o) => o.trim()),
      // `correta` fica preenchida também na múltipla: o portal antigo lê só ela.
      correta: tipo === "multipla" ? (corretas[0] ?? 0) : p.correta,
      ...(tipo === "multipla" ? { corretas } : {}),
      pontos: Number(p.pontos ?? 1) || 1,
      ...(p.explicacao?.trim() ? { explicacao: p.explicacao.trim() } : {}),
    };
  });
}

const numOuNull = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v) || 0)) || null);

export function ProvaEditor({ quiz, notaMinima, cfg, onChange }: {
  quiz: PerguntaQuiz[]; notaMinima: string; cfg: ProvaConfig;
  onChange: (p: { quiz?: PerguntaQuiz[]; notaMinima?: string; cfg?: ProvaConfig }) => void;
}) {
  const c = { ...PROVA_PADRAO, ...cfg };
  const setCfg = (patch: Partial<ProvaConfig>) => onChange({ cfg: { ...cfg, ...patch } });
  const setQ = (i: number, patch: Partial<PerguntaQuiz>) => onChange({ quiz: quiz.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= quiz.length) return;
    const n = [...quiz]; [n[i], n[j]] = [n[j], n[i]]; onChange({ quiz: n });
  };
  const trocarTipo = (i: number, tipo: TipoPergunta) => {
    const p = quiz[i];
    if (tipo === "vf") setQ(i, { tipo, opcoes: ["Verdadeiro", "Falso"], correta: 0, corretas: undefined });
    else if (tipo === "multipla") setQ(i, { tipo, corretas: p.opcoes[p.correta] != null ? [p.correta] : [], opcoes: p.tipo === "vf" ? ["", ""] : p.opcoes });
    else setQ(i, { tipo, corretas: undefined, correta: p.corretas?.[0] ?? p.correta ?? 0, opcoes: p.tipo === "vf" ? ["", ""] : p.opcoes });
  };
  const pontosTotal = quiz.reduce((s, p) => s + (Number(p.pontos ?? 1) || 0), 0);

  return (
    <div className="mt-3 space-y-4">
      {/* ── Configuração ─────────────────────────────────────────── */}
      <div className="rounded-xl border bg-slate-50/60 p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Regras da prova</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="campo sm:col-span-2">
            <label>Título</label>
            <Input value={c.titulo} onChange={(e) => setCfg({ titulo: e.target.value })} placeholder="Prova da aula" />
          </div>
          <div className="campo sm:col-span-2">
            <label>Instruções (opcional)</label>
            <Textarea rows={2} value={c.instrucoes ?? ""} onChange={(e) => setCfg({ instrucoes: e.target.value || null })} placeholder="Ex.: leia com atenção; a prova vale para o certificado da NR." />
          </div>
          <div className="campo">
            <label>Nota mínima para aprovar (%)</label>
            <Input inputMode="numeric" value={notaMinima} onChange={(e) => onChange({ notaMinima: e.target.value })} />
          </div>
          <div className="campo">
            <label>Tentativas</label>
            <Select value={c.tentativas_max == null ? "ilim" : String(c.tentativas_max)} onValueChange={(v) => setCfg({ tentativas_max: v === "ilim" ? null : Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 10].map((n) => <SelectItem key={n} value={String(n)}>{n} tentativa{n > 1 ? "s" : ""}</SelectItem>)}
                <SelectItem value="ilim">Ilimitadas</SelectItem>
              </SelectContent>
            </Select>
            <div className="ajuda">Esgotou sem aprovar? O setor libera mais uma na ficha do aluno › Provas.</div>
          </div>
          <div className="campo">
            <label>Nota que vale</label>
            <Select value={c.nota_vale} onValueChange={(v) => setCfg({ nota_vale: v as "maior" | "ultima" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="maior">A maior entre as tentativas</SelectItem><SelectItem value="ultima">A da última tentativa</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="campo">
            <label>Gabarito para o aluno</label>
            <Select value={c.gabarito} onValueChange={(v) => setCfg({ gabarito: v as ModoGabarito })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(ROTULO_GABARITO) as ModoGabarito[]).map((g) => <SelectItem key={g} value={g}>{ROTULO_GABARITO[g]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="campo">
            <label>Tempo limite (min, opcional)</label>
            <Input inputMode="numeric" placeholder="sem limite" value={c.tempo_limite_min ?? ""} onChange={(e) => setCfg({ tempo_limite_min: numOuNull(e.target.value) })} />
            <div className="ajuda">Passou do tempo, a tentativa fecha com nota 0.</div>
          </div>
          <div className="campo">
            <label>Espera entre tentativas (min, opcional)</label>
            <Input inputMode="numeric" placeholder="pode refazer na hora" value={c.intervalo_min ?? ""} onChange={(e) => setCfg({ intervalo_min: numOuNull(e.target.value) })} />
          </div>
          <div className="campo">
            <label>Sortear perguntas (opcional)</label>
            <Input inputMode="numeric" placeholder={`todas (${quiz.length})`} value={c.sortear ?? ""} onChange={(e) => setCfg({ sortear: numOuNull(e.target.value) })} />
            <div className="ajuda">Cada tentativa sorteia essa quantidade do banco de {quiz.length} pergunta(s).</div>
          </div>
          <div className="campo sm:col-span-2 space-y-2">
            <label className="flex items-center gap-2 text-sm"><Switch checked={c.liberar_apos_video} onCheckedChange={(v) => setCfg({ liberar_apos_video: v })} /> Só liberar a prova depois de assistir ao vídeo até o fim</label>
            <div className="ajuda -mt-1 ml-11">Vale para vídeo enviado por arquivo, YouTube e Vimeo. Link/embed de outra plataforma não tem como ser medido — a prova abre direto.</div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={c.embaralhar_perguntas} onCheckedChange={(v) => setCfg({ embaralhar_perguntas: v })} /> Embaralhar a ordem das perguntas</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={c.embaralhar_opcoes} onCheckedChange={(v) => setCfg({ embaralhar_opcoes: v })} /> Embaralhar as opções de resposta</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={c.multipla_parcial} onCheckedChange={(v) => setCfg({ multipla_parcial: v })} /> Múltipla escolha vale ponto parcial (senão, é tudo ou nada)</label>
          </div>
        </div>
      </div>

      {/* ── Perguntas ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span><b>{quiz.length}</b> pergunta(s) · <b>{pontosTotal}</b> ponto(s) no total</span>
      </div>
      {quiz.map((p, i) => {
        const tipo = p.tipo ?? "unica";
        return (
          <div key={p.id} className="rounded-xl border p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-500">Pergunta {i + 1}</span>
              <Select value={tipo} onValueChange={(v) => trocarTipo(i, v as TipoPergunta)}>
                <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(ROTULO_TIPO_PERGUNTA) as TipoPergunta[]).map((t) => <SelectItem key={t} value={t}>{ROTULO_TIPO_PERGUNTA[t]}</SelectItem>)}</SelectContent>
              </Select>
              <span className="flex items-center gap-1 text-xs text-slate-500">
                Pontos <Input className="h-8 w-16 text-xs" inputMode="decimal" value={p.pontos ?? 1} onChange={(e) => setQ(i, { pontos: Number(e.target.value.replace(",", ".")) || 0 })} />
              </span>
              <div className="ml-auto flex">
                <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0} onClick={() => mover(i, -1)} title="Subir"><ArrowUp className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === quiz.length - 1} onClick={() => mover(i, 1)} title="Descer"><ArrowDown className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="Duplicar" onClick={() => onChange({ quiz: [...quiz.slice(0, i + 1), { ...p, id: crypto.randomUUID() }, ...quiz.slice(i + 1)] })}><Copy className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600" title="Excluir" onClick={() => onChange({ quiz: quiz.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            <Textarea rows={2} placeholder="Enunciado" value={p.enunciado} onChange={(e) => setQ(i, { enunciado: e.target.value })} />
            <div className="mt-2 space-y-1.5">
              {p.opcoes.map((o, k) => {
                const marcada = tipo === "multipla" ? !!p.corretas?.includes(k) : p.correta === k;
                return (
                  <div key={k} className="flex items-center gap-2">
                    <input
                      type={tipo === "multipla" ? "checkbox" : "radio"} name={`correta-${p.id}`} checked={marcada} title="Correta"
                      onChange={() => tipo === "multipla"
                        ? setQ(i, { corretas: marcada ? (p.corretas ?? []).filter((x) => x !== k) : [...(p.corretas ?? []), k] })
                        : setQ(i, { correta: k })}
                    />
                    <Input placeholder={`Opção ${k + 1}`} value={o} disabled={tipo === "vf"}
                           onChange={(e) => setQ(i, { opcoes: p.opcoes.map((x, j) => (j === k ? e.target.value : x)) })} />
                    {tipo !== "vf" && p.opcoes.length > 2 && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setQ(i, {
                        opcoes: p.opcoes.filter((_, j) => j !== k),
                        correta: p.correta === k ? 0 : p.correta > k ? p.correta - 1 : p.correta,
                        corretas: p.corretas?.filter((x) => x !== k).map((x) => (x > k ? x - 1 : x)),
                      })}><Trash2 className="h-3.5 w-3.5" /></Button>
                    )}
                  </div>
                );
              })}
              {tipo !== "vf" && <Button variant="outline" size="sm" onClick={() => setQ(i, { opcoes: [...p.opcoes, ""] })}><Plus className="mr-1 h-3.5 w-3.5" /> Opção</Button>}
              <div className="text-[11px] text-slate-400">{tipo === "multipla" ? "Marque todas as corretas (caixinhas)." : "Marque a correta (bolinha)."}</div>
            </div>
            <Input className="mt-2 text-xs" placeholder="Explicação da resposta (opcional — aparece no gabarito)" value={p.explicacao ?? ""} onChange={(e) => setQ(i, { explicacao: e.target.value })} />
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => onChange({ quiz: [...quiz, novaPergunta("unica")] })}><Plus className="mr-1 h-4 w-4" /> Escolha única</Button>
        <Button variant="outline" size="sm" onClick={() => onChange({ quiz: [...quiz, novaPergunta("multipla")] })}><Plus className="mr-1 h-4 w-4" /> Múltipla escolha</Button>
        <Button variant="outline" size="sm" onClick={() => onChange({ quiz: [...quiz, novaPergunta("vf")] })}><Plus className="mr-1 h-4 w-4" /> Verdadeiro ou falso</Button>
      </div>
    </div>
  );
}
