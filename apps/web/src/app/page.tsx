'use client';

import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="container">
      <h1>Multi-User Job Hunting Assistant</h1>
      <p>Module 0: Secure Foundation Base</p>
      <div style={{ marginTop: '20px' }}>
        <Link href="/login">
          <button>Log In</button>
        </Link>
        <Link href="/signup">
          <button className="secondary-button">Sign Up</button>
        </Link>
      </div>
    </div>
  );
}
