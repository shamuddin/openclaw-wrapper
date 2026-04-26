import type { SVGProps } from 'react';

type OpenClawLogoProps = SVGProps<SVGSVGElement> & {
  title?: string;
};

export function OpenClawLogo({
  title = 'OpenClaw',
  className,
  ...props
}: OpenClawLogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
      {...props}
    >
      <rect x="4" y="4" width="56" height="56" rx="18" fill="#EEF2FF" />
      <rect x="4.75" y="4.75" width="54.5" height="54.5" rx="17.25" stroke="#D7DEFF" />

      <path
        d="M22 14.5C14.95 18.52 10.5 25.06 10.5 32C10.5 38.94 14.95 45.48 22 49.5"
        stroke="#171A2C"
        strokeWidth="4.5"
        strokeLinecap="round"
      />

      <path d="M24 32H38" stroke="#5B5CE6" strokeWidth="4.5" strokeLinecap="round" />
      <path
        d="M24 32C28.36 23.69 34.45 18.27 42 16.5"
        stroke="#5B5CE6"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M24 32C28.36 40.31 34.45 45.73 42 47.5"
        stroke="#5B5CE6"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle cx="22" cy="32" r="5.5" fill="#171A2C" />
      <circle cx="44" cy="16.5" r="4.5" fill="#5B5CE6" />
      <circle cx="48" cy="32" r="4.5" fill="#5B5CE6" />
      <circle cx="44" cy="47.5" r="4.5" fill="#5B5CE6" />

      <circle cx="20.5" cy="30.5" r="1.5" fill="#EEF2FF" opacity="0.95" />
    </svg>
  );
}
