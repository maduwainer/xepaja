import { useEffect, useState } from "react";
import { ApiError, EstablishmentApi, type EstablishmentMine } from "./api";
import { MapView } from "./MapView";

function captureGps(
  onOk: (lat: number, lng: number) => void,
  onFail: (message: string) => void,
) {
  if (!("geolocation" in navigator)) {
    onFail("Geolocalizacao nao suportada aqui: informe latitude e longitude manualmente.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => onOk(pos.coords.latitude, pos.coords.longitude),
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        onFail("Permissao de localizacao negada. Libere no navegador ou informe manualmente.");
      } else {
        onFail("Nao foi possivel obter o GPS. Tente de novo ou informe manualmente.");
      }
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

export function EstablishmentView() {
  const [data, setData] = useState<EstablishmentMine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: string; lng: string }>({ lat: "", lng: "" });

  useEffect(() => {
    EstablishmentApi.mine()
      .then((res) => {
        setData(res);
        if (res.establishment?.gps_lat !== null && res.establishment?.gps_lat !== undefined) {
          setGps({
            lat: String(res.establishment.gps_lat ?? ""),
            lng: String(res.establishment.gps_lng ?? ""),
          });
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Falha ao carregar."));
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      const form = new FormData(e.currentTarget);
      const body: Record<string, unknown> = {
        name: String(form.get("name") ?? ""),
        kind: String(form.get("kind") ?? ""),
        cnpj: String(form.get("cnpj") ?? ""),
        address_text: String(form.get("address") ?? ""),
        reference: String(form.get("reference") ?? ""),
        hours: String(form.get("hours") ?? ""),
      };
      if (gps.lat !== "" && gps.lng !== "") {
        body.gps_lat = Number(gps.lat.replace(",", "."));
        body.gps_lng = Number(gps.lng.replace(",", "."));
      }
      const res = data?.establishment
        ? await EstablishmentApi.update(body)
        : await EstablishmentApi.create(body);
      setData(res);
      setSaved(data?.establishment ? "Estabelecimento atualizado." : "Estabelecimento cadastrado.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha na requisicao. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  const estab = data?.establishment ?? null;

  return (
    <section aria-labelledby="estab-titulo" className="card">
      <h1 id="estab-titulo">Estabelecimento</h1>
      {data && (
        <p className="note" aria-live="polite">
          {data.can_publish
            ? "GPS registrado: voce podera publicar ofertas."
            : data.publish_block_reason}
        </p>
      )}
      {estab?.gps_lat !== null && estab?.gps_lat !== undefined && estab?.gps_lng !== null && estab?.gps_lng !== undefined && (
        <MapView
          center={{ lat: Number(estab.gps_lat), lng: Number(estab.gps_lng) }}
          markers={[{ lat: Number(estab.gps_lat), lng: Number(estab.gps_lng), label: estab.address_text }]}
          zoom={15}
          ariaLabel={`Mapa do local de retirada: ${estab.address_text}`}
          caption="Este e o ponto que os consumidores veem na busca."
        />
      )}
      <form onSubmit={handleSubmit} className="stack">
        <div className="field">
          <label htmlFor="estab-nome">Nome do estabelecimento</label>
          <input id="estab-nome" name="name" required defaultValue={estab?.name ?? ""} maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor="estab-tipo">Tipo</label>
          <select id="estab-tipo" name="kind" defaultValue={estab?.kind ?? "feira"}>
            <option value="feira">Feira</option>
            <option value="mercearia">Mercearia</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="estab-cnpj">CNPJ (se tiver)</label>
          <input id="estab-cnpj" name="cnpj" inputMode="numeric" autoComplete="off" defaultValue={estab?.cnpj ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="estab-end">Endereco de retirada</label>
          <input id="estab-end" name="address" required defaultValue={estab?.address_text ?? ""} autoComplete="street-address" />
        </div>
        <div className="field">
          <label htmlFor="estab-ref">Referencia</label>
          <input id="estab-ref" name="reference" defaultValue={estab?.reference ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="estab-horario">Horario de funcionamento</label>
          <input id="estab-horario" name="hours" defaultValue={estab?.hours ?? ""} placeholder="ex. seg a sab, 7h as 13h" />
        </div>
        <fieldset className="gps">
          <legend>Posicao GPS do local de retirada</legend>
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() =>
                captureGps(
                  (lat, lng) => {
                    setGps({ lat: String(lat), lng: String(lng) });
                    setGpsMsg("GPS capturado no local atual.");
                  },
                  (msg) => setGpsMsg(msg),
                )
              }
            >
              Capturar GPS aqui
            </button>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="estab-lat">Latitude</label>
              <input
                id="estab-lat"
                inputMode="decimal"
                autoComplete="off"
                value={gps.lat}
                onChange={(e) => setGps({ ...gps, lat: e.target.value })}
                placeholder="-15.6"
              />
            </div>
            <div className="field">
              <label htmlFor="estab-lng">Longitude</label>
              <input
                id="estab-lng"
                inputMode="decimal"
                autoComplete="off"
                value={gps.lng}
                onChange={(e) => setGps({ ...gps, lng: e.target.value })}
                placeholder="-56.1"
              />
            </div>
          </div>
          {gpsMsg && (
            <p className="muted" aria-live="polite">
              {gpsMsg}
            </p>
          )}
          <p className="muted">Ao trocar o endereco, registre o GPS de novo no novo local.</p>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="note" aria-live="polite">
            {saved}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Salvando..." : estab ? "Salvar" : "Cadastrar"}
        </button>
      </form>
    </section>
  );
}
