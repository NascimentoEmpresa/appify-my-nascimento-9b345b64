import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  chavesSemCoordenada, consultaDaCidade, foiEntregue, montarParadas,
  type EventoCorreio, type Parada,
} from "@/lib/suprimentos/trajetoCorreio";

// `correios_geo_cidade` chega por migration aplicada manualmente antes da
// regeneração de types.ts; este cast segue o padrão dos demais hooks de
// Suprimentos (ver useCorreioDeclaracao.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/**
 * Por onde o objeto passou, pronto para o mapa.
 *
 * Duas fontes, nesta ordem:
 *   1. os Correios, pela Edge Function, dizem as CIDADES e as datas;
 *   2. a coordenada de cada cidade sai de `correios_geo_cidade`, e só as que
 *      faltam vão ao OpenStreetMap — uma por segundo, e o resultado volta
 *      para a tabela, para a empresa inteira nunca mais buscar aquela cidade.
 */

export interface ParadaNoMapa extends Parada {
  latitude: number | null;
  longitude: number | null;
}

export interface Trajeto {
  codigo: string;
  mensagem: string | null;
  eventos: EventoCorreio[];
  paradas: ParadaNoMapa[];
  entregue: boolean;
  /** Cidades que o mapa não conseguiu localizar — a tela avisa quais. */
  semCoordenada: string[];
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/** O Nominatim pede no máximo uma consulta por segundo. */
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Caixa do Brasil — a mesma do CHECK da tabela, para não tentar gravar lixo. */
const dentroDoBrasil = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= -34 && lat <= 6 && lng >= -74 && lng <= -34;

/** A linha como ela sai de `correios_geo_cidade`. */
interface LinhaGeo { chave: string; latitude: number; longitude: number }

async function coordenadasGravadas(chaves: string[]) {
  if (chaves.length === 0) return {} as Record<string, [number, number]>;
  const { data, error } = await sb
    .from("correios_geo_cidade")
    .select("chave, latitude, longitude")
    .in("chave", chaves);
  if (error) throw error;
  return Object.fromEntries(
    (data ?? []).map((l: LinhaGeo) => [l.chave, [Number(l.latitude), Number(l.longitude)] as [number, number]]),
  );
}

async function buscarNoMapa(consulta: string): Promise<[number, number] | null> {
  const url = `${NOMINATIM}?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(consulta)}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) return null;
  const dados = await r.json();
  const primeiro = Array.isArray(dados) ? dados[0] : null;
  if (!primeiro) return null;
  const lat = Number(primeiro.lat), lng = Number(primeiro.lon);
  return dentroDoBrasil(lat, lng) ? [lat, lng] : null;
}

export async function carregarTrajeto(codigo: string): Promise<Trajeto> {
  const limpo = (codigo ?? "").trim().toUpperCase();
  const { data, error } = await supabase.functions.invoke("correios", {
    body: { acao: "trajeto", codigo: limpo },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  const eventos: EventoCorreio[] = data?.eventos ?? [];
  const paradas = montarParadas(eventos);

  const conhecidas = await coordenadasGravadas([...new Set(paradas.map((p) => p.chave))]);

  // O que falta vai ao OpenStreetMap em série, com pausa entre as consultas —
  // é a regra de uso do serviço gratuito. Na prática são uma ou duas cidades
  // novas por objeto, porque as unidades de tratamento se repetem sempre.
  for (const chave of chavesSemCoordenada(paradas, conhecidas)) {
    const parada = paradas.find((p) => p.chave === chave)!;
    let achado: [number, number] | null = null;
    try {
      achado = await buscarNoMapa(consultaDaCidade(parada));
    } catch {
      // Mapa fora do ar não derruba o trajeto: a tela mostra a lista de
      // eventos, que é a informação, e avisa qual cidade ficou sem pino.
      achado = null;
    }
    if (!achado) continue;

    conhecidas[chave] = achado;
    // Grava para todo mundo. `ignoreDuplicates` porque dois usuários podem
    // abrir o mesmo objeto ao mesmo tempo e resolver a mesma cidade — o
    // segundo não é erro, é desperdício já consumado.
    await sb
      .from("correios_geo_cidade")
      .upsert(
        { chave, cidade: parada.cidade, uf: parada.uf, latitude: achado[0], longitude: achado[1] },
        { onConflict: "chave", ignoreDuplicates: true },
      );
    await esperar(1100);
  }

  const noMapa: ParadaNoMapa[] = paradas.map((p) => ({
    ...p,
    latitude: conhecidas[p.chave]?.[0] ?? null,
    longitude: conhecidas[p.chave]?.[1] ?? null,
  }));

  return {
    codigo: data?.codigo ?? limpo,
    mensagem: data?.mensagem ?? null,
    eventos,
    paradas: noMapa,
    entregue: foiEntregue(eventos),
    semCoordenada: noMapa.filter((p) => p.latitude == null).map((p) => `${p.cidade} - ${p.uf}`),
  };
}

/**
 * `enabled` só quando o mapa está aberto: sem isso toda a fila de pedidos
 * dispararia uma consulta de trajeto por card, e o trajeto é a chamada cara
 * (histórico inteiro + geocodificação).
 */
export function useTrajetoCorreio(codigo: string | null, aberto: boolean) {
  return useQuery({
    queryKey: ["correios_trajeto", (codigo ?? "").trim().toUpperCase()],
    enabled: aberto && !!(codigo ?? "").trim(),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: () => carregarTrajeto(codigo!),
  });
}
