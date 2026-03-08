import Link from "next/link";
import styles from "./landing.module.css";
import BrandLogo from "@/components/BrandLogo";

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <div className={styles.blobTopLeft} />
      <div className={styles.blobBottomRight} />

      <main className={styles.main}>
        <BrandLogo className={styles.logo} />

        <h1 className={styles.title}>
          Learn with a tutor that <span className={styles.highlight}>adapts to exactly how you think.</span>
        </h1>

        <p className={styles.subtitle}>
          Upload a lecture or record one live, then get real-time guidance on
          the moments that confuse you most.
        </p>

        <Link className={styles.cta} href="/record">
          <span className={styles.ctaText}>Start Session</span>
        </Link>
      </main>
    </div>
  );
}
