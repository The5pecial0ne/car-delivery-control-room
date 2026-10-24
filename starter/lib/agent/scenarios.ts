// The demo cases. Each one names an order from the dataset, what starts the
// case, and what the simulated driver privately knows. The agent sees only the
// trigger and whatever it finds out by looking and asking.
//
// They are picked to show both halves of the job: cases where the agent must
// bring a person a decision, and one where it should sort things out and get
// out of the way.

// driver and site are what the simulated driver and the simulated pickup desk privately know.
export type Scenario = { orderId: string; title: string; trigger: string; driver: string; site?: string }

export const SCENARIOS: Scenario[] = [
  {
    orderId: "ord-00322",
    title: "Red warning light on the motorway",
    trigger: "Driver wrote in the app: stopped the Bentley Continental GT after a red warning came on and the car felt different when accelerating.",
    driver: "You are parked at the Rasthof Göttingen service area on the A7, northbound, about 250 km south of Hamburg, in the car park behind the fuel station. You feel safe, it is daylight and you have water. The engine is off. The red light is an engine symbol with the text 'Drivetrain malfunction, reduced power'. If asked for a photo, send one of the dashboard. You do not know what is wrong. You would rather not wait more than about three hours, because you have a train home tonight from Göttingen, but you will stay if asked.",
  },
  {
    orderId: "ord-00299",
    title: "Overnight ferry sold out",
    trigger: "Travel check: the overnight vehicle crossing for this order came back sold out. The driver has no ferry reference.",
    driver: "You are at home and have not left for the pickup yet. You can take the later sailing if Bahn arranges a hotel near the terminal for the night before and your train home afterwards. You would prefer a hotel you can walk to from the terminal. You have not changed your pickup time.",
  },
  {
    orderId: "ord-00603",
    title: "Stuck in the ferry queue",
    trigger: "Driver wrote: the queue before the terminal has barely moved and the booked crossing may close before check-in.",
    driver: "The queue started moving about ten minutes ago. You are now at the check-in booth and the staff have checked you in for the booked crossing; you have a lane number, 14. Everything is fine now and you will board as planned. You are a little embarrassed about the alarm.",
  },
  {
    orderId: "ord-00593",
    title: "Car not at the pickup",
    trigger: "Driver at Velantora Helsinki: reception cannot find the BMW M4 for this order. The driver can only wait a short while longer.",
    driver: "You are still at Velantora Helsinki, in the visitor car park by reception. Nobody has given you the car or keys. You can stay about 45 more minutes from now, then you must leave to catch your train home to Tampere. You have not heard anything new since your last message. You do not know where the car is.",
    site: "You are Adrian Alderbrook at the Velantora Helsinki branch desk. The stock team has just found it: the BMW M4 with this order's VIN was moved last week to the Velantora satellite yard in Vantaa, about 15 km away, because the main lot was full. The car is there and ready. The keys are in the key safe at the Vantaa yard, not at reception. The Vantaa yard opens the key safe only if the seller sends a release email naming the Vantaa yard, because the release letter on file names the main branch. Nobody has sent that email yet. The Vantaa yard closes at 17:00 local time. Only say what you are asked; do not volunteer all of it at once.",
  },
]

export const scenarioFor = (orderId: string) => SCENARIOS.find((scenario) => scenario.orderId === orderId)

// A case keeps its private scenario in one text column. A plain string is
// what the driver knows; JSON holds both the driver's and the site's.
export const packScenario = (driver?: string | null, site?: string | null) => site ? JSON.stringify({ driver: driver ?? null, site }) : driver ?? null
export function scenarioParts(stored: string | null | undefined): { driver: string | null; site: string | null } {
  if (!stored) return { driver: null, site: null }
  if (stored.startsWith("{")) {
    try { const parsed = JSON.parse(stored) as { driver?: string | null; site?: string | null }; return { driver: parsed.driver ?? null, site: parsed.site ?? null } } catch { /* plain text after all */ }
  }
  return { driver: stored, site: null }
}
