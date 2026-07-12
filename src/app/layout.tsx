import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Console",
  description: "A resilient real-time console for the Alchemyst mock agent backend.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
