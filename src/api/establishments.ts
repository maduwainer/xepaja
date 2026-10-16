import { Hono } from "hono";
import { getDb } from "./db";
import { requireMerchant, validateCnpj, type AppEnv } from "./auth";

export const establishmentsApp = new Hono<AppEnv>();

interface EstablishmentRow {
  id: number;
  owner_id: number;
  name: string;
  kind: string;
  cnpj: string | null;
  address_text: string;
  reference: string;
  hours: string;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_captured_at: string | null;
}

const ESTAB_COLUMNS =
  "id, owner_id, name, kind, cnpj, address_text, reference, hours, gps_lat, gps_lng, gps_captured_at";

async function getMine(ownerId: number): Promise<EstablishmentRow | null> {
  const rows = await getDb()`SELECT id, owner_id, name, kind, cnpj, address_text, reference, hours, gps_lat, gps_lng, gps_captured_at FROM establishments WHERE owner_id = ${ownerId}`;
  return (rows[0] as unknown as EstablishmentRow | undefined) ?? null;
}

// UPDATE com colunas dinamicas: monta SET com placeholders $n.
// touch atualiza updated_at; desligar para tabelas sem a coluna (items).
async function updateReturning(
  table: string,
  updates: string[],
  params: (string | number | null)[],
  where: string,
  returning: string,
  touch = true,
) {
  const setList = updates
    .map((u, i) => u.replace("?", `$${i + 1}`))
    .join(", ");
  const rows = await getDb().unsafe(
    `UPDATE ${table} SET ${setList}${touch ? ", updated_at = now()" : ""} WHERE ${where} RETURNING ${returning}`,
    params as (string | number)[],
  );
  return rows;
}

// GPS registrado libera publicar ofertas (Fase 2 exige). Sem GPS, informa o motivo.
export function publishStatus(estab: EstablishmentRow | null): {
  can_publish: boolean;
  publish_block_reason: string | null;
} {
  if (!estab) {
    return {
      can_publish: false,
      publish_block_reason: "Cadastre o estabelecimento antes de publicar ofertas.",
    };
  }
  if (estab.gps_lat === null || estab.gps_lng === null) {
    return {
      can_publish: false,
      publish_block_reason:
        "Registre a posicao GPS no local de retirada antes de publicar ofertas.",
    };
  }
  return { can_publish: true, publish_block_reason: null };
}

function parseGps(body: Record<string, unknown>): {
  lat: number | null;
  lng: number | null;
  error: string | null;
} {
  const rawLat = body.gps_lat;
  const rawLng = body.gps_lng;
  if (rawLat === undefined && rawLng === undefined) return { lat: null, lng: null, error: null };
  const lat = typeof rawLat === "string" ? Number(rawLat) : rawLat;
  const lng = typeof rawLng === "string" ? Number(rawLng) : rawLng;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return { lat: null, lng: null, error: "Informe latitude entre -90 e 90 e longitude entre -180 e 180." };
  }
  return { lat, lng, error: null };
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// RF-04: estabelecimento com nome, tipo, CNPJ se tiver, endereco de retirada,
// referencia e horario. GPS capturado no local; ao trocar o endereco, exige
// recapturar o GPS na mesma requisicao. Vale para ofertas futuras (Fase 2 usa snapshot).
establishmentsApp.get("/establishments/mine", requireMerchant, async (c) => {
  const estab = await getMine(c.get("user").id);
  return c.json({ ok: true, establishment: estab, ...publishStatus(estab) });
});

establishmentsApp.post("/establishments", requireMerchant, async (c) => {
  const user = c.get("user");
  if (await getMine(user.id)) {
    return c.json(
      { ok: false, code: "already_exists", message: "Voce ja tem um estabelecimento. Edite o atual." },
      409,
    );
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return c.json({ ok: false, code: "invalid_body", message: "Informe os dados do estabelecimento." }, 400);
  }
  const name = str(body.name);
  const kind = body.kind === "mercearia" ? "mercearia" : body.kind === "feira" ? "feira" : "";
  const cnpj = validateCnpj(body.cnpj);
  const address = str(body.address_text);
  if (!name) {
    return c.json({ ok: false, code: "invalid_name", message: "Informe o nome do estabelecimento." }, 400);
  }
  if (!kind) {
    return c.json(
      { ok: false, code: "invalid_kind", message: "Tipo precisa ser feira ou mercearia." },
      400,
    );
  }
  if (cnpj === null) {
    return c.json({ ok: false, code: "invalid_cnpj", message: "Informe um CNPJ valido ou deixe em branco." }, 400);
  }
  if (!address) {
    return c.json(
      { ok: false, code: "invalid_address", message: "Informe o endereco de retirada." },
      400,
    );
  }
  const gps = parseGps(body);
  if (gps.error) {
    return c.json({ ok: false, code: "invalid_gps", message: gps.error }, 400);
  }

  const inserted = await getDb()`INSERT INTO establishments
       (owner_id, name, kind, cnpj, address_text, reference, hours, gps_lat, gps_lng, gps_captured_at)
       VALUES (${user.id}, ${name}, ${kind}, ${cnpj || null}, ${address},
         ${str(body.reference)}, ${str(body.hours)}, ${gps.lat}, ${gps.lng},
         ${gps.lat !== null ? new Date().toISOString() : null})
       RETURNING id, owner_id, name, kind, cnpj, address_text, reference, hours, gps_lat, gps_lng, gps_captured_at`;
  const estab = inserted[0] as EstablishmentRow;
  return c.json({ ok: true, establishment: estab, ...publishStatus(estab) }, 201);
});

establishmentsApp.patch("/establishments/mine", requireMerchant, async (c) => {
  const user = c.get("user");
  const current = await getMine(user.id);
  if (!current) {
    return c.json(
      { ok: false, code: "not_found", message: "Cadastre o estabelecimento antes de editar." },
      404,
    );
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, code: "invalid_body", message: "Nada para atualizar." }, 400);
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (body.name !== undefined) {
    const name = str(body.name);
    if (!name) {
      return c.json({ ok: false, code: "invalid_name", message: "Informe o nome do estabelecimento." }, 400);
    }
    updates.push("name = ?");
    params.push(name);
  }
  if (body.kind !== undefined) {
    const kind = body.kind === "mercearia" ? "mercearia" : body.kind === "feira" ? "feira" : "";
    if (!kind) {
      return c.json(
        { ok: false, code: "invalid_kind", message: "Tipo precisa ser feira ou mercearia." },
        400,
      );
    }
    updates.push("kind = ?");
    params.push(kind);
  }
  if (body.cnpj !== undefined) {
    const cnpj = validateCnpj(body.cnpj);
    if (cnpj === null) {
      return c.json({ ok: false, code: "invalid_cnpj", message: "Informe um CNPJ valido ou deixe em branco." }, 400);
    }
    updates.push("cnpj = ?");
    params.push(cnpj || null);
  }

  let addressChanged = false;
  if (body.address_text !== undefined) {
    const address = str(body.address_text);
    if (!address) {
      return c.json(
        { ok: false, code: "invalid_address", message: "Informe o endereco de retirada." },
        400,
      );
    }
    if (address !== current.address_text) addressChanged = true;
    updates.push("address_text = ?");
    params.push(address);
  }
  if (body.reference !== undefined) {
    updates.push("reference = ?");
    params.push(str(body.reference));
  }
  if (body.hours !== undefined) {
    updates.push("hours = ?");
    params.push(str(body.hours));
  }

  const gps = parseGps(body);
  if (gps.error) {
    return c.json({ ok: false, code: "invalid_gps", message: gps.error }, 400);
  }
  if (addressChanged && gps.lat === null) {
    return c.json(
      {
        ok: false,
        code: "gps_required",
        message: "Ao trocar o endereco, registre novamente a posicao GPS no local de retirada.",
      },
      422,
    );
  }
  if (gps.lat !== null && gps.lng !== null) {
    updates.push("gps_lat = ?", "gps_lng = ?", "gps_captured_at = ?");
    params.push(gps.lat, gps.lng, new Date().toISOString());
  }

  if (updates.length === 0) {
    return c.json({ ok: false, code: "invalid_body", message: "Nada para atualizar." }, 400);
  }

  const whereIndex = params.length + 1;
  const setList = updates
    .map((u, i) => u.replace("?", `$${i + 1}`))
    .join(", ");
  const rows = await getDb().unsafe(
    `UPDATE establishments SET ${setList}, updated_at = now() WHERE owner_id = $${whereIndex} RETURNING id, owner_id, name, kind, cnpj, address_text, reference, hours, gps_lat, gps_lng, gps_captured_at`,
    [...params, user.id] as (string | number)[],
  );
  const estab = rows[0] as unknown as EstablishmentRow;
  return c.json({ ok: true, establishment: estab, ...publishStatus(estab) });
});

// Cadastro de itens do estabelecimento (nome e unidade). Compoem ofertas e
// caixas surpresa na Fase 2.
establishmentsApp.get("/items", requireMerchant, async (c) => {
  const estab = await getMine(c.get("user").id);
  if (!estab) {
    return c.json(
      { ok: false, code: "no_establishment", message: "Cadastre o estabelecimento antes dos itens." },
      404,
    );
  }
  const items = await getDb()`SELECT id, establishment_id, name, unit FROM items WHERE establishment_id = ${estab.id} ORDER BY name`;
  return c.json({ ok: true, items });
});

establishmentsApp.post("/items", requireMerchant, async (c) => {
  const estab = await getMine(c.get("user").id);
  if (!estab) {
    return c.json(
      { ok: false, code: "no_establishment", message: "Cadastre o estabelecimento antes dos itens." },
      404,
    );
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = body ? str(body.name) : "";
  const unit = body ? str(body.unit) : "";
  if (!name) {
    return c.json({ ok: false, code: "invalid_name", message: "Informe o nome do item." }, 400);
  }
  if (!unit) {
    return c.json({ ok: false, code: "invalid_unit", message: "Informe a unidade do item." }, 400);
  }
  const inserted = await getDb()`INSERT INTO items (establishment_id, name, unit) VALUES (${estab.id}, ${name}, ${unit})
       RETURNING id, establishment_id, name, unit`;
  return c.json({ ok: true, item: inserted[0] }, 201);
});

async function getOwnItem(estabId: number, itemId: number) {
  const rows = await getDb()`SELECT id, establishment_id, name, unit FROM items WHERE id = ${itemId} AND establishment_id = ${estabId}`;
  return (rows[0] as { id: number } | undefined) ?? null;
}

establishmentsApp.patch("/items/:id", requireMerchant, async (c) => {
  const estab = await getMine(c.get("user").id);
  if (!estab) {
    return c.json(
      { ok: false, code: "no_establishment", message: "Cadastre o estabelecimento antes dos itens." },
      404,
    );
  }
  const itemId = Number(c.req.param("id"));
  if (!Number.isInteger(itemId)) {
    return c.json({ ok: false, code: "not_found", message: "Item nao encontrado." }, 404);
  }
  if (!(await getOwnItem(estab.id, itemId))) {
    return c.json({ ok: false, code: "not_found", message: "Item nao encontrado." }, 404);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  if (body?.name !== undefined) {
    const name = str(body.name);
    if (!name) {
      return c.json({ ok: false, code: "invalid_name", message: "Informe o nome do item." }, 400);
    }
    updates.push("name = ?");
    params.push(name);
  }
  if (body?.unit !== undefined) {
    const unit = str(body.unit);
    if (!unit) {
      return c.json({ ok: false, code: "invalid_unit", message: "Informe a unidade do item." }, 400);
    }
    updates.push("unit = ?");
    params.push(unit);
  }
  if (updates.length === 0) {
    return c.json({ ok: false, code: "invalid_body", message: "Nada para atualizar." }, 400);
  }
  const itemRows = await updateReturning(
    "items",
    updates,
    params,
    `id = ${itemId}`,
    "id, establishment_id, name, unit",
    false,
  );
  return c.json({ ok: true, item: itemRows[0] });
});

establishmentsApp.delete("/items/:id", requireMerchant, async (c) => {
  const estab = await getMine(c.get("user").id);
  if (!estab) {
    return c.json(
      { ok: false, code: "no_establishment", message: "Cadastre o estabelecimento antes dos itens." },
      404,
    );
  }
  const itemId = Number(c.req.param("id"));
  if (!Number.isInteger(itemId)) {
    return c.json({ ok: false, code: "not_found", message: "Item nao encontrado." }, 404);
  }
  if (!(await getOwnItem(estab.id, itemId))) {
    return c.json({ ok: false, code: "not_found", message: "Item nao encontrado." }, 404);
  }
  await getDb()`DELETE FROM items WHERE id = ${itemId}`;
  return c.json({ ok: true });
});
