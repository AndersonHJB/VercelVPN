import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "YAML Link Manager",
  description: "Generate expiring YAML access links."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
