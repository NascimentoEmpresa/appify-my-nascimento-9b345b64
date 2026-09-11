import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, ArrowUpRight, Briefcase, Building2, Bus, Droplets, Flower2, HeartHandshake,
  Headset, LockKeyhole, MapPin, Menu, Phone, ShieldCheck, Sparkles, UserRound, Users, WashingMachine, X,
} from "lucide-react";
import arcoNascimento from "@/assets/logo-nascimento-icon.png";
import fachada from "@/assets/fachada.jpg";

// =========================================================================
// /site — o site institucional da Nascimento, público, sem login.
//
// Pedido de 11/09/2026: "um site empresarial e público incrível, com diversas
// conexões aos nossos outros links" — referência de linguagem visual em
// carmed-bay.vercel.app (tipografia gigante, cor de marca chapada, seções
// grandes com número e time, rodapé de colunas). Aqui a marca é a Nascimento:
// o arco laranja (#f97316) sobre o azul-marinho (#0f3171 / #241f66) que o
// resto do ERP e a página de denúncia já usam.
//
// Tudo o que este site aponta JÁ EXISTE no app e é público:
//   /vagas               portal de candidatura (banco de talentos)
//   /denuncia            Canal de Ética e Denúncias
//   /denuncia?acompanhar acompanhar uma denúncia pelo protocolo
//   /login               área do colaborador (ERP)
//
// Os NÚMEROS são estáticos de propósito — a página roda para `anon`, e as
// tabelas de pessoal não são (nem devem ser) legíveis sem login. Foram
// conferidos no banco em 11/09/2026: 2.227 colaboradores trabalhando, 58
// contratos ativos, 4 empresas do grupo, operação em RS, SC e PR. Atualizar
// aqui quando mudar de patamar; a data fica no rodapé.
//
// CSS injetado com prefixo `st-`, igual ao `dn-` da denúncia: a página não
// usa o Tailwind do ERP nem o layout do app, para carregar leve e não herdar
// nada de tela interna.
// =========================================================================

const ANO = new Date().getFullYear();

const NAV = [
  { href: "#servicos", label: "Serviços" },
  { href: "#sobre", label: "A empresa" },
  { href: "#empresas", label: "Grupo" },
  { href: "#numeros", label: "Números" },
  { href: "#clientes", label: "Clientes" },
  { href: "#carreiras", label: "Trabalhe conosco" },
  { href: "#contato", label: "Contato" },
];

const PALAVRAS = ["Limpeza", "Portaria", "Recepção", "Vigilância", "Jardinagem", "Logística"];

const SERVICOS: { icone: ReactNode; titulo: string; texto: string }[] = [
  { icone: <Droplets className="h-6 w-6" />, titulo: "Limpeza e conservação",
    texto: "Limpeza predial, hospitalar, escolar e de áreas comuns, com equipe própria, EPIs, produtos e supervisão em cada posto." },
  { icone: <UserRound className="h-6 w-6" />, titulo: "Portaria e recepção",
    texto: "Controle de acesso, recepção, atendimento ao público e telefonia. O primeiro contato do seu prédio com quem chega." },
  { icone: <ShieldCheck className="h-6 w-6" />, titulo: "Vigias e zeladoria",
    texto: "Vigia desarmado, zeladoria e ronda em prédios públicos, escolas, parques e unidades administrativas." },
  { icone: <Flower2 className="h-6 w-6" />, titulo: "Jardinagem e áreas verdes",
    texto: "Manutenção de jardins, poda, roçada e paisagismo em campi universitários, hospitais e órgãos públicos." },
  { icone: <Bus className="h-6 w-6" />, titulo: "Motoristas e operação de frota",
    texto: "Motoristas categoria B e D, operadores de máquina e coleta. A logística que mantém a cidade e a instituição andando." },
  { icone: <WashingMachine className="h-6 w-6" />, titulo: "Lavanderia hospitalar",
    texto: "Processamento de roupas em ambiente hospitalar, com o rigor de higienização que um hospital universitário exige." },
  { icone: <Headset className="h-6 w-6" />, titulo: "Apoio administrativo",
    texto: "Auxiliares administrativos, digitadores, telefonistas (inclusive TARM/SAMU), almoxarifes, mensageiros e intérpretes de Libras." },
  { icone: <Sparkles className="h-6 w-6" />, titulo: "Serviços gerais e copa",
    texto: "Copa e cozinha, carregadores e serviços gerais. O que falta para a rotina de uma instituição funcionar sem ruído." },
];

const EMPRESAS = [
  { sigla: "Nascimento", nome: "Nascimento Serviços de Limpeza", texto: "A empresa-mãe: limpeza, portaria, jardinagem, motoristas e apoio administrativo para universidades, tribunais, hospitais e prefeituras." },
  { sigla: "SN", nome: "SN Serviços de Limpeza e Zeladoria Predial", texto: "Zeladoria e limpeza predial com foco em contratos municipais e unidades administrativas." },
  { sigla: "NH", nome: "NH Prestação de Serviços", texto: "Vigias, portaria e serviços emergenciais. A resposta rápida do grupo para demandas urgentes." },
  { sigla: "Canaã", nome: "Escola de Ensino Canaã", texto: "O braço de formação do grupo: educação e qualificação para quem entra e para quem cresce dentro da operação." },
];

const NUMEROS = [
  { valor: 2227, sufixo: "+", rotulo: "colaboradores", texto: "Pessoas trabalhando hoje nas operações do grupo. Cada uma com cadastro, escala, uniforme e EPI." },
  { valor: 58, sufixo: "", rotulo: "contratos ativos", texto: "Universidades federais, Tribunal de Justiça, Polícia Civil, hospitais universitários e dezenas de prefeituras." },
  { valor: 4, sufixo: "", rotulo: "empresas do grupo", texto: "Nascimento, SN, NH e Canaã. Cada uma com a sua especialidade, todas com a mesma gestão." },
  { valor: 3, sufixo: "", rotulo: "estados", texto: "Rio Grande do Sul, Santa Catarina e Paraná, da capital ao interior." },
];

const CLIENTES = [
  "UFRGS", "TJRS", "Polícia Civil RS", "HCPA", "FURG", "UFFS", "HUSM Santa Maria", "Embrapa", "SAMU",
  "Prefeitura de Porto Alegre", "DMAE", "Prefeitura de Bento Gonçalves", "Prefeitura de Caxias do Sul",
  "Prefeitura de Triunfo", "Prefeitura de Veranópolis", "Prefeitura de Charqueadas", "Câmara de Rio Grande",
  "Hospital São Camilo", "SEMAE", "IPAM", "IPASEM", "Funarbe Pelotas",
];

const VALORES = [
  { titulo: "Gente na frente", texto: "Serviço é pessoa. Cada posto tem nome, supervisão e caminho para crescer, do encarregado ao analista." },
  { titulo: "Contrato é compromisso", texto: "Licitação ganha é operação que tem que funcionar no dia seguinte, com o quadro completo e o material no lugar." },
  { titulo: "Transparência de ponta a ponta", texto: "Canal de ética aberto ao público, apuração com prazo e retorno a quem relatou. Sem exceção." },
  { titulo: "Tecnologia própria", texto: "Um ERP construído dentro de casa integra folha, recrutamento, suprimentos e operação. É por ele que o grupo se gerencia." },
];

// ── Utilidades ────────────────────────────────────────────────────────────
/** Marca a seção como visível quando entra na tela (anima uma vez só). */
function useRevelar<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { el?.setAttribute("data-on", "1"); return; }
    const obs = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { el.setAttribute("data-on", "1"); obs.disconnect(); }
    }, { threshold: 0.18 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

/** Contador que sobe até o valor quando aparece na tela. */
function Contador({ valor, sufixo }: { valor: number; sufixo: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let iniciado = false;
    const rodar = () => {
      if (iniciado) return; iniciado = true;
      const t0 = performance.now(); const dur = 1400;
      const passo = (t: number) => {
        const p = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        setN(Math.round(valor * e));
        if (p < 1) requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    };
    if (typeof IntersectionObserver === "undefined") { rodar(); return; }
    const obs = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { rodar(); obs.disconnect(); } }, { threshold: 0.4 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [valor]);
  return <span ref={ref}>{n.toLocaleString("pt-BR")}{sufixo}</span>;
}

function Logo({ claro = false }: { claro?: boolean }) {
  return (
    <a href="#topo" className="st-logo" data-claro={claro ? "1" : "0"} aria-label="Nascimento, soluções em serviços">
      <img src={arcoNascimento} alt="" aria-hidden="true" />
      <span><b>Nascimento</b><i>soluções em serviços</i></span>
    </a>
  );
}

function Secao({ id, eyebrow, titulo, sub, children, escuro = false, className = "" }: {
  id: string; eyebrow: string; titulo: ReactNode; sub?: ReactNode; children: ReactNode; escuro?: boolean; className?: string;
}) {
  const ref = useRevelar<HTMLElement>();
  return (
    <section id={id} ref={ref} className={`st-sec ${escuro ? "st-sec-escura" : ""} ${className}`}>
      <div className="st-wrap">
        <div className="st-sec-h">
          <span className="st-eyebrow">{eyebrow}</span>
          <h2>{titulo}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

// ── Página ────────────────────────────────────────────────────────────────
export default function Site() {
  const [menu, setMenu] = useState(false);
  const [rolou, setRolou] = useState(false);
  const [palavra, setPalavra] = useState(0);

  useEffect(() => {
    document.title = "Nascimento | Soluções em Serviços";
    const onScroll = () => setRolou(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // A palavra gigante do hero troca sozinha — é o "Beijinhos" da referência,
  // só que aqui cada palavra é uma linha de serviço.
  useEffect(() => {
    const t = setInterval(() => setPalavra((p) => (p + 1) % PALAVRAS.length), 2600);
    return () => clearInterval(t);
  }, []);

  const ir = (href: string) => {
    setMenu(false);
    document.querySelector(href)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="st" id="topo">
      <Estilos />

      {/* ── Topo ── */}
      <header className={`st-top ${rolou ? "st-top-rolou" : ""}`}>
        <div className="st-wrap st-top-in">
          <Logo />
          <nav className="st-nav" aria-label="Seções do site">
            {NAV.map((n) => <a key={n.href} href={n.href} onClick={(e) => { e.preventDefault(); ir(n.href); }}>{n.label}</a>)}
          </nav>
          <div className="st-top-cta">
            <Link to="/denuncia" className="st-btn st-btn-ghost"><ShieldCheck className="h-4 w-4" /> Canal de Ética</Link>
            <Link to="/vagas" className="st-btn st-btn-laranja">Vagas abertas <ArrowRight className="h-4 w-4" /></Link>
          </div>
          <button className="st-burger" aria-label={menu ? "Fechar menu" : "Abrir menu"} onClick={() => setMenu((v) => !v)}>
            {menu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menu && (
          <div className="st-menu-m">
            {NAV.map((n) => <a key={n.href} href={n.href} onClick={(e) => { e.preventDefault(); ir(n.href); }}>{n.label}</a>)}
            <Link to="/vagas" className="st-btn st-btn-laranja">Vagas abertas <ArrowRight className="h-4 w-4" /></Link>
            <Link to="/denuncia" className="st-btn st-btn-ghost"><ShieldCheck className="h-4 w-4" /> Canal de Ética</Link>
            <Link to="/login" className="st-btn st-btn-ghost"><LockKeyhole className="h-4 w-4" /> Área do colaborador</Link>
          </div>
        )}
      </header>

      {/* ── Hero ── */}
      <section className="st-hero">
        <div className="st-hero-bg" aria-hidden="true">
          {PALAVRAS.map((p, i) => (
            <span key={p} className="st-hero-palavra" data-on={i === palavra ? "1" : "0"}>{p}</span>
          ))}
        </div>
        <div className="st-wrap st-hero-in">
          <div className="st-hero-txt">
            <span className="st-eyebrow st-eyebrow-claro"><Building2 className="h-3.5 w-3.5" /> Grupo Nascimento · desde Triunfo/RS para três estados</span>
            <h1>
              A operação que faz<br />
              a instituição <em>funcionar.</em>
            </h1>
            <p>
              Limpeza, portaria, vigilância, jardinagem, motoristas e apoio administrativo para
              universidades, tribunais, hospitais e prefeituras. Mais de 2.200 pessoas em campo,
              com gestão própria de ponta a ponta.
            </p>
            <div className="st-hero-cta">
              <a href="#contato" className="st-btn st-btn-laranja st-btn-g" onClick={(e) => { e.preventDefault(); ir("#contato"); }}>
                Falar com a Nascimento <ArrowRight className="h-4 w-4" />
              </a>
              <Link to="/vagas" className="st-btn st-btn-branco st-btn-g"><Briefcase className="h-4 w-4" /> Ver vagas abertas</Link>
            </div>
            <div className="st-hero-selos">
              <span><Users className="h-4 w-4" /> 2.200+ colaboradores</span>
              <span><Building2 className="h-4 w-4" /> 58 contratos ativos</span>
              <span><MapPin className="h-4 w-4" /> RS · SC · PR</span>
            </div>
          </div>
          <figure className="st-hero-foto">
            <img src={fachada} alt="Sede da Nascimento em Triunfo/RS" loading="eager" />
            <figcaption>Sede administrativa · Triunfo/RS</figcaption>
          </figure>
        </div>
      </section>

      {/* ── Serviços ── */}
      <Secao id="servicos" eyebrow="O que fazemos"
        titulo={<>Serviços que <em>sustentam</em> a rotina.</>}
        sub="Um contrato de serviços é o que acontece todo dia às 6 da manhã. É isso que entregamos: gente treinada, material no lugar e supervisão presente.">
        <div className="st-grid st-grid-4">
          {SERVICOS.map((s, i) => (
            <article key={s.titulo} className="st-card st-rev" style={{ transitionDelay: `${i * 60}ms` }}>
              <span className="st-card-ic">{s.icone}</span>
              <h3>{s.titulo}</h3>
              <p>{s.texto}</p>
            </article>
          ))}
        </div>
      </Secao>

      {/* ── A empresa ── */}
      <Secao id="sobre" eyebrow="A empresa" escuro
        titulo={<>Nascimento.<br /><em>Soluções em serviços.</em></>}
        sub="Uma empresa gaúcha que cresceu contrato a contrato: começou na limpeza, entrou na portaria, na jardinagem, na frota. Hoje sustenta a operação de algumas das maiores instituições públicas do Sul.">
        <div className="st-sobre">
          <figure className="st-sobre-foto st-rev">
            <img src={fachada} alt="Fachada da sede da Nascimento" loading="lazy" />
          </figure>
          <div className="st-valores">
            {VALORES.map((v, i) => (
              <div key={v.titulo} className="st-valor st-rev" style={{ transitionDelay: `${120 + i * 80}ms` }}>
                <span className="st-valor-n">0{i + 1}</span>
                <div><h3>{v.titulo}</h3><p>{v.texto}</p></div>
              </div>
            ))}
          </div>
        </div>
      </Secao>

      {/* ── Grupo ── */}
      <Secao id="empresas" eyebrow="O grupo"
        titulo={<>Quatro empresas, <em>uma gestão.</em></>}
        sub="Cada empresa do grupo atende um perfil de contrato. O que não muda é quem cuida: a mesma equipe de RH, suprimentos, jurídico e operação.">
        <div className="st-grid st-grid-4">
          {EMPRESAS.map((e, i) => (
            <article key={e.sigla} className="st-emp st-rev" style={{ transitionDelay: `${i * 70}ms` }}>
              <span className="st-emp-sigla">{e.sigla}</span>
              <h3>{e.nome}</h3>
              <p>{e.texto}</p>
            </article>
          ))}
        </div>
      </Secao>

      {/* ── Números ── */}
      <Secao id="numeros" eyebrow="Em números" escuro className="st-sec-laranja"
        titulo={<>Números que <em>se veem</em> em campo.</>}>
        <div className="st-grid st-grid-4">
          {NUMEROS.map((n, i) => (
            <div key={n.rotulo} className="st-num st-rev" style={{ transitionDelay: `${i * 80}ms` }}>
              <strong><Contador valor={n.valor} sufixo={n.sufixo} /></strong>
              <span>{n.rotulo}</span>
              <p>{n.texto}</p>
            </div>
          ))}
        </div>
      </Secao>

      {/* ── Clientes ── */}
      <section id="clientes" className="st-sec st-clientes">
        <div className="st-wrap st-sec-h">
          <span className="st-eyebrow">Quem confia</span>
          <h2>Instituições que <em>abrem a porta</em> todo dia com a gente.</h2>
        </div>
        <div className="st-marquee" aria-label="Clientes">
          <div className="st-marquee-in">
            {[...CLIENTES, ...CLIENTES].map((c, i) => <span key={i}>{c}</span>)}
          </div>
        </div>
        <div className="st-marquee st-marquee-rev" aria-hidden="true">
          <div className="st-marquee-in">
            {[...CLIENTES.slice().reverse(), ...CLIENTES.slice().reverse()].map((c, i) => <span key={i}>{c}</span>)}
          </div>
        </div>
      </section>

      {/* ── Carreiras ── */}
      <Secao id="carreiras" eyebrow="Trabalhe conosco"
        titulo={<>Sua próxima vaga <em>está aqui.</em></>}
        sub="Abrimos vagas toda semana, em dezenas de cidades. Cadastre seu currículo uma vez e ele fica no nosso banco de talentos para todas as próximas.">
        <div className="st-grid st-grid-3">
          <Link to="/vagas" className="st-cta st-rev">
            <Briefcase className="h-7 w-7" />
            <h3>Vagas abertas</h3>
            <p>Veja as vagas do momento por cidade e cargo e candidate-se pelo celular, em cinco minutos.</p>
            <span className="st-cta-link">Ver vagas <ArrowUpRight className="h-4 w-4" /></span>
          </Link>
          <Link to="/vagas" className="st-cta st-rev" style={{ transitionDelay: "80ms" }}>
            <Users className="h-7 w-7" />
            <h3>Banco de talentos</h3>
            <p>Não achou a vaga certa? Deixe o currículo: o Recrutamento procura no banco antes de abrir qualquer seleção.</p>
            <span className="st-cta-link">Cadastrar currículo <ArrowUpRight className="h-4 w-4" /></span>
          </Link>
          <Link to="/login" className="st-cta st-rev" style={{ transitionDelay: "160ms" }}>
            <LockKeyhole className="h-7 w-7" />
            <h3>Área do colaborador</h3>
            <p>Já é da Nascimento? Entre no ERP para solicitações, férias, formulários e o Espaço do Colaborador.</p>
            <span className="st-cta-link">Entrar <ArrowUpRight className="h-4 w-4" /></span>
          </Link>
        </div>
      </Secao>

      {/* ── Ética ── */}
      <Secao id="etica" eyebrow="Ética e transparência" escuro
        titulo={<>Sua voz é protegida. <em>Relate com segurança.</em></>}
        sub="O Canal de Ética recebe relatos de qualquer pessoa (colaborador, fornecedor, cliente ou cidadão), de forma anônima ou identificada. Cada caso tem comitê, prazo e retorno.">
        <div className="st-etica">
          <div className="st-etica-txt st-rev">
            <ul>
              <li><ShieldCheck className="h-5 w-5" /> Anônimo de verdade: nem e-mail, nem endereço de internet, nem aparelho são gravados.</li>
              <li><HeartHandshake className="h-5 w-5" /> Proteção contra retaliação para quem relata de boa-fé.</li>
              <li><LockKeyhole className="h-5 w-5" /> Identidade do denunciante visível só para quem tem a capacidade de sigilo no comitê.</li>
            </ul>
          </div>
          <div className="st-etica-cta st-rev" style={{ transitionDelay: "100ms" }}>
            <Link to="/denuncia" className="st-btn st-btn-laranja st-btn-g">Registrar uma denúncia <ArrowRight className="h-4 w-4" /></Link>
            <Link to="/denuncia?acompanhar" className="st-btn st-btn-branco st-btn-g">Acompanhar pelo protocolo</Link>
          </div>
        </div>
      </Secao>

      {/* ── Contato ── */}
      <Secao id="contato" eyebrow="Contato"
        titulo={<>Vamos <em>conversar.</em></>}
        sub="Licitação, proposta comercial, parceria ou dúvida sobre um contrato em andamento: a sede fica em Triunfo, no Rio Grande do Sul.">
        <div className="st-contato">
          <div className="st-contato-card st-rev">
            <MapPin className="h-6 w-6" />
            <h3>Sede administrativa</h3>
            <p>Rua João Pessoa, 172<br />Triunfo, RS · CEP 95840-000</p>
            <a className="st-cta-link" href="https://www.google.com/maps/search/?api=1&query=Rua+Jo%C3%A3o+Pessoa+172+Triunfo+RS" target="_blank" rel="noopener noreferrer">
              Ver no mapa <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
          <div className="st-contato-card st-rev" style={{ transitionDelay: "80ms" }}>
            <Phone className="h-6 w-6" />
            <h3>Comercial e licitações</h3>
            <p>Atendimento em horário comercial, de segunda a sexta. Propostas e documentação para editais em todo o Sul.</p>
            <a className="st-cta-link" href="#contato" onClick={(e) => e.preventDefault()}>Segunda a sexta, 8h às 18h</a>
          </div>
          <div className="st-contato-card st-rev" style={{ transitionDelay: "160ms" }}>
            <Briefcase className="h-6 w-6" />
            <h3>Recrutamento</h3>
            <p>Candidaturas e currículos são só pelo portal. É por lá que o time de seleção acompanha cada etapa.</p>
            <Link className="st-cta-link" to="/vagas">Ir para o portal de vagas <ArrowUpRight className="h-4 w-4" /></Link>
          </div>
        </div>
      </Secao>

      {/* ── Rodapé ── */}
      <footer className="st-foot">
        <div className="st-wrap st-foot-in">
          <div className="st-foot-marca">
            <Logo claro />
            <p>Soluções em serviços para instituições públicas e privadas no Rio Grande do Sul, Santa Catarina e Paraná.</p>
          </div>
          <div className="st-foot-col">
            <h4>Empresa</h4>
            <a href="#sobre" onClick={(e) => { e.preventDefault(); ir("#sobre"); }}>Sobre a Nascimento</a>
            <a href="#servicos" onClick={(e) => { e.preventDefault(); ir("#servicos"); }}>Serviços</a>
            <a href="#empresas" onClick={(e) => { e.preventDefault(); ir("#empresas"); }}>Empresas do grupo</a>
            <a href="#clientes" onClick={(e) => { e.preventDefault(); ir("#clientes"); }}>Clientes</a>
          </div>
          <div className="st-foot-col">
            <h4>Pessoas</h4>
            <Link to="/vagas">Vagas abertas</Link>
            <Link to="/vagas">Banco de talentos</Link>
            <Link to="/login">Área do colaborador</Link>
          </div>
          <div className="st-foot-col">
            <h4>Ética</h4>
            <Link to="/denuncia">Canal de Ética e Denúncias</Link>
            <Link to="/denuncia?acompanhar">Acompanhar denúncia</Link>
          </div>
        </div>
        <div className="st-wrap st-foot-base">
          <span>© {ANO} Nascimento Serviços de Limpeza Ltda · CNPJ 03.644.009/0001-23</span>
          <span>Triunfo/RS · números conferidos em 11/09/2026</span>
        </div>
      </footer>
    </div>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────
function Estilos() {
  return <style>{`
    .st *, .st *::before, .st *::after { box-sizing: border-box; }
    .st { --azul: #0f3171; --azul-esc: #241f66; --azul-ink: #0b1f4a; --laranja: #f97316; --laranja-esc: #ea580c;
          --tinta: #0f172a; --cinza: #475569; --cinza-cl: #94a3b8; --fundo: #f5f7fb; --borda: #e2e8f0;
          font-family: Inter, system-ui, -apple-system, sans-serif; color: var(--tinta); background: #fff;
          -webkit-font-smoothing: antialiased; scroll-behavior: smooth; overflow-x: hidden; }
    .st h1, .st h2, .st h3, .st h4 { font-family: 'Plus Jakarta Sans', Inter, sans-serif; letter-spacing: -.025em; margin: 0; }
    .st a { color: inherit; text-decoration: none; }
    .st-wrap { max-width: 1180px; margin: 0 auto; padding: 0 22px; width: 100%; }

    /* ---- botões ---- */
    .st-btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 999px;
              font-size: 13.5px; font-weight: 700; border: 1.5px solid transparent; cursor: pointer; transition: .18s; white-space: nowrap; }
    .st-btn-g { padding: 14px 22px; font-size: 15px; }
    /* ".st .st-btn-*" precisa vencer o ".st a { color: inherit }" acima. */
    .st .st-btn-laranja { background: var(--laranja); color: #fff; box-shadow: 0 10px 30px rgba(249,115,22,.28); }
    .st .st-btn-laranja:hover { background: var(--laranja-esc); transform: translateY(-1px); }
    .st .st-btn-branco { background: #fff; color: var(--azul); }
    .st .st-btn-branco:hover { background: #eef2ff; }
    .st .st-btn-ghost { background: transparent; color: var(--azul); border-color: var(--borda); }
    .st .st-btn-ghost:hover { border-color: var(--laranja); color: var(--laranja-esc); }

    /* ---- topo ---- */
    .st-top { position: sticky; top: 0; z-index: 50; background: rgba(255,255,255,.72); backdrop-filter: blur(14px);
              border-bottom: 1px solid transparent; transition: .2s; }
    .st-top-rolou { border-bottom-color: var(--borda); background: rgba(255,255,255,.92); }
    .st-top-in { display: flex; align-items: center; justify-content: space-between; gap: 18px; height: 72px; }
    .st-logo { display: inline-flex; align-items: center; gap: 10px; }
    .st-logo img { width: 42px; height: auto; display: block; }
    .st-logo span { display: flex; flex-direction: column; line-height: 1; }
    .st-logo b { font-family: 'Plus Jakarta Sans', Inter, sans-serif; font-weight: 800; font-size: 19px; color: var(--azul-esc); letter-spacing: -.03em; }
    .st-logo i { font-style: normal; font-size: 10.5px; font-weight: 600; color: var(--azul); letter-spacing: .01em; margin-top: 2px; }
    .st-logo[data-claro="1"] b, .st-logo[data-claro="1"] i { color: #fff; }
    .st-nav { display: flex; gap: 18px; }
    .st-nav a { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--azul-esc); position: relative; padding: 6px 0; white-space: nowrap; }
    .st-nav a::after { content: ""; position: absolute; left: 0; bottom: 0; height: 2px; width: 0; background: var(--laranja); transition: width .25s; }
    .st-nav a:hover::after { width: 100%; }
    .st-top-cta { display: flex; gap: 8px; }
    .st-burger { display: none; width: 42px; height: 42px; border-radius: 12px; border: 1px solid var(--borda); background: #fff; color: var(--azul); align-items: center; justify-content: center; cursor: pointer; }
    .st-menu-m { display: none; }
    @media (max-width: 1120px) {
      .st-nav, .st-top-cta { display: none; }
      .st-burger { display: inline-flex; }
      .st-menu-m { display: flex; flex-direction: column; gap: 6px; padding: 10px 22px 18px; border-top: 1px solid var(--borda); background: #fff; }
      .st-menu-m a { padding: 10px 4px; font-weight: 700; color: var(--azul-esc); border-bottom: 1px solid #f1f5f9; }
      .st-menu-m .st-btn { justify-content: center; margin-top: 4px; border-bottom: none; }
    }

    /* ---- eyebrow / cabeçalho de seção ---- */
    .st-eyebrow { display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 800; letter-spacing: .12em;
                  text-transform: uppercase; color: var(--laranja-esc); background: #fff7ed; border: 1px solid #fed7aa; border-radius: 999px; padding: 6px 12px; }
    .st-eyebrow-claro { color: #fff; background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.22); }
    .st-sec { padding: 96px 0; }
    .st-sec-h { max-width: 780px; margin-bottom: 44px; }
    .st-sec-h h2 { font-size: clamp(30px, 4.4vw, 52px); font-weight: 800; line-height: 1.04; margin-top: 18px; color: var(--azul-ink); }
    .st-sec-h h2 em { font-style: normal; color: var(--laranja); }
    .st-sec-h p { font-size: clamp(15px, 1.6vw, 18px); line-height: 1.65; color: var(--cinza); margin: 16px 0 0; }
    .st-sec-escura { background: var(--azul-esc); color: #fff; }
    .st-sec-escura .st-sec-h h2 { color: #fff; }
    .st-sec-escura .st-sec-h p { color: rgba(255,255,255,.72); }
    .st-sec-escura .st-eyebrow { color: #fff; background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.2); }
    .st-sec-laranja { background: var(--laranja); }
    .st-sec-laranja .st-sec-h h2 em { color: var(--azul-ink); }
    .st-sec-laranja .st-eyebrow { background: rgba(255,255,255,.18); border-color: rgba(255,255,255,.3); }

    /* revelação */
    .st-rev { opacity: 0; transform: translateY(18px); transition: opacity .6s ease, transform .6s ease; }
    .st-sec[data-on="1"] .st-rev { opacity: 1; transform: none; }

    /* ---- hero ---- */
    .st-hero { position: relative; overflow: hidden; background: linear-gradient(160deg, var(--azul-esc) 0%, var(--azul) 55%, #143a85 100%); color: #fff; }
    .st-hero-bg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
    .st-hero-palavra { position: absolute; font-family: 'Plus Jakarta Sans', Inter, sans-serif; font-weight: 800; font-size: clamp(120px, 22vw, 330px);
                       letter-spacing: -.05em; line-height: 1; color: transparent; -webkit-text-stroke: 1.5px rgba(255,255,255,.14);
                       opacity: 0; transform: translateY(24px) scale(.98); transition: opacity .8s ease, transform .8s ease; white-space: nowrap; }
    .st-hero-palavra[data-on="1"] { opacity: 1; transform: none; }
    .st-hero-in { position: relative; display: grid; grid-template-columns: 1.1fr .9fr; gap: 44px; align-items: center; padding-top: 84px; padding-bottom: 84px; }
    .st-hero h1 { font-size: clamp(36px, 4.9vw, 64px); font-weight: 800; line-height: 1.02; margin: 20px 0 18px; }
    .st-hero h1 em { font-style: normal; color: var(--laranja); }
    .st-hero p { font-size: clamp(15.5px, 1.7vw, 18.5px); line-height: 1.65; color: rgba(255,255,255,.78); max-width: 560px; margin: 0; }
    .st-hero-cta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 28px; }
    .st-hero-selos { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 30px; }
    .st-hero-selos span { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; color: rgba(255,255,255,.85); }
    .st-hero-selos svg { color: var(--laranja); }
    .st-hero-foto { margin: 0; position: relative; border-radius: 26px; overflow: hidden; box-shadow: 0 40px 90px rgba(0,0,0,.45); transform: rotate(1.5deg); }
    .st-hero-foto img { display: block; width: 100%; height: 100%; object-fit: cover; aspect-ratio: 4/3; }
    .st-hero-foto figcaption { position: absolute; left: 14px; bottom: 14px; font-size: 11.5px; font-weight: 700; background: rgba(15,23,42,.6); backdrop-filter: blur(6px); padding: 6px 10px; border-radius: 999px; }
    @media (max-width: 900px) {
      .st-hero-in { grid-template-columns: 1fr; padding-top: 56px; padding-bottom: 56px; }
      .st-hero-foto { transform: none; }
      .st-sec { padding: 68px 0; }
    }

    /* ---- grids e cards ---- */
    .st-grid { display: grid; gap: 18px; }
    .st-grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .st-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    @media (max-width: 1000px) { .st-grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 720px) { .st-grid-4, .st-grid-3 { grid-template-columns: 1fr; } }
    .st-card { background: var(--fundo); border: 1px solid var(--borda); border-radius: 20px; padding: 24px; transition: transform .2s, box-shadow .2s, border-color .2s; }
    .st-card:hover { transform: translateY(-4px); box-shadow: 0 22px 50px rgba(15,23,42,.1); border-color: #fed7aa; }
    .st-card-ic { display: inline-flex; width: 46px; height: 46px; align-items: center; justify-content: center; border-radius: 14px; background: #fff; color: var(--laranja); border: 1px solid #fed7aa; margin-bottom: 16px; }
    .st-card h3 { font-size: 17px; font-weight: 800; color: var(--azul-ink); margin-bottom: 8px; }
    .st-card p { font-size: 14px; line-height: 1.6; color: var(--cinza); margin: 0; }

    /* ---- sobre ---- */
    .st-sobre { display: grid; grid-template-columns: 1fr 1.1fr; gap: 40px; align-items: center; }
    .st-sobre-foto { margin: 0; border-radius: 24px; overflow: hidden; box-shadow: 0 30px 70px rgba(0,0,0,.35); }
    .st-sobre-foto img { display: block; width: 100%; aspect-ratio: 5/4; object-fit: cover; }
    .st-valores { display: flex; flex-direction: column; gap: 16px; }
    .st-valor { display: flex; gap: 16px; padding: 18px 20px; border-radius: 18px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); }
    .st-valor-n { font-family: 'Plus Jakarta Sans', Inter, sans-serif; font-weight: 800; font-size: 22px; color: var(--laranja); line-height: 1; min-width: 34px; }
    .st-valor h3 { font-size: 16px; font-weight: 800; margin-bottom: 4px; }
    .st-valor p { font-size: 13.5px; line-height: 1.6; color: rgba(255,255,255,.72); margin: 0; }
    @media (max-width: 900px) { .st-sobre { grid-template-columns: 1fr; } }

    /* ---- empresas ---- */
    .st-emp { border-radius: 20px; padding: 26px; background: linear-gradient(160deg, var(--azul-esc), var(--azul)); color: #fff; min-height: 240px; display: flex; flex-direction: column; }
    .st-emp-sigla { font-family: 'Plus Jakarta Sans', Inter, sans-serif; font-weight: 800; font-size: 34px; letter-spacing: -.04em; color: var(--laranja); line-height: 1; margin-bottom: auto; }
    .st-emp h3 { font-size: 15.5px; font-weight: 800; margin: 18px 0 8px; }
    .st-emp p { font-size: 13.5px; line-height: 1.6; color: rgba(255,255,255,.75); margin: 0; }

    /* ---- números ---- */
    .st-num { background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.28); border-radius: 20px; padding: 26px 22px; color: #fff; }
    .st-num strong { display: block; font-family: 'Plus Jakarta Sans', Inter, sans-serif; font-weight: 800; font-size: clamp(42px, 5vw, 64px); letter-spacing: -.05em; line-height: 1; color: var(--azul-ink); }
    .st-num span { display: block; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; margin: 10px 0 12px; color: var(--azul-ink); }
    .st-num p { font-size: 13.5px; line-height: 1.6; margin: 0; color: rgba(255,255,255,.92); }

    /* ---- clientes ---- */
    .st-clientes { background: var(--fundo); padding-bottom: 80px; }
    .st-clientes .st-sec-h { margin-bottom: 30px; }
    .st-marquee { overflow: hidden; white-space: nowrap; mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); margin-top: 10px; }
    .st-marquee-in { display: inline-flex; gap: 14px; animation: st-mq 60s linear infinite; }
    .st-marquee-rev .st-marquee-in { animation-direction: reverse; animation-duration: 75s; }
    .st-marquee:hover .st-marquee-in { animation-play-state: paused; }
    .st-marquee-in span { display: inline-flex; align-items: center; padding: 12px 20px; border-radius: 999px; background: #fff; border: 1px solid var(--borda);
                          font-family: 'Plus Jakarta Sans', Inter, sans-serif; font-weight: 800; font-size: 15px; color: var(--azul-ink); }
    @keyframes st-mq { from { transform: translateX(0); } to { transform: translateX(-50%); } }
    @media (prefers-reduced-motion: reduce) { .st-marquee-in { animation: none; } .st-rev { transition: none; } }

    /* ---- carreiras / contato ---- */
    .st-cta { display: flex; flex-direction: column; gap: 10px; padding: 28px; border-radius: 22px; background: var(--fundo); border: 1px solid var(--borda); color: var(--azul-ink); transition: .2s; }
    .st-cta:hover { border-color: var(--laranja); transform: translateY(-4px); box-shadow: 0 22px 50px rgba(15,23,42,.1); }
    .st-cta svg:first-child { color: var(--laranja); }
    .st-cta h3 { font-size: 19px; font-weight: 800; }
    .st-cta p { font-size: 14px; line-height: 1.6; color: var(--cinza); margin: 0; flex: 1; }
    .st-cta-link { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; font-size: 14px; color: var(--laranja-esc); margin-top: 6px; }
    .st-contato { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
    .st-contato-card { padding: 26px; border-radius: 22px; background: var(--fundo); border: 1px solid var(--borda); display: flex; flex-direction: column; gap: 8px; }
    .st-contato-card svg:first-child { color: var(--laranja); }
    .st-contato-card h3 { font-size: 17px; font-weight: 800; color: var(--azul-ink); }
    .st-contato-card p { font-size: 14px; line-height: 1.65; color: var(--cinza); margin: 0; flex: 1; }
    @media (max-width: 720px) { .st-contato { grid-template-columns: 1fr; } }

    /* ---- ética ---- */
    .st-etica { display: grid; grid-template-columns: 1.2fr .8fr; gap: 34px; align-items: center; }
    .st-etica ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .st-etica li { display: flex; gap: 12px; align-items: flex-start; font-size: 15px; line-height: 1.55; color: rgba(255,255,255,.85); padding: 14px 16px; border-radius: 16px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); }
    .st-etica li svg { color: var(--laranja); flex-shrink: 0; margin-top: 2px; }
    .st-etica-cta { display: flex; flex-direction: column; gap: 12px; }
    .st-etica-cta .st-btn { justify-content: center; }
    @media (max-width: 900px) { .st-etica { grid-template-columns: 1fr; } }

    /* ---- rodapé ---- */
    .st-foot { background: var(--azul-ink); color: rgba(255,255,255,.8); padding: 60px 0 26px; }
    .st-foot-in { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr; gap: 30px; }
    .st-foot-marca p { font-size: 13.5px; line-height: 1.6; max-width: 340px; margin: 16px 0 0; }
    .st-foot-col { display: flex; flex-direction: column; gap: 9px; }
    .st-foot-col h4 { font-size: 11.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--laranja); margin-bottom: 6px; }
    .st-foot-col a { font-size: 14px; color: rgba(255,255,255,.8); }
    .st-foot-col a:hover { color: #fff; }
    .st-foot-base { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 44px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,.12); font-size: 12px; color: rgba(255,255,255,.55); }
    @media (max-width: 800px) { .st-foot-in { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 520px) { .st-foot-in { grid-template-columns: 1fr; } }
  `}</style>;
}
