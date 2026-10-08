import { useEffect, useMemo, useState } from "react";
import bigodinho from "@/assets/bigodinho-em-pe.webp";
import bigodinhoProgramador from "@/assets/bigodinho-programador.webm";
import logoBranco from "@/assets/logo-nascimento-branco.webp";
import { VERSICULOS, indiceDoDia } from "@/lib/versiculos";

// =====================================================================
// TV — TELA PADRÃO (sem playlist) — 08/10/2026
//
// Pedido do Pablo: "uma tela padrão nova nas TVs que não têm nada, com o
// bigodinho e animações legais, tipo o login; uma mensagem bíblica igual à
// do Início e PAINEL EM DESENVOLVIMENTO, bem animado".
//
// Tudo em vmin (a TV pode ser 720p, 1080p ou 4K, em pé ou deitada) e só CSS
// (TV de mercado tem pouca CPU: nada de canvas nem JS por quadro). O
// versículo começa no do dia (o mesmo do Início) e gira a cada 12 s, como
// um carrossel; o bigodinho entra, respira, flutua e dá um pulo de tempos em
// tempos, com um balão de fala. Quem prefere menos movimento
// (prefers-reduced-motion) vê tudo parado.
//
// 08/10/2026 — "quero colocar esse vídeo (bigodinho programador) na tela de
// desenvolvimento da TV, bem no canto inferior direito". A 1ª versão recortou
// o fundo preto do vídeo quadro a quadro (WebM transparente) e ficou com a
// borda borrada; o Pablo trocou por um vídeo com fundo claro (estúdio
// branco) pedindo "fundo branco, num card assim": o vídeo vai INTEIRO dentro
// de um card branco arredondado no canto, sem recorte nenhum. WebM VP9
// (1024×576 — múltiplo de 16: em 960×540 o VP9 sujava as 8 linhas de cima —,
// 30 fps, sem áudio, ~15 s em laço — começa e termina no mesmo plano; 4 MB
// contra 15 MB do original), que o Chrome/Android das TVs e da
// gestão tocam; se falhar (Safari antigo), volta o bigodinho em pé.
// =====================================================================

const TROCA_MS = 12_000;
const FALAS = ["Estamos preparando novidades!", "Já já tem conteúdo aqui 😉", "Bom trabalho, equipe!"];

// Partículas com posição fixa (sem Math.random: a tela é a mesma em toda TV).
const PARTICULAS = Array.from({ length: 26 }, (_, i) => ({
  left: (i * 37) % 100, tam: 0.35 + ((i * 7) % 5) * 0.12, atraso: (i * 1.7) % 14, dur: 12 + ((i * 3) % 9),
}));

export function TvTelaPadrao({ nome }: { nome: string }) {
  // O vídeo NÃO depende de prefers-reduced-motion: é o conteúdo pedido, e o
  // Windows com "animações desligadas" faria a PRÉVIA da gestão mostrar outra
  // coisa que a TV (as animações de CSS continuam respeitando a preferência).
  const [comVideo, setComVideo] = useState(true);
  const [agora, setAgora] = useState(new Date());
  useEffect(() => { const t = window.setInterval(() => setAgora(new Date()), 1000); return () => window.clearInterval(t); }, []);

  const inicio = useMemo(() => indiceDoDia(new Date()), []);
  const [passo, setPasso] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setPasso((p) => p + 1), TROCA_MS); return () => window.clearInterval(t); }, []);
  const idx = (inicio + passo) % VERSICULOS.length;
  const v = VERSICULOS[idx];
  const fala = FALAS[passo % FALAS.length];

  return (
    <div className="tvp">
      <style>{CSS}</style>

      {/* Fundo vivo */}
      <div className="tvp-aurora tvp-a1" /><div className="tvp-aurora tvp-a2" /><div className="tvp-aurora tvp-a3" />
      <div className="tvp-grade" />
      <div className="tvp-brilho" />
      {PARTICULAS.map((p, i) => (
        <span key={i} className="tvp-part" style={{ left: `${p.left}%`, width: `${p.tam}vmin`, height: `${p.tam}vmin`, animationDelay: `${p.atraso}s`, animationDuration: `${p.dur}s` }} />
      ))}

      {/* Topo */}
      <header className="tvp-topo">
        <img src={logoBranco} alt="Grupo Nascimento" className="tvp-logo" draggable={false} />
        <div className="tvp-relogio">
          <span className="tvp-hora">{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
          <span className="tvp-data">{agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</span>
        </div>
      </header>

      <main className="tvp-corpo">
        <section className="tvp-texto">
          <p className="tvp-selo"><span className="tvp-ponto" /> {nome}</p>

          <h1 className="tvp-titulo" aria-label="Painel em desenvolvimento">
            {["PAINEL", "EM", "DESENVOLVIMENTO"].map((p, i) => (
              <span key={p} className="tvp-palavra" style={{ animationDelay: `${0.25 + i * 0.18}s` }}>{p}</span>
            ))}
          </h1>

          <div className="tvp-progresso"><span /></div>
          <p className="tvp-sub">Estamos preparando o conteúdo desta tela. Em breve, novidades por aqui.</p>

          <div className="tvp-cartao">
            <p className="tvp-rotulo">Palavra do dia</p>
            <div key={idx} className="tvp-versiculo">
              <p className="tvp-frase">
                {v.frase.split(" ").map((w, i) => <span key={i} style={{ animationDelay: `${i * 0.09}s` }}>{w}&nbsp;</span>)}
              </p>
              <p className="tvp-ref-texto">{v.texto} <strong>({v.ref})</strong></p>
            </div>
            <div className="tvp-pontos">
              {VERSICULOS.map((_, i) => (
                <span key={i} className={i === idx ? "ativo" : ""}>{i === idx && <i key={passo} />}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="tvp-boneco-area">
          {!comVideo && <div className="tvp-anel" />}
          <svg className="tvp-engrenagem tvp-e1" viewBox="0 0 24 24" aria-hidden><path d={ENGRENAGEM} /></svg>
          <svg className="tvp-engrenagem tvp-e2" viewBox="0 0 24 24" aria-hidden><path d={ENGRENAGEM} /></svg>
          {!comVideo && (
            <>
              <div key={`f${passo}`} className="tvp-balao">{fala}</div>
              <div className="tvp-boneco-pos">
                <div className="tvp-sombra" />
                <img src={bigodinho} alt="Mascote do Grupo Nascimento" draggable={false} className="tvp-boneco" />
              </div>
            </>
          )}
        </section>
      </main>

      {/* O bigodinho programando, num card branco no canto inferior direito da tela. */}
      {comVideo && (
        <div className="tvp-video-area">
          <div key={`f${passo}`} className="tvp-balao tvp-balao-video">{fala}</div>
          <video className="tvp-video" src={bigodinhoProgramador} autoPlay muted loop playsInline disablePictureInPicture
            aria-label="Mascote do Grupo Nascimento programando" onError={() => setComVideo(false)} />
        </div>
      )}

      <footer className="tvp-rodape">
        <span>Grupo Nascimento · Soluções em Serviços</span>
        {/* Com o vídeo no canto, o aviso vai para a esquerda (senão ficaria por baixo dele). */}
        {comVideo
          ? <span className="tvp-rodape-dir">· Tela padrão — a playlist desta TV ainda está vazia</span>
          : <span className="tvp-rodape-dir">Tela padrão — a playlist desta TV ainda está vazia</span>}
      </footer>
    </div>
  );
}

const ENGRENAGEM = "M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.4-2.9a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z";

const CSS = `
.tvp{position:relative;height:100%;width:100%;overflow:hidden;color:#fff;font-family:inherit;
  background:radial-gradient(120% 90% at 85% 15%,#1d3f91 0%,#0d2257 45%,#06122f 100%);display:flex;flex-direction:column}
.tvp *{box-sizing:border-box}
.tvp-aurora{position:absolute;border-radius:50%;filter:blur(9vmin);opacity:.55;mix-blend-mode:screen;pointer-events:none}
.tvp-a1{width:60vmin;height:60vmin;left:-12vmin;top:-14vmin;background:#ff6a00;animation:tvp-deriva1 22s ease-in-out infinite}
.tvp-a2{width:70vmin;height:70vmin;right:-18vmin;bottom:-26vmin;background:#2563eb;animation:tvp-deriva2 26s ease-in-out infinite}
.tvp-a3{width:42vmin;height:42vmin;left:38%;top:30%;background:#7c3aed;opacity:.35;animation:tvp-deriva3 30s ease-in-out infinite}
@keyframes tvp-deriva1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(18vmin,10vmin) scale(1.15)}}
@keyframes tvp-deriva2{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-16vmin,-12vmin) scale(1.1)}}
@keyframes tvp-deriva3{0%,100%{transform:translate(0,0)}33%{transform:translate(-12vmin,8vmin)}66%{transform:translate(10vmin,-6vmin)}}
.tvp-grade{position:absolute;inset:-50% -10% 0 -10%;pointer-events:none;opacity:.18;
  background-image:linear-gradient(rgba(255,255,255,.35) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.35) 1px,transparent 1px);
  background-size:7vmin 7vmin;transform:perspective(80vmin) rotateX(62deg) translateY(30%);transform-origin:50% 100%;
  mask-image:linear-gradient(to top,#000 0%,transparent 65%);-webkit-mask-image:linear-gradient(to top,#000 0%,transparent 65%);
  animation:tvp-grade 6s linear infinite}
@keyframes tvp-grade{to{background-position:0 7vmin,0 0}}
.tvp-brilho{position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,transparent 40%,rgba(255,255,255,.08) 50%,transparent 60%);
  transform:translateX(-100%);animation:tvp-brilho 9s ease-in-out 2s infinite}
@keyframes tvp-brilho{0%{transform:translateX(-100%)}35%,100%{transform:translateX(100%)}}
.tvp-part{position:absolute;bottom:-2vmin;border-radius:50%;background:#ffb27a;box-shadow:0 0 1.2vmin #ff8a3d;opacity:0;pointer-events:none;animation:tvp-sobe linear infinite}
@keyframes tvp-sobe{0%{transform:translateY(0);opacity:0}10%{opacity:.8}90%{opacity:.5}100%{transform:translateY(-105vh);opacity:0}}

.tvp-topo{position:relative;z-index:3;display:flex;align-items:center;justify-content:space-between;padding:3.2vmin 4.5vmin 0;animation:tvp-desce .9s cubic-bezier(.2,.8,.2,1) both}
.tvp-logo{height:6.5vmin;width:auto;filter:drop-shadow(0 .6vmin 1.4vmin rgba(0,0,0,.35))}
.tvp-relogio{text-align:right;line-height:1}
.tvp-hora{display:block;font-size:6.2vmin;font-weight:900;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.tvp-data{display:block;margin-top:.8vmin;font-size:1.9vmin;text-transform:capitalize;color:rgba(255,255,255,.7)}
@keyframes tvp-desce{from{opacity:0;transform:translateY(-3vmin)}to{opacity:1;transform:none}}

.tvp-corpo{position:relative;z-index:2;flex:1;display:grid;grid-template-columns:1.25fr 1fr;align-items:center;gap:2vmin;padding:0 4.5vmin}
.tvp-texto{display:flex;flex-direction:column;gap:2.2vmin;min-width:0}
.tvp-selo{display:inline-flex;align-items:center;gap:1.2vmin;align-self:flex-start;padding:.9vmin 2vmin;border-radius:99vmin;font-size:1.9vmin;font-weight:700;
  letter-spacing:.12em;text-transform:uppercase;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(6px);
  animation:tvp-entra .8s cubic-bezier(.2,.8,.2,1) .1s both}
.tvp-ponto{width:1.3vmin;height:1.3vmin;border-radius:50%;background:#ff7a1a;box-shadow:0 0 0 0 rgba(255,122,26,.7);animation:tvp-pulso 1.8s ease-out infinite}
@keyframes tvp-pulso{0%{box-shadow:0 0 0 0 rgba(255,122,26,.7)}100%{box-shadow:0 0 0 2.2vmin rgba(255,122,26,0)}}
.tvp-titulo{margin:0;display:flex;flex-wrap:wrap;gap:0 2.2vmin;font-size:9vmin;font-weight:900;line-height:.95;letter-spacing:-.045em}
.tvp-palavra{display:inline-block;background:linear-gradient(100deg,#fff 0%,#fff 40%,#ffb27a 50%,#fff 60%,#fff 100%);background-size:250% 100%;
  -webkit-background-clip:text;background-clip:text;color:transparent;
  animation:tvp-palavra 1s cubic-bezier(.2,.8,.2,1) both,tvp-shimmer 5s linear 1.6s infinite}
.tvp-palavra:last-child{background-image:linear-gradient(100deg,#ff8a3d 0%,#ffb27a 40%,#fff3e6 50%,#ffb27a 60%,#ff6a00 100%)}
@keyframes tvp-palavra{from{opacity:0;filter:blur(1.4vmin);transform:translateY(4vmin) scale(.96)}to{opacity:1;filter:blur(0);transform:none}}
@keyframes tvp-shimmer{from{background-position:120% 0}to{background-position:-130% 0}}
.tvp-progresso{position:relative;height:1vmin;width:60%;border-radius:99vmin;background:rgba(255,255,255,.12);overflow:hidden;animation:tvp-entra .8s ease .9s both}
.tvp-progresso span{position:absolute;inset:0;width:40%;border-radius:inherit;background:linear-gradient(90deg,transparent,#ff7a1a,#ffd0a8,#ff7a1a,transparent);animation:tvp-carrega 2.4s ease-in-out infinite}
@keyframes tvp-carrega{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}
.tvp-sub{margin:0;font-size:2.3vmin;color:rgba(255,255,255,.75);animation:tvp-entra .8s ease 1s both}
@keyframes tvp-entra{from{opacity:0;transform:translateY(2.4vmin)}to{opacity:1;transform:none}}

.tvp-cartao{margin-top:1.4vmin;padding:2.8vmin 3.2vmin 2.4vmin;border-radius:2.6vmin;background:linear-gradient(140deg,rgba(255,255,255,.12),rgba(255,255,255,.04));
  border:1px solid rgba(255,255,255,.16);box-shadow:0 2.4vmin 6vmin rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.18);backdrop-filter:blur(10px);
  animation:tvp-entra .9s cubic-bezier(.2,.8,.2,1) 1.2s both}
.tvp-rotulo{margin:0 0 1.2vmin;font-size:1.6vmin;font-weight:800;letter-spacing:.24em;text-transform:uppercase;color:#ffb27a}
.tvp-versiculo{min-height:14vmin}
.tvp-frase{margin:0;font-size:4.6vmin;font-weight:900;line-height:1.05;letter-spacing:-.03em}
.tvp-frase span{display:inline-block;background:linear-gradient(90deg,#ffd166,#ff8a3d);-webkit-background-clip:text;background-clip:text;color:transparent;
  animation:tvp-palavra .8s cubic-bezier(.2,.8,.2,1) both}
.tvp-ref-texto{margin:1.4vmin 0 0;font-size:2.1vmin;font-style:italic;color:rgba(255,255,255,.82);animation:tvp-entra .8s ease .5s both}
.tvp-ref-texto strong{font-style:normal;color:#fff}
.tvp-pontos{display:flex;gap:1vmin;margin-top:2vmin}
.tvp-pontos span{position:relative;height:.7vmin;width:2.4vmin;border-radius:99vmin;background:rgba(255,255,255,.22);overflow:hidden;transition:width .5s ease}
.tvp-pontos span.ativo{width:7vmin}
.tvp-pontos i{position:absolute;inset:0;transform-origin:left;background:#ff8a3d;animation:tvp-tempo ${TROCA_MS / 1000}s linear both}
@keyframes tvp-tempo{from{transform:scaleX(0)}to{transform:scaleX(1)}}

.tvp-boneco-area{position:relative;height:100%;min-height:50vmin;display:flex;align-items:flex-end;justify-content:center}
.tvp-anel{position:absolute;left:50%;bottom:6%;width:46vmin;height:46vmin;margin-left:-23vmin;border-radius:50%;
  background:radial-gradient(circle,rgba(255,138,61,.45) 0%,rgba(255,138,61,.12) 45%,transparent 70%);animation:tvp-respira-anel 5s ease-in-out infinite}
@keyframes tvp-respira-anel{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.08);opacity:1}}
.tvp-engrenagem{position:absolute;fill:rgba(255,255,255,.14)}
.tvp-e1{width:12vmin;right:6%;top:14%;animation:tvp-gira 14s linear infinite}
.tvp-e2{width:8vmin;left:8%;top:34%;fill:rgba(255,138,61,.35);animation:tvp-gira 10s linear infinite reverse}
@keyframes tvp-gira{to{transform:rotate(360deg)}}
.tvp-boneco-pos{position:relative;height:72vmin;max-height:100%;display:flex;align-items:flex-end;animation:tvp-flutua 6s ease-in-out 2s infinite}
.tvp-boneco{position:relative;z-index:2;height:100%;width:auto;user-select:none;transform-origin:50% 100%;
  filter:drop-shadow(0 2vmin 3vmin rgba(0,0,0,.45));
  animation:tvp-boneco-entra 1.1s cubic-bezier(.2,.9,.25,1.15) .6s both,tvp-respira 4.8s ease-in-out 1.8s infinite,tvp-pulo 10s cubic-bezier(.3,.7,.3,1) 4s infinite}
.tvp-sombra{position:absolute;left:10%;right:10%;bottom:-1.2vmin;height:3vmin;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.55),transparent);
  animation:tvp-sombra 6s ease-in-out 2s infinite}
@keyframes tvp-boneco-entra{from{opacity:0;transform:translateY(12vmin) scale(.9)}to{opacity:1;transform:none}}
@keyframes tvp-respira{0%,100%{transform:scale(1,1) rotate(0)}50%{transform:scale(1.008,1.014) rotate(-.6deg)}}
@keyframes tvp-pulo{0%,86%,100%{translate:0 0}90%{translate:0 -4vmin}94%{translate:0 0}97%{translate:0 -1.2vmin}}
@keyframes tvp-flutua{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.6vmin)}}
@keyframes tvp-sombra{0%,100%{transform:scaleX(1);opacity:1}50%{transform:scaleX(.85);opacity:.7}}
.tvp-balao{position:absolute;z-index:3;left:4%;top:12%;max-width:30vmin;padding:1.6vmin 2.2vmin;border-radius:2vmin 2vmin 2vmin .4vmin;
  background:#fff;color:#0b1f4d;font-size:2.2vmin;font-weight:800;line-height:1.2;box-shadow:0 1.6vmin 4vmin rgba(0,0,0,.35);
  animation:tvp-balao ${TROCA_MS / 1000}s cubic-bezier(.2,.9,.25,1.2) both}
@keyframes tvp-balao{0%{opacity:0;transform:scale(.6) translateY(2vmin)}6%,80%{opacity:1;transform:none}88%,100%{opacity:0;transform:scale(.9) translateY(-1vmin)}}

.tvp-rodape{position:relative;z-index:3;display:flex;justify-content:space-between;gap:2vmin;padding:1.6vmin 4.5vmin 2.6vmin;font-size:1.6vmin;
  color:rgba(255,255,255,.55);letter-spacing:.06em;animation:tvp-entra .8s ease 1.4s both}
.tvp-rodape-dir{text-transform:uppercase}
.tvp-video-area ~ .tvp-rodape{justify-content:flex-start}

/* Card do bigodinho programador: branco, arredondado, encostado no canto
   inferior direito (como o desenho do Pablo), o vídeo inteiro dentro. Só
   transform na entrada (sem opacidade: navegador de TV fraco às vezes congela
   a animação no 1º quadro). */
.tvp-video-area{position:absolute;z-index:2;right:0;bottom:0;width:42vw;aspect-ratio:16/9;pointer-events:none;
  border-radius:2.6vmin;background:#fff;padding:.7vmin;box-shadow:0 2.4vmin 6vmin rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.6);
  animation:tvp-video-entra 1.2s cubic-bezier(.2,.9,.25,1.1) .5s both}
@keyframes tvp-video-entra{from{transform:translate(8vmin,10vmin)}to{transform:none}}
.tvp-video{display:block;width:100%;height:100%;object-fit:cover;border-radius:2vmin;background:#fff}
.tvp-balao-video{left:-6%;top:-6%;z-index:3}

@media (orientation:portrait){
  .tvp-corpo{grid-template-columns:1fr;grid-template-rows:auto 1fr}
  .tvp-boneco-pos{height:48vh}
  .tvp-titulo{font-size:11vmin}
  .tvp-video-area{width:100vw}
}
@media (prefers-reduced-motion:reduce){
  .tvp *,.tvp *::before,.tvp *::after{animation:none!important;transition:none!important}
}
`;
