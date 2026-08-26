import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

// RPCs novas, ainda fora do types.ts gerado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/**
 * Atualização da lista oficial de CA do Ministério do Trabalho.
 *
 * O site do Ministério recusa download automático — responde 403 para qualquer
 * cliente que não seja um navegador de verdade. Então o caminho é o usuário ir
 * lá, baixar e anexar aqui. Este painel existe para que isso não vire "alguém
 * lembra de mexer numa pasta do servidor": o botão leva ao site já na página
 * certa, e o arquivo entra pelo próprio ERP.
 *
 * O arquivo NÃO é processado no navegador. São 20 MB compactados que viram
 * 98 MB e 33 mil linhas — descompactar isso aqui travaria a aba. A tela envia
 * ao Storage e enfileira; quem carrega é o worker.
 */

const SITE_MTE = "https://caepi.trabalho.gov.br/internet/consultaCAInternet.aspx";

// Acima de ~60 dias a lista começa a atrasar CA renovado; não é erro, é aviso.
const DIAS_PARA_AVISAR = 60;

interface SituacaoCatalogo {
  total_cas: number;
  carregado_em: string | null;
  dias_desde: number | null;
  arquivo_nome: string | null;
  enviado_por_nome: string | null;
  processando: boolean;
  ultimo_erro: string | null;
}

export function PainelCatalogoCa() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  const { data: situacao } = useQuery({
    queryKey: ["sst_ca_situacao"],
    // Enquanto o worker processa, a tela precisa perceber sozinha que terminou.
    refetchInterval: (q) => ((q.state.data as SituacaoCatalogo)?.processando ? 5_000 : false),
    queryFn: async (): Promise<SituacaoCatalogo | null> => {
      const { data, error } = await sb.rpc("sst_ca_situacao_catalogo");
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const enviar = useMutation({
    mutationFn: async (arquivo: File) => {
      const caminho = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${arquivo.name}`;
      const { error: erroUpload } = await supabase.storage
        .from("caepi")
        .upload(caminho, arquivo, { upsert: false });
      if (erroUpload) throw erroUpload;

      const { error } = await sb.rpc("sst_ca_registrar_upload", {
        p_path: caminho,
        p_nome: arquivo.name,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sst_ca_situacao"] });
      toast.success("Arquivo recebido. A lista será atualizada em alguns minutos.");
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Não foi possível enviar o arquivo.";
      toast.error(msg);
    },
    onSettled: () => setEnviando(false),
  });

  function escolher(arquivo: File | undefined) {
    if (!arquivo) return;
    // 100 MB cobre o arquivo compactado com folga larga; acima disso é engano
    // (alguém anexando o .txt já descompactado, por exemplo).
    if (arquivo.size > 100 * 1024 * 1024) {
      toast.error("Arquivo muito grande — anexe o arquivo compactado como veio do site.");
      return;
    }
    setEnviando(true);
    enviar.mutate(arquivo);
  }

  const vazio = !situacao?.carregado_em;
  const atrasado = (situacao?.dias_desde ?? 0) > DIAS_PARA_AVISAR;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-medium">Lista oficial de CA</h3>
            <p className="text-sm text-muted-foreground">
              É contra esta lista que o sistema confere o CA digitado nas entradas de EPI.
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={SITE_MTE} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Baixar do Ministério
              </a>
            </Button>
            <Button onClick={() => inputRef.current?.click()} disabled={enviando}>
              {enviando ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Anexar arquivo
            </Button>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                escolher(e.target.files?.[0]);
                e.target.value = ""; // permite reenviar o mesmo arquivo
              }}
            />
          </div>
        </div>

        <div
          className={cn(
            "flex items-start gap-3 rounded-md border p-3 text-sm",
            vazio || atrasado
              ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
              : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
          )}
        >
          {vazio || atrasado ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div className="space-y-1">
            {situacao?.processando && (
              <p className="font-medium">Processando o arquivo enviado…</p>
            )}

            {vazio && !situacao?.processando && (
              <p>
                <span className="font-medium">Nenhuma lista carregada ainda.</span> Sem ela o
                sistema aceita o CA como foi digitado, sem conferir com o Ministério.
              </p>
            )}

            {!vazio && (
              <>
                <p>
                  <span className="font-medium">
                    {situacao!.total_cas.toLocaleString("pt-BR")} CAs
                  </span>{" "}
                  carregados em{" "}
                  {new Date(situacao!.carregado_em!).toLocaleDateString("pt-BR")}
                  {situacao!.dias_desde !== null && situacao!.dias_desde > 0 && (
                    <> — há {situacao!.dias_desde} dia(s)</>
                  )}
                  .
                </p>
                {atrasado && (
                  <p>
                    Vale atualizar: CA renovado depois dessa data ainda aparece como vencido
                    aqui.
                  </p>
                )}
                {situacao!.enviado_por_nome && (
                  <p className="text-xs opacity-80">
                    Enviado por {situacao!.enviado_por_nome}
                    {situacao!.arquivo_nome ? ` — ${situacao!.arquivo_nome}` : ""}
                  </p>
                )}
              </>
            )}

            {situacao?.ultimo_erro && !situacao.processando && (
              <p className="text-xs opacity-80">Último problema: {situacao.ultimo_erro}</p>
            )}
          </div>
        </div>

        <ol className="space-y-1 text-sm text-muted-foreground">
          <li>1. Clique em <strong>Baixar do Ministério</strong> — abre o site oficial.</li>
          <li>
            2. No site, clique no botão azul <strong>Base de dados do sistema CAEPI
            (Download)</strong> e aguarde o arquivo.
          </li>
          <li>3. Volte aqui e clique em <strong>Anexar arquivo</strong>.</li>
        </ol>
      </CardContent>
    </Card>
  );
}
