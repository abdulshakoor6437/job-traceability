import './globals.css';
import React from 'react';

export const metadata = {
  title: 'Job Hunting Assistant - Foundation',
  description: 'Multi-user job application platform base',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
