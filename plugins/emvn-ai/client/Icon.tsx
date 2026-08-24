import * as React from "react";

type Props = {
  /** The size of the icon, 24px is default to match standard icons */
  size?: number;
  /** The color of the icon, defaults to the current text color */
  fill?: string;
};

export default function Icon({ size = 24, fill = "currentColor" }: Props) {
  return (
    <svg fill={fill} width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 2.5C12.4 2.5 12.75 2.76 12.87 3.14L14.6 8.6L20.06 10.33C20.44 10.45 20.7 10.8 20.7 11.2C20.7 11.6 20.44 11.95 20.06 12.07L14.6 13.8L12.87 19.26C12.75 19.64 12.4 19.9 12 19.9C11.6 19.9 11.25 19.64 11.13 19.26L9.4 13.8L3.94 12.07C3.56 11.95 3.3 11.6 3.3 11.2C3.3 10.8 3.56 10.45 3.94 10.33L9.4 8.6L11.13 3.14C11.25 2.76 11.6 2.5 12 2.5Z" />
      <path d="M18.5 15.5C18.72 15.5 18.91 15.64 18.98 15.85L19.53 17.47L21.15 18.02C21.36 18.09 21.5 18.28 21.5 18.5C21.5 18.72 21.36 18.91 21.15 18.98L19.53 19.53L18.98 21.15C18.91 21.36 18.72 21.5 18.5 21.5C18.28 21.5 18.09 21.36 18.02 21.15L17.47 19.53L15.85 18.98C15.64 18.91 15.5 18.72 15.5 18.5C15.5 18.28 15.64 18.09 15.85 18.02L17.47 17.47L18.02 15.85C18.09 15.64 18.28 15.5 18.5 15.5Z" />
    </svg>
  );
}
