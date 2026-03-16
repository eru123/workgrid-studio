import type { SVGProps } from "react";

function iconProps(props: SVGProps<SVGSVGElement>) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export function PostgresIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path d="M8 7.5c0-2.6 1.8-4.5 4-4.5s4 1.9 4 4.5v5.3c0 3-2 5.2-4 5.2s-4-2.2-4-5.2z" />
      <path d="M10 9.2c.6-.4 1.3-.7 2-.7s1.4.3 2 .7" />
      <path d="M10.4 12.2h3.2" />
      <path d="M12 17.8v3.2" />
      <path d="M8 8.2 5.5 9.8a1.7 1.7 0 0 0-.2 2.7l2.7 2" />
      <path d="M16 8.2 18.5 9.8a1.7 1.7 0 0 1 .2 2.7l-2.7 2" />
    </svg>
  );
}

export function MysqlIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path d="M4 15.5c1.8-3.5 4.7-5.3 8.6-5.3 3.3 0 5.8 1.2 7.4 3.6" />
      <path d="M6.5 18c1.6-1.6 3.7-2.4 6.3-2.4 2.1 0 3.9.5 5.2 1.5" />
      <path d="M9 8.5c0-1.9 1.1-3.5 2.9-4.5" />
      <path d="M12.2 4c1.5.3 2.6 1.3 3.4 3" />
      <path d="M12.5 7.8c-.5 1.7-1.8 3-3.9 4" />
      <path d="M16.2 9.8c.2 1.1.8 2.1 1.8 3" />
    </svg>
  );
}

export function SqliteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <ellipse cx="12" cy="6" rx="6.5" ry="2.8" />
      <path d="M5.5 6v8c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8V6" />
      <path d="M5.5 10c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8" />
      <path d="M5.5 14c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8" />
    </svg>
  );
}

export function MariadbIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path d="M4 16.8c2.2-4.8 5.6-7.2 10.1-7.2 2.3 0 4.3.7 5.9 2.1" />
      <path d="M6.2 19.2c1.9-2 4.3-3 7.1-3 1.6 0 3.1.3 4.5.9" />
      <path d="M9.8 8.8c-.4-2 0-3.8 1.3-5.3" />
      <path d="M13.6 3.8c1.3 1 2 2.4 2.2 4.2" />
      <path d="m8.8 12.8-1.6 1.6" />
      <path d="m15.6 12.2 2.1 2.3" />
    </svg>
  );
}
