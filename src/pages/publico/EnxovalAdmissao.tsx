import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { enxovalCompleto } from "@/lib/suprimentos/admissao";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Camera, Loader2, Shirt, XCircle } from "lucide-react";

type Estado = "verificando" | "invalido" | "formulario" | "enviado";

interface ItemEnxovalPublico {
  id: string;
  nome_item: string;
  tipo_item: string | null;
  tamanhos_disponiveis: string[];
  tamanho?: string | null;
}

interface EnxovalPublico {
  valido: boolean;
  motivo: "inexistente" | "ja_usado" | "expirado" | null;
  contrato_nome: string | null;
  funcao_nome: string | null;
  itens: ItemEnxovalPublico[];
}

const MOTIVOS: Record<string, string> = {
  inexistente: "Este link não existe. Confira se o endereço foi copiado por inteiro.",
  ja_usado: "Este link já foi usado para informar os tamanhos.",
  expirado: "Este link expirou. Peça um novo à equipe responsável pela sua admissão.",
};

const sb = supabase as any;

export default function EnxovalAdmissao() {
  const { token = "" } = useParams<{ token: string }>();
  const [estado, setEstado] = useState<Estado>("verificando");
  const [dados, setDados] = useState<EnxovalPublico | null>(null);
  const [motivo, setMotivo] = useState("inexistente");
  const [foto, setFoto] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const { data, error } = await sb.rpc("sup_adm_enxoval_publico", { p_token: token });
      if (!ativo) return;
      if (error || !data?.valido) {
        setMotivo(data?.motivo ?? "inexistente");
        setEstado("invalido");
        return;
      }
      setDados({
        ...data,
        itens: (data.itens ?? []).map((item: ItemEnxovalPublico) => ({
          ...item,
          tamanhos_disponiveis: item.tamanhos_disponiveis ?? [],
          tamanho: null,
        })),
      });
      setEstado("formulario");
    })();
    return () => { ativo = false; };
  }, [token]);

  const escolherTamanho = (id: string, tamanho: string) => {
    setDados((atual) => atual ? {
      ...atual,
      itens: atual.itens.map((item) => item.id === id ? { ...item, tamanho } : item),
    } : atual);
  };

  const enviar = async () => {
    if (!dados || !enxovalCompleto(dados.itens)) {
      setErro("Escolha o tamanho de todos os itens que possuem grade disponível.");
      return;
    }
    if (!foto) {
      setErro("Envie uma foto para o crachá.");
      return;
    }

    setErro(null);
    setEnviando(true);
    const extensaoBruta = foto.name.split(".").pop()?.toLowerCase() || "jpg";
    const extensao = extensaoBruta.replace(/[^a-z0-9]/g, "") || "jpg";
    const fotoPath = `admissoes/${token}/${crypto.randomUUID()}.${extensao}`;

    const { error: erroUpload } = await supabase.storage
      .from("sup-crachas")
      .upload(fotoPath, foto, { upsert: false, contentType: foto.type || undefined });
    if (erroUpload) {
      setErro("Não foi possível enviar a foto. Tente novamente.");
      setEnviando(false);
      return;
    }

    const { error: erroResposta } = await sb.rpc("sup_adm_enxoval_responder", {
      p_token: token,
      p_itens: dados.itens.map((item) => ({ id: item.id, tamanho: item.tamanho ?? null })),
      p_foto_path: fotoPath,
    });
    setEnviando(false);
    if (erroResposta) {
      setErro(erroResposta.message || "Não foi possível enviar os tamanhos.");
      return;
    }
    setEstado("enviado");
  };

  if (estado === "verificando") {
    return <Moldura><EstadoCentral icone={Loader2} girando titulo="Verificando o link..." /></Moldura>;
  }

  if (estado === "invalido") {
    return (
      <Moldura>
        <EstadoCentral icone={XCircle} titulo="Link indisponível"
          texto={MOTIVOS[motivo] ?? MOTIVOS.inexistente} classe="text-destructive" />
      </Moldura>
    );
  }

  if (estado === "enviado") {
    return (
      <Moldura>
        <EstadoCentral icone={CheckCircle2} titulo="Tamanhos enviados"
          texto="Recebemos suas informações e a foto do crachá. A equipe de Suprimentos já pode preparar os materiais da sua admissão."
          classe="text-emerald-600" />
      </Moldura>
    );
  }

  return (
    <Moldura>
      <div className="space-y-6">
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sua admissão</p>
          <p className="mt-1 font-semibold">{dados?.contrato_nome || "Contrato"}</p>
          <p className="text-sm text-muted-foreground">Função: {dados?.funcao_nome || "—"}</p>
        </div>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <Shirt className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-sm font-semibold">Uniformes e EPIs</h2>
              <p className="text-xs text-muted-foreground">Escolha o tamanho de cada item.</p>
            </div>
          </div>
          <div className="space-y-3">
            {(dados?.itens ?? []).map((item) => (
              <div key={item.id} className="rounded-lg border p-3">
                <Label htmlFor={`tamanho-${item.id}`} className="text-sm font-medium">{item.nome_item}</Label>
                <p className="mb-2 text-xs capitalize text-muted-foreground">{item.tipo_item || "material"}</p>
                {item.tamanhos_disponiveis.length ? (
                  <select id={`tamanho-${item.id}`} value={item.tamanho ?? ""}
                    onChange={(e) => escolherTamanho(item.id, e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Selecione o tamanho</option>
                    {item.tamanhos_disponiveis.map((tamanho) => (
                      <option key={tamanho} value={tamanho}>{tamanho}</option>
                    ))}
                  </select>
                ) : (
                  <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                    Este item não exige escolha de tamanho.
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border p-4">
          <div className="mb-3 flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-sm font-semibold">Foto para o crachá</h2>
              <p className="text-xs text-muted-foreground">Use uma foto nítida, de frente e com boa iluminação.</p>
            </div>
          </div>
          <Input type="file" accept="image/*" capture="environment"
            onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
          {foto && <p className="mt-2 text-xs text-muted-foreground">Arquivo: {foto.name}</p>}
        </section>

        {erro && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{erro}</div>}

        <Button className="w-full" size="lg" disabled={enviando} onClick={enviar}>
          {enviando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando...</> : "Enviar tamanhos e foto"}
        </Button>
      </div>
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 py-8">
      <div className="mx-auto w-full max-w-2xl px-4">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">Uniformes e EPIs da admissão</h1>
          <p className="text-sm text-muted-foreground">Nascimento — soluções em serviços</p>
        </header>
        <Card><CardContent className="p-5 sm:p-6">{children}</CardContent></Card>
      </div>
    </div>
  );
}

function EstadoCentral({
  icone: Icone, titulo, texto, classe = "text-muted-foreground", girando = false,
}: {
  icone: React.ElementType;
  titulo: string;
  texto?: string;
  classe?: string;
  girando?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <Icone className={`h-10 w-10 ${classe} ${girando ? "animate-spin" : ""}`} />
      <h2 className="text-lg font-semibold">{titulo}</h2>
      {texto && <p className="max-w-md text-sm text-muted-foreground">{texto}</p>}
    </div>
  );
}
