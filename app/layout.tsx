import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fixo — AI Finance & Paper Trading",
  description: "Explore Indian markets, test ideas, and learn with virtual money on Fixo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
