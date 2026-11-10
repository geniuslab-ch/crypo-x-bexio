import Image from 'next/image';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-hero">
        <Image src="/brand/crypto2books-logo-640.png" alt="Crypto2Books — From crypto to books." width={640} height={410} priority />
        <ul>
          <li>Imports CSV Kraken, Coinbase et modèle universel</li>
          <li>Conversion CHF documentée, FIFO ou coût moyen pondéré</li>
          <li>Écritures validées envoyées dans bexio, sans doublon</li>
          <li>Piste d’audit complète pour votre fiduciaire</li>
        </ul>
      </div>
      <div className="auth-panel"><div className="auth-card">{children}</div></div>
    </div>
  );
}
