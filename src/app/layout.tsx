import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { AuthProvider } from "@/components/auth-provider";
import { CubeAppearanceProvider } from "@/components/cube-appearance-provider";
import { CubeConnectionProvider } from "@/components/cube-connection-provider";
import { LanguageProvider } from "@/components/language-provider";
import { ScrollbarVisibilityProvider } from "@/components/scrollbar-visibility-provider";
import { SystemNotificationProvider } from "@/components/system-notification-dialog";
import { detectLocale, isLocale, LANGUAGE_COOKIE_KEY } from "@/lib/i18n";
import { ScreenWakeLockProvider } from "@/lib/screen-wake-lock";
import "./globals.css";

async function getRequestLocale() {
  const cookieStore = await cookies();
  const savedLocale = cookieStore.get(LANGUAGE_COOKIE_KEY)?.value;
  if (isLocale(savedLocale)) return savedLocale;
  const requestHeaders = await headers();
  return detectLocale(requestHeaders.get("accept-language"));
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: locale === "zh" ? "立方" : "Cube",
    description: locale === "zh" ? "魔方练习小站" : "Smart cube practice",
    icons: {
      icon: "/li-fang-logo.png",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialLocale = await getRequestLocale();

  return (
    <html lang={initialLocale === "zh" ? "zh-CN" : "en"}>
      <body suppressHydrationWarning>
        <LanguageProvider initialLocale={initialLocale}>
          <SystemNotificationProvider>
            <AuthProvider>
              <CubeAppearanceProvider>
                <CubeConnectionProvider>
                  <ScrollbarVisibilityProvider />
                  <ScreenWakeLockProvider>{children}</ScreenWakeLockProvider>
                </CubeConnectionProvider>
              </CubeAppearanceProvider>
            </AuthProvider>
          </SystemNotificationProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
