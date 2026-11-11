import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { cardsSup, paginasSup, SEGUNDOS_POR_PAGINA_SUP, type DadosSupPainelTv, type ItemValor, type TomCard } from "@/lib/tv/supPainelTv";
import { FONTE, LARANJA, TINTA, TINTA_SUAVE } from "./base";

// =====================================================================
// TV › Compras — Suprimentos (11/11/2026, mig 20261111180000).
// Visão geral dos 6 indicadores + detalhe: a tabela dos itens que MAIS estão
// abaixo do mínimo (com o mínimo ao lado e a barra do quanto falta), os
// atrasos por contrato e fornecedor, e o estoque (maiores valores e parados).
// Regras: src/lib/tv/supPainelTv.ts.
// =====================================================================

const TOM: Record<TomCard, { tinta: string; fundo: string; rotulo: string }> = {
  bom: { tinta: "#15803d", fundo: "#dcfce7", rotulo: "Em dia" },
  atencao: { tinta: "#b45309", fundo: "#fef3c7", rotulo: "Atenção" },
  critico: { tinta: "#b91c1c", fundo: "#fee2e2", rotulo: "Crítico" },
  neutro: { tinta: "#475569", fundo: "#e2e8f0", rotulo: "Informativo" },
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const num = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const sombra = "0 10px 30px -14px rgba(15,23,42,.25)";
const nomeItem = (nome: string, tamanho: string | null) => (tamanho ? `${nome} · ${tamanho}` : nome);

function Bloco({ titulo, children, className = "" }: { titulo: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-0 flex-col rounded-[26px] bg-white px-8 py-6 ${className}`} style={{ boxShadow: sombra }}>
      <p className="mb-4 font-extrabold uppercase tracking-wide" style={{ fontSize: 22, color: TINTA_SUAVE }}>{titulo}</p>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function PaginaGeral({ d }: { d: DadosSupPainelTv }) {
  return (
    <div className="grid h-full grid-cols-3 grid-rows-2 gap-7">
      {cardsSup(d).map((c) => {
        const t = TOM[c.tom];
        return (
          <div key={c.chave} className="flex min-h-0 flex-col rounded-[28px] bg-white px-9 py-7" style={{ boxShadow: sombra, borderTop: `10px solid ${t.tinta}` }}>
            <div className="flex items-start justify-between gap-4">
              <p className="font-extrabold leading-tight" style={{ fontSize: 28, color: TINTA }}>{c.titulo}</p>
              <span className="shrink-0 rounded-full px-4 py-1 font-bold" style={{ fontSize: 18, background: t.fundo, color: t.tinta }}>{t.rotulo}</span>
            </div>
            <p className="mt-4 font-black leading-none tabular-nums" style={{ fontSize: 84, color: c.tom === "neutro" ? TINTA : t.tinta }}>{c.valor}</p>
            <p className="mt-3 font-semibold leading-snug" style={{ fontSize: 22, color: TINTA_SUAVE }}>{c.sub}</p>
            <p className="mt-auto pt-3 font-semibold italic" style={{ fontSize: 18, color: "#94a3b8" }}>{c.pergunta}</p>
          </div>
        );
      })}
    </div>
  );
}

/** A tabela pedida: os itens que mais estão abaixo do mínimo, com o mínimo junto. */
function PaginaMinimo({ d }: { d: DadosSupPainelTv }) {
  const am = d.estoque.abaixo_minimo;
  return (
    <div className="flex h-full flex-col gap-5">
      <div className="flex items-baseline gap-6">
        <p className="font-extrabold" style={{ fontSize: 40, color: TINTA }}>Os itens que mais estão abaixo do estoque mínimo</p>
        <p className="font-bold" style={{ fontSize: 24, color: TINTA_SUAVE }}>
          {am.qtd} abaixo · {am.zerados} zerado(s) · {brl(am.reposicao)} para repor
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-[26px] bg-white px-8 py-4" style={{ boxShadow: sombra }}>
        <table className="w-full" style={{ fontSize: 24 }}>
          <thead>
            <tr className="text-left font-extrabold uppercase" style={{ fontSize: 18, color: TINTA_SUAVE }}>
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Disponível</th>
              <th className="py-2 text-right">Mínimo</th>
              <th className="py-2 text-right">Falta</th>
              <th className="py-2 pl-8" style={{ width: "30%" }}>% do mínimo</th>
            </tr>
          </thead>
          <tbody>
            {am.itens.slice(0, 12).map((i) => {
              const cor = i.disp <= 0 ? "#b91c1c" : i.pct < 50 ? "#dc2626" : "#d97706";
              return (
                <tr key={`${i.nome}|${i.tamanho}`} style={{ borderTop: "1px solid #e4e4e7" }}>
                  <td className="py-2 pr-4 font-bold" style={{ color: TINTA, maxWidth: 700 }}>
                    <span className="block truncate">{nomeItem(i.nome, i.tamanho)}</span>
                  </td>
                  <td className="py-2 text-right font-black tabular-nums" style={{ color: cor }}>{num(i.disp)}</td>
                  <td className="py-2 text-right font-bold tabular-nums" style={{ color: TINTA }}>{num(i.minimo)}</td>
                  <td className="py-2 text-right font-bold tabular-nums" style={{ color: TINTA_SUAVE }}>{num(i.falta)}</td>
                  <td className="py-2 pl-8">
                    <div className="flex items-center gap-3">
                      <div className="relative h-5 flex-1 overflow-hidden rounded-full" style={{ background: "#e4e4e7" }}>
                        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(2, Math.min(100, i.pct))}%`, background: cor }} />
                      </div>
                      <span className="w-[90px] text-right font-black tabular-nums" style={{ fontSize: 22, color: cor }}>{num(i.pct)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListaContratos({ itens, vazio }: { itens: { contrato: string; qtd: number; dias: number }[]; vazio: string }) {
  if (!itens.length) return <p className="font-bold" style={{ fontSize: 24, color: "#15803d" }}>{vazio}</p>;
  const max = Math.max(...itens.map((i) => i.dias), 1);
  return (
    <div className="space-y-3">
      {itens.slice(0, 7).map((i) => (
        <div key={i.contrato}>
          <div className="flex items-baseline justify-between gap-3" style={{ fontSize: 21 }}>
            <span className="truncate font-bold" style={{ color: TINTA }}>{i.contrato}</span>
            <span className="shrink-0 font-black tabular-nums" style={{ color: "#b45309" }}>{i.qtd} · {i.dias} d</span>
          </div>
          <div className="mt-1 h-3 overflow-hidden rounded-full" style={{ background: "#f1f5f9" }}>
            <div className="h-full rounded-full" style={{ width: `${(i.dias / max) * 100}%`, background: "#f59e0b" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PaginaAtrasos({ d }: { d: DadosSupPainelTv }) {
  const cv = d.pedidos.compras_vencidas;
  const se = d.pedidos.sem_entrega;
  const f = d.fornecedor;
  return (
    <div className="grid h-full grid-cols-3 gap-7">
      <Bloco titulo={`Compras vencidas · ${cv.qtd} pedido(s)`}>
        <ListaContratos itens={cv.por_contrato} vazio={`Nenhum pedido aguardando compra há mais de ${cv.dias} dias.`} />
      </Bloco>
      <Bloco titulo={`Contratos sem entrega · ${se.contratos}`}>
        <ListaContratos itens={se.por_contrato} vazio={`Nenhum pedido parado há mais de ${se.dias} dias.`} />
        {se.por_status.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {se.por_status.map((s) => (
              <span key={s.status} className="rounded-full px-4 py-1 font-bold" style={{ fontSize: 18, background: "#f1f5f9", color: TINTA }}>{s.status.toLowerCase()}: {s.qtd}</span>
            ))}
          </div>
        )}
      </Bloco>
      <Bloco titulo="Atraso por fornecedor">
        {f.por_fornecedor.length ? (
          <div className="space-y-4">
            {f.por_fornecedor.map((x) => (
              <div key={x.fornecedor} className="flex items-baseline justify-between gap-3" style={{ fontSize: 22 }}>
                <span className="truncate font-bold" style={{ color: TINTA }}>{x.fornecedor}</span>
                <span className="shrink-0 font-black" style={{ color: "#b91c1c" }}>{x.qtd} · {x.dias} d</span>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <p className="font-bold" style={{ fontSize: 26, color: f.enviados ? "#15803d" : TINTA }}>
              {f.enviados ? "Nenhum pedido de compra com entrega vencida." : "Nenhum pedido de compra enviado ao fornecedor ainda."}
            </p>
            <p className="mt-3 font-semibold" style={{ fontSize: 20, color: TINTA_SUAVE }}>
              O atraso por fornecedor sai dos pedidos de compra (Suprimentos › Pedido de Compra), com a data-limite de entrega. {f.registrados} registrado(s) até agora.
            </p>
          </div>
        )}
      </Bloco>
    </div>
  );
}

function ListaValor({ itens }: { itens: ItemValor[] }) {
  return (
    <div className="space-y-3">
      {itens.slice(0, 8).map((i) => (
        <div key={`${i.nome}|${i.tamanho}`} className="flex items-baseline justify-between gap-3" style={{ fontSize: 21 }}>
          <span className="truncate font-bold" style={{ color: TINTA }}>{nomeItem(i.nome, i.tamanho)}</span>
          <span className="shrink-0 font-black tabular-nums" style={{ color: TINTA }}>{brl(i.valor)}<span className="ml-2 font-semibold" style={{ color: TINTA_SUAVE, fontSize: 18 }}>{num(i.qtd)} un.</span></span>
        </div>
      ))}
    </div>
  );
}

function PaginaEstoque({ d }: { d: DadosSupPainelTv }) {
  const v = d.estoque.valor;
  const sm = d.estoque.sem_mov;
  const maxTipo = Math.max(...v.por_tipo.map((t) => t.valor), 1);
  return (
    <div className="grid h-full grid-cols-3 gap-7">
      <Bloco titulo={`Valor em estoque · ${brl(v.total)}`}>
        <div className="space-y-4">
          {v.por_tipo.slice(0, 6).map((t) => (
            <div key={t.tipo}>
              <div className="flex justify-between font-bold" style={{ fontSize: 21, color: TINTA }}>
                <span className="truncate capitalize">{t.tipo.toLowerCase()}</span><span className="tabular-nums">{brl(t.valor)}</span>
              </div>
              <div className="mt-1 h-3 overflow-hidden rounded-full" style={{ background: "#f1f5f9" }}>
                <div className="h-full rounded-full" style={{ width: `${(t.valor / maxTipo) * 100}%`, background: "#0e7490" }} />
              </div>
            </div>
          ))}
        </div>
      </Bloco>
      <Bloco titulo="Maiores valores em estoque"><ListaValor itens={v.maiores} /></Bloco>
      <Bloco titulo={`Sem movimentação há ${sm.dias}+ dias · ${brl(sm.valor)}`}>
        {sm.itens.length ? <ListaValor itens={sm.itens} />
          : <p className="font-bold" style={{ fontSize: 24, color: "#15803d" }}>Todo item com saldo se movimentou nos últimos {sm.dias} dias.</p>}
      </Bloco>
    </div>
  );
}

/** A TV inteira do relatório "sup-painel". */
export function TelaSupPainel({ d, cor, atualizado }: { d: DadosSupPainelTv; cor: string; atualizado: string | null }) {
  const paginas = paginasSup(d);
  const [pagina, setPagina] = useState(0);
  const [agora, setAgora] = useState(() => new Date());
  const ms = SEGUNDOS_POR_PAGINA_SUP * 1000;
  useEffect(() => {
    if (paginas.length < 2) return;
    const t = window.setTimeout(() => setPagina((p) => (p + 1) % paginas.length), ms);
    return () => window.clearTimeout(t);
  }, [pagina, paginas.length, ms]);
  useEffect(() => { const t = window.setInterval(() => setAgora(new Date()), 15_000); return () => window.clearInterval(t); }, []);
  const p = paginas[Math.min(pagina, paginas.length - 1)];

  return (
    <div className="flex h-full w-full flex-col" style={{ fontFamily: FONTE }}>
      <div className="relative flex shrink-0 items-center gap-7 overflow-hidden px-14 text-white" style={{ height: 150, background: `linear-gradient(115deg, ${cor} 0%, #083344 100%)` }}>
        <div className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-[24px]" style={{ background: "rgba(255,255,255,0.16)" }}>
          <Package style={{ width: 50, height: 50 }} strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-extrabold leading-none tracking-tight" style={{ fontSize: 58 }}>Suprimentos</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {[p.titulo, `${d.estoque.itens.toLocaleString("pt-BR")} itens em estoque`].map((s) => (
              <span key={s} className="rounded-full px-5 py-1 font-bold uppercase tracking-wide" style={{ fontSize: 19, background: "#fff", color: cor }}>{s}</span>
            ))}
          </div>
        </div>
        <p className="shrink-0 font-black leading-none tabular-nums" style={{ fontSize: 70 }}>{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
        <div className="shrink-0 rounded-2xl px-5 py-3 text-center font-black uppercase leading-tight tracking-wider" style={{ fontSize: 19, background: LARANJA }}>Grupo<br />Nascimento</div>
      </div>

      <div key={pagina} className="min-h-0 flex-1 px-12 pb-5 pt-7" style={{ animation: "tv-entra 600ms ease-out" }}>
        {p.chave === "geral" ? <PaginaGeral d={d} />
          : p.chave === "minimo" ? <PaginaMinimo d={d} />
          : p.chave === "atrasos" ? <PaginaAtrasos d={d} />
          : <PaginaEstoque d={d} />}
      </div>

      <div className="flex shrink-0 items-center gap-5 px-12" style={{ height: 60 }}>
        <div className="flex gap-2.5">
          {paginas.map((x, i) => (
            <span key={x.chave} className="rounded-full px-4 py-1 font-bold" style={{ fontSize: 18, background: i === pagina ? cor : "#e4e4e7", color: i === pagina ? "#fff" : TINTA_SUAVE }}>{x.titulo}</span>
          ))}
        </div>
        <div className="relative h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: paginas.length > 1 ? "#e4e4e7" : "transparent" }}>
          {paginas.length > 1 && <div key={`${pagina}-${ms}`} className="absolute inset-y-0 left-0 rounded-full" style={{ background: cor, animation: `tv-progresso ${ms}ms linear forwards` }} />}
        </div>
        <p className="shrink-0 font-semibold" style={{ fontSize: 18, color: TINTA_SUAVE }}>{atualizado ? `Atualizado às ${atualizado}` : "ERP Grupo Nascimento"}</p>
      </div>
      <style>{"@keyframes tv-progresso { from { width: 0% } to { width: 100% } } @keyframes tv-entra { from { transform: translateY(18px) } to { transform: none } }"}</style>
    </div>
  );
}
