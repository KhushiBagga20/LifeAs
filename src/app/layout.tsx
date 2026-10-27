import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], weight: ["400", "600"] });

export const metadata: Metadata = {
  title: {
    default: "Block C — find the crew before they run the block",
    template: "%s · Block C",
  },
  description:
    "A social-deduction game in a modern apartment block. Play online with friends; AI neighbours fill the empty seats and an AI narrator tells every night's story.",
};

export const viewport: Viewport = { themeColor: "#0b0f1a" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
