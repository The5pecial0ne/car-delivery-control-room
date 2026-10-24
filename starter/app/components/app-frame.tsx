import Link from "next/link"
import type { ReactNode } from "react"
import { fmtDateTime } from "@/lib/present/time"
import { Icon } from "./icons"
import { ReadingModeToggle } from "./reading-mode"

export type Section = "desk" | "board" | "inbox" | "customers" | "drivers" | "sites"

const GROUPS: { label: string; links: { section: Section; href: string; label: string; icon: string }[] }[] = [
  { label: "Work", links: [
    { section: "desk", href: "/", label: "Needs you", icon: "alert" },
    { section: "board", href: "/board", label: "All orders", icon: "car" },
    { section: "inbox", href: "/inbox", label: "Inbox", icon: "inbox" },
  ] },
  { label: "People and places", links: [
    { section: "customers", href: "/customers", label: "Customers", icon: "people" },
    { section: "drivers", href: "/drivers", label: "Drivers", icon: "driver" },
    { section: "sites", href: "/sites", label: "Places", icon: "building" },
  ] },
]

/**
 * The product shell: one slim bar across the top with the wordmark, the two
 * groups of sections, and on the right the snapshot and the reading switch.
 * The page gets the full width underneath.
 */
export function AppFrame({ children, section, snapshotAt, board = false }: { children: ReactNode; section: Section; snapshotAt?: string | null; board?: boolean }) {
  return <div className={`app${board ? " app-board" : ""}`}>
    <header className="topbar">
      <Link href="/" className="wordmark" aria-label="Control Room home">Control Room</Link>
      <nav className="topbar-nav" aria-label="Main navigation">
        {GROUPS.map((group) => <div className="nav-group" role="group" aria-label={group.label} key={group.label}>
          {group.links.map((link) => <Link key={link.section} href={link.href} className={`nav-link${section === link.section ? " active" : ""}`} aria-current={section === link.section ? "page" : undefined}>
            <Icon name={link.icon} size={15} />{link.label}
          </Link>)}
        </div>)}
      </nav>
      <div className="topbar-end">
        <span className="topbar-snapshot" title="Fictional data, read only">{snapshotAt ? `Snapshot ${fmtDateTime(snapshotAt)}` : "Fictional snapshot"}</span>
        <ReadingModeToggle />
      </div>
    </header>
    <div className="main">{children}</div>
  </div>
}
