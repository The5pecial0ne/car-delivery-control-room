import { NextResponse, after } from "next/server"
import { eq, inArray } from "drizzle-orm"
import { db } from "@/lib/agent/conn"
import { isRunning, openCase, runCase } from "@/lib/agent/loop"
import { packScenario, SCENARIOS, scenarioFor } from "@/lib/agent/scenarios"
import { listCases } from "@/lib/agent/store"
import { addresses, customers, datasetMetadata, orderItems, orders, vehicles } from "@/lib/schema"

export const runtime = "nodejs"

export async function GET() {
  const cases = await listCases()
  const orderIds = [...new Set(cases.map((row) => row.orderId))]
  const orderRows = orderIds.length ? await db.select({ order: orders, customer: customers.name }).from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id)).where(inArray(orders.id, orderIds)) : []
  const cars = orderIds.length ? await db.select({ orderId: orderItems.orderId, role: orderItems.role, make: vehicles.make, model: vehicles.model })
    .from(orderItems).innerJoin(vehicles, eq(orderItems.vehicleId, vehicles.id)).where(inArray(orderItems.orderId, orderIds)) : []
  const addressIds = orderRows.flatMap(({ order }) => [order.pickupAddressId, order.deliveryAddressId])
  const places = addressIds.length ? await db.select({ id: addresses.id, city: addresses.city }).from(addresses).where(inArray(addresses.id, addressIds)) : []
  const city = (id: string) => places.find((place) => place.id === id)?.city ?? null
  const orderInfo = new Map(orderRows.map(({ order, customer }) => {
    const car = cars.find((item) => item.orderId === order.id && item.role === "PRIMARY") ?? cars.find((item) => item.orderId === order.id)
    return [order.id, {
      reference: order.reference, customer, car: car ? `${car.make} ${car.model}` : null,
      from: city(order.pickupAddressId), to: city(order.deliveryAddressId),
    }]
  }))
  const [meta] = await db.select().from(datasetMetadata).limit(1)
  return NextResponse.json({
    snapshotAt: meta?.snapshotAt.toISOString() ?? null,
    cases: cases.map(({ transcript: _transcript, scenario: _scenario, ...rest }) => ({ ...rest, running: isRunning(rest.id), order: orderInfo.get(rest.orderId) ?? null })),
    demos: SCENARIOS.map(({ orderId, title }) => ({ orderId, title, open: cases.some((row) => row.orderId === orderId && row.status !== "resolved") })),
  })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { orderId?: string; trigger?: string; scenario?: string }
  const demo = body.orderId && !body.trigger ? scenarioFor(body.orderId) : undefined
  const trigger = body.trigger ?? demo?.trigger
  if (!body.orderId || !trigger) {
    return NextResponse.json({ error: "Send orderId and trigger, or the orderId of a demo scenario", demos: SCENARIOS.map((item) => item.orderId) }, { status: 400 })
  }
  const caseRow = await openCase({ orderId: body.orderId, trigger, scenario: body.scenario ?? packScenario(demo?.driver, demo?.site) })
  after(() => runCase(caseRow.id))
  return NextResponse.json({ id: caseRow.id }, { status: 201 })
}
