import "./globals.css";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Epostscanner",
  description: "Fulltekst-søk i EML-arkiv",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="no">
      <body>{children}</body>
    </html>
  );
}
