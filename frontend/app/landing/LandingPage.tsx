import Link from "next/link";
import styles from "./landing.module.css";

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <div className={styles.blobTopLeft} />
      <div className={styles.blobBottomRight} />

      <main className={styles.main}>
        <p className={styles.kicker}>AI Lecture Companion</p>

        <h1 className={styles.title}>
          Learn with a tutor that adapts to exactly how you think.
        </h1>

        <p className={styles.subtitle}>
          Upload a lecture or record one live, then get real-time guidance on
          the moments that confuse you most.
        </p>

        <Link className={styles.cta} href="/record">
          Start Session
        </Link>
      </main>
    </div>
  );
}
