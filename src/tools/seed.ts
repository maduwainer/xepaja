// Seed de demonstracao do XepaJá: contas, estabelecimentos, itens,
// ofertas publicadas e solicitacoes de exemplo via API publica.
//
// Uso: com o watch rodando, a partir de src:
//   bun run seed
//   XEPAJA_URL=http://localhost:3000 bun run seed
//
// Idempotente: cada etapa procura pela chave natural (e-mail, nome do
// estabelecimento, nome do item, titulo da oferta, reserva ativa) e so
// cria o que falta. Pode rodar de novo sem duplicar.
//
// Fotos: cada item do seed tem uma foto de exemplo em
// public/seed-photos/<slug>.jpg (geradas via skill imagegen, fotos
// casuais de celular, sem producao). A foto da oferta usa a do seu
// item principal; o seed so envia quando a oferta esta sem foto ou com
// o placeholder antigo (< 2 KB), entao foto real do comerciante nunca
// e trocada e tudo sobrevive a re-seeds.
//
// Excecoes fora da API, marcadas no codigo: 1 falta inicial em
// cliente-joao e cliente-beto, relogio adiantado para expiracoes e
// bloqueio do cliente-carlos. Mesmo recurso usado nos testes
// automatizados para montar cenario.
//
// Manutencao: ao mudar fluxos, validacoes ou formatos da API, atualizar
// este arquivo junto (ver "Seed de demonstracao" em ../AGENTS.md).

import { Database } from "bun:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SEED_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function itemSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

function seedPhotoPath(itemName: string): string {
  return join(SEED_ROOT, "public", "seed-photos", `${itemSlug(itemName)}.jpg`);
}

const BASE = process.env.XEPAJA_URL ?? "http://localhost:3000";

interface SeedUser {
  name: string;
  cpf: string;
  email: string;
  password: string;
  role: "merchant" | "consumer";
  radius?: number;
}

interface SeedItem {
  name: string;
  unit: string;
}

interface SeedOffer {
  title: string;
  kind: "item" | "caixa";
  items: { name: string; qty: number }[];
  total_units: number;
  price_cents: number;
  is_free?: boolean;
  draftOnly?: boolean;
  photo_item?: string;
  storage_notes: string;
}

interface SeedEstablishment {
  owner: string;
  name: string;
  kind: "feira" | "mercearia";
  address: string;
  gps_lat: number;
  gps_lng: number;
  items: SeedItem[];
  offers: SeedOffer[];
}

const USERS: SeedUser[] = [
  { name: "Comercio Banca Demo", cpf: "52998224725", email: "comercio-banca@exemplo.com", password: "comercio-banca-123", role: "merchant" },
  { name: "Comercio Feira Demo", cpf: "11144477735", email: "comercio-feira@exemplo.com", password: "comercio-feira-123", role: "merchant" },
  { name: "Comercio Padaria Demo", cpf: "39053344705", email: "comercio-padaria@exemplo.com", password: "comercio-padaria-123", role: "merchant" },
  { name: "Cliente Zeca Demo", cpf: "11144477735", email: "cliente-zeca@exemplo.com", password: "cliente-zeca-123", role: "consumer", radius: 10 },
  { name: "Cliente Maria Demo", cpf: "52998224725", email: "cliente-maria@exemplo.com", password: "cliente-maria-123", role: "consumer", radius: 10 },
  { name: "Cliente Joao Demo", cpf: "39053344705", email: "cliente-joao@exemplo.com", password: "cliente-joao-123", role: "consumer", radius: 10 },
  { name: "Cliente Ana Demo", cpf: "11144477735", email: "cliente-ana@exemplo.com", password: "cliente-ana-123", role: "consumer", radius: 10 },
  { name: "Cliente Beto Demo", cpf: "52998224725", email: "cliente-beto@exemplo.com", password: "cliente-beto-123", role: "consumer", radius: 10 },
  { name: "Cliente Duda Demo", cpf: "39053344705", email: "cliente-duda@exemplo.com", password: "cliente-duda-123", role: "consumer", radius: 10 },
  { name: "Cliente Carlos Demo", cpf: "52998224725", email: "cliente-carlos@exemplo.com", password: "cliente-carlos-123", role: "consumer", radius: 10 },
];

const ESTABLISHMENTS: SeedEstablishment[] = [
  {
    owner: "comercio-banca@exemplo.com",
    name: "Comercio Banca Demo Central",
    kind: "feira",
    address: "Rua das Flores, 100",
    gps_lat: -15.6005,
    gps_lng: -56.1005,
    items: [
      { name: "mamao", unit: "kg" },
      { name: "banana", unit: "duzia" },
      { name: "tomate", unit: "kg" },
      { name: "abacaxi", unit: "un" },
      { name: "cebola", unit: "kg" },
    ],
    offers: [
      {
        title: "Caixa demo da banca",
        kind: "caixa",
        items: [
          { name: "mamao", qty: 1 },
          { name: "banana", qty: 1 },
          { name: "tomate", qty: 1 },
        ],
        total_units: 4,
        price_cents: 800,
        photo_item: "mamao",
        storage_notes: "Manter refrigerado.",
      },
      {
        title: "Suco da banca",
        kind: "item",
        items: [{ name: "mamao", qty: 2 }],
        total_units: 1,
        price_cents: 300,
        photo_item: "mamao",
        storage_notes: "Feito na hora.",
      },
      {
        title: "Rascunho da banca",
        kind: "item",
        items: [{ name: "cebola", qty: 1 }],
        total_units: 2,
        price_cents: 200,
        draftOnly: true,
        storage_notes: "Ainda sem foto.",
      },
    ],
  },
  {
    owner: "comercio-feira@exemplo.com",
    name: "Quitanda da Feira",
    kind: "feira",
    address: "Av. da Feira, 200",
    gps_lat: -15.602,
    gps_lng: -56.098,
    items: [
      { name: "alface", unit: "un" },
      { name: "cenoura", unit: "kg" },
      { name: "laranja", unit: "duzia" },
      { name: "beterraba", unit: "kg" },
      { name: "couve", unit: "maco" },
    ],
    offers: [
      {
        title: "Verduras do fim de feira",
        kind: "caixa",
        items: [
          { name: "alface", qty: 2 },
          { name: "cenoura", qty: 1 },
        ],
        total_units: 6,
        price_cents: 500,
        photo_item: "alface",
        storage_notes: "Retirar hoje.",
      },
      {
        title: "Laranjas maduras gratis",
        kind: "item",
        items: [{ name: "laranja", qty: 1 }],
        total_units: 3,
        price_cents: 0,
        is_free: true,
        photo_item: "laranja",
        storage_notes: "Maduras, ideais para suco.",
      },
    ],
  },
  {
    owner: "comercio-padaria@exemplo.com",
    name: "Padaria Pao Quente",
    kind: "mercearia",
    address: "Rua do Pao, 300",
    gps_lat: -15.597,
    gps_lng: -56.103,
    items: [
      { name: "pao frances", unit: "un" },
      { name: "bolo", unit: "fatia" },
      { name: "leite", unit: "litro" },
      { name: "cafe", unit: "pacote" },
      { name: "manteiga", unit: "un" },
    ],
    offers: [
      {
        title: "Xepa da padaria",
        kind: "caixa",
        items: [
          { name: "pao frances", qty: 5 },
          { name: "bolo", qty: 1 },
        ],
        total_units: 5,
        price_cents: 1000,
        photo_item: "pao frances",
        storage_notes: "Paes do dia anterior.",
      },
    ],
  },
];

// consumer -> titulo da oferta. Ordem importa pela regra de 1 ativa.
// Zeca fica fora daqui: ele estrela os ciclos terminais abaixo
// (retirada e cancelamento liberam a ativa para o passo seguinte).
const RESERVATION_PLAN: { consumer: string; offer: string }[] = [
  { consumer: "cliente-maria@exemplo.com", offer: "Verduras do fim de feira" },
  { consumer: "cliente-joao@exemplo.com", offer: "Caixa demo da banca" },
];

async function req(
  path: string,
  opts: { method?: string; cookie?: string; body?: unknown; form?: FormData } = {},
): Promise<{ status: number; json: any; cookie: string }> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  let payload: BodyInit | undefined;
  if (opts.form) {
    payload = opts.form;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(opts.body);
  }
  const res = await fetch(BASE + path, {
    method: opts.method ?? "GET",
    headers,
    body: payload,
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  return { status: res.status, json: await res.json().catch(() => null), cookie: setCookie.split(";")[0] };
}

function fail(step: string, res: { status: number; json: any }): never {
  throw new Error(`seed falhou em ${step}: http ${res.status} ${JSON.stringify(res.json)}`);
}

// Cria com renovacao: se a chave anterior virou historico terminal
// (expirada etc.), tenta sufixos ate achar ou criar uma ativa.
async function createReservation(
  cookie: string,
  offerId: number,
  baseKey: string,
  step: string,
): Promise<{ id: number; state: string; code?: string } | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const key = attempt === 0 ? baseKey : `${baseKey}-r${attempt + 1}`;
    const res = await req("/api/reservations", {
      method: "POST",
      cookie,
      body: { offer_id: offerId, idempotency_key: key },
    });
    if (res.status === 201) {
      return {
        id: res.json.reservation.id,
        state: res.json.reservation.state,
        code: res.json.reservation?.pickup_code ?? res.json.pickup_code,
      };
    }
    if (res.json?.code === "offer_unavailable" || res.json?.code === "sold_out") {
      console.log(`oferta fora de jogo, pulando ${step}`);
      return null;
    }
    if (res.json?.repeated) {
      const st = res.json.reservation?.state as string | undefined;
      if (st === "pendente" || st === "confirmada") {
        return { id: res.json.reservation.id, state: st };
      }
      continue;
    }
    return fail(step, res);
  }
  throw new Error(`seed: sem chave livre para ${step}`);
}

async function ensureUser(u: SeedUser): Promise<string> {
  const signup = await req("/api/auth/signup", {
    method: "POST",
    body: {
      name: u.name,
      cpf: u.cpf,
      email: u.email,
      password: u.password,
      role: u.role,
      ...(u.role === "consumer" ? { search_radius_km: u.radius ?? 10 } : {}),
    },
  });
  if (signup.status === 201) {
    console.log(`usuario criado: ${u.email}`);
    return signup.cookie;
  }
  if (signup.json?.code === "email_in_use") {
    const login = await req("/api/auth/login", {
      method: "POST",
      body: { email: u.email, password: u.password },
    });
    if (login.status !== 200) fail(`login ${u.email}`, login);
    console.log(`usuario ja existia: ${u.email}`);
    return login.cookie;
  }
  return fail(`signup ${u.email}`, signup);
}

async function ensureEstablishment(cookie: string, spec: SeedEstablishment): Promise<void> {
  const mine = await req("/api/establishments/mine", { cookie });
  if (mine.status === 200 && mine.json?.establishment) {
    console.log(`estabelecimento ok: ${spec.name}`);
    return;
  }
  const created = await req("/api/establishments", {
    method: "POST",
    cookie,
    body: {
      name: spec.name,
      kind: spec.kind,
      address_text: spec.address,
      gps_lat: spec.gps_lat,
      gps_lng: spec.gps_lng,
    },
  });
  if (created.status !== 201) fail(`estabelecimento ${spec.name}`, created);
  console.log(`estabelecimento criado: ${spec.name}`);
}

async function ensureItems(cookie: string, specs: SeedItem[]): Promise<Map<string, number>> {
  const list = await req("/api/items", { cookie });
  if (list.status !== 200) fail("listar itens", list);
  const byName = new Map<string, number>();
  for (const it of list.json.items as { id: number; name: string }[]) byName.set(it.name, it.id);
  for (const spec of specs) {
    if (byName.has(spec.name)) continue;
    const created = await req("/api/items", {
      method: "POST",
      cookie,
      body: { name: spec.name, unit: spec.unit },
    });
    if (created.status !== 201) fail(`item ${spec.name}`, created);
    byName.set(spec.name, created.json.item.id);
    console.log(`item criado: ${spec.name}`);
  }
  return byName;
}

function offerWindow(): { available_from: string; pickup_from: string; pickup_until: string } {
  const now = Date.now();
  return {
    available_from: new Date(now - 30 * 60_000).toISOString(),
    pickup_from: new Date(now - 15 * 60_000).toISOString(),
    pickup_until: new Date(now + 4 * 60 * 60_000).toISOString(),
  };
}

async function ensureOffer(
  cookie: string,
  spec: SeedOffer,
  itemIds: Map<string, number>,
): Promise<number> {
  const mine = await req("/api/offers/mine", { cookie });
  if (mine.status !== 200) fail("listar ofertas", mine);
  const existing = (mine.json.offers as { id: number; title: string; state: string }[]).find(
    (o) => o.title === spec.title,
  );
  let offerId: number;
  if (!existing) {
    const draft = await req("/api/offers", {
      method: "POST",
      cookie,
      body: {
        title: spec.title,
        kind: spec.kind,
        total_units: spec.total_units,
        price_cents: spec.price_cents,
        ...(spec.is_free ? { is_free: true } : {}),
        ...offerWindow(),
        storage_notes: spec.storage_notes,
        items: spec.items.map((i) => {
          const id = itemIds.get(i.name);
          if (!id) throw new Error(`seed: item ${i.name} nao encontrado para a oferta ${spec.title}`);
          return { item_id: id, qty_per_unit: i.qty };
        }),
      },
    });
    if (draft.status !== 201) fail(`rascunho ${spec.title}`, draft);
    offerId = draft.json.offer.id;
    console.log(`oferta criada: ${spec.title}`);
  } else {
    offerId = existing.id;
    if (existing.state === "publicada") {
      await refreshPhotoIfTiny(cookie, offerId, spec);
      console.log(`oferta ja publicada: ${spec.title}`);
      return offerId;
    }
    if (existing.state !== "rascunho") {
      console.log(`oferta em estado final (${existing.state}), mantida: ${spec.title}`);
      return offerId;
    }
    if (spec.draftOnly) {
      console.log(`oferta rascunho (sem foto, sem publicar): ${spec.title}`);
      return offerId;
    }
    console.log(`oferta em rascunho, completando: ${spec.title}`);
  }
  await uploadSeedPhoto(cookie, offerId, spec);
  const pub = await req(`/api/offers/${offerId}/publish`, { method: "POST", cookie });
  if (pub.status !== 200) fail(`publicar ${spec.title}`, pub);
  console.log(`oferta publicada: ${spec.title}`);
  return offerId;
}

async function refreshPhotoIfTiny(cookie: string, offerId: number, spec: SeedOffer): Promise<void> {
  // Re-seed seguro: so envia a foto do seed quando a oferta esta sem
  // foto ou ainda com o placeholder antigo (< 2 KB). Foto real enviada
  // pelo comerciante nunca e trocada.
  const current = await fetch(`${BASE}/api/offers/${offerId}/photo`, {
    headers: { Cookie: cookie },
  });
  const size = current.ok ? (await current.blob()).size : 0;
  if (current.ok && size >= 2048) return;
  await uploadSeedPhoto(cookie, offerId, spec);
  console.log(`foto de exemplo enviada: ${spec.title}`);
}

async function uploadSeedPhoto(cookie: string, offerId: number, spec: SeedOffer): Promise<void> {
  if (!spec.photo_item) throw new Error(`seed: oferta ${spec.title} sem photo_item`);
  const file = Bun.file(seedPhotoPath(spec.photo_item));
  if (!(await file.exists())) throw new Error(`seed: foto ausente para item ${spec.photo_item}`);
  const form = new FormData();
  form.append("photo", file);
  const photo = await req(`/api/offers/${offerId}/photo`, { method: "POST", cookie, form });
  if (photo.status !== 200) fail(`foto ${spec.title}`, photo);
}

async function offerIdByTitle(cookie: string, title: string): Promise<number | null> {
  const mine = await req("/api/offers/mine", { cookie });
  if (mine.status !== 200) fail("listar ofertas", mine);
  const found = (mine.json.offers as { id: number; title: string }[]).find((o) => o.title === title);
  return found ? found.id : null;
}

async function activeReservation(cookie: string): Promise<{ id: number } | null> {
  const res = await req("/api/reservations/active", { cookie });
  if (res.status !== 200) fail("reserva ativa", res);
  return res.json.reservation;
}

function markOneMiss(email: string): void {
  // Excecao documentada fora da API: faltas so acontecem por expiracao real.
  const db = new Database("data/xepaja.sqlite");
  const user = db.query("SELECT id, misses_since_unblock AS m FROM users WHERE email = ?").get(email) as {
    id: number;
    m: number;
  } | null;
  if (!user) throw new Error(`seed: usuario ${email} nao encontrado para marcar falta`);
  if (user.m === 0) {
    db.query("UPDATE users SET misses_since_unblock = 1 WHERE id = ?").run(user.id);
    console.log(`falta de exemplo marcada: ${email}`);
  }
}

async function ensureReservations(
  cookies: Map<string, string>,
  merchantCookies: Map<string, string>,
  offerOwners: Map<string, string>,
  offerIds: Map<string, number>,
): Promise<void> {
  for (const plan of RESERVATION_PLAN) {
    const cookie = cookies.get(plan.consumer);
    if (!cookie) throw new Error(`seed: sem sessao para ${plan.consumer}`);
    if (await activeReservation(cookie)) {
      console.log(`reserva ativa ja existe, pulando: ${plan.consumer}`);
      continue;
    }
    const offerId = offerIds.get(plan.offer);
    if (!offerId) throw new Error(`seed: oferta ${plan.offer} nao encontrada`);
    const key = `seed-${plan.consumer.split("@")[0]}-${offerId}`;
    const created = await createReservation(cookie, offerId, key, `reserva ${plan.consumer} -> ${plan.offer}`);
    if (!created) continue;
    console.log(`solicitacao (${created.state}): ${plan.consumer} -> ${plan.offer}`);
  }

  // Ciclo completo de exemplo: zeca reserva a xepa da padaria e o
  // comerciante confirma a retirada com o codigo de uso unico.
  const zeca = cookies.get("cliente-zeca@exemplo.com");
  if (zeca && !(await activeReservation(zeca))) {
    const offerId = offerIds.get("Xepa da padaria");
    if (offerId) {
      const created = await createReservation(zeca, offerId, `seed-cliente-zeca-${offerId}-retirada`, "retirada de exemplo");
      if (!created) {
        console.log("retirada de exemplo sem oferta vigente, pulando");
      } else if (created.state !== "confirmada" || !created.code) {
        console.log("retirada de exemplo ja existia (idempotente)");
      } else {
        const owner = offerOwners.get("Xepa da padaria");
        const merchant = owner ? merchantCookies.get(owner) : undefined;
        if (created.code && merchant) {
          const pickup = await req("/api/reservations/pickup/confirm", {
            method: "POST",
            cookie: merchant,
            body: { code: created.code },
          });
          if (pickup.status !== 200) fail("retirada de exemplo", pickup);
          console.log("retirada de exemplo confirmada: cliente-zeca -> Xepa da padaria");
        }
      }
    }
  }

  // Cancelamento de exemplo: zeca reserva as laranjas gratis e cancela
  // dentro do prazo (sem falta), liberando a ativa.
  if (zeca && !(await activeReservation(zeca))) {
    const offerId = offerIds.get("Laranjas maduras gratis");
    if (offerId) {
      const created = await createReservation(zeca, offerId, `seed-cliente-zeca-${offerId}-cancela`, "cancelamento de exemplo");
      if (!created) {
        console.log("cancelamento de exemplo sem oferta vigente, pulando");
      } else if (created.state !== "confirmada" && created.state !== "pendente") {
        console.log("cancelamento de exemplo ja existia (idempotente)");
      } else {
        const cancel = await req(`/api/reservations/${created.id}/cancel`, {
          method: "POST",
          cookie: zeca,
        });
        if (cancel.status !== 200) fail("cancelamento de exemplo", cancel);
        console.log("cancelamento de exemplo: cliente-zeca -> Laranjas maduras gratis");
      }
    }
  }
}

const health = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
if (!health) {
  console.error(`seed: API fora do ar em ${BASE}. Suba com bun run watch antes.`);
  process.exit(1);
}

const cookies = new Map<string, string>();
for (const u of USERS) cookies.set(u.email, await ensureUser(u));

const merchantCookies = new Map<string, string>();
for (const spec of ESTABLISHMENTS) {
  const cookie = cookies.get(spec.owner);
  if (!cookie) throw new Error(`seed: sem sessao para ${spec.owner}`);
  merchantCookies.set(spec.owner, cookie);
  await ensureEstablishment(cookie, spec);
  const itemIds = await ensureItems(cookie, spec.items);
  for (const offer of spec.offers) await ensureOffer(cookie, offer, itemIds);
}

// Falta de exemplo antes dos pedidos: com 1 falta o pedido sai pendente.
markOneMiss("cliente-joao@exemplo.com");
markOneMiss("cliente-beto@exemplo.com");

async function historyList(cookie: string): Promise<{ id: number; offer_title: string; state: string }[]> {
  const res = await req("/api/reservations/history", { cookie });
  if (res.status !== 200) fail("historico", res);
  return res.json.reservations;
}

async function activeFor(cookie: string, title: string): Promise<{ id: number; state: string } | null> {
  const res = await req("/api/reservations/active", { cookie });
  if (res.status !== 200) fail("reserva ativa", res);
  const r = res.json.reservation;
  return r && r.offer_title === title ? { id: r.id, state: r.state } : null;
}

async function ensurePending(
  cookie: string,
  offerId: number,
  title: string,
  who: string,
): Promise<number> {
  const already = await activeFor(cookie, title);
  if (already) {
    if (already.state !== "pendente") throw new Error(`seed: ${who} tem ativa nao pendente em ${title}`);
    return already.id;
  }
  const hist = await historyList(cookie);
  if (hist.some((h) => h.offer_title === title)) {
    throw new Error(`seed: ${who} sem ativa mas com historico em ${title}; limpe ou ajuste o plano`);
  }
  const created = await createReservation(cookie, offerId, `seed-${who}-${offerId}`, `reserva ${who} -> ${title}`);
  if (!created) throw new Error(`seed: oferta ${title} fora de jogo para ${who}`);
  if (created.state !== "pendente") {
    throw new Error(`seed: ${who} -> ${title} saiu ${created.state}, esperado pendente (falta marcada?)`);
  }
  return created.id;
}

// Recusada: comerciante recusa o pendente com motivo.
async function refuseFlow(consumerEmail: string, title: string, reason: string): Promise<void> {
  const cookie = cookies.get(consumerEmail);
  const offerId = offerIds.get(title);
  const owner = offerOwners.get(title);
  if (!cookie || !offerId || !owner) throw new Error(`seed: dados faltando para recusar ${title}`);
  const hist = await historyList(cookie);
  if (hist.some((h) => h.offer_title === title && h.state === "recusada")) {
    console.log(`recusa ja existia: ${consumerEmail} -> ${title}`);
    return;
  }
  const id = await ensurePending(cookie, offerId, title, consumerEmail.split("@")[0]);
  const refused = await req(`/api/reservations/${id}/refuse`, {
    method: "POST",
    cookie: merchantCookies.get(owner),
    body: { reason },
  });
  if (refused.status === 404) {
    console.log(`recusa ja decidida: ${consumerEmail} -> ${title}`);
    return;
  }
  if (refused.status !== 200) fail(`recusar ${title}`, refused);
  console.log(`pedido recusado: ${consumerEmail} -> ${title}`);
}

// Cancelada pelo comercio: confirmada que o comerciante cancela com motivo.
async function merchantCancelFlow(consumerEmail: string, title: string, reason: string): Promise<void> {
  const cookie = cookies.get(consumerEmail);
  const offerId = offerIds.get(title);
  const owner = offerOwners.get(title);
  if (!cookie || !offerId || !owner) throw new Error(`seed: dados faltando para cancelar ${title}`);
  const hist = await historyList(cookie);
  if (hist.some((h) => h.offer_title === title && h.state === "cancelada")) {
    console.log(`cancelamento do comercio ja existia: ${consumerEmail} -> ${title}`);
    return;
  }
  const active = await activeFor(cookie, title);
  let id: number;
  if (active) {
    if (active.state !== "confirmada") throw new Error(`seed: ativa inesperada em ${title}`);
    id = active.id;
  } else {
    const created = await createReservation(cookie, offerId, `seed-${consumerEmail.split("@")[0]}-${offerId}`, `comercio cancela ${title}`);
    if (!created) throw new Error(`seed: oferta ${title} fora de jogo para ${consumerEmail}`);
    id = created.id;
  }
  const cancelled = await req(`/api/reservations/${id}/merchant-cancel`, {
    method: "POST",
    cookie: merchantCookies.get(owner),
    body: { reason },
  });
  if (cancelled.status === 404) {
    console.log(`cancelamento ja decidido: ${consumerEmail} -> ${title}`);
    return;
  }
  if (cancelled.status !== 200) fail(`comercio cancela ${title}`, cancelled);
  console.log(`comercio cancelou: ${consumerEmail} -> ${title}`);
}

function timeTravelReservation(id: number, field: "pending_expires_at" | "pickup_until", iso: string): void {
  // Excecao documentada fora da API: expiracao real levaria 30 min ou
  // horas; aqui adiantamos o relogio da reserva e disparamos a varredura
  // preguicosa com uma leitura normal.
  const db = new Database("data/xepaja.sqlite");
  db.query(`UPDATE reservations SET ${field} = ? WHERE id = ?`).run(iso, id);
}

// Expirada sem falta: pendente que passou dos 30 min sem decisao.
async function expirePendingFlow(consumerEmail: string, title: string): Promise<void> {
  const cookie = cookies.get(consumerEmail);
  const offerId = offerIds.get(title);
  if (!cookie || !offerId) throw new Error(`seed: dados faltando para expirar ${title}`);
  const hist = await historyList(cookie);
  if (hist.some((h) => h.offer_title === title && h.state === "expirada")) {
    console.log(`expirada sem falta ja existia: ${consumerEmail} -> ${title}`);
    return;
  }
  const id = await ensurePending(cookie, offerId, title, consumerEmail.split("@")[0]);
  timeTravelReservation(id, "pending_expires_at", new Date(Date.now() - 60_000).toISOString());
  await req("/api/reservations/active", { cookie });
  const after = await historyList(cookie);
  if (!after.some((h) => h.offer_title === title && h.state === "expirada")) {
    throw new Error(`seed: ${title} nao expirou para ${consumerEmail}`);
  }
  console.log(`pendente expirou sem falta: ${consumerEmail} -> ${title}`);
}

// Expirada com falta: confirmada que passou do fim + tolerancia sem retirar.
async function expireConfirmedFlow(consumerEmail: string, title: string): Promise<void> {
  const cookie = cookies.get(consumerEmail);
  const offerId = offerIds.get(title);
  if (!cookie || !offerId) throw new Error(`seed: dados faltando para expirar ${title}`);
  const hist = await historyList(cookie);
  if (hist.some((h) => h.offer_title === title && h.state === "expirada")) {
    console.log(`expirada com falta ja existia: ${consumerEmail} -> ${title}`);
    return;
  }
  const active = await activeFor(cookie, title);
  let id: number;
  if (active) {
    if (active.state !== "confirmada") throw new Error(`seed: ativa inesperada em ${title}`);
    id = active.id;
  } else {
    const created = await createReservation(cookie, offerId, `seed-${consumerEmail.split("@")[0]}-${offerId}`, `expirar ${title}`);
    if (!created) throw new Error(`seed: oferta ${title} fora de jogo para ${consumerEmail}`);
    id = created.id;
  }
  timeTravelReservation(id, "pickup_until", new Date(Date.now() - 30 * 60_000).toISOString());
  await req("/api/reservations/active", { cookie });
  const after = await historyList(cookie);
  if (!after.some((h) => h.offer_title === title && h.state === "expirada")) {
    throw new Error(`seed: ${title} nao expirou para ${consumerEmail}`);
  }
  console.log(`confirmada expirou com falta: ${consumerEmail} -> ${title}`);
}

async function closeOfferAs(ownerEmail: string, title: string, how: "encerrar" | "cancelar"): Promise<void> {
  const cookie = cookies.get(ownerEmail);
  if (!cookie) throw new Error(`seed: sem sessao para ${ownerEmail}`);
  const mine = await req("/api/offers/mine", { cookie });
  if (mine.status !== 200) fail("listar ofertas", mine);
  const offer = (mine.json.offers as { id: number; title: string; state: string }[]).find(
    (o) => o.title === title,
  );
  if (!offer || offer.state !== "publicada") {
    console.log(`oferta ja ${offer?.state ?? "ausente"}, pulando ${how}: ${title}`);
    return;
  }
  const done = await req(`/api/offers/${offer.id}/${how === "encerrar" ? "encerrar" : "cancel"}`, {
    method: "POST",
    cookie,
    body: how === "cancelar" ? { reason: "Demo: fim da grade de exemplo." } : {},
  });
  if (done.status !== 200) fail(`${how} ${title}`, done);
  console.log(`oferta ${how === "encerrar" ? "encerrada" : "cancelada"}: ${title}`);
}

function blockCarlos(): void {
  // Excecao documentada fora da API: bloqueio real exige 3 faltas em 10 dias.
  const db = new Database("data/xepaja.sqlite");
  const user = db.query("SELECT id, blocked_until AS b FROM users WHERE email = ?").get(
    "cliente-carlos@exemplo.com",
  ) as { id: number; b: string | null } | null;
  if (!user) throw new Error("seed: cliente-carlos ausente");
  if (user.b && new Date(user.b).getTime() > Date.now()) {
    console.log("bloqueio ja existe: cliente-carlos");
    return;
  }
  db.query("UPDATE users SET misses_since_unblock = 3, blocked_until = ? WHERE id = ?").run(
    new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
    user.id,
  );
  console.log("bloqueio de exemplo: cliente-carlos (3 faltas, 10 dias)");
}

const feiraCookie = cookies.get("comercio-feira@exemplo.com");
if (!feiraCookie) throw new Error("seed: sem sessao para comercio-feira");
const offerIds = new Map<string, number>();
const offerOwners = new Map<string, string>();
for (const spec of ESTABLISHMENTS) {
  const cookie = cookies.get(spec.owner);
  if (!cookie) throw new Error(`seed: sem sessao para ${spec.owner}`);
  for (const offer of spec.offers) {
    const id = await offerIdByTitle(cookie, offer.title);
    if (id) {
      offerIds.set(offer.title, id);
      offerOwners.set(offer.title, spec.owner);
    }
  }
}

await ensureReservations(cookies, merchantCookies, offerOwners, offerIds);

// cliente-ana esgota o Suco (total 1) com confirmada direta.
await (async () => {
  const cookie = cookies.get("cliente-ana@exemplo.com");
  const offerId = offerIds.get("Suco da banca");
  if (!cookie || !offerId) throw new Error("seed: dados faltando para Suco da banca");
  if (await activeFor(cookie, "Suco da banca")) {
    console.log("reserva ativa ja existe, pulando: cliente-ana");
    return;
  }
  const hist = await historyList(cookie);
  if (hist.some((h) => h.offer_title === "Suco da banca")) {
    console.log("ana ja tem historico no Suco, pulando");
    return;
  }
  const created = await createReservation(cookie, offerId, `seed-cliente-ana-${offerId}`, "reserva cliente-ana -> Suco da banca");
  if (!created) {
    console.log("Suco fora de jogo, pulando: cliente-ana");
    return;
  }
  console.log(`solicitacao criada (${created.state}, esgota a oferta): cliente-ana -> Suco da banca`);
})();

await refuseFlow("cliente-beto@exemplo.com", "Caixa demo da banca", "Demo: acabou antes da separacao.");
await merchantCancelFlow("cliente-duda@exemplo.com", "Laranjas maduras gratis", "Demo: feira antecipou o fechamento.");
await expirePendingFlow("cliente-beto@exemplo.com", "Xepa da padaria");
await expireConfirmedFlow("cliente-duda@exemplo.com", "Caixa demo da banca");

await closeOfferAs("comercio-padaria@exemplo.com", "Xepa da padaria", "encerrar");
await closeOfferAs("comercio-feira@exemplo.com", "Laranjas maduras gratis", "cancelar");
blockCarlos();

console.log("\nContas de exemplo (senha ao lado do e-mail):");
for (const u of USERS) console.log(`- ${u.role === "merchant" ? "comerciante" : "consumidor"}: ${u.email} / ${u.password}`);
