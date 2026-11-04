import type { ReactNode } from 'react';
const P = ({ children, size = 22 }: { children: ReactNode; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);
export const IHome = () => (
  <P>
    <path d="M3 11l9-8 9 8" />
    <path d="M5 10v10h14V10" />
  </P>
);
export const ICal = () => (
  <P>
    <rect x="3" y="4" width="18" height="17" rx="3" />
    <path d="M8 2v4M16 2v4M3 10h18" />
  </P>
);
export const IUsers = () => (
  <P>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5" />
    <path d="M16 4.5a3.5 3.5 0 010 7M18 14.8c2 .6 3.2 2.3 3.5 5.2" />
  </P>
);
export const IMsg = () => (
  <P>
    <path d="M21 12a8 8 0 01-11.7 7L3 21l2-5.6A8 8 0 1121 12z" />
  </P>
);
export const IGear = () => (
  <P>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </P>
);
export const IPlus = () => (
  <P size={18}>
    <path d="M12 5v14M5 12h14" />
  </P>
);
export const ICheck = () => (
  <P size={18}>
    <path d="M5 13l4 4L19 7" />
  </P>
);
export const ICopy = () => (
  <P size={16}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 012-2h10" />
  </P>
);
export const IScan = () => (
  <P>
    <path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M7 12h10" />
  </P>
);
export const ISearch = () => (
  <P size={18}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </P>
);
export const IUpload = () => (
  <P size={18}>
    <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
  </P>
);
