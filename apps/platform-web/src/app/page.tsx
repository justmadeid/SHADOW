import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ padding: 32 }}>
      <p style={{ color: "#35e6a5", fontFamily: "monospace" }}>PLATFORM / M0</p>
      <h1>Investigation Intelligence Platform</h1>
      <p style={{ color: "#a6b0bc" }}>
        Engineering foundation shell. Business product implementation begins after M0.
      </p>
      <nav style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <Link href="/shadow">SHADOW</Link>
        <Link href="/echo">ECHO</Link>
        <Link href="/spectra">SPECTRA</Link>
      </nav>
    </main>
  );
}
