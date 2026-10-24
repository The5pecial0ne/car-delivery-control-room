// The demo cases. Each one names an order from the dataset, what starts the
// case, and what the simulated driver privately knows. The agent sees only the
// trigger and whatever it finds out by looking and asking.
//
// They are picked to show both halves of the job: cases where the agent must
// bring a person a decision, and one where it should sort things out and get
// out of the way.

export type Scenario = { orderId: string; title: string; trigger: string; driver: string }

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
]

export const scenarioFor = (orderId: string) => SCENARIOS.find((scenario) => scenario.orderId === orderId)
