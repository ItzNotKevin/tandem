"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./landing.module.css";
import BrandLogo from "@/components/BrandLogo";
import CursorTrail from "@/components/CursorTrail";

export default function LandingPage() {
  const router = useRouter();
  const [isWiping, setIsWiping] = useState(false);

  const handleStartSession = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsWiping(true);

    // Wait for wipe animation to cover screen before routing
    setTimeout(() => {
      router.push("/record");
    }, 600);
  };

  return (
    <div className={styles.page}>
      <CursorTrail />
      <div className={styles.blobTopLeft} />
      <div className={styles.blobBottomRight} />

      <main className={styles.main}>
        <BrandLogo className={styles.logo} />

        <p className={styles.kicker}>
          <span className={styles.kickerTextWrapper}>
            THE AHA MOMENT
            <svg
              className={styles.highlightUnderline}
              viewBox="0 0 100 20"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d="M 2 16 Q 20 18 45 14 T 98 14 M 5 18 Q 30 14 60 17 T 95 15"
                stroke="#5A5145"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength="1"
                opacity="0.8"
              />
            </svg>
          </span>, ON DEMAND
        </p>
        <h1 className={styles.title}>
          Learn with a tutor that <span className={styles.highlight}>adapts to exactly how you think.</span>
        </h1>

        <p className={styles.subtitle}>
          Upload a lecture or record one live, then get real-time guidance on
          the moments that confuse you most.
        </p>

        <a className={styles.cta} href="/record" onClick={handleStartSession}>
          <span className={styles.ctaText}>Start Session</span>
        </a>
      </main>

      {/* Screen Wipe Overlay */}
      <div className={`${styles.wipeLayer} ${isWiping ? styles.wipeActive : ''}`} />
    </div>
  );
}
