import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, ChevronLeft, ChevronRight, Quote, Star } from "lucide-react";
import { useMuralInicio, type ItemMuralInicio } from "@/hooks/useMuralReconhecimento";
import { lerNota, rotuloMes } from "@/lib/formularios/muralReconhecimento";

/**
 * Cartão "Reconhecimento e Convivência Profissional" do Início (30/10/2026).
 *
 * Mostra os recados POSITIVOS que os colegas deixaram uns para os outros na
 * Avaliação de Reconhecimento (pergunta "colegas" dos Formulários), sempre do
 * MÊS ANTERIOR e só depois que quem cuida do formulário LIBEROU — a regra
 * inteira está em lib/formularios/muralReconhecimento e na migration
 * 20261030003200. Aqui é só vitrine.
 *
 * ANONIMATO. O formulário é anônimo, então o cartão mostra QUEM FOI
 * reconhecido (nome, setor, foto do cadastro) e nunca quem escreveu — o
 * banco nem devolve esse dado.
 *
 * ANIMAÇÃO. Segue a regra do Início: ambiente, em CSS, nada por frame do
 * React. Um destaque por vez que troca sozinho (pausa com o mouse em cima),
 * barra de progresso, brilhos flutuando e a fila de rostos entrando em
 * cascata. `prefers-reduced-motion` desliga os enfeites; a troca de recado
 * continua, como fade.
 *
 * O cartão SOME quando não há nada liberado no mês — como o de aniversários,
 * cartão vazio numa tela aberta o dia inteiro é ruído.
 */
const INTERVALO_MS = 7000;

export function ReconhecimentoCard() {
  useEstiloReconhecimento();
  const { data, isLoading, isError } = useMuralInicio();
  const itens = useMemo(() => data?.itens ?? [], [data]);
  const [atual, setAtual] = useState(0);
  const [pausado, setPausado] = useState(false);
  const [ciclo, setCiclo] = useState(0);   // reinicia a barra de progresso a cada troca

  // Uma pessoa por rosto na fila, com quantos recados recebeu.
  const pessoas = useMemo(() => {
    const m = new Map<string, { item: ItemMuralInicio; indice: number; total: number }>();
    itens.forEach((it, i) => {
      const k = it.colaborador.toUpperCase();
      const atualP = m.get(k);
      if (atualP) atualP.total += 1;
      else m.set(k, { item: it, indice: i, total: 1 });
    });
    return [...m.values()];
  }, [itens]);

  const ir = useCallback((i: number) => {
    if (!itens.length) return;
    setAtual(((i % itens.length) + itens.length) % itens.length);
    setCiclo((c) => c + 1);
  }, [itens.length]);

  // A troca sozinha vale também com movimento reduzido: é conteúdo, não
  // enfeite — e o Windows com "Mostrar animações" desligado (comum nas
  // máquinas da empresa) deixaria o cartão parado no primeiro recado. Lá só
  // os enfeites param e a troca vira um fade (ver o CSS).
  useEffect(() => {
    if (pausado || itens.length < 2) return;
    const t = window.setTimeout(() => ir(atual + 1), INTERVALO_MS);
    return () => window.clearTimeout(t);
  }, [atual, pausado, itens.length, ir, ciclo]);

  if (isLoading || isError || !itens.length) return null;
  const it = itens[Math.min(atual, itens.length - 1)];
  const nota = lerNota(it.nota);
  const escala = Math.max(2, it.escala || 5);

  return (
    <section className="ini-card rec-card" aria-roledescription="carrossel"
      onMouseEnter={() => setPausado(true)} onMouseLeave={() => { setPausado(false); setCiclo((c) => c + 1); }}>
      <span className="rec-brilho rec-brilho--a" aria-hidden />
      <span className="rec-brilho rec-brilho--b" aria-hidden />
      <span className="rec-brilho rec-brilho--c" aria-hidden />

      <div className="ini-card-hd">
        <div className="ini-hd-tx">
          <h3><Award className="ini-hd-ic rec-trofeu" aria-hidden /> Reconhecimento e Convivência Profissional</h3>
          <p>
            O que os colegas disseram uns dos outros em <b>{rotuloMes(data!.mes)}</b> ·{" "}
            {itens.length} {itens.length === 1 ? "recado" : "recados"} para {pessoas.length} {pessoas.length === 1 ? "pessoa" : "pessoas"}
          </p>
        </div>
        {itens.length > 1 && (
          <div className="rec-setas">
            <button type="button" className="rec-seta" onClick={() => ir(atual - 1)} aria-label="Recado anterior"><ChevronLeft size={16} /></button>
            <span className="rec-contador">{atual + 1}/{itens.length}</span>
            <button type="button" className="rec-seta" onClick={() => ir(atual + 1)} aria-label="Próximo recado"><ChevronRight size={16} /></button>
          </div>
        )}
      </div>

      <div className="ini-card-body rec-body">
        <article key={`${it.chave}:${atual}`} className="rec-destaque" aria-live="polite">
          <div className="rec-foto">
            {it.avatar_url ? <img src={it.avatar_url} alt="" /> : <span className="rec-iniciais">{iniciais(it.colaborador)}</span>}
          </div>
          <div className="rec-corpo">
            <p className="rec-nome">{nomeLegivel(it.colaborador)}</p>
            <p className="rec-setor">{[it.cargo, it.setor].filter(Boolean).map((t) => nomeLegivel(String(t))).join(" · ")}</p>
            {nota != null && (
              <div className="rec-estrelas" aria-label={`Nota ${it.nota} de ${escala}`}>
                {Array.from({ length: escala }, (_, i) => (
                  <Star key={i} size={14} className={i < Math.round(nota) ? "rec-estrela rec-estrela--on" : "rec-estrela"}
                    style={{ "--i": i } as React.CSSProperties} fill={i < Math.round(nota) ? "currentColor" : "none"} aria-hidden />
                ))}
              </div>
            )}
            <blockquote className="rec-texto">
              <Quote size={18} className="rec-aspas" aria-hidden />
              {it.comentario}
            </blockquote>
          </div>
          {itens.length > 1 && (
            <span key={ciclo} className={`rec-progresso ${pausado ? "rec-progresso--pausa" : ""}`}
              style={{ animationDuration: `${INTERVALO_MS}ms` }} aria-hidden />
          )}
        </article>

        {pessoas.length > 1 && (
          <div className="rec-fila" role="list" aria-label="Quem foi reconhecido">
            {pessoas.map((p, i) => {
              const ativa = p.item.colaborador.toUpperCase() === it.colaborador.toUpperCase();
              return (
                <button key={p.item.colaborador} type="button" role="listitem"
                  className={`rec-rosto ${ativa ? "rec-rosto--on" : ""}`} style={{ "--i": i } as React.CSSProperties}
                  title={`${nomeLegivel(p.item.colaborador)} — ${p.total} ${p.total === 1 ? "recado" : "recados"}`}
                  onClick={() => ir(p.indice)}>
                  {p.item.avatar_url ? <img src={p.item.avatar_url} alt="" /> : <span>{iniciais(p.item.colaborador)}</span>}
                  {p.total > 1 && <b>{p.total}</b>}
                </button>
              );
            })}
          </div>
        )}
        <p className="rec-rodape">Recados anônimos, liberados por quem cuida da avaliação.</p>
      </div>
    </section>
  );
}

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

/** "FULANA DE TAL" → "Fulana de Tal". */
function nomeLegivel(t: string) {
  const minusculas = new Set(["de", "da", "do", "das", "dos", "e"]);
  return t.toLowerCase().split(/\s+/).filter(Boolean)
    .map((w, i) => (i > 0 && minusculas.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
}

/* ------------------------------------------------------------------ */
/* CSS injetado uma vez, no mesmo esquema de components/aniversarios.   */
/* Herda .ini-card / .ini-card-hd / .ini-card-body do Início.           */
/* ------------------------------------------------------------------ */
const ID_ESTILO = "rec-styles";

function useEstiloReconhecimento() {
  useEffect(() => {
    if (document.getElementById(ID_ESTILO)) return;
    const el = document.createElement("style");
    el.id = ID_ESTILO;
    el.textContent = CSS_RECONHECIMENTO;
    document.head.appendChild(el);
  }, []);
}

const CSS_RECONHECIMENTO = `
.ini-card.rec-card{position:relative;overflow:hidden;
  animation:rec-entra .7s cubic-bezier(.16,1,.3,1) both;}
/* Fio de luz na borda de cima, o mesmo gesto do hero do Início. */
.ini-card.rec-card::before{content:'';position:absolute;inset:0 0 auto 0;height:3px;z-index:1;
  background:linear-gradient(90deg,#f59e0b,#f97316,#ec4899,#6366f1,#f59e0b);background-size:300% 100%;
  animation:rec-fio 8s linear infinite;}
@keyframes rec-fio{to{background-position:300% 0}}
@keyframes rec-entra{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}

/* Brilhos que derivam devagar atrás do conteúdo. */
.rec-brilho{position:absolute;border-radius:9999px;pointer-events:none;filter:blur(40px);opacity:.5;z-index:0;}
.rec-brilho--a{width:220px;height:220px;top:-90px;right:-40px;background:radial-gradient(circle,rgba(249,115,22,.45),transparent 70%);
  animation:rec-deriva 16s ease-in-out infinite;}
.rec-brilho--b{width:180px;height:180px;bottom:-80px;left:10%;background:radial-gradient(circle,rgba(99,102,241,.35),transparent 70%);
  animation:rec-deriva 21s ease-in-out -5s infinite reverse;}
.rec-brilho--c{width:120px;height:120px;top:40%;left:55%;background:radial-gradient(circle,rgba(236,72,153,.25),transparent 70%);
  animation:rec-deriva 13s ease-in-out -2s infinite;}
@keyframes rec-deriva{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-22px,18px) scale(1.15)}}
.rec-card .ini-card-hd,.rec-card .ini-card-body{position:relative;z-index:1;}

.ini-hd-ic.rec-trofeu{color:#f59e0b;animation:rec-balanca 4s ease-in-out infinite;transform-origin:50% 90%;}
@keyframes rec-balanca{0%,86%,100%{transform:rotate(0)}90%{transform:rotate(-12deg)}94%{transform:rotate(10deg)}}

.rec-setas{display:flex;align-items:center;gap:6px;flex:none;}
.rec-seta{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;cursor:pointer;
  border:1px solid hsl(var(--border));background:hsl(var(--card));color:hsl(var(--foreground));
  transition:transform .2s cubic-bezier(.34,1.56,.64,1),background .2s;}
.rec-seta:hover{transform:scale(1.1);background:hsl(var(--muted));}
.rec-contador{font-size:.72rem;font-weight:800;color:hsl(var(--muted-foreground));min-width:34px;text-align:center;}

.ini-card-body.rec-body{padding:16px 20px 14px;}
.rec-destaque{position:relative;display:flex;gap:16px;align-items:flex-start;padding:16px 18px 20px;border-radius:16px;overflow:hidden;
  border:1px solid hsl(var(--border));
  background:linear-gradient(135deg,rgba(245,158,11,.10),rgba(236,72,153,.06) 45%,rgba(99,102,241,.07));
  animation:rec-troca .65s cubic-bezier(.16,1,.3,1) both;}
@keyframes rec-troca{from{opacity:0;transform:translateX(26px);filter:blur(4px)}to{opacity:1;transform:none;filter:none}}

.rec-foto{position:relative;flex:none;width:64px;height:64px;}
.rec-foto::before{content:'';position:absolute;inset:-4px;border-radius:9999px;
  background:conic-gradient(from 0deg,#f59e0b,#f97316,#ec4899,#6366f1,#f59e0b);animation:rec-gira 6s linear infinite;}
@keyframes rec-gira{to{transform:rotate(360deg)}}
.rec-foto img,.rec-iniciais{position:relative;width:64px;height:64px;border-radius:9999px;object-fit:cover;
  display:grid;place-items:center;font-size:1.05rem;font-weight:800;color:hsl(var(--primary));
  background:hsl(var(--card));border:3px solid hsl(var(--card));
  animation:rec-pulo .6s cubic-bezier(.34,1.56,.64,1) .1s both;}
@keyframes rec-pulo{from{transform:scale(.5);opacity:0}to{transform:none;opacity:1}}

.rec-corpo{flex:1;min-width:0;}
.rec-nome{font-size:1rem;font-weight:800;color:hsl(var(--foreground));line-height:1.25;letter-spacing:-.01em;}
.rec-setor{font-size:.74rem;color:hsl(var(--muted-foreground));margin-top:2px;}
.rec-estrelas{display:flex;gap:2px;margin-top:6px;}
.rec-estrela{color:hsl(var(--muted-foreground) / .35);}
.rec-estrela--on{color:#f59e0b;animation:rec-estrela .45s cubic-bezier(.34,1.56,.64,1) both;animation-delay:calc(.25s + var(--i) * 80ms);}
@keyframes rec-estrela{from{transform:scale(0) rotate(-90deg);opacity:0}to{transform:none;opacity:1}}
.rec-texto{position:relative;margin-top:10px;padding-left:24px;font-size:.92rem;line-height:1.55;font-style:italic;
  color:hsl(var(--foreground) / .88);white-space:pre-wrap;word-break:break-word;
  animation:rec-texto .7s ease .2s both;}
.rec-aspas{position:absolute;left:0;top:1px;color:#f97316;opacity:.7;}
@keyframes rec-texto{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

.rec-progresso{position:absolute;left:0;bottom:0;height:3px;width:100%;transform-origin:left;
  background:linear-gradient(90deg,#f59e0b,#ec4899);animation:rec-barra linear both;}
.rec-progresso--pausa{animation-play-state:paused;}
@keyframes rec-barra{from{transform:scaleX(0)}to{transform:scaleX(1)}}

.rec-fila{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;}
.rec-rosto{position:relative;width:36px;height:36px;padding:0;border-radius:9999px;cursor:pointer;
  border:2px solid hsl(var(--card));background:hsl(var(--primary) / .12);color:hsl(var(--primary));
  font-size:.68rem;font-weight:800;display:grid;place-items:center;
  box-shadow:0 3px 10px -4px hsl(218 50% 15% / .4);
  animation:rec-pulo .45s cubic-bezier(.34,1.56,.64,1) both;animation-delay:calc(var(--i) * 45ms);
  transition:transform .22s cubic-bezier(.34,1.56,.64,1),box-shadow .22s;}
.rec-rosto img{width:100%;height:100%;border-radius:9999px;object-fit:cover;}
.rec-rosto:hover{transform:translateY(-3px) scale(1.1);}
.rec-rosto--on{box-shadow:0 0 0 2px #f97316,0 6px 16px -6px rgba(249,115,22,.7);transform:scale(1.08);}
.rec-rosto b{position:absolute;right:-5px;top:-5px;min-width:16px;height:16px;padding:0 4px;border-radius:9999px;
  font-size:.6rem;line-height:16px;color:#fff;background:#f97316;border:2px solid hsl(var(--card));}
.rec-rodape{margin-top:12px;font-size:.68rem;color:hsl(var(--muted-foreground));}

@media (max-width:640px){
  .rec-destaque{flex-direction:column;align-items:center;text-align:center;}
  .rec-estrelas{justify-content:center;}
}
@media (prefers-reduced-motion:reduce){
  .ini-card.rec-card,.ini-card.rec-card::before,.rec-brilho,.rec-trofeu,.rec-foto::before,.rec-foto img,.rec-iniciais,
  .rec-estrela--on,.rec-texto,.rec-rosto{animation:none!important;transition:none!important;}
  .rec-destaque{animation:rec-fade .5s ease both;}
}
@keyframes rec-fade{from{opacity:0}to{opacity:1}}
`;
