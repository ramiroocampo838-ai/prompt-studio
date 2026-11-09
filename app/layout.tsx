import type { Metadata } from "next"
import Link from "next/link"
import "./globals.css"

export const metadata: Metadata = { title: "Prompt Studio", description: "Create narrated videos from a prompt" }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            Prompt Studio
          </Link>
          <nav>
            <Link href="/">Projects</Link>
            <Link href="/images" style={{ marginLeft: 18 }}>Images</Link>
          </nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  )
}
