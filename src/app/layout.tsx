import type { Metadata } from "next";
import { Fraunces, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
});

const sans = Public_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-public-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Medical Desert Planner — India",
  description:
    "Find where India's healthcare capability gaps are real versus data-poor — evidence-cited, uncertainty-honest, and ready to act on.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <nav className="app-nav">
          <a href="/" className="app-nav__link">Medical Desert Planner</a>
          <a href="/referral" className="app-nav__link">Referral Copilot</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
