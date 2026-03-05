import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Novel Factory",
  description: "Production-grade novel factory MVP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="font-body text-ink">
        <div className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,#ffe7c7,transparent_40%),radial-gradient(circle_at_80%_10%,#d8efe1,transparent_35%),linear-gradient(180deg,#f8f6f0,#f1ede2)]">
          {children}
        </div>
      </body>
    </html>
  );
}
