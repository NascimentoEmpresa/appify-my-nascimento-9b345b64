import { describe, expect, it } from "vitest";
import {
  alternarFavorito,
  alternarRecolhido,
  CHAVE_FAVORITOS,
  montarGruposPresenca,
  moverItem,
  normalizarPreferencias,
  ordenarSetores,
  PREFERENCIAS_VAZIAS,
  reordenarPessoa,
  reordenarSetor,
  SEM_SETOR,
  type UsuarioElenco,
  estaAtivo,
  iniciais,
  INATIVIDADE_AUSENTE_MS,
  JANELA_ONLINE_MS,
  montarListaPresenca,
  statusPresenca,
  type PresencaLinha,
} from "@/lib/presencaOnline";

const AGORA = "2026-10-30T15:00:00.000Z";
const antes = (msAtras: number) => new Date(Date.parse(AGORA) - msAtras).toISOString();

describe("statusPresenca", () => {
  it("heartbeat recente e ativo = online", () => {
    expect(statusPresenca(antes(10_000), antes(10_000), AGORA)).toBe("online");
  });

  it("aba aberta mas parada = ausente", () => {
    expect(statusPresenca(antes(10_000), antes(JANELA_ONLINE_MS + 1), AGORA)).toBe("ausente");
  });

  it("no limite exato da janela ainda está online", () => {
    expect(statusPresenca(antes(JANELA_ONLINE_MS), antes(JANELA_ONLINE_MS), AGORA)).toBe("online");
  });

  it("sem heartbeat além da janela = offline, mesmo que ativo_em seja recente", () => {
    expect(statusPresenca(antes(JANELA_ONLINE_MS + 1), antes(0), AGORA)).toBe("offline");
  });

  it("data ausente ou inválida = offline", () => {
    expect(statusPresenca(null, null, AGORA)).toBe("offline");
    expect(statusPresenca("lixo", antes(0), AGORA)).toBe("offline");
  });

  it("um heartbeat perdido (2 min) não derruba ninguém", () => {
    expect(statusPresenca(antes(120_000), antes(120_000), AGORA)).toBe("online");
  });
});

describe("estaAtivo", () => {
  const t = Date.parse(AGORA);
  it("aba escondida nunca é ativa", () => {
    expect(estaAtivo(false, t, t)).toBe(false);
  });
  it("aba visível com interação recente é ativa", () => {
    expect(estaAtivo(true, t - 1000, t)).toBe(true);
  });
  it("aba visível parada há muito tempo vira ausente", () => {
    expect(estaAtivo(true, t - INATIVIDADE_AUSENTE_MS, t)).toBe(false);
  });
});

describe("montarListaPresenca", () => {
  const linha = (nome: string, visto: number, ativo: number): PresencaLinha => ({
    user_id: nome,
    nome,
    avatar_url: null,
    setor: null,
    visto_em: antes(visto),
    ativo_em: antes(ativo),
  });

  it("tira offline, põe online antes de ausente e ordena por nome sem acento", () => {
    const lista = montarListaPresenca(
      [
        linha("Zeca", 0, 0),
        linha("Érica", 0, 0),
        linha("Bruno", 0, JANELA_ONLINE_MS + 1),
        linha("Ana", 0, JANELA_ONLINE_MS + 1),
        linha("Carlos", JANELA_ONLINE_MS + 1, 0),
      ],
      AGORA,
    );
    expect(lista.map((p) => `${p.nome}:${p.status}`)).toEqual([
      "Érica:online",
      "Zeca:online",
      "Ana:ausente",
      "Bruno:ausente",
    ]);
  });
});

describe("iniciais", () => {
  it("primeira e última palavra", () => {
    expect(iniciais("Ana Luiza Faleiro")).toBe("AF");
    expect(iniciais("cálita")).toBe("C");
    expect(iniciais("  ")).toBe("?");
    expect(iniciais(null)).toBe("?");
  });
});

describe("painel por setor com favoritos", () => {
  const elenco: UsuarioElenco[] = [
    { user_id: "a", nome: "Ana", avatar_url: null, setor: "RH" },
    { user_id: "b", nome: "Bruno", avatar_url: null, setor: "RH" },
    { user_id: "c", nome: "Carla", avatar_url: null, setor: "Financeiro" },
    { user_id: "d", nome: "Érica", avatar_url: null, setor: null },
    { user_id: "e", nome: "Zeca", avatar_url: null, setor: "RH" },
  ];
  const presencas: PresencaLinha[] = [
    { user_id: "e", nome: "Zeca", avatar_url: null, setor: "RH", visto_em: antes(0), ativo_em: antes(0) },
    { user_id: "b", nome: "Bruno", avatar_url: null, setor: "RH", visto_em: antes(0), ativo_em: antes(JANELA_ONLINE_MS + 1) },
  ];
  const resumo = (gs: ReturnType<typeof montarGruposPresenca>) =>
    gs.map((g) => `${g.titulo}[${g.online}/${g.total}]:${g.pessoas.map((p) => `${p.nome}=${p.status}`).join(",")}`);

  it("mostra todos, offline incluído; online > ausente > offline; Sem setor por último", () => {
    expect(resumo(montarGruposPresenca(elenco, presencas, AGORA, PREFERENCIAS_VAZIAS))).toEqual([
      "Financeiro[0/1]:Carla=offline",
      "RH[1/3]:Zeca=online,Bruno=ausente,Ana=offline",
      `${SEM_SETOR}[0/1]:Érica=offline`,
    ]);
  });

  it("favorito sai do setor e vai para o grupo Favoritos no topo", () => {
    const prefs = alternarFavorito(PREFERENCIAS_VAZIAS, "c");
    const gs = montarGruposPresenca(elenco, presencas, AGORA, prefs);
    expect(gs[0].chave).toBe(CHAVE_FAVORITOS);
    expect(gs[0].pessoas.map((p) => p.user_id)).toEqual(["c"]);
    expect(gs.some((g) => g.titulo === "Financeiro")).toBe(false);
    expect(alternarFavorito(prefs, "c").favoritos).toEqual([]);
  });

  it("ordem arrastada vale; quem nunca foi arrastado vem depois", () => {
    const prefs = reordenarPessoa(PREFERENCIAS_VAZIAS, "RH", ["e", "b", "a"], "a", "e");
    expect(prefs.ordemPessoas.RH).toEqual(["a", "e", "b"]);
    const comNovo = [...elenco, { user_id: "f", nome: "Fábio", avatar_url: null, setor: "RH" }];
    const g = montarGruposPresenca(comNovo, presencas, AGORA, prefs).find((x) => x.chave === "RH")!;
    expect(g.pessoas.map((p) => p.user_id)).toEqual(["a", "e", "b", "f"]);
  });

  it("setores arrastados ficam na ordem; Sem setor continua no fim", () => {
    const prefs = reordenarSetor(PREFERENCIAS_VAZIAS, ["Financeiro", "RH"], "RH", "Financeiro");
    expect(montarGruposPresenca(elenco, presencas, AGORA, prefs).map((g) => g.titulo)).toEqual([
      "RH",
      "Financeiro",
      SEM_SETOR,
    ]);
    expect(ordenarSetores([SEM_SETOR, "B", "A"], [])).toEqual(["A", "B", SEM_SETOR]);
  });

  it("busca ignora acento/caixa, some com grupo vazio e abre os recolhidos", () => {
    const prefs = alternarRecolhido(PREFERENCIAS_VAZIAS, SEM_SETOR);
    expect(montarGruposPresenca(elenco, presencas, AGORA, prefs).at(-1)!.recolhido).toBe(true);
    const gs = montarGruposPresenca(elenco, presencas, AGORA, prefs, "ERICA");
    expect(gs.map((g) => `${g.titulo}:${g.recolhido}`)).toEqual([`${SEM_SETOR}:false`]);
  });

  it("normalizarPreferencias descarta lixo do jsonb", () => {
    expect(normalizarPreferencias(null)).toEqual(PREFERENCIAS_VAZIAS);
    expect(
      normalizarPreferencias({ favoritos: ["a", "a", 3, ""], ordemPessoas: { RH: ["x"], X: "y" }, recolhidos: "RH" }),
    ).toEqual({ favoritos: ["a"], ordemSetores: [], ordemPessoas: { RH: ["x"] }, recolhidos: [] });
  });

  it("moverItem não mexe quando o item não existe", () => {
    const l = ["a", "b"];
    expect(moverItem(l, "z", "a")).toBe(l);
  });
});
