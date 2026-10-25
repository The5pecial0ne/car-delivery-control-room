import type { Metadata, Viewport } from "next"
import "@fontsource/opendyslexic/400.css"
import "@fontsource/opendyslexic/700.css"
import "./globals.css"
import { READING_MODE_SCRIPT } from "./components/reading-mode"

export const metadata: Metadata = {
  title: "Car Delivery Control Room starter",
  description: "A fictional operations dataset and a simple read-only starting point.",
}

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Poppins for headings, Manrope for body text and the interface, Reddit Mono for identifiers.
            OpenDyslexic, for easy reading mode, ships with the app. The rest load from Google Fonts; without a network the stack falls back to Arial. */}
        <script dangerouslySetInnerHTML={{ __html: READING_MODE_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&family=Reddit+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
