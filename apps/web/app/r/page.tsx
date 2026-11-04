'use client';
import { useEffect, useState } from 'react';
import { GuestRsvp } from '@/components/GuestRsvp';

/** Guest RSVP entry. The bearer token lives in the URL fragment (/r#<token>), so it never reaches server logs or Referer headers. */
export default function RsvpPage() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const read = () => setToken(window.location.hash.replace(/^#/, '') || null);
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  if (token === undefined)
    return (
      <div className="guest-wrap">
        <div className="skel" style={{ width: 240, height: 24, marginTop: 40 }} />
      </div>
    );
  if (!token)
    return (
      <div className="guest-wrap">
        <main className="guest-card" id="main">
          <div className="guest-body">
            <h1>This link is not valid</h1>
            <p>Please open the personal link you received from the host.</p>
          </div>
        </main>
      </div>
    );
  return <GuestRsvp token={token} />;
}
