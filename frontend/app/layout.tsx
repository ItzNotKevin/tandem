import type { Metadata } from "next";
import { Geist, Geist_Mono, Caveat, Kalam, Permanent_Marker, Reenie_Beanie, Nothing_You_Could_Do, Shadows_Into_Light } from "next/font/google";
import "./globals.css";
import 'katex/dist/katex.min.css';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
});

const kalam = Kalam({
  weight: ['400', '700'],
  variable: "--font-kalam",
  subsets: ["latin"],
});

const permanentMarker = Permanent_Marker({
  weight: '400',
  variable: "--font-permanent-marker",
  subsets: ["latin"],
});

const reenieBeanie = Reenie_Beanie({
  weight: '400',
  variable: "--font-reenie",
  subsets: ["latin"],
});

const nothingYouCouldDo = Nothing_You_Could_Do({
  weight: '400',
  variable: "--font-nothing",
  subsets: ["latin"],
});

const shadowsIntoLight = Shadows_Into_Light({
  weight: '400',
  variable: "--font-shadows",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tandem",
  description: "AI lecture companion",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable} ${kalam.variable} ${permanentMarker.variable} ${reenieBeanie.variable} ${nothingYouCouldDo.variable} ${shadowsIntoLight.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
