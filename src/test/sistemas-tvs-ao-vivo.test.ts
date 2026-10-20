import { describe, it, expect } from "vitest";
import { alertaDaTv, aoVivoFresco, itensNoAr, posicaoNoLaco, scriptPrincipal, telaAoVivo, type AlertaTv, type ItemTv } from "@/lib/tv/tv";
import { paginaNoTempo } from "@/lib/tv/relatorioTv";

// Sistemas › TV's — AO VIVO × PRÉVIA (mig 20261008000003). A gestão tem que
// mostrar o que a TV mostra: mesmos itens no ar, mesmo aviso, mesma pausa.

const agora = new Date("2026-10-08T12:00:00Z");
const item = (id: string, duracao_seg = 10, extra: Partial<ItemTv> = {}): ItemTv => ({
  id, tipo: "aviso", titulo: null, url: null, arquivo: null, texto: id, cor: null, duracao_seg, ...extra,
});
const alerta = (o: Partial<AlertaTv>): AlertaTv => ({
  id: "a1", texto: "Simulado", cor: "#dc2626", inicio: "2026-10-08T11:00:00Z", fim: "2026-10-08T13:00:00Z",
  todas: true, dispositivos: [], encerrado_em: null, created_at: "2026-10-08T11:00:00Z", ...o,
});
const tvOnline = { id: "tv1", nome: "TV RH", ativo: true, ultimo_ping: "2026-10-08T11:59:50Z" };

describe("itens no ar e aviso geral — as regras do tv_estado", () => {
  it("só ativos e dentro da validade, na ordem", () => {
    const xs = [
      { id: "b", ativo: true, valido_de: null, valido_ate: null, ordem: 20 },
      { id: "a", ativo: true, valido_de: null, valido_ate: null, ordem: 10 },
      { id: "oculto", ativo: false, valido_de: null, valido_ate: null, ordem: 5 },
      { id: "vencido", ativo: true, valido_de: null, valido_ate: "2026-10-08T11:00:00Z", ordem: 1 },
      { id: "futuro", ativo: true, valido_de: "2026-10-09T00:00:00Z", valido_ate: null, ordem: 2 },
    ];
    expect(itensNoAr(xs, agora).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("aviso: o mais recente valendo, para todas ou para esta TV", () => {
    expect(alertaDaTv([alerta({})], "tv1", agora)?.id).toBe("a1");
    expect(alertaDaTv([alerta({ todas: false, dispositivos: ["tv2"] })], "tv1", agora)).toBeNull();
    expect(alertaDaTv([alerta({ encerrado_em: "2026-10-08T11:30:00Z" })], "tv1", agora)).toBeNull();
    expect(alertaDaTv([alerta({ fim: "2026-10-08T11:59:00Z" })], "tv1", agora)).toBeNull();
    const dois = [alerta({ id: "velho" }), alerta({ id: "novo", created_at: "2026-10-08T11:30:00Z" })];
    expect(alertaDaTv(dois, "tv1", agora)?.id).toBe("novo");
  });
});

describe("posição na volta da playlist (simulação)", () => {
  it("anda pelos tempos e dá a volta", () => {
    const xs = [item("a", 10), item("b", 20)];
    expect(posicaoNoLaco(xs, 0)).toEqual({ indice: 0, noItemMs: 0 });
    expect(posicaoNoLaco(xs, 12_000)).toEqual({ indice: 1, noItemMs: 2_000 });
    expect(posicaoNoLaco(xs, 31_000)).toEqual({ indice: 0, noItemMs: 1_000 });
    expect(posicaoNoLaco([], 5_000)).toEqual({ indice: 0, noItemMs: 0 });
  });
});

describe("tela AO VIVO", () => {
  const itens = [item("a", 10), item("b", 20)];
  const base = { tv: tvOnline, itens, alertas: [] as AlertaTv[], agora, simulacaoDesde: agora.getTime() - 12_000 };

  it("TV informou o item: exato, desde quando", () => {
    const r = telaAoVivo({ ...base, aoVivo: { suportado: true, atual_item_id: "b", atual_desde: "2026-10-08T11:59:55Z" } });
    expect(r.exata).toBe(true);
    expect(r.indice).toBe(1);
    expect(r.tela).toMatchObject({ modo: "item", item: { id: "b" }, inicioS: 5 });
  });

  it("sem informação (banco sem a migration ou TV antiga): aproximado pelos tempos", () => {
    const r = telaAoVivo({ ...base, aoVivo: { suportado: false, atual_item_id: null, atual_desde: null } });
    expect(r.exata).toBe(false);
    expect(r.tela).toMatchObject({ modo: "item", item: { id: "b" } });
    // item que saiu da playlist também cai na simulação
    expect(telaAoVivo({ ...base, aoVivo: { suportado: true, atual_item_id: "sumiu", atual_desde: null } }).exata).toBe(false);
  });

  it("aviso geral por cima, pausada, relógio e offline", () => {
    const comAviso = telaAoVivo({ ...base, alertas: [alerta({})], aoVivo: null });
    expect(comAviso.tela.alerta).toEqual({ texto: "Simulado", cor: "#dc2626" });
    expect(telaAoVivo({ ...base, tv: { ...tvOnline, ativo: false }, aoVivo: null }).tela.modo).toBe("pausada");
    expect(telaAoVivo({ ...base, itens: [], aoVivo: null }).tela.modo).toBe("relogio");
    const off = telaAoVivo({ ...base, tv: { ...tvOnline, ultimo_ping: "2026-10-08T11:50:00Z" }, aoVivo: null });
    expect(off.tela).toMatchObject({ modo: "offline", visto: "há 10 min" });
  });

  it("a chave só muda quando a tela muda (o vídeo não recomeça a cada consulta)", () => {
    const av = { suportado: true, atual_item_id: "a", atual_desde: "2026-10-08T11:59:58Z" };
    const k1 = telaAoVivo({ ...base, aoVivo: av }).tela.chave;
    const k2 = telaAoVivo({ ...base, agora: new Date(agora.getTime() + 4_000), aoVivo: av }).tela.chave;
    const k3 = telaAoVivo({ ...base, aoVivo: { ...av, atual_item_id: "b", atual_desde: "2026-10-08T12:00:08Z" } }).tela.chave;
    expect(k1).toBe(k2);
    expect(k3).not.toBe(k1);
  });
});

// 20/10/2026 (mig 20261020000001): "quando coloco em ao vivo não aparece o
// que está aparecendo na TV". A TV confirma o item a cada consulta; o ao vivo
// acha o item mesmo fora da lista "no ar" da gestão, abre na página que a TV
// está, e o player recarrega quando sai versão nova.
describe("ao vivo confiável (mig 20261020000001)", () => {
  const itens = [item("a", 10), item("b", 20)];
  const base = { tv: tvOnline, itens, alertas: [] as AlertaTv[], agora, simulacaoDesde: agora.getTime() - 12_000 };

  it("confirmação fresca vale; velha (player antigo) cai na simulação; sem a coluna, vale como antes", () => {
    const fresca = { suportado: true, atual_item_id: "a", atual_desde: "2026-10-08T11:50:00Z", atual_em: "2026-10-08T11:59:50Z" };
    const velha = { ...fresca, atual_em: "2026-10-08T11:50:00Z" };
    expect(aoVivoFresco(fresca, agora)).toBe(true);
    expect(aoVivoFresco(velha, agora)).toBe(false);
    expect(aoVivoFresco({ ...fresca, atual_em: null }, agora)).toBe(false);
    expect(aoVivoFresco({ suportado: true, atual_item_id: "a", atual_desde: null }, agora)).toBeNull();
    expect(telaAoVivo({ ...base, aoVivo: fresca }).exata).toBe(true);
    expect(telaAoVivo({ ...base, aoVivo: velha }).exata).toBe(false);
    expect(telaAoVivo({ ...base, aoVivo: { suportado: true, atual_item_id: "a", atual_desde: "2026-10-08T11:59:55Z" } }).exata).toBe(true);
  });

  it("item informado fora dos 'no ar' da gestão: mostra o que a TV disse, não um simulado", () => {
    const av = { suportado: true, atual_item_id: "c", atual_desde: "2026-10-08T11:59:00Z", atual_em: "2026-10-08T11:59:55Z" };
    const r = telaAoVivo({ ...base, itensTodos: [...itens, item("c", 30)], aoVivo: av });
    expect(r.exata).toBe(true);
    expect(r.indice).toBeNull();
    expect(r.tela).toMatchObject({ modo: "item", item: { id: "c" }, inicioS: 60 });
  });

  it("página do relatório no tempo: abre onde a TV está e espera só o que falta", () => {
    expect(paginaNoTempo(0, 15_000, 3)).toEqual({ pagina: 0, faltaMs: 15_000 });
    expect(paginaNoTempo(20_000, 15_000, 3)).toEqual({ pagina: 1, faltaMs: 10_000 });
    expect(paginaNoTempo(50_000, 15_000, 3)).toEqual({ pagina: 0, faltaMs: 10_000 }); // deu a volta
    expect(paginaNoTempo(50_000, 15_000, 1)).toEqual({ pagina: 0, faltaMs: 15_000 });
  });

  it("versão publicada: acha o JS principal do index.html", () => {
    const html = `<!doctype html><head><script type="module" crossorigin src="/assets/index-AbC123.js"></script>
      <link rel="modulepreload" href="/assets/vendor-x.js"><script src="https://cdn.gpteng.co/gptengineer.js" type="module"></script></head>`;
    expect(scriptPrincipal(html)).toBe("/assets/index-AbC123.js");
    expect(scriptPrincipal(`<script type="module" src="/src/main.tsx"></script>`)).toBeNull(); // dev
    expect(scriptPrincipal("")).toBeNull();
  });
});
