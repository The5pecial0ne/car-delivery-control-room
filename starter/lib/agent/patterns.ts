// Site patterns: places where the same kind of trouble keeps coming back.
//
// One missing release letter is bad luck. The third order from the same
// dealer that needs a manual check is a habit, and the next driver should
// not have to find out at the gate. We read the records every order already
// has (alerts, work items, documents, site visits, the site's own details)
// and group the trouble by place and by theme. Plain counting, no model.

import { eq, inArray } from "drizzle-orm"
import { alerts, relatedRecords, sites } from "@/lib/schema"
import { db } from "./conn"

type Theme = "release" | "access" | "contact" | "not_ready" | "paperwork"

const THEMES: Record<Theme, { label: string; advice: string }> = {
  release: { label: "Keys and release papers", advice: "Confirm who holds the keys and that the release letter is signed before a driver sets off." },
  access: { label: "Gate and site access", advice: "Confirm opening hours and gate access with the site on the day, not from the profile." },
  contact: { label: "Contact person", advice: "Get a named contact with a working phone number before dispatch." },
  not_ready: { label: "Car not ready or not found", advice: "Ask the site to confirm the car is ready and where it stands before the driver travels." },
  paperwork: { label: "Handover paperwork", advice: "Remind the driver which signatures and photos the site needs, and check them at handover." },
}

const ALERT_THEMES: Record<string, Theme> = {
  EMPTY_PICKUP: "not_ready", PICKUP_PROOF_REJECTED: "paperwork", SITE_ACCESS_CONFLICT: "access",
  SITE_ACCESS_UNCONFIRMED: "access", RELEASE_DOCUMENT_UNCLEAR: "release", DELIVERY_ACCESS_RISK: "access",
}
const WORK_THEMES: Record<string, Theme> = {
  COMMERCIAL_RELEASE_HOLD: "release", KEY_HOLDER_STOCK_CHECK: "release", PICKUP_ACCESS_CHECK_REQUIRED: "access",
  SITE_HANDOVER_REVIEW: "paperwork", PICKUP_EVIDENCE_FOLLOWUP: "paperwork", PICKUP_CONTACT_HANDLE_REQUIRED: "contact",
  RECEIVER_AUTHORITY_CHECK: "release", SIGNED_HANDOVER_FOLLOWUP: "paperwork",
}
const DOC_THEMES: Record<string, Theme> = { RELEASE_AUTHORITY: "release", SIGNED_HANDOVER: "paperwork" }

export type Signal = { orderId: string; theme: Theme; what: string; source: string; boundary: string }
export type SitePattern = {
  siteId: string; siteName: string; city: string
  orders: number; troubledOrders: number
  themes: { theme: Theme; label: string; orders: number; advice: string }[]
  signals: Signal[]
}

// A pattern needs the trouble to repeat: two or more different orders at the same place.
const MIN_ORDERS = 2

export async function sitePatterns(filter?: { siteIds?: string[] }): Promise<SitePattern[]> {
  const endpoints = await db.select().from(relatedRecords).where(eq(relatedRecords.collection, "order_endpoint_details"))
  const atSite = endpoints
    .filter((row) => typeof row.details.site_id === "string" && (!filter?.siteIds || filter.siteIds.includes(String(row.details.site_id))))
    .flatMap((row) => row.orderId ? [{ ...row, orderId: row.orderId }] : [])
  const orderIds = [...new Set(atSite.map((row) => row.orderId))]
  if (!orderIds.length) return []
  const [alertRows, records, siteRows] = await Promise.all([
    db.select().from(alerts).where(inArray(alerts.orderId, orderIds)),
    db.select().from(relatedRecords).where(inArray(relatedRecords.orderId, orderIds)),
    db.select().from(sites),
  ])

  const signals = new Map<string, Signal[]>()
  const add = (siteId: string, signal: Signal) => signals.set(siteId, [...(signals.get(siteId) ?? []), signal])

  for (const endpoint of atSite) {
    const siteId = String(endpoint.details.site_id)
    const boundary = String(endpoint.details.boundary ?? "PICKUP").toLowerCase()
    const orderId = endpoint.orderId
    // Only trouble tied to this end of the trip counts for this place.
    for (const alert of alertRows.filter((row) => row.orderId === orderId)) {
      const theme = ALERT_THEMES[alert.signal]
      const isDelivery = alert.signal.startsWith("DELIVERY")
      if (theme && isDelivery === (boundary === "delivery")) add(siteId, { orderId, theme, what: alert.summary, source: `alerts/${alert.id}`, boundary })
    }
    for (const row of records.filter((record) => record.orderId === orderId)) {
      const kind = String(row.details.kind ?? "")
      if (row.collection === "work_items" && WORK_THEMES[kind] && (boundary === "pickup") !== kind.startsWith("RECEIVER")) {
        add(siteId, { orderId, theme: WORK_THEMES[kind], what: String(row.details.title ?? row.details.summary ?? kind.replaceAll("_", " ").toLowerCase()), source: `work_items/${row.id}`, boundary })
      }
      if (row.collection === "documents" && DOC_THEMES[kind] && ["MISSING", "REJECTED"].includes(String(row.details.status)) && boundary === "pickup") {
        add(siteId, { orderId, theme: DOC_THEMES[kind], what: `${kind.replaceAll("_", " ").toLowerCase()} ${String(row.details.status).toLowerCase()}`, source: `documents/${row.id}`, boundary })
      }
      if (row.collection === "site_visits" && row.details.site_id === siteId && row.details.outcome === "VEHICLE_NOT_FOUND") {
        add(siteId, { orderId, theme: "not_ready", what: "driver arrived and the car was not there", source: `site_visits/${row.id}`, boundary })
      }
    }
    if (endpoint.details.contact_status === "UNCONFIRMED" && endpoint.details.access_status !== "CONFIRMED") {
      add(siteId, { orderId, theme: "contact", what: "contact and access still unconfirmed", source: `order_endpoint_details/${endpoint.id}`, boundary })
    }
  }

  const patterns: SitePattern[] = []
  for (const [siteId, list] of signals) {
    // The site profile says the same thing on every order, so it can add to a
    // pattern but never make one: only things that went wrong on orders count.
    const troubled = new Set(list.filter((signal) => !signal.source.startsWith("order_endpoint_details/")).map((signal) => signal.orderId))
    if (troubled.size < MIN_ORDERS) continue
    const site = siteRows.find((row) => row.id === siteId)
    const byTheme = new Map<Theme, Set<string>>()
    for (const signal of list) byTheme.set(signal.theme, new Set([...(byTheme.get(signal.theme) ?? []), signal.orderId]))
    patterns.push({
      siteId, siteName: site?.name ?? siteId, city: site?.city ?? "",
      orders: new Set(atSite.filter((row) => row.details.site_id === siteId).map((row) => row.orderId)).size,
      troubledOrders: troubled.size,
      themes: [...byTheme].map(([theme, orders]) => ({ theme, label: THEMES[theme].label, orders: orders.size, advice: THEMES[theme].advice })).sort((a, b) => b.orders - a.orders),
      signals: list,
    })
  }
  return patterns.sort((a, b) => b.troubledOrders - a.troubledOrders)
}

/** Patterns at the pickup and delivery places of one order. */
export async function patternsForOrder(orderId: string): Promise<SitePattern[]> {
  const endpoints = await db.select().from(relatedRecords).where(eq(relatedRecords.orderId, orderId))
  const siteIds = endpoints.filter((row) => row.collection === "order_endpoint_details" && typeof row.details.site_id === "string").map((row) => String(row.details.site_id))
  return siteIds.length ? sitePatterns({ siteIds }) : []
}
