// Painel Gerencial — as frases de leitura rápida embaixo dos gráficos da aba
// Desenvolvimento. São só uma leitura da distribuição já calculada; nenhuma
// delas inventa número.
import { ItemDist } from "./tipos";
import { pct } from "./ui";

export function insightNec(d: ItemDist[]) {
  const tot = d.reduce((s, x) => s + x.n, 0); const top = [...d].filter(x => x.n).sort((a, b) => b.n - a.n)[0];
  if (!top) return null;
  return <div>💡 Necessidade mais citada: <b>{top.completo}</b> ({pct(top.n, tot)}).</div>;
}
export function insightSit(d: ItemDist[]) {
  const tot = d.reduce((s, x) => s + x.n, 0); const risco = d.find(x => /risco|ruim|insatisf/i.test(x.completo));
  if (!risco || !tot) return null;
  return <div>⚠️ <b>{pct(risco.n, tot)}</b> em <b>{risco.completo}</b> — atenção prioritária.</div>;
}
export function insightForte(d: ItemDist[]) {
  const top = [...d].filter(x => x.n).sort((a, b) => b.n - a.n)[0];
  if (!top) return null;
  return <div>⭐ Ponto forte mais reconhecido: <b>{top.completo}</b>.</div>;
}
