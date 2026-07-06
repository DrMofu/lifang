import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { CubeAppearanceProvider } from "@/components/cube-appearance-provider";
import { CubeConnectionProvider } from "@/components/cube-connection-provider";
import { ScrollbarVisibilityProvider } from "@/components/scrollbar-visibility-provider";
import { ScreenWakeLockProvider } from "@/lib/screen-wake-lock";
import "./globals.css";

export const metadata: Metadata = {
  title: "立方",
  description: "魔方练习小站",
  icons: {
    icon: "/li-fang-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body suppressHydrationWarning>
        <AuthProvider>
          <CubeAppearanceProvider>
            <CubeConnectionProvider>
              <ScrollbarVisibilityProvider />
              <ScreenWakeLockProvider>{children}</ScreenWakeLockProvider>
            </CubeConnectionProvider>
          </CubeAppearanceProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
